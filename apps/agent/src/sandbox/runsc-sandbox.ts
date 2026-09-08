import { spawnToResult } from "./process.js";
import type { SandboxProvider, SandboxRunOptions, SandboxResult } from "./types.js";

export interface RunscSandboxOptions {
  /** Path to the gVisor runtime. Defaults to `runsc` on PATH. */
  runscPath?: string;
  /** Network isolation for the sandbox. Defaults to "none". */
  network?: "none" | "host";
  /** Run unprivileged (no root). Defaults to true. */
  rootless?: boolean;
}

/**
 * Production backend: gVisor (`runsc`). Each command runs in a userspace-kernel
 * sandbox with network disabled by default — a stronger boundary than a shared-
 * kernel container without the cost of a full microVM.
 *
 * Requires the open-source gVisor runtime installed (https://gvisor.dev).
 */
export class RunscSandboxProvider implements SandboxProvider {
  readonly kind = "runsc" as const;

  constructor(private readonly options: RunscSandboxOptions = {}) {}

  run(options: SandboxRunOptions): Promise<SandboxResult> {
    const runsc = this.options.runscPath ?? "runsc";
    const rootless = this.options.rootless ?? true;
    const args = ["do"];
    if (rootless) args.push("--rootless");
    args.push(`--network=${this.options.network ?? "none"}`);
    args.push("--", options.command, ...(options.args ?? []));

    return spawnToResult(runsc, args, {
      cwd: options.cwd,
      env: options.env,
      timeoutMs: options.timeoutMs,
      input: options.input,
    });
  }
}
