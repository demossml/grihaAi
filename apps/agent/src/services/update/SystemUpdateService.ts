/**
 * system_update: безопасное самообновление из demossml/grihaAi + перезапуск.
 * Инварианты: только demossml/grihaAi, данные ~/.grish-ai не трогаются,
 * dirty → отказ, build упал → без restart, restart через systemd-команду.
 */
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { emit } from "@griha/observability";
import { GRIHA_DEFAULT_BRANCH } from "./constants.js";
import type { ExecFn, SystemUpdateDeps, UpdateAction, UpdateResult } from "./types.js";

const execFileAsync = promisify(execFile);

const defaultExec: ExecFn = async (cmd, args, opts) => {
  const r = await execFileAsync(cmd, args, {
    cwd: opts.cwd,
    timeout: opts.timeout,
    maxBuffer: 16 * 1024 * 1024,
  });
  return { stdout: String(r.stdout), stderr: String(r.stderr) };
};

const DEFAULT_BUILD_TIMEOUT = 10 * 60_000;
const DEFAULT_GIT_TIMEOUT = 2 * 60_000;

/** remote должен указывать на demossml/grihaAi (https или ssh). */
export function isAllowedRemote(url: string): boolean {
  const u = url.trim().toLowerCase();
  return (
    u.includes("github.com/demossml/grihaai") ||
    u.includes("github.com:demossml/grihaai")
  );
}

export class SystemUpdateService {
  private readonly exec: ExecFn;
  private readonly branch: string;

  constructor(private readonly deps: SystemUpdateDeps) {
    this.exec = deps.exec ?? defaultExec;
    this.branch = deps.branch ?? GRIHA_DEFAULT_BRANCH;
  }

  private async git(args: string[], cwd: string): Promise<{ stdout: string; stderr: string }> {
    return this.exec("git", args, { cwd, timeout: DEFAULT_GIT_TIMEOUT });
  }

  private async gitRoot(cwd: string): Promise<string> {
    const { stdout } = await this.git(["rev-parse", "--show-toplevel"], cwd);
    return stdout.trim();
  }

  private async remoteUrl(cwd: string): Promise<string> {
    const { stdout } = await this.git(["remote", "get-url", "origin"], cwd);
    return stdout.trim();
  }

  private async headSha(cwd: string): Promise<string> {
    const { stdout } = await this.git(["rev-parse", "HEAD"], cwd);
    return stdout.trim();
  }

  private async dirtyFiles(cwd: string): Promise<string[]> {
    const { stdout } = await this.git(["status", "--porcelain"], cwd);
    return stdout
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
  }

  private defaultBuild(repoDir: string, log: string[]): Promise<{ ok: boolean; message?: string }> {
    return this.runBuildSteps(
      [
        { cmd: "npm", args: ["install"], label: "npm install" },
        { cmd: "npx", args: ["turbo", "run", "build"], label: "turbo build" },
      ],
      repoDir,
      log,
    );
  }

  private async runBuildSteps(
    steps: Array<{ cmd: string; args: string[]; label: string }>,
    repoDir: string,
    log: string[],
  ): Promise<{ ok: boolean; message?: string }> {
    for (const step of steps) {
      try {
        const r = await this.exec(step.cmd, step.args, { cwd: repoDir, timeout: DEFAULT_BUILD_TIMEOUT });
        log.push(`${step.label}: ok`);
        if (r.stdout.trim()) log.push(r.stdout.trim().slice(-2000));
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        log.push(`${step.label}: FAILED`);
        return { ok: false, message };
      }
    }
    return { ok: true };
  }

  async status(): Promise<UpdateResult> {
    const started = Date.now();
    const log: string[] = [];
    try {
      const root = await this.gitRoot(this.deps.repoDir);
      const remote = await this.remoteUrl(root);
      if (!isAllowedRemote(remote)) {
        return { ok: false, action: "status", code: "WRONG_REMOTE", message: "origin не demossml/grihaAi", log };
      }
      const sha = await this.headSha(root);
      const branchOut = await this.git(["rev-parse", "--abbrev-ref", "HEAD"], root);
      const branch = branchOut.stdout.trim();
      const dirty = await this.dirtyFiles(root);
      log.push(`remote=${remote}`);
      log.push(`sha=${sha}`);
      log.push(`branch=${branch}`);
      log.push(`dirty=${dirty.length > 0 ? "yes" : "no"}`);
      emit({
        component: "system_update",
        event: "system_update.end",
        ok: true,
        data: { action: "status", beforeSha: sha },
      });
      return {
        ok: true,
        action: "status",
        beforeSha: sha,
        afterSha: sha,
        branch,
        remote,
        restarted: false,
        log,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { ok: false, action: "status", code: "INTERNAL", message, log };
    }
  }

  async run(opts: { userId?: string; fromCli?: boolean }): Promise<UpdateResult> {
    const started = Date.now();
    const log: string[] = [];
    const action: UpdateAction = "run";
    emit({ component: "system_update", event: "system_update.start", data: { action } });

    try {
      // Owner gate (CLI может обойти).
      if (!opts.fromCli) {
        if (this.deps.assertOwner && !(await this.deps.assertOwner(opts.userId))) {
          return { ok: false, action, code: "DENY", message: "Только владелец бота.", log };
        }
      }

      const root = await this.gitRoot(this.deps.repoDir);
      const remote = await this.remoteUrl(root);
      if (!isAllowedRemote(remote)) {
        return { ok: false, action, code: "WRONG_REMOTE", message: "origin не demossml/grihaAi", log };
      }
      log.push(`remote=${remote}`);

      const dirty = await this.dirtyFiles(root);
      if (dirty.length > 0) {
        return {
          ok: false,
          action,
          code: "DIRTY",
          message: "Есть локальные изменения — отказ (не тянем поверх).",
          log,
        };
      }

      const beforeSha = await this.headSha(root);
      log.push(`before=${beforeSha}`);

      await this.git(["fetch", "origin"], root);
      try {
        const merge = await this.git(["merge", "--ff-only", `origin/${this.branch}`], root);
        if (merge.stdout.trim()) log.push(merge.stdout.trim());
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        log.push(`merge: FAILED ${message}`);
        return { ok: false, action, code: "GIT", message: message.slice(-500), beforeSha, log };
      }

      const afterSha = await this.headSha(root);
      log.push(`after=${afterSha}`);

      if (beforeSha === afterSha) {
        emit({ component: "system_update", event: "system_update.end", ok: true, data: { action, beforeSha, afterSha } });
        return {
          ok: true,
          action,
          beforeSha,
          afterSha,
          branch: this.branch,
          remote,
          restarted: false,
          log,
        };
      }

      // Сборка. Fail → без restart.
      const build = this.deps.runBuild
        ? await this.deps.runBuild(root, log)
        : await this.defaultBuild(root, log);
      if (!build.ok) {
        return {
          ok: false,
          action,
          code: "BUILD",
          message: build.message ?? "build failed",
          beforeSha,
          afterSha,
          log,
        };
      }

      // Restart.
      const restartCmd = this.resolveRestartCommand();
      try {
        spawn(restartCmd[0], restartCmd.slice(1), { detached: true, stdio: "ignore" }).unref();
        log.push(`restart spawned: ${restartCmd.join(" ")}`);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { ok: false, action, code: "RESTART", message, beforeSha, afterSha, log };
      }

      emit({ component: "system_update", event: "system_update.end", ok: true, data: { action, beforeSha, afterSha } });
      return {
        ok: true,
        action,
        beforeSha,
        afterSha,
        branch: this.branch,
        remote,
        restarted: true,
        log,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { ok: false, action, code: "INTERNAL", message, log };
    }
  }

  private resolveRestartCommand(): string[] {
    if (this.deps.restartCommand && this.deps.restartCommand.length > 0) {
      return this.deps.restartCommand;
    }
    const fromEnv = process.env.GRIHA_RESTART_CMD?.trim();
    if (fromEnv) return fromEnv.split(/\s+/).filter(Boolean);
    return ["systemctl", "--user", "restart", "griha-ai"];
  }
}
