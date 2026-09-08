import { randomUUID } from "node:crypto";
import type {
  SharedInsight,
  SteerCommand,
  SubAgentState,
  SubAgentTask,
} from "../../../src/types/index.js";

export interface RunSubAgentOptions {
  goal: string;
  context?: string;
  role?: string;
  parentSessionId: string;
  projectId?: string;
}

export interface SubAgentResult {
  taskId: string;
  subtreeSessionId: string;
  result: string;
  insights?: string[];
}

export interface SubAgentRunTask {
  goal: string;
  context?: string;
  role?: string;
  subtreeSessionId: string;
  signal: AbortSignal;
  /** Runner reports partial progress here. */
  onPartial?: (partial: string) => void;
  /** Runner assigns this; the manager calls it to deliver a redirect. */
  onSteer?: (message: string) => void;
}

/** Executes a single sub-agent task. Swap for a real LLM runner later. */
export interface SubAgentRunner {
  (task: SubAgentRunTask): Promise<{ result: string; insights?: string[] }>;
}

export interface InsightsStore {
  addInsight(insight: Omit<SharedInsight, "id" | "createdAt">): Promise<SharedInsight>;
}

/**
 * Runs sub-agent tasks with isolated memory scoped by a per-task
 * `subtreeSessionId`, tracks live state for steering, collects results, and
 * writes explicit insights into the Shared Insights layer.
 *
 * Depth is implicitly 1 — the runner is not given a way to spawn further
 * sub-agents.
 */
export class SubAgentManager {
  private readonly states = new Map<string, SubAgentState>();
  private readonly runTasks = new Map<string, SubAgentRunTask>();
  private readonly controllers = new Map<string, AbortController>();
  private readonly runPromises = new Map<string, Promise<void>>();
  private readonly results = new Map<string, SubAgentResult>();

  constructor(
    private readonly insights: InsightsStore,
    private readonly runner: SubAgentRunner,
  ) {}

  /** Start a sub-agent and return immediately (task runs in background). */
  start(options: RunSubAgentOptions): SubAgentResult {
    const taskId = randomUUID();
    const subtreeSessionId = randomUUID();
    const now = new Date().toISOString();
    const controller = new AbortController();

    const state: SubAgentState = {
      taskId,
      subtreeSessionId,
      goal: options.goal,
      role: options.role,
      status: "running",
      startedAt: now,
      lastUpdateAt: now,
      steeringMessages: [],
      parentSessionId: options.parentSessionId,
    };
    this.states.set(taskId, state);
    this.controllers.set(taskId, controller);

    const runTask: SubAgentRunTask = {
      goal: options.goal,
      context: options.context,
      role: options.role,
      subtreeSessionId,
      signal: controller.signal,
      onPartial: (partial) => {
        state.partialResult = partial;
        state.lastUpdateAt = new Date().toISOString();
      },
    };
    this.runTasks.set(taskId, runTask);

    const runPromise = this.runner(runTask).then(
      async (run) => {
        if (state.status === "stopped") return;
        state.status = "completed";
        state.finalResult = run.result;
        state.lastUpdateAt = new Date().toISOString();
        this.results.set(taskId, { taskId, subtreeSessionId, result: run.result, insights: run.insights });

        if (run.insights) {
          for (const content of run.insights) {
            await this.insights.addInsight({
              content,
              sourceTaskId: taskId,
              sourceBotId: subtreeSessionId,
              projectId: options.projectId,
            });
          }
        }
      },
      (error) => {
        if (state.status === "stopped") return;
        state.status = "failed";
        state.finalResult = error instanceof Error ? error.message : String(error);
        state.lastUpdateAt = new Date().toISOString();
        this.results.set(taskId, {
          taskId,
          subtreeSessionId,
          result: state.finalResult,
        });
      },
    );
    this.runPromises.set(taskId, runPromise);

    return { taskId, subtreeSessionId, result: "" };
  }

  /** Start and wait for completion (Phase 5 semantics). */
  async runOne(options: RunSubAgentOptions): Promise<SubAgentResult> {
    const handle = this.start(options);
    return this.waitFor(handle.taskId);
  }

  async waitFor(taskId: string): Promise<SubAgentResult> {
    const promise = this.runPromises.get(taskId);
    if (promise) await promise;
    const result = this.results.get(taskId);
    if (result) return result;
    const state = this.states.get(taskId);
    if (!state) throw new Error(`Unknown task: ${taskId}`);
    return {
      taskId,
      subtreeSessionId: state.subtreeSessionId,
      result: state.partialResult ?? state.finalResult ?? "",
    };
  }

  async delegate(tasks: RunSubAgentOptions[]): Promise<SubAgentResult[]> {
    const results: SubAgentResult[] = [];
    for (const task of tasks) {
      results.push(await this.runOne(task));
    }
    return results;
  }

  listRunning(): SubAgentState[] {
    return this.listAll().filter(
      (s) => s.status === "running" || s.status === "steered" || s.status === "pending",
    );
  }

  listAll(): SubAgentState[] {
    return [...this.states.values()];
  }

  getState(taskId: string): SubAgentState | null {
    return this.states.get(taskId) ?? null;
  }

  async steer(taskId: string, command: SteerCommand): Promise<void> {
    const state = this.states.get(taskId);
    const runTask = this.runTasks.get(taskId);
    if (!state) throw new Error(`Unknown task: ${taskId}`);

    state.steeringMessages = [...(state.steeringMessages ?? []), command.message];
    state.lastUpdateAt = new Date().toISOString();

    if (command.action === "stop") {
      await this.stop(taskId, true);
      return;
    }
    if (command.action === "redirect") {
      state.status = "steered";
    }
    runTask?.onSteer?.(command.message);
  }

  async stop(taskId: string, keepPartial: boolean): Promise<SubAgentResult> {
    const state = this.states.get(taskId);
    if (!state) throw new Error(`Unknown task: ${taskId}`);
    this.controllers.get(taskId)?.abort();
    state.status = "stopped";
    state.lastUpdateAt = new Date().toISOString();
    const result: SubAgentResult = {
      taskId,
      subtreeSessionId: state.subtreeSessionId,
      result: keepPartial ? (state.partialResult ?? "") : "",
    };
    this.results.set(taskId, result);
    return result;
  }

  /** Phase 5 compatibility: persistent task records. */
  listTasks(): SubAgentTask[] {
    return this.listAll().map((s) => this.toTask(s));
  }

  getTask(id: string): SubAgentTask | undefined {
    const state = this.states.get(id);
    return state ? this.toTask(state) : undefined;
  }

  private toTask(state: SubAgentState): SubAgentTask {
    return {
      id: state.taskId,
      goal: state.goal,
      role: state.role,
      status: state.status,
      result: state.finalResult ?? state.partialResult,
      parentSessionId: state.parentSessionId,
      subtreeSessionId: state.subtreeSessionId,
      createdAt: state.startedAt,
      finishedAt:
        state.status === "completed" || state.status === "failed" || state.status === "stopped"
          ? state.lastUpdateAt
          : undefined,
    };
  }
}
