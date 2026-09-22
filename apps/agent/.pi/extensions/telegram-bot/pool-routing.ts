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
 * Phase 2.1: маршрутизация перед prompt. Fail-safe — никогда не роняет ход.
 *
 * - оба флага OFF → { null, null } (ноль накладных, старый путь 1:1);
 * - policy on → decision + budget (complexity/kind из decision);
 * - flash on + callFlash → routeMessage (rule → flash_llm → fallback);
 * - любой throw → { null, null } (legacy prompt продолжается).
 */
export async function preparePoolRouting(
  input: PoolRoutingInput,
  opts?: {
    env?: NodeJS.ProcessEnv;
    callFlash?: (
      messages: Array<{ role: "system" | "user"; content: string }>,
    ) => Promise<string>;
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
    const callFlash = flashOn ? opts?.callFlash : undefined;
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
