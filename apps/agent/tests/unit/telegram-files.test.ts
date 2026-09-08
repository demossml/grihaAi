import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { downloadTelegramFileAsBase64 } from "../../src/utils/telegram-files.js";

describe("telegram file resolution", () => {
  it("resolves a file_id to a base64 data URL via getFile + download", async () => {
    const urls: string[] = [];
    const fetchFn = (async (url: string) => {
      urls.push(url);
      if (url.includes("/getFile")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ ok: true, result: { file_path: "photos/file_1.jpg" } }),
        };
      }
      return {
        ok: true,
        status: 200,
        arrayBuffer: async () => new TextEncoder().encode("IMAGE-BYTES").buffer,
      };
    }) as unknown as typeof fetch;

    const dataUrl = await downloadTelegramFileAsBase64("123:token", "AgAC-fid", { fetchFn });

    assert.equal(urls[0], "https://api.telegram.org/bot123:token/getFile?file_id=AgAC-fid");
    assert.equal(urls[1], "https://api.telegram.org/file/bot123:token/photos/file_1.jpg");
    assert.equal(dataUrl, `data:image/jpeg;base64,${Buffer.from("IMAGE-BYTES").toString("base64")}`);
  });

  it("throws when getFile returns no file_path", async () => {
    const fetchFn = (async () => ({
      ok: true,
      status: 200,
      json: async () => ({ ok: true, result: {} }),
    })) as unknown as typeof fetch;

    await assert.rejects(
      () => downloadTelegramFileAsBase64("token", "fid", { fetchFn }),
      /no file_path/,
    );
  });
});
