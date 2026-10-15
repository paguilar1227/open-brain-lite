#!/usr/bin/env bash
set -euo pipefail
root=$(cd "$(dirname "$0")/.." && pwd)
target="${1:-codex}"
case "$target" in
  codex)
    codex mcp add open-brain-lite -- bash "$root/plugin/scripts/mcp.sh"
    mkdir -p "${CODEX_HOME:-$HOME/.codex}/skills"
    if [[ -e "${CODEX_HOME:-$HOME/.codex}/skills/open-brain-lite" ]]; then
      printf 'Skill already exists; preserving it. Source: %s\n' "$root/plugin/skills/open-brain-lite"
    else
      ln -s "$root/plugin/skills/open-brain-lite" "${CODEX_HOME:-$HOME/.codex}/skills/open-brain-lite"
    fi
    ;;
  claude)
    claude mcp add --scope user open-brain-lite -- bash "$root/plugin/scripts/mcp.sh"
    mkdir -p "$HOME/.claude/skills"
    if [[ ! -e "$HOME/.claude/skills/open-brain-lite" ]]; then ln -s "$root/plugin/skills/open-brain-lite" "$HOME/.claude/skills/open-brain-lite"; fi
    ;;
  *) printf 'Usage: %s [codex|claude]\n' "$0" >&2; exit 2 ;;
esac
printf 'Installed. Restart the client to load the MCP and skill.\n'
