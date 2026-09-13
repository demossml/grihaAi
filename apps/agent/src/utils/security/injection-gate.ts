import { isAgentRuntimeEnabled } from "../../runtime/index.js";
import {
  scanForInjection,
  type InjectionScanResult,
  type InjectionSource,
} from "../../runtime/security/injection.js";

/**
 * K4 (Item 11.2, §26) — injection-stage в конвейер проверки контента.
 *
 * §26: отдельный security stage для недоверенного контента (web, documents,
 * tool results, MCP results, external messages, Telegram attachments).
 * Flag off → null (проверка отключена, 1:1 старое поведение).
 * Полу-доверенные источники (tool-result/mcp) → warn, не block.
 */

export function scanContent(
  content: string,
  source: InjectionSource,
  env: NodeJS.ProcessEnv,
): InjectionScanResult | null {
  if (!isAgentRuntimeEnabled(env)) return null;
  return scanForInjection(content, source);
}
