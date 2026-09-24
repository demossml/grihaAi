import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  clearSessionTrust,
  getSessionTrust,
  setSessionTrust,
} from "../../../src/sandbox/gateway-context.js";

describe("gateway-context (session trust)", () => {
  it("unknown sessionId → untrusted (default deny elevation)", () => {
    assert.equal(getSessionTrust("unknown-" + Math.random()), "untrusted");
  });

  it("setSessionTrust trusted → get trusted; clear → untrusted", () => {
    const id = "s-" + Math.random();
    setSessionTrust(id, "trusted");
    assert.equal(getSessionTrust(id), "trusted");
    clearSessionTrust(id);
    assert.equal(getSessionTrust(id), "untrusted");
  });

  it("setSessionTrust untrusted → get untrusted", () => {
    const id = "s-" + Math.random();
    setSessionTrust(id, "untrusted");
    assert.equal(getSessionTrust(id), "untrusted");
  });
});
