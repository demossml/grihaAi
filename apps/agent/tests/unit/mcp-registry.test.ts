/**
 * Item 12.1 (L1/§22): MCP registry и discovery.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { McpRegistry } from "../../src/runtime/mcp/registry.js";

const makeRegistry = (): McpRegistry => {
  const registry = new McpRegistry();
  registry.registerServer({
    id: "files",
    name: "Files",
    transport: "stdio",
    credentialScope: "files:prod",
  });
  registry.registerTool({ name: "read", description: "read file", serverId: "files" });
  registry.registerTool({ name: "write", description: "write file", serverId: "files" });
  return registry;
};

describe("MCP registry (Item 12.1)", () => {
  it("регистрация сервера и tool-дискавери", () => {
    const registry = makeRegistry();
    assert.equal(registry.listServers().length, 1);
    assert.deepEqual(registry.listTools("files").map((t) => t.name), ["read", "write"]);
  });

  it("дубликат сервера → ошибка", () => {
    const registry = makeRegistry();
    assert.throws(
      () =>
        registry.registerServer({ id: "files", name: "dup", transport: "http", credentialScope: "x" }),
      /already registered/,
    );
  });

  it("tool без сервера → ошибка", () => {
    const registry = new McpRegistry();
    assert.throws(
      () => registry.registerTool({ name: "x", description: "x", serverId: "ghost" }),
      /unknown server/,
    );
  });

  it("§22: агент получает только явно запрошенные tools, неизвестное имя → ошибка", () => {
    const registry = makeRegistry();
    assert.deepEqual(registry.resolveTools("files", ["read"]).map((t) => t.name), ["read"]);
    assert.throws(() => registry.resolveTools("files", ["sudo"]), /tool not found/);
  });

  it("credentialScope хранится на сервере (K7-фундамент)", () => {
    const registry = makeRegistry();
    assert.equal(registry.getServer("files")?.credentialScope, "files:prod");
  });
});
