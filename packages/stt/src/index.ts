import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import type { SttOptions, TranscribeResult } from "@griha/shared-types";

/**
 * Local voice transcription via a python3 script (faster-whisper bridge).
 * v1 backend: `python3 <script> <filePath>`, script prints a JSON
 * TranscribeResult to stdout. No hard dependency on pi.
 */
export async function transcribeVoice(
  filePath: string,
  options: SttOptions = {},
): Promise<TranscribeResult> {
  const script = options.scriptPath ?? path.join(process.cwd(), "scripts", "stt_local.py");

  if (!existsSync(script)) {
    return { ok: false, text: "", error: `STT script not found: ${script}` };
  }
  if (!existsSync(filePath)) {
    return { ok: false, text: "", error: `Audio file not found: ${filePath}` };
  }

  return new Promise<TranscribeResult>((resolve) => {
    const child = spawn("python3", [script, filePath], {
      timeout: options.timeoutMs,
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => {
      resolve({ ok: false, text: "", error: error.message });
    });
    child.on("close", (code) => {
      if (code !== 0) {
        resolve({ ok: false, text: "", error: stderr.trim() || `STT exited with code ${code}` });
        return;
      }
      try {
        const parsed = JSON.parse(stdout.trim()) as TranscribeResult;
        resolve(parsed);
      } catch {
        resolve({ ok: false, text: "", error: "Invalid STT output" });
      }
    });
  });
}
