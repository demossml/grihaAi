import { test } from "node:test";
import assert from "node:assert/strict";
import { run } from "./cli.js";

test("doctor offline → JSON { ok, checks } длиной 6, exit соответствует ok", async () => {
  const out: string[] = [];
  const code = await run(["doctor"], {
    stdout: (s) => out.push(s),
    stderr: () => {},
  });

  const payload = JSON.parse(out.join(""));
  assert.equal(typeof payload.ok, "boolean");
  assert.equal(Array.isArray(payload.checks), true);
  assert.equal(payload.checks.length, 6);
  assert.equal(code, payload.ok ? 0 : 1);
});

test("doctor --pretty → строки [STATUS] id: message", async () => {
  const out: string[] = [];
  const code = await run(["doctor", "--pretty"], {
    stdout: (s) => out.push(s),
    stderr: () => {},
  });
  assert.ok([0, 1].includes(code));
  assert.ok(out.some((l) => /^\[(PASS|FAIL|WARN|SKIP)\] /.test(l)));
});

test("--help → code 0 и usage", async () => {
  const out: string[] = [];
  const code = await run(["--help"], {
    stdout: (s) => out.push(s),
    stderr: () => {},
  });
  assert.equal(code, 0);
  assert.ok(out.join("").includes("doctor"));
});

test("unknown command → code 1", async () => {
  const err: string[] = [];
  const code = await run(["bogus"], {
    stdout: () => {},
    stderr: (s) => err.push(s),
  });
  assert.equal(code, 1);
});
