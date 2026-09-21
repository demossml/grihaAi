/**
 * Типы system_update: результат + injectable-депсы.
 */

export type UpdateAction = "status" | "run";

export type UpdateResult =
  | {
      ok: true;
      action: UpdateAction;
      beforeSha: string;
      afterSha: string;
      branch: string;
      remote: string;
      restarted: boolean;
      log: string[];
    }
  | {
      ok: false;
      action: UpdateAction;
      code:
        | "DENY"
        | "WRONG_REMOTE"
        | "DIRTY"
        | "GIT"
        | "BUILD"
        | "RESTART"
        | "INTERNAL";
      message: string;
      beforeSha?: string;
      afterSha?: string;
      log: string[];
    };

export type ExecResult = { stdout: string; stderr: string };
export type ExecFn = (
  cmd: string,
  args: string[],
  opts: { cwd: string; timeout?: number },
) => Promise<ExecResult>;

export interface SystemUpdateDeps {
  /** Корень git checkout */
  repoDir: string;
  /** default main */
  branch?: string;
  /** owner check: return true if allowed */
  assertOwner?: (userId: string | undefined) => boolean | Promise<boolean>;
  /** for CLI: skip owner if true */
  allowLocalCli?: boolean;
  /** e.g. ["systemctl", "--user", "restart", "griha-ai"] */
  restartCommand?: string[];
  /** default: npm install && npx turbo run build */
  runBuild?: (repoDir: string, log: string[]) => Promise<{ ok: boolean; message?: string }>;
  exec?: ExecFn;
}
