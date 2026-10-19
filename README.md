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

Open port `3210` on the serving machine. The local workspace opens directly; no installation API key or login is required. The default listener is loopback; remote access requires deliberately configuring a bind address or HTTPS reverse proxy. Use HTTPS for browser notifications on phones.

```sh
docker compose stop       # preserve all data
./scripts/setup.sh        # resume, or rebuild after source changes
```

Do not remove Docker volumes unless you intend to erase the installation. Back up the `database` and `files` volumes together; `models` can be downloaded again. `.env` contains installation secrets and is gitignored.

## Models

When no provider preference has been saved or explicitly set in the environment, startup and successful Copilot sign-in check the installation’s authentication and live model catalog. If Claude Sonnet 5.5 is enabled, it becomes the completion default; otherwise the app keeps local Ollama. Embeddings remain local. Saving model settings makes that choice explicit and disables automatic selection; a selected provider’s request failures never trigger a silent fallback.

- **Default embedding:** Ollama `embeddinggemma`, 768 dimensions. A small [300M-parameter retrieval model](https://ollama.com/library/embeddinggemma) suited to a personal corpus.
- **Default completion/consolidation:** Ollama `qwen3.5:4b`, with thinking disabled for structured extraction and ordinary retrieval. [Qwen 3.5](https://ollama.com/library/qwen3.5) is a small multimodal model; the 4B weight download is approximately 3.3–4.0 GB. Compose packages the checksum-pinned official Ollama `0.40.4` release with its CPU components, excluding unused GPU runtimes, and disables cloud execution. Older runtimes can reject this model. Native Ollama can also be selected with `OLLAMA_URL` for hardware acceleration; setup prepares and verifies the models on that endpoint using the persisted model choice. The CPU acceptance runner took 39.2 seconds for three embeddings and a short structured completion; substantial handoffs can take several minutes and run as background jobs.
- **llama.cpp:** Select Local · llama.cpp in Settings and provide your local OpenAI-compatible server endpoint and loaded model. Ollama still supplies embeddings. Requests disable reasoning for ordinary extraction and handoffs, matching the Ollama default. Tested against llama.cpp `b11429` with Qwen 3.5 4B GGUF: structured JSON and a source-backed handoff both completed through the app's adapter.
- **Optional completion:** GitHub Copilot or ChatGPT via their official SDKs. Both device sign-in flows start from Settings. Copilot login uses the pinned official CLI, with automatic updates disabled and an installation-owned home/cache. Credentials are isolated in this installation; ambient host tokens and CLI accounts are excluded. Signed-in completion is verified with Copilot `gpt-5-mini` and ChatGPT `gpt-6-luna`, including after app-container recreation. Headless Copilot login enables file-backed credential storage in the private authentication volume; its settings file is written with mode `0600`.
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
5. `consolidate_project` starts a versioned, source-backed handoff and returns a job immediately. Poll `get_project_context` for `consolidation.status`: `running`, `completed`, or `failed`. State synthesis uses explicit project notes, sessions, and tasks. Documents appear in a labeled reference inventory and remain searchable/retrievable; record adopted document facts in a note or session decision to include them as project state. Previous summaries and source records remain available. Each summary and its searchable source note commit together before indexing. A job interrupted by a server restart can be started again; completed memories remain in the database.

The local HTTP MCP endpoint is `/mcp` and requires no API key. The stdio bridge connects automatically. Cloud deployments retain Bearer authentication.

## UI and data

- Reuses v2's component-based projects, notes, folders, document readers, todo hierarchy, comments, archive, pinning, tagging, search syntax, and mobile navigation.
- `frontend/src/theme.css` applies Software Kitchen’s Mono Drafting light and dark themes: the same palette, flat controls, sharp corners, Inter, and Geist Mono. Fonts are bundled locally; no font service is contacted. Light is the fresh-install default, and your selection persists per browser.
- Settings includes provider selection and opt-in browser notifications for due todos. Overlapping reminder checks are deduplicated, and disabling reminders stops pending delivery. Reminders require a supported secure browser origin and an open app; closed-browser Web Push is not implemented.
- The Memory tab tracks background consolidation, survives a page reload while the job runs, and displays failures without discarding the previous handoff. Local model requests do not use Node fetch's fixed five-minute response-header deadline.
- Text, Markdown, DOCX, text PDFs, and image OCR have local extraction paths. Audio and video use local Whisper (base/int8); YouTube URLs use a single original-language yt-dlp caption track or local transcription. Public X URLs save the referenced post text directly from X's public embed endpoint; whole threads and attached media are not captured. HTML imports use local Readability parsing. Protected or unsupported sources fail explicitly. Whisper weights download on first transcription and remain in the data volume.
- Ordinary local search retrieves vectors, text matches, and graph links without waiting for completion-based query classification. Generated answers still use the chosen completion provider.
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
npm run test:e2e -- 'lite-contract|settings'
```

The checks create and clean up their own records. The memory cases require a local completion provider. The remaining inherited v2 browser suite requires its original seed fixtures; it is not evidence of Lite acceptance by itself.

The manually triggered **Docker acceptance** GitHub Actions workflow runs the documented setup on a fresh runner, uses real local models and OCR, checks global/project search and the containerized plugin, recreates the test containers with their existing named volumes, then checks persisted models, settings, handoffs, and original file bytes. Its artifact contains the acceptance receipt and Docker diagnostics. Run it with `gh workflow run docker-acceptance.yml`.

Verified so far: build, 361 backend tests, 85 frontend tests, 3 Python media tests, and 11 desktop/mobile browser checks (one inherited Help placeholder is explicitly skipped). The background-job update additionally passed four desktop/mobile checks against an isolated stub runtime and a controlled mid-job page reload. A real MCP client with embedded PostgreSQL verified captured source and project scope while indexing was pending, then observed the ready state. Separate read-only reviews confirmed the browser, credential-isolation, local-import, transaction, model-setup, reminder, Markdown-rendering, background-error, asynchronous MCP-write, reference-provenance, and official Copilot login scopes. Real native Ollama + MCP checks covered ingestion, global/project search, idempotent session saving, consolidation, and retrieval by a fresh client. In the small acceptance corpus, search took 73–216 ms and consolidation took 36 seconds on an Apple M1 Pro; these are observations, not service guarantees. PDF, DOCX, WAV, and MP4 uploads extracted text and returned byte-identical originals. A real HTML import preserved paragraph boundaries and excluded navigation. A public text-only X post returned its exact text; regression tests cover the Lite import route and project/source preservation. Project state also survived a restart of the isolated native backend.

The final [Docker CPU acceptance run](https://github.com/paguilar1227/open-brain-lite/actions/runs/38792885923) passed on application revision `de38b64`: setup, real-model verification, text/PNG/PDF/WAV ingestion, source-backed consolidation, global/project search, all 25 plugin tools being available, and file/model/settings/session recovery after container recreation. The receipt verifies original-file hashes and exact handoff fields through a fresh plugin client. Its handoff also passed the reference-provenance regression and was inspected manually.

The local Docker installation also passed setup on the Apple M1 Pro after approved build-cache cleanup. Its first CPU model check took 213 seconds, including model startup; GPU-accelerated native Ollama remains an optional configuration. Both subscription providers completed device sign-in and returned the expected PostgreSQL JSON through the app adapters after container recreation. Copilot took 4.8 seconds and ChatGPT 3.9 seconds in that probe. Local project notes, session decisions, open work, global/project search, and all 25 MCP tools also survived the local restart checks. Full X-thread/media capture is outside the remaining scope. Physical-phone HTTPS notifications remain unverified; desktop and emulated-mobile browser notification checks passed.


### Session workspaces

Sessions hold their own notes, documents/uploads, todos and timeline. A session can belong to one project or remain standalone. Project search includes its direct content and all child sessions; global search includes standalone sessions. Existing project content stays where it was, and existing handoffs keep their IDs and source notes.

Open **Sessions** in navigation or a project's **Sessions** tab. Create a session, add content, and use its search scope selector or searchable/tag-filtered timeline. **Manage session** can rename or move the workspace. Deleting requires typing its name and permanently removes its owned content, files and timeline. A failed file cleanup remains queued and is retried by repeating the same session DELETE request.

A project's timeline combines direct project events and all child-session events in one chronology. Its tag menu is the distinct union across that history: a shared name such as `front-end` appears once and matches every included source. The **AND / OR** toggle defaults to AND (every selected tag); OR matches any selected tag, and no selection shows all events. REST and MCP accept the same `tag_match: all | any` option. Event cards identify their session or show **Project-level**. A session's timeline and tag menu remain local to that session; search and pagination do not shrink the available tag inventory.

MCP clients use `list_sessions`, `create_session`, `get_session_context`, `update_session`, `delete_session`, `session_timeline`, and `project_timeline`. Pass `session_id` to content/todo writes, lists, search and questions. Keep a stable `session_key` when creating/resuming; `save_session` also accepts the session UUID. See the bundled `plugin/skills/open-brain-lite/SKILL.md` for the complete workflow.

The agent interface also supports file upload/download/replacement, pins, all list filters, todo ordering and comments, bulk operations, tag maintenance, inventory, due reminders, and provider/model settings and device login. Permanent deletion requires explicit confirmation arguments (the current session name or exact record IDs); archive/restore remains available for reversible removal. Settings and device-login state are shared with the UI. Browser-local theme and browser notification permission remain in the browser. `backend/tests/integration/mcp-workspace-parity.test.ts` checks every server-backed UI route has a tool and exercises workflows through the real HTTP MCP transport with an isolated database and mock inference.

Session workspaces require migration `013_session_workspaces.sql`, after timeline migration `012_project_timeline.sql`. Back up and approve these migrations before upgrading an existing installation.

## Shared runtime releases

The web app, plugin, and CopilotBot consume the same backend and UI. To publish a stable runtime, update the root package version and lockfile, then push its matching `vX.Y.Z` tag. The release workflow builds and tests the project and publishes `open-brain-runtime.tar.gz` with `open-brain-runtime.json` (source revision, API compatibility version, size, and SHA-256). Published versions are immutable; fixes get a new version.

CopilotBot checks these stable releases from its Open Brain panel. It backs up its managed database and files before installation, verifies the updated API and UI, and restores the previous runtime and snapshot if verification fails. Remote or independently managed services are updated by their operator.
