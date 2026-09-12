/**
 * System update tool — guardrails (U1–U11). Моки exec — реальный git не трогаем.
 */
import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  FORBIDDEN_GIT_SUBCOMMANDS,
  assertSafeDirs,
  findRepoRoot,
  guardExec,
  isOwnerCheck,
  runSafeUpdate,
  type ExecResult,
  type UpdateDeps,
} from "../../src/services/system/update-service.js";

const tmpDirs: string[] = [];
afterEach(() => {
  for (const d of tmpDirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

function makeDirs(): { repoDir: string; dataDir: string } {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "upd-"));
  tmpDirs.push(base);
  const repoDir = path.join(base, "repo");
  const dataDir = path.join(base, "data");
  fs.mkdirSync(path.join(repoDir, ".git"), { recursive: true });
  fs.mkdirSync(dataDir, { recursive: true });
  return { repoDir, dataDir };
}

type Rule = (cmd: string, args: string[]) => ExecResult | undefined;

function mockExec(rules: Rule[]): {
  exec: UpdateDeps["exec"];
  calls: string[];
} {
  const calls: string[] = [];
  const exec: UpdateDeps["exec"] = async (cmd, args) => {
    calls.push(`${cmd} ${args.join(" ")}`);
    for (const rule of rules) {
      const r = rule(cmd, args);
      if (r) return r;
    }
    return { code: 0, stdout: "", stderr: "" };
  };
  return { exec, calls };
}

const ok = (stdout = ""): ExecResult => ({ code: 0, stdout, stderr: "" });

function deps(over: Partial<UpdateDeps> & { repoDir: string; dataDir: string; exec: UpdateDeps["exec"] }): UpdateDeps {
  return {
    requestRestart: async () => "flag",
    log: () => undefined,
    ...over,
  };
}

// ── Guardrails ─────────────────────────────────────────────────────────────

describe("system-update guardrails", () => {
  it("assertSafeDirs: одинаковые пути → throw", () => {
    const d = makeDirs();
    assert.throws(() => assertSafeDirs(d.repoDir, d.repoDir), /must differ/);
  });

  it("assertSafeDirs: dataDir — git-репо → throw", () => {
    const d = makeDirs();
    fs.mkdirSync(path.join(d.dataDir, ".git"));
    assert.throws(() => assertSafeDirs(d.repoDir, d.dataDir), /git repo/);
  });

  it("repoDir внутри dataDir → throw", () => {
    const d = makeDirs();
    const repoInside = path.join(d.dataDir, "repo");
    fs.mkdirSync(path.join(repoInside, ".git"), { recursive: true });
    assert.throws(() => assertSafeDirs(repoInside, d.dataDir));
  });

  it("запрещённые git-подкоманды → guardExec бросает (U4)", () => {
    for (const s of FORBIDDEN_GIT_SUBCOMMANDS) {
      assert.throws(() => guardExec("git", [s, "--hard"]), new RegExp(s));
    }
    assert.doesNotThrow(() => guardExec("git", ["pull", "--ff-only", "origin", "main"]));
    assert.doesNotThrow(() => guardExec("npm", ["ci"]));
  });

  it("FORBIDDEN_GIT_SUBCOMMANDS покрывает reset/clean/push/rebase", () => {
    for (const s of ["reset", "clean", "push", "rebase", "filter-branch", "rm"]) {
      assert.ok(FORBIDDEN_GIT_SUBCOMMANDS.includes(s), s);
    }
  });

  it("findRepoRoot находит .git вверх", () => {
    const d = makeDirs();
    assert.equal(findRepoRoot(path.join(d.repoDir, "apps", "agent")), path.resolve(d.repoDir));
    assert.equal(findRepoRoot(d.dataDir), null);
  });
});

// ── Ход обновления ─────────────────────────────────────────────────────────

describe("runSafeUpdate", () => {
  it("dirty tree → ok:false, step=precheck, pull НЕ вызывается (U5)", async () => {
    const d = makeDirs();
    const { exec, calls } = mockExec([
      (cmd, args) => (cmd === "git" && args[0] === "status" ? ok(" M apps/agent/src/bot.ts") : undefined),
    ]);
    const res = await runSafeUpdate(deps({ repoDir: d.repoDir, dataDir: d.dataDir, exec }));
    assert.equal(res.ok, false);
    assert.equal(res.step, "precheck");
    assert.ok(res.message.includes("Локальные изменения"));
    assert.ok(!calls.some((c) => c.startsWith("git pull")), "pull не должен вызываться");
  });

  it("чистое дерево → fetch + pull --ff-only с точными аргументами", async () => {
    const d = makeDirs();
    const { exec, calls } = mockExec([
      (cmd, args) =>
        cmd === "git" && args[0] === "rev-parse" && args[1] === "HEAD"
          ? ok("abc123")
          : cmd === "git" && args[0] === "rev-parse" && args[1] === "--abbrev-ref"
            ? ok("main")
            : undefined,
    ]);
    const res = await runSafeUpdate(deps({ repoDir: d.repoDir, dataDir: d.dataDir, exec }));
    assert.equal(res.ok, true);
    assert.ok(calls.includes("git fetch origin"), calls.join("\n"));
    assert.ok(calls.includes("git pull --ff-only origin main"), calls.join("\n"));
    assert.ok(calls.includes("npx turbo run build"));
  });

  it("pull non-ff ошибка → ok:false, restart НЕ вызывается", async () => {
    const d = makeDirs();
    let restarts = 0;
    const { exec } = mockExec([
      (cmd, args) =>
        cmd === "git" && args[0] === "rev-parse" && args[1] === "HEAD"
          ? ok("abc123")
          : cmd === "git" && args[0] === "rev-parse" && args[1] === "--abbrev-ref"
            ? ok("main")
            : cmd === "git" && args[0] === "pull"
              ? { code: 1, stdout: "", stderr: "fatal: Not possible to fast-forward" }
              : undefined,
    ]);
    const res = await runSafeUpdate(
      deps({
        repoDir: d.repoDir,
        dataDir: d.dataDir,
        exec,
        requestRestart: async () => {
          restarts++;
          return "flag";
        },
      }),
    );
    assert.equal(res.ok, false);
    assert.equal(res.step, "pull");
    assert.equal(restarts, 0);
  });

  it("build fail → ok:false, restart НЕ вызывается (U7)", async () => {
    const d = makeDirs();
    let restarts = 0;
    const { exec } = mockExec([
      (cmd, args) =>
        cmd === "git" && args[0] === "rev-parse" && args[1] === "HEAD"
          ? ok("abc123")
          : cmd === "git" && args[0] === "rev-parse" && args[1] === "--abbrev-ref"
            ? ok("main")
            : cmd === "npx"
              ? { code: 1, stdout: "", stderr: "tsc error" }
              : undefined,
    ]);
    const res = await runSafeUpdate(
      deps({
        repoDir: d.repoDir,
        dataDir: d.dataDir,
        exec,
        requestRestart: async () => {
          restarts++;
          return "flag";
        },
      }),
    );
    assert.equal(res.ok, false);
    assert.equal(res.step, "build");
    assert.equal(restarts, 0);
  });

  it("успех → requestRestart вызван ровно один раз (U8)", async () => {
    const d = makeDirs();
    let restarts = 0;
    const { exec } = mockExec([
      (cmd, args) =>
        cmd === "git" && args[0] === "rev-parse" && args[1] === "HEAD"
          ? ok("def456")
          : cmd === "git" && args[0] === "rev-parse" && args[1] === "--abbrev-ref"
            ? ok("main")
            : undefined,
    ]);
    const res = await runSafeUpdate(
      deps({
        repoDir: d.repoDir,
        dataDir: d.dataDir,
        exec,
        requestRestart: async () => {
          restarts++;
          return "flag";
        },
      }),
    );
    assert.equal(res.ok, true);
    assert.equal(res.step, "done");
    assert.equal(res.beforeSha, "def456");
    assert.equal(restarts, 1);
  });

  it("lock-файлы менялись → npm ci вызывается (U6)", async () => {
    const d = makeDirs();
    const { exec, calls } = mockExec([
      (cmd, args) =>
        cmd === "git" && args[0] === "rev-parse" && args[1] === "HEAD"
          ? ok("abc123")
          : cmd === "git" && args[0] === "rev-parse" && args[1] === "--abbrev-ref"
            ? ok("main")
            : cmd === "git" && args[0] === "diff"
              ? ok("package-lock.json")
              : undefined,
    ]);
    const res = await runSafeUpdate(deps({ repoDir: d.repoDir, dataDir: d.dataDir, exec }));
    assert.equal(res.ok, true);
    assert.ok(calls.includes("npm ci"), calls.join("\n"));
  });

  it("detached HEAD → precheck fail", async () => {
    const d = makeDirs();
    const { exec } = mockExec([
      (cmd, args) =>
        cmd === "git" && args[0] === "rev-parse" && args[1] === "HEAD"
          ? ok("abc123")
          : cmd === "git" && args[0] === "rev-parse" && args[1] === "--abbrev-ref"
            ? ok("HEAD")
            : undefined,
    ]);
    const res = await runSafeUpdate(deps({ repoDir: d.repoDir, dataDir: d.dataDir, exec }));
    assert.equal(res.ok, false);
    assert.ok(res.message.includes("detached HEAD"));
  });
});

// ── U1: owner-only ─────────────────────────────────────────────────────────

describe("isOwnerCheck (U1)", () => {
  it("id == ownerUserId → true", async () => {
    assert.equal(
      await isOwnerCheck({ ownerUserId: "1", getRole: async () => null }, "1"),
      true,
    );
  });
  it("role owner → true", async () => {
    assert.equal(
      await isOwnerCheck({ getRole: async () => "owner" }, "42"),
      true,
    );
  });
  it("admin/user → false (canManage НЕ достаточно)", async () => {
    assert.equal(
      await isOwnerCheck({ ownerUserId: "1", getRole: async () => "admin" }, "42"),
      false,
    );
    assert.equal(
      await isOwnerCheck({ ownerUserId: "1", getRole: async () => "user" }, "42"),
      false,
    );
  });
});
