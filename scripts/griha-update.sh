#!/usr/bin/env bash
# SYSTEM UPDATE — безопасное обновление кода Гриши (U1–U12).
# Данные (~/.grish-ai) НЕ трогаются. Только fetch + pull --ff-only.
set -euo pipefail

REPO="${GRIHA_REPO_DIR:-$(cd "$(dirname "$0")/.." && pwd)}"
DATA="${GRIHA_DATA_DIR:-$HOME/.grish-ai}"
cd "$REPO"

if [[ "$REPO" == "$DATA" ]]; then
  echo "FATAL: repo == data" >&2
  exit 1
fi

if ! git status --porcelain | grep -q .; then
  :
else
  echo "Dirty tree — обновление отменено" >&2
  git status --porcelain | head -20 >&2
  exit 1
fi

git fetch origin
BRANCH=$(git rev-parse --abbrev-ref HEAD)
if [[ "$BRANCH" == "HEAD" ]]; then
  echo "Detached HEAD — обновите вручную" >&2
  exit 1
fi
git pull --ff-only origin "$BRANCH"

if [[ -f package-lock.json ]]; then
  npm ci || npm install
else
  npm install
fi

npx turbo run build

echo "OK $(git rev-parse --short HEAD)"
# Рестарт — внешний механизм:
#   systemctl --user restart griha-agent.service
# или GRIHA_RESTART_CMD в tool-пути.
