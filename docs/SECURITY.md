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

## External content boundary
User text, caption, `[REPLY_TO]`, album and voice transcript are wrapped in
`<external_content source="...">` and scanned (`sanitizeForAgent`) before the agent
prompt. Content inside `<external_content>` is DATA, not instructions; injection
markers → `[CONTENT_BLOCKED_BY_SECURITY]` placeholder instead of raw text.

## send_file roots
`defaultFileRoots()` in production (`NODE_ENV=production` or
`GRIHA_STRICT_FILE_ROOTS=1`) allows only `~/.grish-ai/reports|media|artifacts`.
Dev keeps a broader set (cwd, monorepo root, tmp). The model cannot send `.env`/sources
by guessing a path.

## Cron script jobs
`runScriptSandboxed` runs script-jobs in runsc (or refuse `SANDBOX_UNAVAILABLE`); local
exec only via `GRIHA_EXECUTE_CODE_ALLOW_LOCAL=1` + non-production. Env scrubbed
(`buildSandboxEnv`). No host spawn for automation without a user in the loop.

## Limitations
Legacy voice path may still lack scan — see STATUS.
