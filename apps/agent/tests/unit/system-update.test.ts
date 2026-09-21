/**
 * system_update — SystemUpdateService (mock exec, без реальной сети).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { SystemUpdateService, isAllowedRemote } from "../../src/services/update/SystemUpdateService.js";
import type { ExecFn, SystemUpdateDeps } from "../../src/services/update/types.js";

const GOOD_REMOTE = "https://github.com/demossml/grihaAi.git";

interface MockState {
  remoteUrl?: string;
  porcelain?: string;
  beforeSha?: string;
  afterSha?: string;
  mergeFail?: boolean;
  fetchFail?: boolean;
}

function makeExec(state: MockState): { exec: ExecFn; headCalls: () => number } {
  let headCalls = 0;
  const exec: ExecFn = async (_cmd, args) => {
    const a = args.join(" ");
    if (a.startsWith("rev-parse --show-toplevel")) return { stdout: "/repo", stderr: "" };
    if (a.startsWith("remote get-url")) return { stdout: state.remoteUrl ?? GOOD_REMOTE, stderr: "" };
    if (a.startsWith("rev-parse HEAD")) {
      headCalls++;
      return { stdout: headCalls === 1 ? (state.beforeSha ?? "sha-before") : (state.afterSha ?? "sha-before"), stderr: "" };
    }
    if (a.startsWith("rev-parse --abbrev-ref")) return { stdout: "main", stderr: "" };
    if (a.startsWith("status --porcelain")) return { stdout: state.porcelain ?? "", stderr: "" };
    if (a.startsWith("fetch")) {
      if (state.fetchFail) throw new Error("fetch failed");
      return { stdout: "", stderr: "" };
    }
    if (a.startsWith("merge")) {
      if (state.mergeFail) throw new Error("merge conflict");
      return { stdout: "updated", stderr: "" };
    }
    return { stdout: "", stderr: "" };
  };
  return { exec, headCalls: () => headCalls };
}

function makeDeps(over: Partial<SystemUpdateDeps> = {}): SystemUpdateDeps {
  return { repoDir: "/repo", ...over };
}

test("isAllowedRemote: https и ssh формы demossml/grihaAi → true", () => {
  assert.equal(isAllowedRemote("https://github.com/demossml/grihaAi.git"), true);
  assert.equal(isAllowedRemote("git@github.com:demossml/grihaAi.git"), true);
});

test("isAllowedRemote: другой репозиторий → false", () => {
  assert.equal(isAllowedRemote("https://github.com/other/repo.git"), false);
});

test("wrong remote → WRONG_REMOTE", async () => {
  const { exec } = makeExec({ remoteUrl: "https://github.com/evil/repo.git" });
  const svc = new SystemUpdateService(makeDeps({ exec, allowLocalCli: true }));
  const r = await svc.run({ fromCli: true });
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.equal(r.code, "WRONG_REMOTE");
});

test("dirty porcelain → DIRTY", async () => {
  const { exec } = makeExec({ porcelain: " M src/x.ts" });
  const svc = new SystemUpdateService(makeDeps({ exec, allowLocalCli: true }));
  const r = await svc.run({ fromCli: true });
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.equal(r.code, "DIRTY");
});

test("fetch+ff-only success, same sha → ok, restarted false", async () => {
  const { exec } = makeExec({ beforeSha: "same", afterSha: "same" });
  const svc = new SystemUpdateService(makeDeps({ exec, allowLocalCli: true }));
  const r = await svc.run({ fromCli: true });
  assert.equal(r.ok, true, JSON.stringify(r));
  if (!r.ok) return;
  assert.equal(r.restarted, false);
});

test("new sha + build ok + restart spawned → restarted true", async () => {
  const { exec } = makeExec({ beforeSha: "old", afterSha: "new" });
  const svc = new SystemUpdateService(
    makeDeps({
      exec,
      allowLocalCli: true,
      runBuild: async (_dir, log) => {
        log.push("build ok");
        return { ok: true };
      },
      restartCommand: ["true"],
    }),
  );
  const r = await svc.run({ fromCli: true });
  assert.equal(r.ok, true, JSON.stringify(r));
  if (!r.ok) return;
  assert.equal(r.restarted, true);
});

test("build fail → BUILD, restart не вызывается", async () => {
  const { exec } = makeExec({ beforeSha: "old", afterSha: "new" });
  let buildCalled = false;
  const svc = new SystemUpdateService(
    makeDeps({
      exec,
      allowLocalCli: true,
      runBuild: async () => {
        buildCalled = true;
        return { ok: false, message: "tsc failed" };
      },
    }),
  );
  const r = await svc.run({ fromCli: true });
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.equal(r.code, "BUILD");
  assert.equal(buildCalled, true);
});

test("assertOwner false → DENY (из Telegram)", async () => {
  const { exec } = makeExec({});
  const svc = new SystemUpdateService(
    makeDeps({ exec, assertOwner: async () => false }),
  );
  const r = await svc.run({ userId: "42", fromCli: false });
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.equal(r.code, "DENY");
});

test("status → ok с sha/branch/remote", async () => {
  const { exec } = makeExec({ beforeSha: "abc123" });
  const svc = new SystemUpdateService(makeDeps({ exec }));
  const r = await svc.status();
  assert.equal(r.ok, true, JSON.stringify(r));
  if (!r.ok) return;
  assert.equal(r.beforeSha, "abc123");
  assert.equal(r.branch, "main");
});
