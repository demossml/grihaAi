/**
 * Phase 11 — Security публичный API (риски, инъекции, файлы, approval).
 * Ничего не подключено к production-путям.
 */
export {
  DEFAULT_APPROVAL_POLICY,
  classifyAction,
  requiresApproval,
  type ActionKind,
  type ActionRisk,
  type ApprovalPolicy,
  type RiskLevel,
} from "./risk.js";
export {
  scanForInjection,
  type InjectionScanIssue,
  type InjectionScanResult,
  type InjectionSource,
  type InjectionVerdict,
} from "./injection.js";
export {
  checkFileOperation,
  fileOperationRisk,
  isSafePath,
  type FileOperationSpec,
  type FileSafetyResult,
} from "./files.js";
export {
  DEFAULT_MEMORY_WRITE_APPROVAL_POLICY,
  makeMemoryWriteApprovalPolicy,
  memoryWriteNeedsApproval,
  type MemoryWriteApprovalPolicy,
  type MemoryWriteDecision,
} from "./approval.js";
