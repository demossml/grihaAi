import { HttpsProxyAgent } from "https-proxy-agent";

/**
 * Прокси для Telegram: из РФ api.telegram.org недоступен напрямую, поэтому при
 * заданном HTTPS_PROXY/https_proxy grammy ходит через прокси.
 */
export function resolveProxyUrl(env: NodeJS.ProcessEnv = process.env): string | undefined {
  return env.HTTPS_PROXY || env.https_proxy || undefined;
}

export interface BotProxyOptions {
  client: { baseFetchConfig: { agent: HttpsProxyAgent<string> } };
}

export function buildBotOptions(proxyUrl?: string): BotProxyOptions | undefined {
  if (!proxyUrl) return undefined;
  return { client: { baseFetchConfig: { agent: new HttpsProxyAgent(proxyUrl) } } };
}
