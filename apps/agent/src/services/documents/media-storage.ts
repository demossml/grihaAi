/**
 * Постоянное хранение Telegram media (PROMPT 05).
 *
 * MediaStorage — abstraction поверх локального диска:
 *   ~/.grish-ai/media/telegram/<chat-id>/<YYYY>/<MM>/<sha256>.<ext>
 *
 * Ключ НЕ зависит от Telegram filename (path traversal невозможен):
 * ext берётся только из whitelist'а mime-типов. Размер проверяется ДО записи.
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { getConfigDir } from "@griha/config";

export interface MediaStoragePutInput {
  content: Buffer | Uint8Array;
  /** Канонический ключ (без user input). */
  key: string;
  mimeType?: string;
  originalName?: string;
}

export interface MediaStoragePutResult {
  key: string;
  size: number;
  sha256: string;
}

export interface MediaStorage {
  put(input: MediaStoragePutInput): Promise<MediaStoragePutResult>;
  exists(key: string): Promise<boolean>;
  get(key: string): Promise<Buffer>;
  delete(key: string): Promise<void>;
}

export const DEFAULT_MAX_MEDIA_BYTES = 50 * 1024 * 1024; // 50 МБ — лимит Telegram Bot API
export const DEFAULT_ALLOWED_MIME = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/pdf",
  "audio/ogg",
  "audio/mpeg",
  "audio/mp4",
  "audio/wav",
  "audio/aac",
  "video/mp4",
  "video/webm",
  "video/mpeg",
];

const EXT_BY_MIME: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "application/pdf": "pdf",
  "audio/ogg": "ogg",
  "audio/mpeg": "mp3",
  "audio/mp4": "m4a",
  "audio/wav": "wav",
  "audio/aac": "aac",
  "video/mp4": "mp4",
  "video/webm": "webm",
  "video/mpeg": "mpeg",
};

export interface LocalMediaStorageOptions {
  rootDir?: string;
  maxBytes?: number;
  allowedMimeTypes?: string[];
}

export function defaultMediaRoot(): string {
  return path.join(getConfigDir(), "media", "telegram");
}

/** Канонический ключ: telegram/{chatId}/{YYYY}/{MM}/{sha256}.{ext}. */
export function buildStorageKey(input: {
  chatId: string;
  sha256: string;
  mimeType?: string;
}): string {
  const now = new Date();
  const year = String(now.getUTCFullYear());
  const month = String(now.getUTCMonth() + 1).padStart(2, "0");
  const ext = EXT_BY_MIME[input.mimeType ?? ""] ?? "bin";
  return `telegram/${input.chatId}/${year}/${month}/${input.sha256}.${ext}`;
}

export class LocalMediaStorage implements MediaStorage {
  readonly root: string;

  constructor(private readonly options: LocalMediaStorageOptions = {}) {
    this.root = options.rootDir ?? defaultMediaRoot();
  }

  private sanitizeKey(key: string): string {
    // Ключ строится из chatId/sha256/whitelist-ext — user input не участвует;
    // защита от любых ../ и абсолютных путей всё равно обязательна.
    const clean = key.replace(/\\/g, "/");
    const resolved = path.resolve(this.root, clean);
    if (resolved !== path.resolve(this.root) && !resolved.startsWith(path.resolve(this.root) + path.sep)) {
      throw new Error(`media storage key escapes root: ${key}`);
    }
    return clean;
  }

  private filePathOf(key: string): string {
    return path.join(this.root, this.sanitizeKey(key));
  }

  async put(input: MediaStoragePutInput): Promise<MediaStoragePutResult> {
    const content = Buffer.isBuffer(input.content)
      ? input.content
      : Buffer.from(input.content);
    const maxBytes = this.options.maxBytes ?? DEFAULT_MAX_MEDIA_BYTES;
    if (content.length > maxBytes) {
      throw new Error(`media too large: ${content.length} > ${maxBytes} bytes`);
    }
    const mime = input.mimeType ?? "application/octet-stream";
    const allowed = this.options.allowedMimeTypes ?? DEFAULT_ALLOWED_MIME;
    if (!allowed.includes(mime)) {
      throw new Error(`media mime not allowed: ${mime}`);
    }
    const sha256 = createHash("sha256").update(content).digest("hex");
    const filePath = this.filePathOf(input.key);
    const dir = path.dirname(filePath);
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    if (!fs.existsSync(filePath)) {
      const tmp = `${filePath}.tmp-${Date.now()}`;
      fs.writeFileSync(tmp, content);
      fs.chmodSync(tmp, 0o600);
      fs.renameSync(tmp, filePath);
    }
    return { key: input.key, size: content.length, sha256 };
  }

  async exists(key: string): Promise<boolean> {
    return fs.existsSync(this.filePathOf(key));
  }

  async get(key: string): Promise<Buffer> {
    return fs.readFileSync(this.filePathOf(key));
  }

  async delete(key: string): Promise<void> {
    const p = this.filePathOf(key);
    if (fs.existsSync(p)) fs.rmSync(p, { force: true });
  }

  /** Абсолютный путь к сохранённому файлу (локальная оптимизация для OCR/STT). */
  pathOf(key: string): string {
    return this.filePathOf(key);
  }
}
