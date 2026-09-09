import dns from "node:dns/promises";

/**
 * Автообнаружение актуальных IP api.telegram.org.
 *
 * Telegram периодически меняет IP, а РКН блокирует отдельные адреса «вразнобой»,
 * поэтому хардкод одного IP гарантированно устаревает. Здесь IP собираются из
 * трёх источников параллельно:
 *   1. системный DNS (dns.resolve4);
 *   2. Google DoH (https://dns.google/resolve);
 *   3. Cloudflare DoH (https://cloudflare-dns.com/dns-query, JSON API).
 * Результаты объединяются, валидируются (только публичные IPv4) и дедуплицируются.
 * При полном провале всех источников возвращается аварийный seed-список.
 */

export const TELEGRAM_API_HOST = "api.telegram.org";

/** Аварийный seed — только когда DoH и системный DNS полностью отказали. */
export const SEED_FALLBACK_IPS: readonly string[] = [
  "149.154.167.220",
  "149.154.166.110",
];

const DOH_GOOGLE_URL = "https://dns.google/resolve";
const DOH_CLOUDFLARE_URL = "https://cloudflare-dns.com/dns-query";

export interface DiscoverTelegramIpsOptions {
  /** Инжектируемый fetch (тесты). */
  fetchFn?: typeof fetch;
  /** Инжектируемый системный резолвер (тесты). */
  resolve4?: (host: string) => Promise<string[]>;
  /** Таймаут одного DoH-запроса. */
  timeoutMs?: number;
}

/** Валидация: только публичный IPv4 (без private/link-local/CGNAT/multicast). */
export function isPublicIpv4(ip: string): boolean {
  const parts = ip.split(".");
  if (parts.length !== 4) return false;
  const nums: number[] = [];
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return false;
    const n = Number(part);
    if (n > 255) return false;
    nums.push(n);
  }
  const [a, b] = nums;
  if (a === 0 || a === 127 || a >= 224) return false; // this-net, loopback, multicast+
  if (a === 10) return false; // private 10/8
  if (a === 172 && b >= 16 && b <= 31) return false; // private 172.16/12
  if (a === 192 && b === 168) return false; // private 192.168/16
  if (a === 169 && b === 254) return false; // link-local
  if (a === 100 && b >= 64 && b <= 127) return false; // CGNAT 100.64/10
  return true;
}

/** Дедuпликация с сохранением порядка. */
export function dedupeIps(ips: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const ip of ips) {
    if (seen.has(ip)) continue;
    seen.add(ip);
    out.push(ip);
  }
  return out;
}

interface DohAnswer {
  Answer?: Array<{ data?: unknown }>;
}

async function queryDoh(
  fetchFn: typeof fetch,
  url: string,
  headers: Record<string, string>,
  timeoutMs: number,
): Promise<string[]> {
  const res = await fetchFn(url, { headers, signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) return [];
  const json = (await res.json()) as DohAnswer;
  return (json.Answer ?? [])
    .map((a) => a.data)
    .filter((d): d is string => typeof d === "string")
    .filter(isPublicIpv4);
}

/** Собирает и валидирует список IP api.telegram.org; фолбэк на seed при полном провале. */
export async function discoverTelegramIps(options: DiscoverTelegramIpsOptions = {}): Promise<string[]> {
  const fetchFn = options.fetchFn ?? fetch;
  const resolve4 = options.resolve4 ?? ((host: string) => dns.resolve4(host));
  const timeoutMs = options.timeoutMs ?? 4000;
  const host = TELEGRAM_API_HOST;

  const [system, google, cloudflare] = await Promise.all([
    resolve4(host).catch(() => []),
    queryDoh(
      fetchFn,
      `${DOH_GOOGLE_URL}?name=${encodeURIComponent(host)}&type=A`,
      {},
      timeoutMs,
    ).catch(() => []),
    queryDoh(
      fetchFn,
      `${DOH_CLOUDFLARE_URL}?name=${encodeURIComponent(host)}&type=A`,
      { Accept: "application/dns-json" },
      timeoutMs,
    ).catch(() => []),
  ]);

  const merged = dedupeIps([...system, ...google, ...cloudflare]);
  return merged.length > 0 ? merged : [...SEED_FALLBACK_IPS];
}
