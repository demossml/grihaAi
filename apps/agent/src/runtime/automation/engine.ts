/**
 * Phase 10 (Item 10.2, матрица J2) — AutomationEngine контракт (§21).
 *
 * one-shot / recurring / cron, agent-job / no-agent job, pause/resume/remove.
 * In-memory реализация; wiring к существующему CronService — за флагом.
 */
import { validateScriptJob, type ScriptJobSpec } from "./script.js";

export type AutomationJobKind = "one-shot" | "recurring" | "cron";

export type AutomationJobStatus = "idle" | "running" | "paused" | "done" | "failed";

export interface AutomationJob {
  id: string;
  name: string;
  kind: AutomationJobKind;
  schedule?: string;
  prompt?: string;
  /** agent = через LLM-runner; script = без LLM (J4). */
  runAs: "agent" | "script";
  script?: ScriptJobSpec;
  status: AutomationJobStatus;
  lastRunAt?: string;
  lastError?: string;
}

export interface AutomationEngine {
  create(job: Omit<AutomationJob, "id" | "status">): Promise<string>;
  run(id: string): Promise<void>;
  pause(id: string): Promise<void>;
  resume(id: string): Promise<void>;
  remove(id: string): Promise<void>;
}

export interface AutomationRunners {
  runAgent?: (job: AutomationJob) => Promise<void>;
  runScript?: (job: AutomationJob, spec: ScriptJobSpec) => Promise<void>;
  now?: () => string;
  idFactory?: () => string;
}

let seq = 0;
const defaultId = () => `job-${++seq}`;

export class InMemoryAutomationEngine implements AutomationEngine {
  private readonly jobs = new Map<string, AutomationJob>();
  private readonly runners: AutomationRunners;
  private readonly now: () => string;
  private readonly idFactory: () => string;

  constructor(runners: AutomationRunners = {}) {
    this.runners = runners;
    this.now = runners.now ?? (() => new Date().toISOString());
    this.idFactory = runners.idFactory ?? defaultId;
  }

  async create(job: Omit<AutomationJob, "id" | "status">): Promise<string> {
    if (job.runAs === "script") {
      if (!job.script) throw new Error("script job requires script spec");
      validateScriptJob(job.script);
    } else if (!job.prompt) {
      throw new Error("agent job requires prompt");
    }
    const record: AutomationJob = {
      ...job,
      id: this.idFactory(),
      status: "idle",
    };
    this.jobs.set(record.id, record);
    return record.id;
  }

  async run(id: string): Promise<void> {
    const job = this.jobs.get(id);
    if (!job) throw new Error(`job not found: ${id}`);
    if (job.status === "paused") throw new Error(`job is paused: ${id}`);
    job.status = "running";
    job.lastError = undefined;
    try {
      if (job.runAs === "script" && job.script) {
        if (!this.runners.runScript) throw new Error("no script runner injected");
        await this.runners.runScript(job, job.script);
      } else {
        if (!this.runners.runAgent) throw new Error("no agent runner injected");
        await this.runners.runAgent(job);
      }
      job.status = job.kind === "one-shot" ? "done" : "idle";
      job.lastRunAt = this.now();
    } catch (err) {
      job.status = "failed";
      job.lastError = err instanceof Error ? err.message : String(err);
    }
  }

  async pause(id: string): Promise<void> {
    const job = this.require(id);
    job.status = "paused";
  }

  async resume(id: string): Promise<void> {
    const job = this.require(id);
    if (job.status !== "paused") throw new Error(`job is not paused: ${id}`);
    job.status = "idle";
  }

  async remove(id: string): Promise<void> {
    if (!this.jobs.delete(id)) throw new Error(`job not found: ${id}`);
  }

  get(id: string): AutomationJob | undefined {
    const job = this.jobs.get(id);
    return job ? { ...job } : undefined;
  }

  list(): AutomationJob[] {
    return [...this.jobs.values()].map((j) => ({ ...j }));
  }

  private require(id: string): AutomationJob {
    const job = this.jobs.get(id);
    if (!job) throw new Error(`job not found: ${id}`);
    return job;
  }
}
