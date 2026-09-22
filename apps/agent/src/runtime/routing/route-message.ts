import type { FlashRouterDeps, RoutingContext, RoutingDecision } from "./types.js";
import { fallbackRoute, tryRuleRoute } from "./rule-route.js";
import { routeWithFlash } from "./flash-route.js";

export function isFlashRouterEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const v = (env.GRIHA_FLASH_ROUTER ?? "").trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

/**
 * Главный вход Phase 2.
 * 1) tryRuleRoute
 * 2) if null && flash enabled && callFlash provided → routeWithFlash
 * 3) else fallbackRoute
 */
export async function routeMessage(
  ctx: RoutingContext,
  opts?: {
    env?: NodeJS.ProcessEnv;
    callFlash?: FlashRouterDeps["callFlash"];
  },
): Promise<RoutingDecision> {
  const env = opts?.env ?? process.env;
  const ruled = tryRuleRoute(ctx);
  if (ruled && ruled.confidence >= 0.8) return ruled;

  if (isFlashRouterEnabled(env) && opts?.callFlash) {
    return routeWithFlash(ctx, { callFlash: opts.callFlash });
  }

  // rule with mid confidence still better than blind fallback
  if (ruled) return ruled;
  return fallbackRoute(ctx);
}
