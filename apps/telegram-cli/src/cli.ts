import { parseArgs } from "node:util";
import { readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { runOfflineChecks } from "@griha/telegram-doctor-core";
import type { DoctorCheck } from "@griha/telegram-doctor-core";

export interface CliIO {
  stdout: (s: string) => void;
  stderr: (s: string) => void;
}

function readBotToken(): string | undefined {
  const envToken = process.env.TELEGRAM_BOT_TOKEN;
  if (envToken) return envToken;
  try {
    const configPath = path.join(os.homedir(), ".grish-ai", "config.json");
    const config = JSON.parse(readFileSync(configPath, "utf8")) as { telegram?: { botToken?: string } };
    return config?.telegram?.botToken;
  } catch {
    return undefined;
  }
}

/** getMe только по флагу --online; таймаут 10s. Токен не выводится. */
async function onlineCheck(timeoutMs = 10_000): Promise<DoctorCheck> {
  const token = readBotToken();
  if (!token) {
    return { id: "telegram-online", status: "fail", message: "бот-токен не задан — online-проверка невозможна" };
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/getMe`, { signal: controller.signal });
    const body = (await res.json()) as { ok?: boolean; result?: { username?: string }; description?: string };
    if (res.ok && body.ok) {
      return { id: "telegram-online", status: "pass", message: `getMe ok (bot: @${body.result?.username ?? "?"})` };
    }
    return { id: "telegram-online", status: "fail", message: `getMe fail: ${body.description ?? res.status}` };
  } catch (err) {
    return { id: "telegram-online", status: "fail", message: `getMe error: ${err instanceof Error ? err.message : String(err)}` };
  } finally {
    clearTimeout(timer);
  }
}

export async function run(argv: string[], io: CliIO): Promise<number> {
  let values: Record<string, string | boolean | undefined>;
  let positionals: string[];

  try {
    const parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        pretty: { type: "boolean" },
        online: { type: "boolean" },
        help: { type: "boolean", short: "h" },
      },
    });
    values = parsed.values as Record<string, string | boolean | undefined>;
    positionals = parsed.positionals;
  } catch (err) {
    io.stderr(err instanceof Error ? err.message : String(err));
    return 1;
  }

  const command = positionals[0];

  if (values.help || command === undefined) {
    io.stdout("Usage: griha-telegram doctor [--pretty] [--online]\n");
    return values.help ? 0 : 1;
  }

  if (command !== "doctor") {
    io.stderr(`unknown command: ${command}`);
    return 1;
  }

  const checks = await runOfflineChecks();
  if (values.online) {
    checks.push(await onlineCheck());
  }

  const ok = checks.every((c) => c.status !== "fail");

  if (values.pretty) {
    for (const c of checks) {
      io.stdout(`[${c.status.toUpperCase()}] ${c.id}: ${c.message}${c.fix ? ` — fix: ${c.fix}` : ""}`);
    }
  } else {
    io.stdout(JSON.stringify({ ok, checks }));
  }

  return ok ? 0 : 1;
}
