import { randomBytes } from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";

export interface AtomicWriteInput {
  outDir: string;
  prefix: string;
  ext: string;
  buffer: Buffer;
}

const RANDOM_ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";

/** 6 символов [a-z0-9]. */
function random6(): string {
  const bytes = randomBytes(6);
  let s = "";
  for (let i = 0; i < 6; i++) s += RANDOM_ALPHABET[bytes[i] % RANDOM_ALPHABET.length];
  return s;
}

/** YYYYMMDD по локальному времени. */
function yyyymmdd(): string {
  const d = new Date();
  return (
    `${d.getFullYear()}` +
    `${String(d.getMonth() + 1).padStart(2, "0")}` +
    `${String(d.getDate()).padStart(2, "0")}`
  );
}

/**
 * Атомарная запись файла: `<outDir>/<prefix>_<YYYYMMDD>_<random6>.<ext>`.
 * Имя файла генерируется здесь — внешний filename НЕ принимается.
 * Возвращает абсолютный путь к финальному файлу.
 */
export async function writeOutputAtomically(input: AtomicWriteInput): Promise<string> {
  const { outDir, prefix, ext, buffer } = input;
  const st = fs.statSync(outDir);
  if (!st.isDirectory()) throw new Error(`outDir is not a directory: ${outDir}`);

  const name = `${prefix}_${yyyymmdd()}_${random6()}.${ext}`;
  const finalPath = path.join(outDir, name);
  const tmpPath = `${finalPath}.tmp`;

  await fsp.writeFile(tmpPath, buffer);
  await fsp.rename(tmpPath, finalPath);

  return path.resolve(finalPath);
}
