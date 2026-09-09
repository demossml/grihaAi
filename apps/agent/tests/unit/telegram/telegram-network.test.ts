import { describe, it } from "node:test";
import assert from "node:assert/strict";
import https from "node:https";
import type { TLSSocket } from "node:tls";
import type { Socket } from "node:net";
import { Bot } from "grammy";
import {
  discoverTelegramIps,
  SEED_FALLBACK_IPS,
  isPublicIpv4,
  dedupeIps,
} from "../../../.pi/extensions/telegram-bot/telegram-ips.js";
import {
  IpFallbackDialer,
  TelegramResilientFetcher,
  isRetryableConnectError,
  socketOptionsFor,
  sharedTelegramFetcher,
} from "../../../.pi/extensions/telegram-bot/telegram-network.js";

// Самоподписанный тестовый сертификат CN=api.telegram.org (срок ~100 лет).
// Сгенерирован openssl только для тестов — в проде не используется.
const TEST_KEY = `-----BEGIN PRIVATE KEY-----
MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQDMRMrF/g8/As5c
B6iR2D1psn5spe+Z05UOiAYPzE2R4ZOMRoMmrvSu0uPFNHfWKQqF1PUoiHmbeYBr
xn+vYpCrMj7Qn2jCW95Jx6mPxrxawb8n1d//7x7TQwWi3BKPYTu8fqYmz6IP3M2G
SrcKn9gfswxEtRwjYgY2DLHvSy6P+WS424no6EIVbDkAiAm6cWgrQgR1eY4YtJuY
QjdpTOPVPCSHGX4cjTHcc//sOQSQSEg4wSdPb3ruQcpkj/q6Z5FNF4M/NiJweQas
IV/EMoDiYzrbU5UqCv+UYiOteL+6Mqb8V4Tl133tkLdxeo1pVMtrTrEUo0Thki8X
2KWMleUpAgMBAAECggEAHFEI/wtqF6UO8EkLgDRGxyk8R1l1bpCbICmRFY2Pz0JD
DvYTZkBooPeRJZxRZHnKAKV12smYegoM2GPq/Wgff+v2Mzt17UOI/BdWlRzKrZYg
JqiKZdNDJawr0tjJJeEnw8iWxdiQsbw9LXmcCDgCYNqUP84PeYQ0MjfuTqrQaJq9
QSz7JOX9QqljEX65CuupVgSf8YddE3d4m3qhdh7OcFVaig99aghVe1soAnGwJOtM
JJ681rhR3BbaLCbcZcGIaS69/14tdHuuWaIET2jQpCCK5nt8lIQ/ryrl2wJB0NsS
azaDdK0Suec2YdeBPA3KQ+o/DrVl1F6iUkd6brl6tQKBgQD7ZlHUWvw3bLZ5acT1
YlI5x7fWrgZ6A97IXIoOKCo9Ze39vFYD130ZKAN5nrcX0Yh89rjIN70hANTZx/e4
P7KX2X8vqJaHZKOV3JYSiyKbh/OW7vRXGlqL7daG1jxpriRDlKvWUnuOfdrYLD1u
bFiKJs/Xt9VF3TRzapnUBcsr8wKBgQDQAbANBfU5Kb+XGZmOwsj5/HbvImaFpRCL
8YwewD19AjudIRnjG0gSg6xPBzYNW8ZF8trg9BpeiYNrNybiAe/HIhIi5KTvtBUo
EtoPyDuK7kEd/bgPCBYAMTj+QX4xm/6EI+AhkOSITe0mZBjhr0TVUyJBgsa2A3rD
9q8IWxb9cwKBgDi992o+vv6jguwUe2gHMRfphAzoan3PsdD3UhGv7xi8kOLcR23G
jW3IIkCpGho+KNhLt5k5O27fiSs+fyMO/XhYluRi4NbeWC3TA+xbiwwfu1Mty+h9
AkLjA7CbWjdgHr9CJybQpyKaNXLlSVhLDBDigbbmvzRtoREL1nyMcjcRAoGAd+Ch
H8BRRbKD0odUcmxb+4a+3K7MuzUYRi7dfFN6nHMO/E25Z6Ovc8wjICCdzDEaIfIG
pyLHl7hU3xOX+yT2laNTJHz1eZgloUTMG9BgUH9jU++HhlI4q7+ygwYnvluS4YDz
iSTCMLQIetmxZU/nsbIJyguejgOPWyTuVzh4FXUCgYEA94qqbRl27mOfsm0WZHO/
WM4jEUZaG0QrijtS3LcIfG7V5lurXJUzLt9S/gQDfFmgrW/RLc+y9IdpcUCG+eco
Upmml79GhB6hHRUoQmQJqifWi2IbTKEFiPg9XlWWNOtgb1rV8QUaY+RWiP8Cjjo6
G2251g/d5aU+OKYQrJlFGTU=
-----END PRIVATE KEY-----`;

const TEST_CERT = `-----BEGIN CERTIFICATE-----
MIIDNjCCAh6gAwIBAgIUcvVbooQUc+3poJhIvXNnIrkwpQIwDQYJKoZIhvcNAQEL
BQAwGzEZMBcGA1UEAwwQYXBpLnRlbGVncmFtLm9yZzAgFw0yNjA5MDkwNDQyMDBa
GA8yMTI2MDgxNjA0NDIwMFowGzEZMBcGA1UEAwwQYXBpLnRlbGVncmFtLm9yZzCC
ASIwDQYJKoZIhvcNAQEBBQADggEPADCCAQoCggEBAMxEysX+Dz8CzlwHqJHYPWmy
fmyl75nTlQ6IBg/MTZHhk4xGgyau9K7S48U0d9YpCoXU9SiIeZt5gGvGf69ikKsy
PtCfaMJb3knHqY/GvFrBvyfV3//vHtNDBaLcEo9hO7x+pibPog/czYZKtwqf2B+z
DES1HCNiBjYMse9LLo/5ZLjbiejoQhVsOQCICbpxaCtCBHV5jhi0m5hCN2lM49U8
JIcZfhyNMdxz/+w5BJBISDjBJ09veu5BymSP+rpnkU0Xgz82InB5BqwhX8QygOJj
OttTlSoK/5RiI614v7oypvxXhOXXfe2Qt3F6jWlUy2tOsRSjROGSLxfYpYyV5SkC
AwEAAaNwMG4wHQYDVR0OBBYEFE6hzWEktHBbK0zileY4W6QG6/VZMB8GA1UdIwQY
MBaAFE6hzWEktHBbK0zileY4W6QG6/VZMA8GA1UdEwEB/wQFMAMBAf8wGwYDVR0R
BBQwEoIQYXBpLnRlbGVncmFtLm9yZzANBgkqhkiG9w0BAQsFAAOCAQEAxQK0LtsG
5R40kc8j20oSfUGScz29UMmFe7/LUCrKmNv3SEkJFUvu3BDCKhKEOWAfXv+FkGVM
NAYBdE30chIPuu941YZu0fbOHjje0jw3YkcT3jj62YbNKqIbldmUmGyXKc2MpyVQ
/Qie/a8BYgPGrJZV5Iz/lltsItVwUonQMn0PHmAVR0vDrkaScp1n8sAU+KV/MFVY
aBNcLmOGrXPZ6YaoqdeBDEKwF6fHxJO0YSMmsa9sIPOkFVlAovPssH1wCZOPbY6G
N5qwSgtvnkObKyMGO9jXSgGcPhjC/+qKBMbSUH5xQxtYtYEUm9SrfFNQLpmgFlDH
miI/DCQXRs006A==
-----END CERTIFICATE-----`;

const sock = (): Socket => ({}) as unknown as Socket;

describe("telegram-ips DoH discovery", () => {
  it("merges system DNS + both DoH providers, validates and dedupes", async () => {
    const calls: Array<{ url: string; headers: Record<string, string> }> = [];
    const fetchFn = (async (input: unknown, init?: { headers?: Record<string, string> }) => {
      const url = String(input);
      calls.push({ url, headers: (init?.headers ?? {}) as Record<string, string> });
      if (url.includes("dns.google")) {
        return {
          ok: true,
          json: async () => ({
            Answer: [
              { data: "149.154.167.220" },
              { data: "10.0.0.5" }, // приватный — отбрасывается
              { data: "999.1.2.3" }, // невалидный — отбрасывается
              { data: "149.154.167.220" }, // дубль
            ],
          }),
        } as unknown as Response;
      }
      // cloudflare
      return {
        ok: true,
        json: async () => ({ Answer: [{ data: "149.154.166.110" }] }),
      } as unknown as Response;
    }) as typeof fetch;

    const ips = await discoverTelegramIps({
      fetchFn,
      resolve4: async () => ["149.154.166.110", "91.108.56.10"],
    });

    // Системный DNS первым, затем DoH, дубли убраны, приватный/невалидный отброшены.
    assert.deepEqual(ips, ["149.154.166.110", "91.108.56.10", "149.154.167.220"]);
    // Cloudflare должен получить Accept: application/dns-json.
    const cf = calls.find((c) => c.url.includes("cloudflare-dns.com"));
    assert.equal(cf?.headers.Accept, "application/dns-json");
  });

  it("falls back to the seed list when every source fails", async () => {
    const ips = await discoverTelegramIps({
      fetchFn: (async () => {
        throw new Error("network down");
      }) as unknown as typeof fetch,
      resolve4: async () => {
        throw new Error("ENOTFOUND");
      },
    });
    assert.deepEqual(ips, [...SEED_FALLBACK_IPS]);
  });

  it("merges seed IPs even when discovery returns a result", async () => {
    // Обнаружение вернуло только заблокированный РКН IP — рабочий seed-IP
    // обязан остаться в списке кандидатов для диалерского фолбэка.
    const ips = await discoverTelegramIps({
      fetchFn: (async () => {
        return {
          ok: true,
          json: async () => ({ Answer: [{ data: "149.154.166.110" }] }),
        } as unknown as Response;
      }) as typeof fetch,
      resolve4: async () => ["149.154.166.110"],
    });
    assert.deepEqual(ips, ["149.154.166.110", "149.154.167.220"]);
  });
});

describe("sharedTelegramFetcher singleton", () => {
  it("is a function and has no sticky IP before first connect", () => {
    assert.equal(typeof sharedTelegramFetcher.fetch, "function");
    assert.equal(sharedTelegramFetcher.getStickyIp(), null); // ещё не подключались
  });

  it("imports from the same module give the same instance", async () => {
    const { sharedTelegramFetcher: again } = await import(
      "../../../.pi/extensions/telegram-bot/telegram-network.js"
    );
    assert.equal(again, sharedTelegramFetcher);
  });
});

describe("ip validation", () => {
  it("accepts public IPv4 and rejects private/reserved", () => {
    assert.equal(isPublicIpv4("149.154.167.220"), true);
    assert.equal(isPublicIpv4("91.108.56.1"), true);
    assert.equal(isPublicIpv4("10.0.0.5"), false);
    assert.equal(isPublicIpv4("192.168.1.1"), false);
    assert.equal(isPublicIpv4("127.0.0.1"), false);
    assert.equal(isPublicIpv4("169.254.1.1"), false);
    assert.equal(isPublicIpv4("100.64.0.1"), false);
    assert.equal(isPublicIpv4("999.1.2.3"), false);
    assert.equal(isPublicIpv4("not-an-ip"), false);
  });

  it("dedupeIps keeps order and removes duplicates", () => {
    assert.deepEqual(dedupeIps(["a", "b", "a", "c", "b"]), ["a", "b", "c"]);
  });
});

describe("retryable connect errors", () => {
  it("retries socket-level errors only", () => {
    assert.equal(isRetryableConnectError(Object.assign(new Error("x"), { code: "ECONNREFUSED" })), true);
    assert.equal(isRetryableConnectError(Object.assign(new Error("x"), { code: "ETIMEDOUT" })), true);
    assert.equal(isRetryableConnectError(Object.assign(new Error("x"), { code: "ENOTFOUND" })), true);
    assert.equal(isRetryableConnectError({ name: "ConnectTimeoutError" }), true);
    // HTTP-ответы — НЕ connect-ошибки.
    assert.equal(isRetryableConnectError(Object.assign(new Error("Too Many Requests"), { statusCode: 429 })), false);
    assert.equal(isRetryableConnectError(Object.assign(new Error("Internal"), { statusCode: 500 })), false);
    assert.equal(isRetryableConnectError(new Error("random")), false);
  });
});

describe("IpFallbackDialer (sticky + fallback order)", () => {
  it("tries system DNS first, then fallback IPs; sticks to the first success", async () => {
    const attempts: Array<string | null> = [];
    const dialer = new IpFallbackDialer(() => ["1.1.1.1", "2.2.2.2"]);
    const outcome = await dialer.dial(async (ip) => {
      attempts.push(ip);
      if (ip === null) throw Object.assign(new Error("refused"), { code: "ECONNREFUSED" });
      if (ip === "1.1.1.1") throw Object.assign(new Error("refused"), { code: "ECONNREFUSED" });
      return sock();
    });

    assert.equal(outcome.usedIp, "2.2.2.2");
    assert.equal(outcome.attempts, 3);
    assert.deepEqual(attempts, [null, "1.1.1.1", "2.2.2.2"]);
    assert.equal(dialer.getStickyIp(), "2.2.2.2");
  });

  it("reuses sticky on the next dial", async () => {
    const dialer = new IpFallbackDialer(() => ["1.1.1.1"]);
    // Первый успех на IP → sticky.
    await dialer.dial(async (ip) => {
      if (ip === null) throw Object.assign(new Error("refused"), { code: "ECONNREFUSED" });
      return sock();
    });
    const attempts: Array<string | null> = [];
    const outcome = await dialer.dial(async (ip) => {
      attempts.push(ip);
      if (ip === null) throw Object.assign(new Error("refused"), { code: "ECONNREFUSED" });
      return sock();
    });
    assert.deepEqual(attempts, ["1.1.1.1"]);
    assert.equal(outcome.attempts, 1);
    assert.equal(dialer.getStickyIp(), "1.1.1.1");
  });

  it("resets sticky on failure and falls through to the next candidates", async () => {
    const logs: string[] = [];
    const dialer = new IpFallbackDialer(() => ["1.1.1.1", "2.2.2.2"], (m) => logs.push(m));
    await dialer.dial(async (ip) => {
      if (ip === null) throw Object.assign(new Error("x"), { code: "ECONNREFUSED" });
      return sock();
    });

    const outcome = await dialer.dial(async (ip) => {
      if (ip === "1.1.1.1") throw Object.assign(new Error("sticky broken"), { code: "ECONNREFUSED" });
      if (ip === null) throw Object.assign(new Error("dns blocked"), { code: "ENOTFOUND" });
      return sock();
    });

    assert.equal(outcome.usedIp, "2.2.2.2");
    assert.equal(dialer.getStickyIp(), "2.2.2.2");
    assert.ok(logs.some((l) => l.includes("sticky IP 1.1.1.1 failed")));
  });

  it("does not switch IP on HTTP-level errors and rethrows immediately", async () => {
    const dialer = new IpFallbackDialer(() => ["1.1.1.1", "2.2.2.2"]);
    await dialer.dial(async (ip) => {
      if (ip === null) throw Object.assign(new Error("x"), { code: "ECONNREFUSED" });
      return sock();
    });
    const attempts: Array<string | null> = [];
    await assert.rejects(
      dialer.dial(async (ip) => {
        attempts.push(ip);
        throw Object.assign(new Error("Too Many Requests"), { statusCode: 429 });
      }),
      /Too Many Requests/,
    );
    assert.deepEqual(attempts, ["1.1.1.1"], "должна быть ровно одна попытка (sticky), без перебора");
    assert.equal(dialer.getStickyIp(), "1.1.1.1", "HTTP-ошибка не сбрасывает sticky");
  });

  it("throws the last error when every candidate fails", async () => {
    const dialer = new IpFallbackDialer(() => ["1.1.1.1"]);
    await assert.rejects(
      dialer.dial(async () => {
        throw Object.assign(new Error("all down"), { code: "ECONNREFUSED" });
      }),
      /all down/,
    );
  });
});

describe("SNI / Host preservation", () => {
  it("socketOptionsFor keeps servername = api.telegram.org for an IP", () => {
    const opts = socketOptionsFor("149.154.167.220", 443, "api.telegram.org");
    assert.equal(opts.host, "149.154.167.220");
    assert.equal(opts.port, 443);
    assert.equal(opts.servername, "api.telegram.org");
  });
});

// ── Интеграция: реальный локальный TLS-сервер + кастомная fetch ──────────────

interface TlsTestServer {
  url: (path: string) => string;
  port: number;
  state: {
    /** TCP-соединения (keep-alive: 1 соединение на несколько запросов). */
    tcpConnections: number;
    /** HTTP-запросы. */
    requests: number;
    servernames: string[];
    hosts: string[];
  };
  close: () => Promise<void>;
}

async function startTlsTestServer(): Promise<TlsTestServer> {
  const state = {
    tcpConnections: 0,
    requests: 0,
    servernames: [] as string[],
    hosts: [] as string[],
  };
  const server = https.createServer({ key: TEST_KEY, cert: TEST_CERT }, (req, res) => {
    state.requests++;
    state.servernames.push(String((req.socket as TLSSocket).servername ?? ""));
    state.hosts.push(String((req.headers.host as string | undefined) ?? ""));
    if (req.url === "/error") {
      res.writeHead(500);
      res.end("boom");
      return;
    }
    res.writeHead(200, { "content-type": "application/json" });
    res.end(
      JSON.stringify({
        ok: true,
        result: { id: 1, is_bot: true, first_name: "griha", username: "griha_ai_bot" },
      }),
    );
  });
  server.on("connection", () => state.tcpConnections++);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  return {
    port,
    url: (p) => `https://api.telegram.org:${port}${p}`,
    state,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections?.();
        server.close(() => resolve());
      }),
  };
}

describe("telegram network integration (real TLS + resilient fetch)", () => {
  it("connects via fallback IP with SNI/Host preserved, sticky set, keep-alive reused", async () => {
    const tls = await startTlsTestServer();
    const logs: string[] = [];
    const fetcher = new TelegramResilientFetcher({
      discoverIps: () => ["127.0.0.2", "127.0.0.1"], // первый — закрытый порт, второй — сервер
      includeSystemDns: false,
      tlsOptions: { rejectUnauthorized: false },
      logger: (m) => logs.push(m),
      connectTimeoutMs: 500,
    });
    try {
      const res = await fetcher.fetch(tls.url("/getMe"), { method: "GET" });
      assert.equal(res.status, 200);
      const json = (await res.json()) as { ok: boolean; result: { username: string } };
      assert.equal(json.ok, true);

      // SNI и Host сохранились как api.telegram.org.
      assert.equal(tls.state.servernames[0], "api.telegram.org");
      assert.equal(tls.state.hosts[0], `api.telegram.org:${tls.port}`);

      // Фолбэк: первый IP не работал → sticky на второй.
      assert.equal(fetcher.getStickyIp(), "127.0.0.1");
      assert.ok(logs.some((l) => l.includes("sticky IP: 127.0.0.1")));
      assert.ok(logs.some((l) => l.includes("in 2 attempt(s)")));

      // Keep-alive: второй запрос — то же TCP-соединение.
      const res2 = await fetcher.fetch(tls.url("/getMe"), { method: "GET" });
      assert.equal(res2.status, 200);
      assert.equal(tls.state.requests, 2);
      assert.equal(tls.state.tcpConnections, 1, "живое соединение должно переиспользоваться");

      // HTTP 500 — не connect-ошибка: sticky не меняется.
      const res3 = await fetcher.fetch(tls.url("/error"), { method: "GET" });
      assert.equal(res3.status, 500);
      assert.equal(fetcher.getStickyIp(), "127.0.0.1");
    } finally {
      await fetcher.close();
      await tls.close();
    }
  });

  it("grammy bot sends getMe through the resilient fetch", async () => {
    const tls = await startTlsTestServer();
    const fetcher = new TelegramResilientFetcher({
      discoverIps: () => ["127.0.0.1"],
      includeSystemDns: false,
      tlsOptions: { rejectUnauthorized: false },
      connectTimeoutMs: 500,
    });
    try {
      const bot = new Bot("123456:TEST-TOKEN", {
        client: {
          apiRoot: `https://api.telegram.org:${tls.port}`,
          fetch: fetcher.fetch as never,
        },
      });
      const me = await bot.api.getMe();
      assert.equal(me.username, "griha_ai_bot");
      assert.equal(fetcher.getStickyIp(), "127.0.0.1");
      assert.equal(tls.state.servernames[0], "api.telegram.org");
    } finally {
      await fetcher.close();
      await tls.close();
    }
  });
});
