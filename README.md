# Open Brain Lite

Private, local-first project memory derived from [open-brain-v2](https://github.com/paguilar1227/open-brain-v2), source revision `e25ca23`.

Projects keep their todos, notes, documents, search, and MCP tools. Session handoffs and consolidated project memory let the next AI session continue with the same evidence. PostgreSQL/pgvector, files, model weights, provider sign-ins, and settings persist in Docker volumes.

## Run

Requirements: Docker with Compose. The setup script downloads the local model weights and checks real embeddings and structured completion before reporting ready; after that the default path needs no cloud model account.

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
- **Default completion/consolidation:** Ollama `qwen3.5:4b`, with thinking disabled for structured extraction and ordinary retrieval. [Qwen 3.5](https://ollama.com/library/qwen3.5) is a small multimodal model; the 4B weight download is approximately 3.3–4.0 GB. Compose packages the checksum-pinned official Ollama `0.40.4` release with its CPU components, excluding unused GPU runtimes, and disables cloud execution. Older runtimes can reject this model. Native Ollama can also be selected with `OLLAMA_URL` for hardware acceleration; setup prepares and verifies the models on that endpoint using the persisted model choice. The CPU acceptance runner took 39.2 seconds for three embeddings and a short structured completion; substantial handoffs can take several minutes and run as background jobs.
- **llama.cpp:** Select Local · llama.cpp in Settings and provide your local OpenAI-compatible server endpoint and loaded model. Ollama still supplies embeddings.
- **Optional completion:** GitHub Copilot or ChatGPT via their official SDKs. ChatGPT device sign-in starts from Settings; account authorization and a signed-in completion remain to be verified. Copilot completion is implemented, but its device sign-in is currently blocked: the SDK runtime cannot perform CLI login, and adding the separate official CLI awaits approval. Credentials are isolated in this installation; ambient host tokens and CLI accounts are excluded.
- Embeddings always remain local when using subscription completion. The selected completion provider receives the relevant prompt and retrieved project content. No silent provider fallback.

Changing the embedding model requires reindexing with matching dimensions; do not reuse vectors from a different embedding model. These defaults passed a native Apple M1 Pro workload: real ingestion, global/project retrieval, structured extraction, and a source-cited handoff retrieved by a new MCP client. This is a practical default, not a claim of universal benchmark leadership.

## Agent plugin

```sh
./scripts/install-plugin.sh codex   # MCP registration + skill
./scripts/install-plugin.sh claude  # equivalent Claude registration
```

The installer preserves an existing skill. Restart the client after installing. `plugin/` is also a Claude plugin layout with a manifest, `.mcp.json`, and skill. For plugin-manager installations outside this checkout, set `OPEN_BRAIN_LITE_HOME` to the app checkout. The bridge executes inside the Docker app; host Node/npm dependencies are not required.

Workflow:

1. `list_projects` resolves the project UUID.
2. `get_project_context` reads current memory, session handoffs, and open work.
3. Existing `search`, `create`, `update`, `replace`, archive/restore, comment, and other tools operate on the same underlying records as the UI. Local content writes acknowledge capture with `status: pending` while indexing continues. Poll `get(id)` (or `get(new_id)` after replacement) until `processing_status` is `ready` or `failed`; `processing_error` explains a failure. URL fetching/extraction occurs before capture is acknowledged.
4. `save_session` stores factual progress, decisions, and next steps, idempotently by project + session key. Session records and their source notes commit together before acknowledgment; search indexing runs in the background. Retries also repair older unlinked handoffs.
5. `consolidate_project` starts a versioned, source-backed handoff and returns a job immediately. Poll `get_project_context` for `consolidation.status`: `running`, `completed`, or `failed`. Previous summaries and source records remain available. Each summary and its searchable source note commit together before indexing. A job interrupted by a server restart can be started again; completed memories remain in the database.

The HTTP MCP endpoint is `/mcp` with Bearer authentication. The plugin's stdio bridge reads this checkout's `.env`, so secrets do not need to be copied into MCP configuration.

## UI and data

- Reuses v2's component-based projects, notes, folders, document readers, todo hierarchy, comments, archive, pinning, tagging, search syntax, and mobile navigation.
- `frontend/src/theme.css` overrides semantic tokens. Future Refero themes can change this layer without rewriting feature components. Fonts load locally from the system.
- Settings includes provider selection and opt-in browser notifications for due todos. Overlapping reminder checks are deduplicated, and disabling reminders stops pending delivery. Reminders require a supported secure browser origin and an open app; closed-browser Web Push is not implemented.
- The Memory tab tracks background consolidation, survives a page reload while the job runs, and displays failures without discarding the previous handoff. Local model requests do not use Node fetch's fixed five-minute response-header deadline.
- Text, Markdown, DOCX, text PDFs, and image OCR have local extraction paths. Audio and video use local Whisper (base/int8); YouTube URLs use a single original-language yt-dlp caption track or local transcription. Public X URLs save the referenced post text directly from X's public embed endpoint; whole threads and attached media are not captured. HTML imports use local Readability parsing. Protected or unsupported sources fail explicitly. Whisper weights download on first transcription and remain in the data volume.
- Original text is persisted before async model work. Interrupted ingests are recovered at startup from their stored source.

## Development and verification

```sh
npm ci
npm run build:all
npm test
npm run test:frontend
```

Provider tests use mocks and require no real account keys. The local-database tests execute the migrations, pgvector searches, rollback behavior, and disk reopen against embedded PostgreSQL (PGlite); Docker acceptance remains a separate check. Production builds run the real configured local provider; stub mode is only for tests or explicit UI development.

Browser regression checks run against an explicitly started, isolated installation:

```sh
npm run test:e2e:install --workspace=open-brain-frontend
OPEN_BRAIN_API_KEY=your-test-installation-key npm run test:e2e -- 'lite-contract|settings'
```

The checks create and clean up their own records. The memory cases require a local completion provider. The remaining inherited v2 browser suite requires its original seed fixtures; it is not evidence of Lite acceptance by itself.

The manually triggered **Docker acceptance** GitHub Actions workflow runs the documented setup on a fresh runner, uses real local models and OCR, checks global/project search and the containerized plugin, recreates the test containers with their existing named volumes, then checks persisted models, settings, handoffs, and original file bytes. Its artifact contains the acceptance receipt and Docker diagnostics. Run it with `gh workflow run docker-acceptance.yml`.

Verified so far: build, 352 backend tests, 85 frontend tests, 3 Python media tests, and 11 desktop/mobile browser checks (one inherited Help placeholder is explicitly skipped). The background-job update additionally passed four desktop/mobile checks against an isolated stub runtime and a controlled mid-job page reload. A real MCP client with embedded PostgreSQL verified captured source and project scope while indexing was pending, then observed the ready state. Separate read-only reviews confirmed the browser, credential-isolation, local-import, transaction, model-setup, reminder, Markdown-rendering, background-error, and asynchronous MCP-write scopes. Real native Ollama + MCP checks covered ingestion, global/project search, idempotent session saving, consolidation, and retrieval by a fresh client. In the small acceptance corpus, search took 73–216 ms and consolidation took 36 seconds on an Apple M1 Pro; these are observations, not service guarantees. PDF, DOCX, WAV, and MP4 uploads extracted text and returned byte-identical originals. A real HTML import preserved paragraph boundaries and excluded navigation. A public text-only X post returned its exact text; regression tests cover the Lite import route and project/source preservation. Project state also survived a restart of the isolated native backend.

Current work remains in progress: Docker CPU acceptance passed setup, real-model verification, text ingestion, PNG OCR, PDF extraction, and WAV transcription. It exposed a five-minute HTTP timeout during consolidation; the transport and background-job fix awaits a fresh full run. Container recreation and durable-file checks remain unverified in Docker. Installation on this Mac remains blocked by local Docker disk space. Copilot CLI installation awaits approval. ChatGPT device URL/code parsing passed in an empty installation; neither subscription provider has completed account authorization or a real signed-in completion. A public YouTube caption extraction passes on the native runtime. Physical-phone HTTPS notifications remain unverified. Native model checks and browser tests do not substitute for those integrations.
