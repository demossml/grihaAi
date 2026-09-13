#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../.."

echo "=== makeModel reasoning ==="
grep -n "reasoning:" apps/agent/src/utils/bootstrap/provider-bootstrap.ts || true
echo "=== STYLE_BLOCK ==="
grep -n "STYLE_BLOCK" apps/agent/.pi/extensions/telegram-bot/TelegramSessionPool.ts || true
PI_AI_JS=$(find node_modules -path "*pi-ai*/dist/api/openai-completions.js" 2>/dev/null | head -1 || true)
echo "pi-ai js: ${PI_AI_JS:-NOT_FOUND}"
if [[ -n "${PI_AI_JS:-}" ]]; then
  grep -n "thinkingFormat\|model\.reasoning\|type: \"disabled\"" "$PI_AI_JS" | head -40
fi
