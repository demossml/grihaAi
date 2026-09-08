import { LocalSandboxProvider } from "./local-sandbox.js";
import { RunscSandboxProvider, type RunscSandboxOptions } from "./runsc-sandbox.js";
import type { SandboxProvider } from "./types.js";

export type {
  SandboxKind,
  SandboxProvider,
  SandboxResult,
  SandboxRunOptions,
} from "./types.js";
export { LocalSandboxProvider } from "./local-sandbox.js";
export { RunscSandboxProvider } from "./runsc-sandbox.js";
export type { RunscSandboxOptions } from "./runsc-sandbox.js";

/**
 * Sandbox factory — the single entry point for choosing an execution backend.
 * `dev` = plain local process (development); `runsc` = gVisor (production).
 * The choice is external (config/env), never hardcoded per tool.
 */
export function createSandboxProvider(
  backend: "dev" | "runsc",
  options?: RunscSandboxOptions,
): SandboxProvider {
  if (backend === "runsc") return new RunscSandboxProvider(options);
  return new LocalSandboxProvider();
}
