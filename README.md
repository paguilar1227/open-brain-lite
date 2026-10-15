# Open Brain Lite

Private, local-first project memory derived from [open-brain-v2](https://github.com/paguilar1227/open-brain-v2), source revision `e25ca23`.

Projects keep their todos, notes, documents, search, and MCP tools. Session handoffs and consolidated project memory let the next AI session continue with the same evidence. PostgreSQL/pgvector, files, model weights, provider sign-ins, and settings persist in Docker volumes.

## Run

Requirements: Docker with Compose. The setup script downloads the local model weights; after that the default path needs no cloud model account.

```sh
gh repo clone paguilar1227/open-brain-lite
cd open-brain-lite
./scripts/setup.sh
```

Open port `3210` on the serving machine. Sign in with the installation API key in `.env`. The generated key is never baked into the frontend. The default listener is loopback; remote access requires deliberately configuring a bind address or HTTPS reverse proxy. Use HTTPS for browser notifications on phones.

```sh
docker compose stop       # preserve all data
./scripts/setup.sh        # resume, or rebuild after source changes
```

Do not remove Docker volumes unless you intend to erase the installation. Back up the `database` and `files` volumes together; `models` can be downloaded again. `.env` contains installation secrets and is gitignored.

## Models

- **Default embedding:** Ollama `embeddinggemma`, 768 dimensions. A small [300M-parameter retrieval model](https://ollama.com/library/embeddinggemma) suited to a personal corpus.
- **Default completion/consolidation:** Ollama `qwen3.5:4b`, with thinking disabled for structured extraction and ordinary retrieval. [Qwen 3.5](https://ollama.com/library/qwen3.5) is a current small multimodal model; the 4B weight download is approximately 3.3–4.0 GB. The default works on CPU; native Ollama can also be selected with `OLLAMA_URL` for hardware acceleration.
- **llama.cpp:** Select Local · llama.cpp in Settings and provide your local OpenAI-compatible server endpoint and loaded model. Ollama still supplies embeddings.
- **Optional completion:** GitHub Copilot or ChatGPT via their official SDKs. Use Settings to start device sign-in, select a provider/model, and save. Credentials are isolated in this installation; host CLI accounts are not mounted.
- Embeddings always remain local when using subscription completion. The selected completion provider receives the relevant prompt and retrieved project content. No silent provider fallback.

Changing the embedding model requires reindexing with matching dimensions; do not reuse vectors from a different embedding model. Model defaults are provisional until measured on the real local workload.

## Agent plugin

```sh
./scripts/install-plugin.sh codex   # MCP registration + skill
./scripts/install-plugin.sh claude  # equivalent Claude registration
```

The installer preserves an existing skill. Restart the client after installing. `plugin/` is also a Claude plugin layout with a manifest, `.mcp.json`, and skill. For plugin-manager installations outside this checkout, set `OPEN_BRAIN_LITE_HOME` to the app checkout. The bridge executes inside the Docker app; host Node/npm dependencies are not required.

Workflow:

1. `list_projects` resolves the project UUID.
2. `get_project_context` reads current memory, session handoffs, and open work.
3. Existing `search`, `create`, `update`, `replace`, archive/restore, comment, and other tools operate on the same underlying records as the UI.
4. `save_session` stores factual progress, decisions, and next steps, idempotently by project + session key.
5. `consolidate_project` makes a versioned, source-backed handoff. Previous summaries and source records remain available.

The HTTP MCP endpoint is `/mcp` with Bearer authentication. The plugin's stdio bridge reads this checkout's `.env`, so secrets do not need to be copied into MCP configuration.

## UI and data

- Reuses v2's component-based projects, notes, folders, document readers, todo hierarchy, comments, archive, pinning, tagging, search syntax, and mobile navigation.
- `frontend/src/theme.css` overrides semantic tokens. Future Refero themes can change this layer without rewriting feature components. Fonts load locally from the system.
- Settings includes provider selection and opt-in browser notifications for due todos. Reminders require a supported secure browser origin and an open app; closed-browser Web Push is not implemented.
- Text, Markdown, DOCX, text PDFs, and image OCR have local extraction paths. Audio and video use local Whisper (base/int8); public platform URLs use yt-dlp captions or local transcription. HTML imports use local Readability parsing. Protected or unsupported sources fail explicitly. Whisper weights download on first transcription and remain in the data volume.
- Original text is persisted before async model work. Interrupted ingests are recovered at startup from their stored source.

## Development and verification

```sh
npm ci
npm run build:all
npm test
npm run test:frontend
```

Provider tests use mocks and require no real account keys. The local-database tests execute the migrations, pgvector searches, rollback behavior, and disk reopen against embedded PostgreSQL (PGlite); Docker acceptance remains a separate check. Production builds run the real configured local provider; stub mode is only for tests or explicit UI development.

Current work remains in progress: real Docker/model/mobile validation, completion-provider sign-in verification, local media/URL extraction verification, and the final independent acceptance pass. Do not treat passing mock-based tests as proof of those integrations.
