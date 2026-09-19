import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { run } from "./cli.js";

test("pdf + --data → code 0 и ok true", async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "render-cli-"));
  try {
    const reqFile = path.join(dir, "req.json");
    writeFileSync(
      reqFile,
      JSON.stringify({
        template: "expense-report",
        title: "Отчёт о расходах",
        blocks: [{ kind: "markdown", text: "запасной блок" }],
        data: {
          period: "тест",
          totalAmount: 100,
          categories: [{ name: "Тест", amount: 100 }],
          items: [],
        },
      }),
    );

    const out: string[] = [];
    const err: string[] = [];
    const code = await run(
      ["pdf", "--template", "expense-report", "--data", reqFile, "--out", dir],
      { stdout: (s) => out.push(s), stderr: (s) => err.push(s) },
    );

    assert.equal(code, 0, `stderr: ${err.join(" ")}`);
    const result = JSON.parse(out.join(""));
    assert.equal(result.ok, true, JSON.stringify(result));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("missing --out → code 1", async () => {
  const out: string[] = [];
  const err: string[] = [];
  const code = await run(["pdf", "--template", "expense-report"], {
    stdout: (s) => out.push(s),
    stderr: (s) => err.push(s),
  });
  assert.equal(code, 1);
  assert.ok(err.join(" ").includes("--template and --out are required"));
});

test("list-templates → code 0 и JSON-массив", async () => {
  const out: string[] = [];
  const code = await run(["list-templates"], {
    stdout: (s) => out.push(s),
    stderr: () => {},
  });
  assert.equal(code, 0);
  const list = JSON.parse(out.join(""));
  assert.deepEqual([...list].sort(), ["expense-report", "meeting-minutes", "sales-report"]);
});
