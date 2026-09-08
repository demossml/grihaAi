import { Type } from "typebox";
import type { AgentToolResult, ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { capabilitiesReport, type CapabilityReport } from "../../../src/utils/capabilities.js";

/**
 * Connector boundary — exposes a machine-readable capability report so skills
 * and callers can check which external capabilities are available, which
 * skills are degraded, and which actions require approval.
 */
export default function connector(pi: ExtensionAPI): void {
  pi.registerTool({
    name: "capabilities_list",
    label: "List connector capabilities",
    description:
      "Machine-readable отчёт: доступные external capabilities, degraded skills, действия, требующие approval.",
    parameters: Type.Object({}),
    async execute(): Promise<AgentToolResult<CapabilityReport>> {
      const report = capabilitiesReport();
      const text = JSON.stringify(report, null, 2);
      return { content: [{ type: "text", text }], details: report };
    },
  });
}
