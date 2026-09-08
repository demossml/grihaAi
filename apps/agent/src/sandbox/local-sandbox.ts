import { spawnToResult } from "./process.js";
import type { SandboxProvider, SandboxRunOptions, SandboxResult } from "./types.js";

/**
 * Dev backend: runs the command directly on the host (no isolation). Used only
 * for local development and tests — never for untrusted input.
 */
export class LocalSandboxProvider implements SandboxProvider {
  readonly kind = "dev" as const;

  run(options: SandboxRunOptions): Promise<SandboxResult> {
    return spawnToResult(options.command, options.args ?? [], {
      cwd: options.cwd,
      env: options.env,
      timeoutMs: options.timeoutMs,
      input: options.input,
    });
  }
}
