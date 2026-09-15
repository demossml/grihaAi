/**
 * extractPdfText — извлечение текста из PDF через pdfjs-dist (не vision).
 * Используется для чехов/накладных в формате PDF, которые vision не читает.
 *
 * Возвращает объединённый текст всех страниц. Никогда не выдумывает данные —
 * просто дословно собирает то, что есть в PDF-слое текста.
 */
export async function extractPdfText(filePath: string): Promise<string> {
  // Ленивый импорт: pdfjs-dist тянет worker/легаси, не хотим грузить его при
  // обычных фото-чеках.
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");

  const fs = await import("node:fs/promises");
  const data = new Uint8Array(await fs.readFile(filePath));

  // worker не нужен, если отключить (текстовый слой работает на главном потоке).
  // Реальные чеки/накладные (из 1С и кассовых программ) содержат собственный
  // ToUnicode-маппинг, поэтому текст читается без внешних шрифтов.
  const task = pdfjs.getDocument({
    data,
    useWorkerFetch: false,
    stopAtErrors: true,
  });
  const doc = await task.promise;

  try {
    const parts: string[] = [];
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      const text = content.items
        .map((it) => ("str" in it ? (it as { str: string }).str : ""))
        .join(" ");
      parts.push(text);
    }
    return parts.join("\n").trim();
  } finally {
    await task.destroy();
  }
}