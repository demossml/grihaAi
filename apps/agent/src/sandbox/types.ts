/**
 * Sandbox execution layer (defense-in-depth).
 *
 * `SandboxProvider` is the seam for running code that the gateway decides may
 * execute. Two backends are expected: `dev` (plain local process, for local
 * development) and `runsc` (gVisor userspace kernel, the production default).
 * The interface mirrors the DI pattern in docs/ARCHITECTURE.md §7.
 */

export type SandboxKind = "dev" | "runsc";

export interface SandboxRunOptions {
  command: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
  /** Kill the process after this many milliseconds. */
  timeoutMs?: number;
  /** Write to stdin before closing it. */
  input?: string;
}

export interface SandboxResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut?: boolean;
  /** Process spawn failure (e.g. sandbox runtime missing). */
  error?: string;
}

export interface SandboxProvider {
  readonly kind: SandboxKind;
  run(options: SandboxRunOptions): Promise<SandboxResult>;
}
