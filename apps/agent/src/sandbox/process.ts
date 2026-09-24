import { spawn } from "node:child_process";
import type { SandboxResult } from "./types.js";
import { scrubEnv } from "./env-scrub.js";

export interface SpawnProcessOptions {
  cwd?: string;
  env?: Record<string, string>;
  timeoutMs?: number;
  input?: string;
}

/** Shared spawn → SandboxResult plumbing for the sandbox backends. */
export function spawnToResult(
  command: string,
  args: string[],
  options: SpawnProcessOptions = {},
): Promise<SandboxResult> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (result: SandboxResult): void => {
      if (settled) return;
      settled = true;
      resolve(result);
    };

    let child;
    try {
      // P0: НЕ наследуем host-секреты — только allowlist + явные overrides.
      child = spawn(command, args, {
        cwd: options.cwd,
        env: { ...scrubEnv(), ...options.env },
      });
    } catch (error) {
      finish({ exitCode: null, stdout: "", stderr: "", error: String(error) });
      return;
    }

    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    child.stdout?.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    if (options.timeoutMs) {
      timer = setTimeout(() => {
        timedOut = true;
        child.kill("SIGKILL");
      }, options.timeoutMs);
    }

    if (options.input) {
      child.stdin?.write(options.input);
    }
    child.stdin?.end();

    child.on("error", (error) => {
      if (timer) clearTimeout(timer);
      finish({ exitCode: null, stdout, stderr, error: error.message });
    });

    child.on("close", (code) => {
      if (timer) clearTimeout(timer);
      finish({ exitCode: code, stdout, stderr, timedOut });
    });
  });
}
