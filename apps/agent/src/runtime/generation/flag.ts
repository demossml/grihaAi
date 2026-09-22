/**
 * Feature flag GRIHA_GENERATION_POLICY (default OFF = старое поведение).
 */
export function isGenerationPolicyEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const v = (env.GRIHA_GENERATION_POLICY ?? "").trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}
