import {
  isGenerationPolicyEnabled,
  resolveGenerationBudget,
  type GenerationBudget,
} from "../../../src/runtime/generation/index.js";
import {
  isFlashRouterEnabled,
  routeMessage,
  type RoutingContext,
  type RoutingDecision,
} from "../../../src/runtime/routing/index.js";
import {
  createCallFlash,
  type CallFlashFn,
  type FlashCallDeps,
} from "./pool-call-flash.js";

/**
 * Phase 2.1: сбор RoutingContext для pool. Только короткие поля, без истории.
 * userText обрезается до 1500 символов (classifier не должен видеть весь ход).
 */
export interface PoolRoutingInput {
  text: string;
  hasImage?: boolean;
  hasVoice?: boolean;
  chatType?: string;
}

export function buildRoutingContext(input: PoolRoutingInput): RoutingContext {
  const ct = input.chatType;
  const chatType =
    ct === "private" || ct === "group" || ct === "supergroup" || ct === "channel"
      ? ct
      : "unknown";
  return {
    userText: (input.text ?? "").slice(0, 1500),
    hasImage: !!input.hasImage,
    hasVoice: !!input.hasVoice,
    hostHint: "unknown",
    chatType,
  };
}

export interface PoolRoutingResult {
  decision: RoutingDecision | null;
  budget: GenerationBudget | null;
}

/**
 * Phase 2.1/2.2: маршрутизация перед prompt. Fail-safe — никогда не роняет ход.
 *
 * - оба флага OFF → { null, null } (ноль накладных, старый путь 1:1);
 * - policy on → decision + budget (complexity/kind из decision);
 * - flash on → routeMessage (rule → flash_llm → fallback); callFlash создаётся
 *   из `flash`-конфига (apiKey) или передаётся явно через opts.callFlash;
 * - любой throw → { null, null } (legacy prompt продолжается).
 */
export async function preparePoolRouting(
  input: PoolRoutingInput,
  opts?: {
    env?: NodeJS.ProcessEnv;
    callFlash?: CallFlashFn;
    /** Flash-конфиг (apiKey/baseUrl/model) + инъекция fetch для тестов. */
    flash?: FlashCallDeps & { fetchFn?: typeof fetch };
  },
): Promise<PoolRoutingResult> {
  const env = opts?.env ?? process.env;
  const flashOn = isFlashRouterEnabled(env);
  const policyOn = isGenerationPolicyEnabled(env);

  if (!flashOn && !policyOn) {
    return { decision: null, budget: null };
  }

  try {
    const rctx = buildRoutingContext(input);
    let callFlash = opts?.callFlash;
    // Phase 2.2: при флаге on + apiKey строим реальный callFlash (иначе rule+fallback).
    if (flashOn && !callFlash && opts?.flash?.apiKey) {
      callFlash = createCallFlash({
        apiKey: opts.flash.apiKey,
        baseUrl: opts.flash.baseUrl,
        model: opts.flash.model,
        fetchFn: opts.flash.fetchFn,
      });
    }
    const decision = await routeMessage(rctx, { env, callFlash });
    const budget = policyOn
      ? resolveGenerationBudget({
          complexity: decision.complexity,
          kind: decision.kind,
        })
      : null;
    return { decision, budget };
  } catch {
    // fail-safe: routing never breaks the turn
    return { decision: null, budget: null };
  }
}

/**
 * Phase Flash contract: служебная строка для report_dispatch — агент должен
 * брать данные из tools/БД, а не выдумывать суммы/строки отчёта.
 */
export const REPORT_DISPATCH_GUIDANCE =
  "[ROUTE] report_dispatch: this is a data/report request. Call the report tools " +
  "(report_data_expenses / report_data_problems) to read real data from the DB. " +
  "Do NOT invent totals, line items or numbers — only report what the tools return. " +
  "If there is no data, say so plainly.";

export function applyRouteGuidance(
  message: string,
  decision: { kind: string } | null | undefined,
): string {
  if (!decision || decision.kind !== "report_dispatch") return message;
  if (message.includes("[ROUTE] report_dispatch")) return message;
  return `${REPORT_DISPATCH_GUIDANCE}\n\n${message}`;
}
