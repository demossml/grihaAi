# Security

## Session trust
- Default unknown sessionId: **untrusted** (deny elevation).
- Telegram sessions: **untrusted**.
- TUI / headless bot main session: explicit **trusted**.
- Gateway denies shell/execute_code/file mutation for untrusted.

## execute_code
- Production: only **runsc** sandbox; if unavailable → refuse (`SANDBOX_UNAVAILABLE`).
- Local host exec only if `GRIHA_EXECUTE_CODE_ALLOW_LOCAL=1` and `NODE_ENV !== production`.
- Never map classifyCodeRisk `"safe"` → host exec automatically.

## Environment scrub
`buildSandboxEnv()` allowlist only; strip keys matching token/key/secret/password/auth/bot.

## Prompt injection
OCR/document text scanned (`scanForInjection`, source document) before agent prompt. On block — do not inject raw OCR as instructions.

## Limitations
Legacy voice path may still lack scan — see STATUS.
