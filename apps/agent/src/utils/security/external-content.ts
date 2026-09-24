/**
 * External content boundary — wrap + scan untrusted user/OCR/reply text before
 * it reaches the agent prompt. Content inside `<external_content>` is DATA, not
 * instructions; injection markers → placeholder instead of raw text.
 */
import {
  scanForInjection,
  type InjectionSource,
} from "../../runtime/security/injection.js";

/** Wrap untrusted text so the model treats it as data, not instructions. */
export function wrapExternalContent(source: string, text: string): string {
  const body = (text ?? "").slice(0, 50_000);
  return `<external_content source="${source}">\n${body}\n</external_content>`;
}

/**
 * Scan + wrap. On block, raw text is replaced with a placeholder (never injected
 * as trusted instructions). Empty/whitespace → empty.
 */
export function sanitizeForAgent(
  text: string | null | undefined,
  source: InjectionSource,
): { text: string; blocked: boolean } {
  const raw = (text ?? "").trim();
  if (!raw) return { text: "", blocked: false };
  const result = scanForInjection(raw, source);
  if (result.verdict === "block") {
    return {
      text: wrapExternalContent(source, "[CONTENT_BLOCKED_BY_SECURITY]"),
      blocked: true,
    };
  }
  return { text: wrapExternalContent(source, raw), blocked: false };
}
