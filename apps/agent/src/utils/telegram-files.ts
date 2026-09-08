/**
 * Telegram Bot API helpers for resolving a `file_id` (from a photo/document
 * message) into image data the vision caller can consume.
 */

const TELEGRAM_API = "https://api.telegram.org";

export interface TelegramFilesOptions {
  /** Injectable fetch for tests; defaults to the global fetch. */
  fetchFn?: typeof fetch;
}

/** Resolve a Telegram `file_id` to a base64 `data:` URL (jpeg assumed). */
export async function downloadTelegramFileAsBase64(
  botToken: string,
  fileId: string,
  options: TelegramFilesOptions = {},
): Promise<string> {
  const fetchFn = options.fetchFn ?? fetch;

  const getFileUrl = `${TELEGRAM_API}/bot${botToken}/getFile?file_id=${encodeURIComponent(fileId)}`;
  const fileRes = await fetchFn(getFileUrl);
  if (!fileRes.ok) {
    throw new Error(`Telegram getFile failed: ${fileRes.status}`);
  }
  const fileJson = (await fileRes.json()) as {
    ok?: boolean;
    result?: { file_path?: string };
  };
  const filePath = fileJson.result?.file_path;
  if (!fileJson.ok || !filePath) {
    throw new Error("Telegram getFile returned no file_path");
  }

  const downloadUrl = `${TELEGRAM_API}/file/bot${botToken}/${filePath}`;
  const downloadRes = await fetchFn(downloadUrl);
  if (!downloadRes.ok) {
    throw new Error(`Telegram file download failed: ${downloadRes.status}`);
  }
  const buffer = await downloadRes.arrayBuffer();
  const base64 = Buffer.from(buffer).toString("base64");
  return `data:image/jpeg;base64,${base64}`;
}
