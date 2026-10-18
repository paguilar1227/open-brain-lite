#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
if [[ ! -f .env ]]; then
  umask 077
  printf 'POSTGRES_PASSWORD=%s\n' "$(openssl rand -hex 24)" > .env
fi
docker compose up -d --build --wait
docker compose exec -T app node scripts/verify-models.mjs --pull
printf '\nOpen Brain Lite is ready on the configured host and port (default 3210).\nNo API key is needed. Data persists in Docker volumes.\n'
