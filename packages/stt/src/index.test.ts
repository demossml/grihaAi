import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { transcribeVoice } from "./index.js";

interface Fixture {
  dir: string;
  script: string;
  audio: string;
}

/** Fake python STT script — no real model, fully controlled stdout/stderr. */
function makeFixture(scriptBody: string, withAudio = true): Fixture {
  const dir = mkdtempSync(path.join(tmpdir(), "stt-test-"));
  const script = path.join(dir, "fake_stt.py");
  writeFileSync(script, scriptBody, "utf8");
  const audio = path.join(dir, "sample.wav");
  if (withAudio) writeFileSync(audio, "fake-audio", "utf8");
  return { dir, script, audio };
}

function cleanup(fixture: Fixture): void {
  rmSync(fixture.dir, { recursive: true, force: true });
}

describe("@griha/stt transcribeVoice (fake python bridge)", () => {
  it("returns the transcription from a fake script", async () => {
    const fixture = makeFixture(
      'import json, sys\nprint(json.dumps({"ok": True, "text": "привет", "durationMs": 42, "language": "ru"}))\n',
    );
    try {
      const res = await transcribeVoice(fixture.audio, { scriptPath: fixture.script });
      assert.equal(res.ok, true);
      assert.equal(res.text, "привет");
      assert.equal(res.durationMs, 42);
      assert.equal(res.language, "ru");
    } finally {
      cleanup(fixture);
    }
  });

  it("passes --language through to the script", async () => {
    const fixture = makeFixture(
      'import json, sys\nprint(json.dumps({"ok": True, "text": " ".join(sys.argv[1:])}))\n',
    );
    try {
      const res = await transcribeVoice(fixture.audio, {
        scriptPath: fixture.script,
        language: "ru",
      });
      assert.equal(res.ok, true);
      assert.match(res.text, /--language ru/);
    } finally {
      cleanup(fixture);
    }
  });

  it("reports a clear error when the script is missing", async () => {
    const fixture = makeFixture("", false);
    try {
      const res = await transcribeVoice(fixture.audio, {
        scriptPath: path.join(fixture.dir, "nope.py"),
      });
      assert.equal(res.ok, false);
      assert.match(res.error ?? "", /script not found/i);
    } finally {
      cleanup(fixture);
    }
  });

  it("reports a clear error when the audio file is missing", async () => {
    const fixture = makeFixture("", false);
    try {
      const res = await transcribeVoice(path.join(fixture.dir, "missing.wav"), {
        scriptPath: fixture.script,
      });
      assert.equal(res.ok, false);
      assert.match(res.error ?? "", /Audio file not found/);
    } finally {
      cleanup(fixture);
    }
  });

  it("reports Invalid STT output for non-JSON stdout", async () => {
    const fixture = makeFixture("print('not json')\n");
    try {
      const res = await transcribeVoice(fixture.audio, { scriptPath: fixture.script });
      assert.equal(res.ok, false);
      assert.match(res.error ?? "", /Invalid STT output/);
    } finally {
      cleanup(fixture);
    }
  });

  it("reports the stderr on a non-zero exit", async () => {
    const fixture = makeFixture(
      'import sys\nsys.stderr.write("boom: bad audio")\nsys.exit(2)\n',
    );
    try {
      const res = await transcribeVoice(fixture.audio, { scriptPath: fixture.script });
      assert.equal(res.ok, false);
      assert.match(res.error ?? "", /boom: bad audio/);
    } finally {
      cleanup(fixture);
    }
  });
});
