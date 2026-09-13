/**
 * Phase 11 (Item 11.2, матрица K4 + §26) — prompt-injection scanning.
 *
 * §26: защита как отдельный security stage; не полагаться только на system
 * prompt; проверять web content, documents, tool results, MCP results,
 * external messages, Telegram attachments.
 */

export type InjectionSource =
  | "web"
  | "document"
  | "tool-result"
  | "mcp"
  | "external-message"
  | "telegram-attachment";

export type InjectionVerdict = "block" | "warn" | "allow";

export interface InjectionScanIssue {
  kind: "instruction-override" | "identity-claim" | "hidden-text";
  offset: number;
  detail: string;
}

export interface InjectionScanResult {
  verdict: InjectionVerdict;
  issues: InjectionScanIssue[];
  reason: string;
}

const OVERRIDE_PATTERN =
  /(ignore (all )?(previous|prior) instructions|disregard .* instructions|забудь (все )?инструкции|игнорируй (все )?инструкции|новые правила: ты теперь)/ig;
const IDENTITY_PATTERN =
  /(you are now|ты теперь|system:\s*you|from now on you (are|must)|с этого момента ты)/ig;
const ZERO_WIDTH = /[\u200b-\u200f\ufeff\u00ad\u2060]/;

/**
 * Источники, где инъекция наиболее вероятна (недоверенный контент).
 * tool-result/mcp — полу-доверенные: warn, не block.
 */
const UNTRUSTED: ReadonlySet<InjectionSource> = new Set([
  "web",
  "document",
  "external-message",
  "telegram-attachment",
]);

/** Отдельный security stage для недоверенного контента. */
export function scanForInjection(
  content: string,
  source: InjectionSource,
): InjectionScanResult {
  const issues: InjectionScanIssue[] = [];
  let match: RegExpExecArray | null;
  OVERRIDE_PATTERN.lastIndex = 0;
  while ((match = OVERRIDE_PATTERN.exec(content))) {
    issues.push({ kind: "instruction-override", offset: match.index, detail: match[0].slice(0, 40) });
  }
  IDENTITY_PATTERN.lastIndex = 0;
  while ((match = IDENTITY_PATTERN.exec(content))) {
    issues.push({ kind: "identity-claim", offset: match.index, detail: match[0].slice(0, 40) });
  }
  if (ZERO_WIDTH.test(content)) {
    issues.push({ kind: "hidden-text", offset: 0, detail: "скрытые zero-width символы" });
  }
  if (issues.length === 0) return { verdict: "allow", issues, reason: "чисто" };
  if (UNTRUSTED.has(source)) {
    return { verdict: "block", issues, reason: `инъекция из недоверенного источника (${source})` };
  }
  return { verdict: "warn", issues, reason: `подозрительный контент (${source}) — пропустить с пометкой` };
}
