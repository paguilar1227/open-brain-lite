# E2E test fixtures

Pinned, checked-in inputs for `E2E_TEST_PLAN.md`. Filenames are stable; the contents are deterministic given the source files in this directory.

## Files

| File | What | Generated from |
|------|------|----------------|
| `sample.md` | Source markdown for the PDF (hand-authored, ~3 sections, multi-chunk-worthy) | source of truth |
| `sample.pdf` | 2-page PDF rendered from `sample.md` | `generate.py` (reportlab) |
| `sample.png` | 1024×600 PNG with high-contrast text for OCR (`pgvector + HNSW`, etc.) | `generate.py` (Pillow) |
| `sample.wav` | 10s mono 16kHz speech: "This is a test recording for Open Brain. The topic is pgvector and Anthropic Haiku." | `regen.sh` (macOS `say` + `ffmpeg`) |

## Regeneration

`regen.sh` handles everything — creates a local venv (`tests/fixtures/e2e/.venv`, gitignored), pins `reportlab` + `pillow` from `requirements.txt`, runs `generate.py`, then produces the WAV with macOS `say` + `ffmpeg`. **No global pip installs.**

```bash
# From the repo root:
bash tests/fixtures/e2e/regen.sh
```

Re-run any time the source (`sample.md`, the PNG/WAV text strings inside `generate.py`/`regen.sh`) changes. Outputs are reproducible — same source → same byte-stable PDF/PNG (the WAV varies slightly because TTS is nondeterministic, but the spoken text is fixed).

If sample.wav can't be regenerated (non-macOS host, no `ffmpeg`), commit the existing WAV and skip the audio step. The other fixtures regenerate fine on any OS with Python ≥ 3.10.

## When to regenerate

- If you edit `sample.md` (PDF source), `generate.py` (PNG layout), or the audio script in `regen.sh`.
- After major Python tooling upgrades that might change reportlab/Pillow output.

After regenerating, **update the "Baseline expected outcomes" section in `E2E_TEST_PLAN.md`** if the visible content (OCR words, transcript phrasing, page count) changed.

## Why these fixtures

Each fixture exercises a specific code path:

- **PDF (multi-page)** — multi-chunk pipeline, sentence-boundary chunker, blob storage round-trip.
- **PNG with text** — Haiku OCR on images via the metadata extractor.
- **WAV (speech)** — Haiku audio transcription.
- **Markdown body** — references named entities (pgvector, HNSW, IVFFlat, Anthropic, Gemini) so graph extraction has something to find.
