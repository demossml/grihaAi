import { randomUUID } from "node:crypto";
import type { CronChangeDetector, CronRunner } from "./CronService.js";
import type { CronJob } from "../../../src/types/index.js";
import type { SubAgentRunner } from "../multi-agent/SubAgentManager.js";

/**
 * Deterministic snapshot of the job's externally-editable durable state.
 * Run outputs (`lastRunAt`, `lastResult`) are deliberately excluded — they
 * change on every run and would make monitorMode fire forever. Editing the
 * prompt/schedule/notepad/enabled between ticks is what counts as "changed".
 */
export function computeCronStateSnapshot(job: CronJob): string {
  return JSON.stringify({
    schedule: job.schedule,
    prompt: job.prompt,
    enabled: job.enabled,
    continuity: job.continuity,
    monitorMode: job.monitorMode,
    notepad: job.notepad ?? null,
    projectId: job.projectId ?? null,
  });
}

/**
 * Real `CronRunner`: executes the cron prompt through the same `SubAgentRunner`
 * path (isolated `AgentSession` per run) that delegation uses — no parallel
 * agent-launch mechanism.
 */
export function createRealCronRunner(subAgentRunner: SubAgentRunner): CronRunner {
  return async (job, effectivePrompt) => {
    const result = await subAgentRunner({
      goal: effectivePrompt,
      role: "cron",
      context: `Cron job: ${job.name} (${job.id})`,
      subtreeSessionId: `cron:${job.id}:${randomUUID()}`,
      signal: new AbortController().signal,
    });
    return { result: result.result, usedLlm: true };
  };
}

/**
 * Real `CronChangeDetector`: diffs the job's monitorable state against the
 * snapshot persisted in the durable sqlite schema on the previous successful
 * run. Returns true (changed) when they differ — including the first run,
 * where no snapshot has been stored yet.
 */
export function createRealCronChangeDetector(
  getStoredSnapshot: (jobId: string) => Promise<string | null>,
): CronChangeDetector {
  return async (job) => {
    const current = computeCronStateSnapshot(job);
    const stored = await getStoredSnapshot(job.id);
    return stored !== current;
  };
}
