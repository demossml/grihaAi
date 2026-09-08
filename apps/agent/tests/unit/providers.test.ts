import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  getProviders,
  noopEmailProvider,
  noopCalendarProvider,
} from "../../src/providers/providers.js";

describe("providers (noop)", () => {
  it("email.send is unavailable — never fake success", async () => {
    const res = await getProviders().email.send("u1", { to: "a@b.c", subject: "s", body: "b" });
    assert.equal(res.ok, false);
    assert.match(res.error ?? "", /не подключён/);
  });

  it("email.draft is a local operation and succeeds", async () => {
    const res = await noopEmailProvider.draft("u1", { to: "a@b.c", subject: "s", body: "b" });
    assert.equal(res.ok, true);
  });

  it("calendar.write is unavailable", async () => {
    const res = await noopCalendarProvider.writeEvent("u1", {});
    assert.equal(res.ok, false);
  });

  it("exposes the full provider set", () => {
    const p = getProviders();
    assert.ok(p.calendar && p.email && p.crm && p.travel && p.accounting);
  });
});
