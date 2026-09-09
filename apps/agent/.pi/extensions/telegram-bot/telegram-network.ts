import tls from "node:tls";
import https from "node:https";
import type { Socket } from "node:net";
import { Readable, type Duplex } from "node:stream";
import { TELEGRAM_API_HOST } from "./telegram-ips.js";

/**
 * Мульти-IP подключение к Telegram: кастомная `fetch`-реализация поверх
 * node:https с keep-alive-агентом, у которого `createConnection` перебирает
 * несколько IP api.telegram.org по очереди и запоминает рабочий (sticky).
 * Аналог Hermes `telegram_network.py`.
 *
 * - Порядок попыток: sticky → системный DNS → остальные обнаруженные IP.
 * - Ретраются только connect-ошибки (ECONNREFUSED/ETIMEDOUT/…); HTTP-ответы
 *   (4xx/5xx) IP не меняют.
 * - При подключении к конкретному IP сохраняются TLS SNI и HTTP Host =
 *   `api.telegram.org` (URL не переписывается — меняется только endpoint сокета).
 * - keep-alive: один https.Agent на хост — живой сокет переиспользуется между
 *   последовательными getUpdates (новый TCP-коннект не создаётся).
 */

export const DEFAULT_CONNECT_TIMEOUT_MS = 10_000;
export const DEFAULT_IP_REFRESH_MS = 10 * 60 * 1000;

const CONNECT_ERROR_CODES = new Set([
  "ECONNREFUSED",
  "ECONNRESET",
  "ETIMEDOUT",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "ENOTFOUND",
  "EAI_AGAIN",
  "EPIPE",
  // undici-специфичные коды:
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_SOCKET",
]);

/** Ошибка — connect-уровень (её стоит ретраить на другом IP)? */
export function isRetryableConnectError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { code?: unknown; name?: unknown; statusCode?: unknown };
  // HTTP-ответ (4xx/5xx) — НЕ connect-ошибка: IP не меняем.
  if (typeof e.statusCode === "number") return false;
  if (typeof e.code === "string" && CONNECT_ERROR_CODES.has(e.code)) return true;
  return (
    typeof e.name === "string" &&
    /^(ConnectTimeoutError|ConnectError|SocketError|TimeoutError)$/.test(e.name)
  );
}

/**
 * TLS-опции для подключения к конкретному IP: `host` = IP, но `servername`
 * (SNI) остаётся `api.telegram.org`, иначе сертификат не сойдётся. HTTP Host
 * сохраняется сам собой — URL запроса не переписывается.
 */
export function socketOptionsFor(
  ip: string,
  port: number,
  hostname: string = TELEGRAM_API_HOST,
  extra: tls.ConnectionOptions = {},
): tls.ConnectionOptions {
  return { host: ip, port, servername: hostname, ...extra };
}

function connectError(code: string, message: string): Error {
  const err = new Error(message) as Error & { code: string };
  err.code = code;
  return err;
}

/** tls.connect с таймаутом: резолвится на secureConnect. */
export function connectTls(
  options: tls.ConnectionOptions,
  timeoutMs: number = DEFAULT_CONNECT_TIMEOUT_MS,
): Promise<Socket> {
  return new Promise<Socket>((resolve, reject) => {
    const socket = tls.connect(options);
    const timer = setTimeout(() => {
      socket.destroy();
      reject(connectError("ETIMEDOUT", `connect timeout to ${String(options.host)}:${options.port}`));
    }, timeoutMs);
    socket.once("secureConnect", () => {
      clearTimeout(timer);
      resolve(socket);
    });
    socket.once("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

export type DialFn = (ip: string | null) => Promise<Socket>;

export interface DialOutcome {
  socket: Socket;
  /** null — системный DNS; иначе конкретный IP. */
  usedIp: string | null;
  attempts: number;
}

/**
 * Перебор IP со sticky: sticky → системный DNS → остальные IP. На connect-ошибке
 * идёт дальше по списку (sticky сбрасывается, если упал именно он); HTTP-ошибки
 * не перехватываются здесь вообще (это уровень dialFn/транспорта).
 */
export class IpFallbackDialer {
  private stickyIp: string | null = null;

  constructor(
    private readonly getIps: () => string[],
    private readonly logger: (message: string) => void = () => {},
    private readonly includeSystemDns = true,
  ) {}

  getStickyIp(): string | null {
    return this.stickyIp;
  }

  private attemptOrder(): Array<string | null> {
    const order: Array<string | null> = [];
    if (this.stickyIp) order.push(this.stickyIp);
    if (this.includeSystemDns) order.push(null); // системный DNS
    for (const ip of this.getIps()) {
      if (ip !== this.stickyIp) order.push(ip);
    }
    return order;
  }

  async dial(dialFn: DialFn): Promise<DialOutcome> {
    const order = this.attemptOrder();
    let lastError: unknown = null;
    for (const ip of order) {
      try {
        const socket = await dialFn(ip);
        if (ip !== null) {
          const first = this.stickyIp === null;
          this.stickyIp = ip;
          if (first) this.logger(`[telegram-network] sticky IP: ${ip}`);
        }
        return { socket, usedIp: ip, attempts: order.indexOf(ip) + 1 };
      } catch (err) {
        lastError = err;
        if (!isRetryableConnectError(err)) throw err; // HTTP/прочее — не ретраим
        if (ip !== null && this.stickyIp === ip) {
          this.stickyIp = null;
          this.logger(`[telegram-network] sticky IP ${ip} failed — reset`);
        }
      }
    }
    throw lastError instanceof Error ? lastError : new Error(String(lastError));
  }
}

export interface TelegramResilientFetchOptions {
  /** Хост, для которого работает мульти-IP (по умолчанию api.telegram.org). */
  host?: string;
  /** Источник IP-списка (DoH-обнаружение или инжектированный список). */
  discoverIps: () => string[] | Promise<string[]>;
  /** Интервал переобнаружения IP. */
  refreshIntervalMs?: number;
  /** Таймаут установки одного соединения. */
  connectTimeoutMs?: number;
  /** Доп. TLS-опции (тест-только: rejectUnauthorized). */
  tlsOptions?: tls.ConnectionOptions;
  /** Пробовать системный DNS вторым кандидатом (тесты отключают для детерминизма). */
  includeSystemDns?: boolean;
  logger?: (message: string) => void;
}

/** Минимальный контракт для периодического переобнаружения IP. */
export interface IpRefresher {
  refreshIps(): Promise<string[]>;
}

/**
 * Кастомная fetch для grammy (`client: { fetch }`) с мульти-IP фолбэком и
 * keep-alive на собственном https.Agent'е.
 */
export class TelegramResilientFetcher implements IpRefresher {
  private readonly host: string;
  private readonly discoverIpsFn: () => string[] | Promise<string[]>;
  private readonly refreshIntervalMs: number;
  private readonly connectTimeoutMs: number;
  private readonly tlsOptions: tls.ConnectionOptions;
  private readonly logger: (message: string) => void;
  private readonly dialer: IpFallbackDialer;
  private readonly agents = new Map<string, https.Agent>();
  private ipList: string[] = [];
  private lastDiscoveredAt = 0;

  constructor(options: TelegramResilientFetchOptions) {
    this.host = options.host ?? TELEGRAM_API_HOST;
    this.discoverIpsFn = options.discoverIps;
    this.refreshIntervalMs = options.refreshIntervalMs ?? DEFAULT_IP_REFRESH_MS;
    this.connectTimeoutMs = options.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS;
    this.tlsOptions = options.tlsOptions ?? {};
    this.logger = options.logger ?? (() => {});
    this.dialer = new IpFallbackDialer(
      () => this.ipList,
      this.logger,
      options.includeSystemDns ?? true,
    );
  }

  getStickyIp(): string | null {
    return this.dialer.getStickyIp();
  }

  getDiscoveredIps(): string[] {
    return [...this.ipList];
  }

  /** Переобнаружить IP сейчас (логирует результат). */
  async refreshIps(): Promise<string[]> {
    try {
      this.ipList = await Promise.resolve(this.discoverIpsFn());
    } catch (err: unknown) {
      this.logger(
        `[telegram-network] IP discovery failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    this.lastDiscoveredAt = Date.now();
    this.logger(`[telegram-network] discovered IPs: ${this.ipList.join(", ")}`);
    return this.ipList;
  }

  private async maybeRefreshIps(): Promise<void> {
    const stale = Date.now() - this.lastDiscoveredAt > this.refreshIntervalMs;
    if (this.ipList.length === 0 || stale) {
      await this.refreshIps();
    }
  }

  /** keep-alive https.Agent на хост; для нашего хоста — мульти-IP createConnection. */
  private getAgent(hostname: string): https.Agent {
    let agent = this.agents.get(hostname);
    if (agent) return agent;

    agent = new https.Agent({
      keepAlive: true,
      maxSockets: 4,
      keepAliveMsecs: 60_000,
    });
    if (hostname === this.host) {
      agent.createConnection = (connOpts, callback) => {
        const done = (err: Error | null, socket: tls.TLSSocket | null) => {
          callback?.(err, (socket ?? undefined) as unknown as Duplex);
        };
        void (async () => {
          await this.maybeRefreshIps();
          try {
            const port = Number(connOpts.port ?? 443);
            const outcome = await this.dialer.dial((ip) => {
              const tlsOpts =
                ip === null
                  ? {
                      host: connOpts.host ?? hostname,
                      port,
                      servername: connOpts.servername ?? this.host,
                      ...this.tlsOptions,
                    }
                  : socketOptionsFor(ip, port, this.host, this.tlsOptions);
              return connectTls(tlsOpts, this.connectTimeoutMs);
            });
            if (outcome.usedIp !== null) {
              this.logger(
                `[telegram-network] connected to ${this.host} via ${outcome.usedIp} in ${outcome.attempts} attempt(s)`,
              );
            }
            done(null, outcome.socket as tls.TLSSocket);
          } catch (err: unknown) {
            done(err instanceof Error ? err : new Error(String(err)), null);
          }
        })();
      };
    }
    this.agents.set(hostname, agent);
    return agent;
  }

  /** fetch-совместимая функция для grammy `client.fetch`. */
  readonly fetch: typeof fetch = (input, init = {}) =>
    new Promise<Response>((resolve, reject) => {
      const inputStr =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : input instanceof Request
              ? input.url
              : String(input);
      const url = new URL(inputStr);
      const agent = this.getAgent(url.hostname);
      const method = (init.method ?? "GET").toUpperCase();
      const headers: Record<string, string | string[]> = {};
      const raw = init.headers as unknown;
      if (raw instanceof Headers) {
        raw.forEach((value, key) => {
          headers[key] = value;
        });
      } else if (Array.isArray(raw)) {
        for (const [key, value] of raw as Array<[string, string]>) headers[key] = value;
      } else if (raw && typeof raw === "object") {
        Object.assign(headers, raw as Record<string, string>);
      }

      const req = https.request(
        {
          protocol: url.protocol,
          hostname: url.hostname,
          port: url.port ? Number(url.port) : 443,
          path: `${url.pathname}${url.search}`,
          method,
          headers,
          agent,
          signal: init.signal ?? undefined,
        },
        (res) => {
          const responseHeaders = new Headers();
          for (const [key, value] of Object.entries(res.headers)) {
            if (value === undefined) continue;
            for (const v of Array.isArray(value) ? value : [value]) {
              responseHeaders.append(key, v);
            }
          }
          resolve(
            new Response(Readable.toWeb(res) as unknown as ReadableStream, {
              status: res.statusCode ?? 200,
              statusText: res.statusMessage,
              headers: responseHeaders,
            }),
          );
        },
      );
      req.on("error", reject);

      const body = init.body as unknown;
      if (body == null) {
        req.end();
      } else if (
        typeof body === "string" ||
        body instanceof Uint8Array ||
        Buffer.isBuffer(body)
      ) {
        req.end(body as string | Uint8Array);
      } else if (body instanceof Readable) {
        body.pipe(req);
      } else if (body instanceof ReadableStream) {
        Readable.fromWeb(body).pipe(req);
      } else {
        Readable.from(body as AsyncIterable<Uint8Array>).pipe(req);
      }
    });

  /** Закрыть пулы сокетов (при остановке бота/в тестах). */
  async close(): Promise<void> {
    for (const agent of this.agents.values()) {
      agent.destroy();
    }
    this.agents.clear();
  }
}

/** Периодическое переобнаружение IP (раз в intervalMs), не блокирует вызовы. */
export function startPeriodicIpRefresh(
  refresher: IpRefresher,
  intervalMs: number = DEFAULT_IP_REFRESH_MS,
): NodeJS.Timeout {
  const timer = setInterval(() => {
    void refresher.refreshIps().catch(() => {});
  }, intervalMs);
  timer.unref?.();
  return timer;
}
