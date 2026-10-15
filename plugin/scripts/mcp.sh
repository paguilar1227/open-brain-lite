#!/usr/bin/env bash
set -euo pipefail
root="${OPEN_BRAIN_LITE_HOME:-$(cd "$(dirname "$0")/../.." && pwd)}"
if [[ ! -f "$root/docker-compose.yml" ]]; then
  printf 'Set OPEN_BRAIN_LITE_HOME to your Open Brain Lite checkout.\n' >&2
  exit 1
fi
exec docker compose --project-directory "$root" -f "$root/docker-compose.yml" exec -T app node /app/plugin/scripts/mcp.mjs
