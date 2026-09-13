/**
 * Phase 12 — MCP + Toolsets публичный API (чистые функции).
 * Транспорт/wiring — за флагом `HERMES_AGENT_RUNTIME`.
 */
export {
  DEFAULT_MCP_EXECUTION_POLICY,
  McpRegistry,
  type McpExecutionPolicy,
  type McpServer,
  type McpTool,
  type McpTransport,
} from "../mcp/registry.js";
export {
  ALL_TOOLSETS,
  DEFAULT_TOOLSET_POLICY,
  canModifyPolicy,
  canUseToolset,
  validateToolsetRequest,
  type Toolset,
  type ToolsetDecision,
  type ToolsetPolicy,
} from "./toolsets.js";
export {
  alwaysActivatable,
  isSkillActivatable,
  type ActivationDecision,
  type SkillRequirement,
} from "./activation.js";
