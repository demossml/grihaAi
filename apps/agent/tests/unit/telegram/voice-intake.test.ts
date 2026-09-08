import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { assessTranscriptConfidence } from "../../../src/utils/telegram/voice-intake.js";
import type { TranscribeResult } from "@griha/shared-types";

describe("voice intake confidence", () => {
  it("marks failed STT as uncertain", () => {
    const r: TranscribeResult = { ok: false, text: "", error: "no model" };
    const a = assessTranscriptConfidence(r);
    assert.equal(a.uncertain, true);
    assert.equal(a.confidence, 0);
  });

  it("marks empty transcripts as uncertain", () => {
    const a = assessTranscriptConfidence({ ok: true, text: "  " });
    assert.equal(a.uncertain, true);
  });

  it("marks too-short transcripts as uncertain", () => {
    const a = assessTranscriptConfidence({ ok: true, text: "да" });
    assert.equal(a.uncertain, true);
  });

  it("marks garbled transcripts as uncertain", () => {
    const a = assessTranscriptConfidence({ ok: true, text: "� ▓ � ▒ ░" });
    assert.equal(a.uncertain, true);
  });

  it("accepts a normal transcript", () => {
    const a = assessTranscriptConfidence({
      ok: true,
      text: "Напомни позвонить Ивану завтра в десять утра",
    });
    assert.equal(a.uncertain, false);
    assert.ok(a.confidence >= 0.8);
  });
});
