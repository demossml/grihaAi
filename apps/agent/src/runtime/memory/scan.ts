/**
 * Phase 5 (Item 5.3, матрица E4) — scan контента памяти при записи.
 *
 * Griha: injection/скрытые символы scan при записи в память. Сейчас gateway
 * сканирует запросы, но не memory-записи. Чистая функция для write-path.
 */

export interface MemoryScanIssue {
  kind: "zero-width" | "control" | "injection" | "homoglyph";
  offset: number;
  detail: string;
}

const ZERO_WIDTH = /[\u200b-\u200f\ufeff\u00ad\u2060]/g;
const CONTROL = /[\u0000-\u0008\u000e-\u001f\u007f]/g;
const INJECTION = /(ignore (all )?(previous|prior) instructions|disregard .* instructions|system:\s*you are|ты теперь|забудь все инструкции)/ig;
/** Кириллица/латиница-подобные омоглифы (а/о/е/с/р/х/у). */
const HOMOGLYPH = /[а-яА-Я]/;

/** Проверка контента перед записью в память. Пусто = чисто. */
export function scanMemoryContent(content: string): MemoryScanIssue[] {
  const issues: MemoryScanIssue[] = [];
  let match: RegExpExecArray | null;
  ZERO_WIDTH.lastIndex = 0;
  while ((match = ZERO_WIDTH.exec(content))) {
    issues.push({
      kind: "zero-width",
      offset: match.index,
      detail: `скрытый символ U+${match[0].charCodeAt(0).toString(16).toUpperCase()}`,
    });
  }
  CONTROL.lastIndex = 0;
  while ((match = CONTROL.exec(content))) {
    issues.push({
      kind: "control",
      offset: match.index,
      detail: `управляющий символ U+${match[0].charCodeAt(0).toString(16).toUpperCase()}`,
    });
  }
  INJECTION.lastIndex = 0;
  while ((match = INJECTION.exec(content))) {
    issues.push({
      kind: "injection",
      offset: match.index,
      detail: `маркер инъекции: ${match[0].slice(0, 40)}`,
    });
  }
  if (HOMOGLYPH.test(content)) {
    issues.push({
      kind: "homoglyph",
      offset: 0,
      detail: "кириллические символы в контенте памяти (омоглиф-риск)",
    });
  }
  return issues;
}

/** Решение по результатам scan. */
export function scanDecision(
  content: string,
): { allowed: boolean; issues: MemoryScanIssue[] } {
  const issues = scanMemoryContent(content);
  return {
    allowed: issues.every((i) => i.kind === "homoglyph"),
    issues,
  };
}
