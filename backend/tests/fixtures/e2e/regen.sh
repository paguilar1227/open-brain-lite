#!/usr/bin/env bash
# Regenerate E2E test fixtures (sample.pdf, sample.png) using a local venv.
# Audio (sample.wav) is generated separately via macOS `say` + `ffmpeg` (see README).
set -euo pipefail

cd "$(dirname "$0")"

VENV=".venv"
if [ ! -d "$VENV" ]; then
  echo "Creating venv at $(pwd)/$VENV"
  python3 -m venv "$VENV"
fi

# shellcheck disable=SC1091
source "$VENV/bin/activate"

pip install --quiet --upgrade pip
pip install --quiet -r requirements.txt

python3 generate.py

deactivate

# Audio (macOS-only path)
if command -v say >/dev/null 2>&1 && command -v ffmpeg >/dev/null 2>&1; then
  say -v Daniel -o /tmp/sample.aiff "This is a test recording for Open Brain. The topic is pgvector and Anthropic Haiku."
  ffmpeg -y -loglevel error -i /tmp/sample.aiff -ar 16000 -ac 1 sample.wav
  rm -f /tmp/sample.aiff
  echo "wrote $(pwd)/sample.wav"
else
  echo "Skipping sample.wav — needs macOS \`say\` and \`ffmpeg\`. Generate manually if missing."
fi
