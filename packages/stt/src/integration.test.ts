import { describe, it } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { transcribeVoice } from "./index.js";

/**
 * Manual integration test with a real audio file + real faster-whisper.
 * NOT part of CI — requires the python deps (`pip install -r
 * apps/agent/scripts/requirements.txt`) and a real audio file.
 *
 * Run explicitly:
 *   RUN_STT_INTEGRATION=1 STT_AUDIO_FILE=/path/to/speech.wav \
 *     npx tsx --test src/integration.test.ts
 */
const RUN = process.env.RUN_STT_INTEGRATION === "1";

// packages/stt/src → repo root is ../../ ; the bridge lives in apps/agent.
const SCRIPT =
  process.env.STT_SCRIPT_PATH ??
  path.resolve(process.cwd(), "..", "..", "apps", "agent", "scripts", "stt_local.py");

describe("stt integration (real faster-whisper)", { skip: !RUN }, () => {
  it("transcribes a real audio file", async () => {
    const audio = process.env.STT_AUDIO_FILE;
    if (!audio) {
      assert.fail("STT_AUDIO_FILE env var is required for the integration test");
    }
    const res = await transcribeVoice(audio, {
      scriptPath: SCRIPT,
      timeoutMs: 600_000, // first run downloads the model
    });
    assert.equal(res.ok, true);
    assert.ok((res.text ?? "").trim().length > 0);
  });
});
