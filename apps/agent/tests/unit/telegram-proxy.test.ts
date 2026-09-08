import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { HttpsProxyAgent } from "https-proxy-agent";
import {
  buildBotOptions,
  resolveProxyUrl,
} from "../../.pi/extensions/telegram-bot/proxy.js";

describe("telegram proxy factory", () => {
  it("читает HTTPS_PROXY / https_proxy", () => {
    assert.equal(resolveProxyUrl({ HTTPS_PROXY: "http://127.0.0.1:8089" }), "http://127.0.0.1:8089");
    assert.equal(resolveProxyUrl({ https_proxy: "http://p:1" }), "http://p:1");
    assert.equal(resolveProxyUrl({}), undefined);
  });

  it("создаёт proxy-опции только при заданном прокси", () => {
    assert.equal(buildBotOptions(undefined), undefined);
    const options = buildBotOptions("http://127.0.0.1:8089");
    assert.ok(options);
    assert.ok(options.client.baseFetchConfig.agent instanceof HttpsProxyAgent);
  });
});
