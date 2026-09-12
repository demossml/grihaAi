/**
 * System update — безопасное обновление кода с remote git (U1–U12).
 *
 * - только fetch + pull --ff-only; reset/clean/push/rebase/rm запрещены;
 * - dirty tree → отказ ДО любого pull;
 * - данные (~/.grish-ai) никогда не пишутся/не удаляются (кроме append-лога
 *   updates.log и runtime/restart.flag);
 * - сборка упала → рестарт НЕ вызывается.
 */
import fs from "node:fs";
import path from "node:path";

export type UpdateStep =
  | "precheck"
  | "fetch"
  | "pull"
  | "install"
  | "build"
  | "restart"
  | "done"
  | "failed";

export interface UpdateResult {
  ok: boolean;
  step: UpdateStep;
  message: string;
  beforeSha?: string;
  afterSha?: string;
  /** restart: requested (cmd) | flag | exit | skipped. */
  restart?: string;
  logTail?: string;
}

export interface ExecResult {
  code: number;
  stdout: string;
  stderr: string;
}

export type ExecFn = (
  cmd: string,
  args: string[],
  opts: { cwd: string; timeoutMs: number },
) => Promise<ExecResult>;

export interface UpdateDeps {
  repoDir: string;
  /** default: getConfigDir() — must NOT equal repoDir. */
  dataDir: string;
  exec: ExecFn;
  /** request restart via supervisor; may no-op in tests. Returns kind. */
  requestRestart: () => Promise<string>;
  log: (line: string) => void;
}

/** U4: чёрный список git-подкоманд. */
export const FORBIDDEN_GIT_SUBCOMMANDS = [
  "reset",
  "clean",
  "push",
  "rebase",
  "filter-branch",
  "rm",
];

/** U2: автодетект корня репозитория вверх от startDir (до 8 уровней). */
export function findRepoRoot(startDir: string): string | null {
  let dir = path.resolve(startDir);
  for (let i = 0; i < 8; i++) {
    if (fs.existsSync(path.join(dir, ".git"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

/** U2/U3: repo и data не должны совпадать/вложиться, data не git-репо. */
export function assertSafeDirs(repoDir: string, dataDir: string): void {
  const repo = path.resolve(repoDir);
  const data = path.resolve(dataDir);
  if (repo === data) {
    throw new Error("repoDir and dataDir must differ");
  }
  if (fs.existsSync(path.join(data, ".git"))) {
    throw new Error("dataDir looks like a git repo — refuse");
  }
  const rel = path.relative(data, repo);
  if (rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel))) {
    throw new Error("repoDir must not be inside dataDir");
  }
}

/** Имя ветки из rev-parse: только безопасные символы. */
const BRANCH_RE = /^[A-Za-z0-9._\-/]+$/;

/** U4: чёрный список git-подкоманд — бросает ДО вызова. */
export function guardExec(cmd: string, args: string[]): void {
  if (cmd === "git" && args.length > 0 && FORBIDDEN_GIT_SUBCOMMANDS.includes(args[0])) {
    throw new Error(`forbidden git subcommand: ${args[0]}`);
  }
}

/** U4: только известные git-команды, только ff-only. */
async function runSafeUpdate(deps: UpdateDeps): Promise<UpdateResult> {
  try {
    assertSafeDirs(deps.repoDir, deps.dataDir);
  } catch (err: unknown) {
    return {
      ok: false,
      step: "precheck",
      message: err instanceof Error ? err.message : String(err),
    };
  }
  if (!fs.existsSync(path.join(path.resolve(deps.repoDir), ".git"))) {
    return { ok: false, step: "precheck", message: `.git не найден в repoDir: ${deps.repoDir}` };
  }

  const run = async (cmd: string, args: string[], timeoutMs: number): Promise<ExecResult> => {
    guardExec(cmd, args);
    const r = await deps.exec(cmd, args, { cwd: deps.repoDir, timeoutMs });
    deps.log(`${cmd} ${args.join(" ")} → exit ${r.code}`);
    return r;
  };

  // U5: dirty tree → стоп, без pull.
  const status = await run("git", ["status", "--porcelain"], 30_000);
  if (status.code !== 0) {
    return {
      ok: false,
      step: "precheck",
      message: `git status failed:\n${status.stderr || status.stdout}`,
    };
  }
  const dirty = status.stdout.split("\n").map((l) => l.trim()).filter(Boolean);
  if (dirty.length > 0) {
    return {
      ok: false,
      step: "precheck",
      message: `Локальные изменения, обновление отменено:\n${dirty.slice(0, 20).join("\n")}`,
    };
  }

  const before = await run("git", ["rev-parse", "HEAD"], 30_000);
  if (before.code !== 0) {
    return {
      ok: false,
      step: "precheck",
      message: `git rev-parse HEAD failed:\n${before.stderr || before.stdout}`,
    };
  }
  const beforeSha = before.stdout.trim();

  const br = await run("git", ["rev-parse", "--abbrev-ref", "HEAD"], 30_000);
  const branch = br.stdout.trim();
  if (br.code !== 0 || !branch) {
    return { ok: false, step: "precheck", message: "не удалось определить ветку" };
  }
  if (branch === "HEAD") {
    return { ok: false, step: "precheck", message: "detached HEAD — обновите вручную" };
  }
  if (!BRANCH_RE.test(branch)) {
    return { ok: false, step: "precheck", message: "недопустимое имя ветки" };
  }

  const fetch = await run("git", ["fetch", "origin"], 120_000);
  if (fetch.code !== 0) {
    return {
      ok: false,
      step: "fetch",
      message: `git fetch failed:\n${fetch.stderr || fetch.stdout}`,
    };
  }

  const pull = await run("git", ["pull", "--ff-only", "origin", branch], 120_000);
  if (pull.code !== 0) {
    return {
      ok: false,
      step: "pull",
      message: `git pull --ff-only failed:\n${pull.stderr || pull.stdout}`,
    };
  }

  const after = await run("git", ["rev-parse", "HEAD"], 30_000);
  const afterSha = after.stdout.trim();

  // U6: зависимости — только если менялись lock/package.
  const diff = await run(
    "git",
    ["diff", "--name-only", beforeSha, afterSha, "--", "package.json", "package-lock.json", "apps/agent/package.json"],
    30_000,
  );
  const changedFiles = diff.stdout.split("\n").map((l) => l.trim()).filter(Boolean);
  if (changedFiles.length > 0) {
    let inst = await run("npm", ["ci"], 600_000);
    if (inst.code !== 0) {
      deps.log("npm ci failed — fallback npm install");
      inst = await run("npm", ["install"], 600_000);
    }
    if (inst.code !== 0) {
      return {
        ok: false,
        step: "install",
        message: `npm install failed:\n${(inst.stderr || inst.stdout).slice(-2000)}`,
      };
    }
  }

  // U7: build — при падении рестарт НЕ вызывается.
  const build = await run("npx", ["turbo", "run", "build"], 600_000);
  if (build.code !== 0) {
    return {
      ok: false,
      step: "build",
      message: `Build failed:\n${(build.stderr || build.stdout).slice(-2000)}`,
    };
  }

  // U8: рестарт через внешний механизм.
  let restart = "skipped";
  try {
    restart = await deps.requestRestart();
    deps.log(`restart: ${restart}`);
  } catch (err: unknown) {
    deps.log(`restart request failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  return {
    ok: true,
    step: "done",
    restart,
    beforeSha,
    afterSha,
    message: `Обновление кода завершено (${beforeSha.slice(0, 7)} → ${afterSha.slice(0, 7)}).`,
  };
}

export { runSafeUpdate };

/**
 * U8: рестарт по приоритету:
 * 1) GRIHA_RESTART_CMD — полная команда через sh -c;
 * 2) flag-файл <dataDir>/runtime/restart.flag для внешнего watcher'а;
 * 3) process.exit(0) ТОЛЬКО при GRIHA_UPDATE_EXIT=1 (systemd Restart=always).
 */
export function createRestartRequester(dataDir: string, exec: ExecFn): () => Promise<string> {
  return async () => {
    const cmd = process.env.GRIHA_RESTART_CMD?.trim();
    if (cmd) {
      await exec("sh", ["-c", cmd], { cwd: dataDir, timeoutMs: 30_000 });
      return "requested";
    }
    const flagDir = path.join(dataDir, "runtime");
    fs.mkdirSync(flagDir, { recursive: true });
    fs.writeFileSync(path.join(flagDir, "restart.flag"), `${new Date().toISOString()}\n`);
    if (process.env.GRIHA_UPDATE_EXIT === "1") {
      setTimeout(() => process.exit(0), 500);
      return "exit";
    }
    return "flag";
  };
}

/** U10: лог в stdout + append-only ~/.grish-ai/logs/update.log. */
export function createUpdateLogger(dataDir: string): (line: string) => void {
  const logPath = path.join(dataDir, "logs", "update.log");
  return (line: string) => {
    const stamped = `${new Date().toISOString()} ${line}`;
    console.log(`[system-update] ${stamped}`);
    try {
      fs.mkdirSync(path.dirname(logPath), { recursive: true });
      fs.appendFileSync(logPath, `${stamped}\n`, { encoding: "utf8", mode: 0o600 });
    } catch {
      /* лог — не критично */
    }
  };
}

/** U1: owner = роль owner ИЛИ id == config.ownerUserId. */
export async function isOwnerCheck(
  deps: {
    getRole: (userId: string) => Promise<string | null>;
    ownerUserId?: string;
  },
  userId: string,
): Promise<boolean> {
  if (deps.ownerUserId && String(userId) === String(deps.ownerUserId)) return true;
  return (await deps.getRole(userId)) === "owner";
}
