import { spawn } from "node:child_process";
import type { RenderRequest, RenderResult } from "@griha/render-contracts";

/**
 * Клиент spawn CLI-рендера (@griha/render-cli).
 *
 * spawn process.execPath + cliPath + [format, "--template", template, "--stdin",
 * "--out", outDir]; в stdin пишем JSON request. Таймаут (default 60s) — SIGKILL.
 * Никогда не бросает — всегда резолвит RenderResult (fallback на legacy решает
 * вызывающая сторона).
 */

interface SpawnChild {
  stdout: { on: (event: string, cb: (chunk: Buffer) => void) => void } | null;
  stderr: { on: (event: string, cb: (chunk: Buffer) => void) => void } | null;
  stdin: { write: (s: string) => unknown; end: () => unknown } | null;
  on: (event: string, cb: (...args: unknown[]) => void) => unknown;
  kill: (signal: string) => void;
}

export interface RenderCliClientOptions {
  cliPath: string;
  outDir: string;
  timeoutMs?: number;
  /** Для тестов: подменяемый spawn. */
  spawnImpl?: (command: string, args: string[], options: unknown) => SpawnChild;
}

export interface RenderCliClient {
  render(request: RenderRequest): Promise<RenderResult>;
}

function parseResult(stdout: string, stderr: string, exitCode: unknown): RenderResult {
  try {
    const parsed = JSON.parse(stdout.trim()) as RenderResult;
    if (parsed && typeof parsed.ok === "boolean") return parsed;
  } catch {
    // fall through to generic failure
  }
  return {
    ok: false,
    code: "RENDER_FAILED",
    message: `CLI exited ${String(exitCode)}: ${stderr.trim() || stdout.trim() || "no output"}`,
  };
}

export function createRenderCliClient(opts: RenderCliClientOptions): RenderCliClient {
  const { cliPath, outDir, timeoutMs = 60_000, spawnImpl } = opts;
  const doSpawn = spawnImpl ?? (spawn as unknown as NonNullable<typeof spawnImpl>);

  return {
    render(request) {
      return new Promise<RenderResult>((resolve) => {
        let stdout = "";
        let stderr = "";
        let settled = false;
        let timer: ReturnType<typeof setTimeout> | undefined;

        const finish = (result: RenderResult): void => {
          if (settled) return;
          settled = true;
          if (timer) clearTimeout(timer);
          resolve(result);
        };

        const child = doSpawn(
          process.execPath,
          [cliPath, request.format, "--template", request.template, "--stdin", "--out", outDir],
          { stdio: ["pipe", "pipe", "pipe"] },
        );

        timer = setTimeout(() => {
          try {
            child.kill("SIGKILL");
          } catch {
            /* ignore */
          }
          finish({ ok: false, code: "RENDER_FAILED", message: `CLI timeout after ${timeoutMs}ms` });
        }, timeoutMs);

        child.stdout?.on("data", (chunk) => {
          stdout += chunk.toString();
        });
        child.stderr?.on("data", (chunk) => {
          stderr += chunk.toString();
        });
        child.on("error", (err) => {
          finish({
            ok: false,
            code: "RENDER_FAILED",
            message: err instanceof Error ? err.message : String(err),
          });
        });
        child.on("close", (code) => {
          finish(parseResult(stdout, stderr, code));
        });

        try {
          child.stdin?.write(JSON.stringify(request));
          child.stdin?.end();
        } catch {
          /* close/error handler fire */
        }
      });
    },
  };
}
