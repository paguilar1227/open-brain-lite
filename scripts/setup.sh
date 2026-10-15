#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
if [[ ! -f .env ]]; then
  umask 077
  printf 'OPEN_BRAIN_API_KEY=%s\nPOSTGRES_PASSWORD=%s\n' "$(openssl rand -hex 32)" "$(openssl rand -hex 24)" > .env
fi
docker compose up -d --build --wait
embedding_model=$(docker compose exec -T app printenv EMBEDDING_MODEL)
docker compose exec -T ollama ollama pull "$embedding_model"
local_model=$(docker compose exec -T app printenv LOCAL_MODEL)
docker compose exec -T ollama ollama pull "$local_model"
docker compose exec -T app node scripts/verify-models.mjs
printf '\nOpen Brain Lite is ready on the configured host and port (default 3210).\nYour API key is in .env. Data persists in Docker volumes.\n'
