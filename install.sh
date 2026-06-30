#!/usr/bin/env bash
# Deploy the standard HXA connector on a BeautyClawOS sub-machine.
# Idempotent. Run ON the sub-machine (or push the dir there first).
set -euo pipefail

DIR="$(cd "$(dirname "$0")" && pwd)"
ZYLOS_DIR="${ZYLOS_DIR:-$HOME/zylos}"

echo "[install] dir=$DIR zylos=$ZYLOS_DIR"

# 1. deps (the HXA SDK)
( cd "$DIR" && npm install --no-audit --no-fund )

# 2. standard outbound: skills/hxa/scripts/send.js (c4-send routes here)
mkdir -p "$ZYLOS_DIR/.claude/skills/hxa/scripts"
cp "$DIR/send.js" "$ZYLOS_DIR/.claude/skills/hxa/scripts/send.js"
echo "[install] send.js installed"

# 3. per-machine config — fill HXA_TOKEN / HXA_ORG_ID / HXA_NAME here.
#    For multi-org, run one connector per org with its own .env (HXA_ENV_FILE).
if [ ! -f "$DIR/.env" ]; then
  cp "$DIR/.env.example" "$DIR/.env"
  echo "[install] created .env from example — FILL IN HXA_TOKEN/HXA_ORG_ID/HXA_NAME, then re-run pm2 start"
  exit 0
fi

# 4. start connector + watchdog and persist
( cd "$DIR" && pm2 start ecosystem.config.cjs && pm2 save )
echo "[install] done. Verify: pm2 ls ; ss -tnp | grep conai ; check c4.db channel=hxa gets traffic on next message"
