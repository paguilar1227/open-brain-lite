// End-to-end acceptance against a fresh Docker installation. All inference is local.
// Run `write`, restart the compose services, then run `read` with the same receipt.
import 'dotenv/config';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { setTimeout as wait } from 'node:timers/promises';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const phase = process.argv[2];
assert(['write', 'read'].includes(phase), 'Usage: node scripts/verify-docker.mjs write|read [receipt-path]');
const receiptPath = process.argv[3] || 'scratch/docker-acceptance-receipt.json';
const base = process.env.OPEN_BRAIN_BASE_URL || `http://127.0.0.1:${process.env.PORT || 3210}`;
const headers = {}; // Local REST and MCP access require no installation key.
const receipt = phase === 'read' ? JSON.parse(await readFile(receiptPath, 'utf8')) : { checks: [], files: [] };

async function checkpoint(check) {
  receipt.checks.push(check);
  await mkdir(dirname(receiptPath), { recursive: true });
  await writeFile(receiptPath, JSON.stringify(receipt, null, 2));
  console.log(JSON.stringify(check));
}

async function api(path, body, method = body === undefined ? 'GET' : 'POST') {
  const response = await fetch(new URL(`/api/v1${path}`, base), {
    method,
    headers: { ...headers, ...(body instanceof FormData ? {} : { 'Content-Type': 'application/json' }) },
    body: body === undefined ? undefined : body instanceof FormData ? body : JSON.stringify(body),
  });
  assert(response.ok, `${path}: HTTP ${response.status} ${await response.clone().text()}`);
  return response.json();
}

async function connectPlugin() {
  const client = new Client({ name: 'docker-plugin-acceptance', version: '1.0' });
  await client.connect(new StdioClientTransport({ command: 'bash', args: ['plugin/scripts/mcp.sh'] }));
  return client;
}

async function callPlugin(client, name, args) {
  const result = await client.callTool({ name, arguments: args });
  assert(!result.isError, JSON.stringify(result.content));
  return JSON.parse(result.content[0].text);
}

async function ready(id) {
  let status;
  do {
    status = await api(`/content/${id}/status`);
    if (status.processing_status === 'pending') await wait(1000);
  } while (status.processing_status === 'pending');
  assert.equal(status.processing_status, 'ready', status.processing_error);
  return (await api(`/content/${id}`)).item;
}

const runtime = await api('/runtime');
assert.equal(runtime.provider, 'ollama', 'Acceptance must use the real local provider');

if (phase === 'write') {
  const { project } = await api('/projects', { name: 'Docker durable memory acceptance' });
  const { project: other } = await api('/projects', { name: 'Unrelated cooking acceptance' });
  receipt.projectId = project.id;
  const note = await api('/content', { type: 'note', title: 'Durable storage decision',
    content: 'Project notes and task state persist locally in PostgreSQL. Original documents remain in a Docker volume. Each AI session reads the earlier decisions and next steps.', project_ids: [project.id] });
  await ready(note.id);
  receipt.noteId = note.id;
  const unrelated = await api('/content', { type: 'note', title: 'Pasta recipe',
    content: 'Bake lasagna with tomato sauce, ricotta and parmesan.', project_ids: [other.id] });
  await ready(unrelated.id);
  receipt.unrelatedNoteId = unrelated.id;
  const { todo } = await api('/todos', { content: 'Verify project state after restarting Docker.', project_id: project.id });
  receipt.todoId = todo.id;
  await checkpoint({ check: 'real-local-ingestion', passed: true });

  for (const fixture of [
    { filename: 'sample.png', type: 'image/png', expected: /pgvector|HNSW/i },
    { filename: 'sample.pdf', type: 'application/pdf', expected: /pgvector/i },
    { filename: 'sample.wav', type: 'audio/wav', expected: /test recording/i },
  ]) {
    const bytes = await readFile(`backend/tests/fixtures/e2e/${fixture.filename}`);
    const form = new FormData();
    form.set('type', 'document'); form.set('title', `Docker ${fixture.filename}`);
    form.set('project_ids', project.id);
    form.set('file', new Blob([bytes], { type: fixture.type }), fixture.filename);
    const saved = await api('/content', form);
    const item = await ready(saved.id);
    assert.match(item.content, fixture.expected);
    receipt.files.push({ id: saved.id, name: fixture.filename, sha256: createHash('sha256').update(bytes).digest('hex') });
    await checkpoint({ check: 'local-file-extraction', file: fixture.filename, passed: true });
  }

  const seedClient = await connectPlugin();
  let job;
  try {
    const session = await callPlugin(seedClient, 'save_session', { project_id: project.id, session_key: 'docker-acceptance',
      summary: 'Local documents and a storage decision were captured. Restart validation is next.',
      decisions: ['Persist PostgreSQL, files, and model weights in Docker volumes.'], next_steps: ['Verify state through a fresh plugin process after restarting every service.'] });
    receipt.sessionId = session.id;
    job = await callPlugin(seedClient, 'consolidate_project', { project_id: project.id });
  } finally { await seedClient.close(); }
  await checkpoint({ check: 'consolidation-started-via-plugin', job: job.id, status: job.status });
  let context;
  do {
    context = await api(`/projects/${project.id}/context`);
    assert.equal(context.consolidation?.id, job.id, 'Consolidation was interrupted or replaced');
    if (context.consolidation.status === 'running') await wait(1000);
  } while (context.consolidation.status === 'running');
  assert.equal(context.consolidation.status, 'completed', context.consolidation.error);
  const memory = context.memory;
  assert.equal(memory.id, context.consolidation.memory_id);
  assert(memory.summary.trim());
  assert.doesNotMatch(memory.summary, /lasagna|ricotta|parmesan/i);
  receipt.memoryId = memory.id;
  receipt.memorySummary = memory.summary;
  const sources = [receipt.noteId, receipt.todoId, receipt.sessionId, ...receipt.files.map(file => file.id)];
  for (const id of sources) assert(memory.source_ids.includes(id), `Missing consolidation source ${id}`);
  assert(sources.some(id => memory.summary.includes(id)), 'Handoff must cite its supplied source records');
  assert.match(memory.summary, /restart/i, 'Handoff must retain the pending restart verification');
  assert.match(memory.summary, /volume|PostgreSQL/i, 'Handoff must retain the storage decision');
  assert.doesNotMatch(memory.summary, /\b3,?072[\s*-]*(?:dimension|dimensional)|Gemini Embedding|text-embedding-3-large/i,
    'Reference PDF settings must not become current project architecture');
  receipt.savedModelSettings = { provider: runtime.provider, localModel: runtime.localModel,
    llamaUrl: runtime.llamaUrl, llamaModel: 'docker-acceptance-unused-model',
    copilotModel: runtime.copilotModel, chatgptModel: runtime.chatgptModel };
  await api('/runtime', receipt.savedModelSettings, 'PUT');
  await checkpoint({ check: 'source-backed-consolidation', passed: true });
}

const savedRuntime = await api('/runtime');
for (const [name, value] of Object.entries(receipt.savedModelSettings)) assert.equal(savedRuntime[name], value);

const query = 'How are project notes and task state retained between AI sessions?';
const global = await api('/search', { query });
assert(global.hits.some(hit => hit.chunk?.content_item_id === receipt.noteId));
const scoped = await api('/search', { query, project_id: receipt.projectId });
assert(scoped.hits.length);
assert(scoped.hits.some(hit => hit.chunk?.content_item_id === receipt.noteId));
assert(scoped.hits.every(hit => hit.type === 'todo' ? hit.todo.project_id === receipt.projectId : hit.chunk.parent_project_ids.includes(receipt.projectId)));
const otherQuery = 'Bake lasagna with tomato sauce, ricotta and parmesan.';
const otherGlobal = await api('/search', { query: otherQuery });
assert(otherGlobal.hits.some(hit => hit.chunk?.content_item_id === receipt.unrelatedNoteId));
const otherScoped = await api('/search', { query: otherQuery, project_id: receipt.projectId });
assert(otherScoped.hits.every(hit => hit.chunk?.content_item_id !== receipt.unrelatedNoteId));
await checkpoint({ check: `${phase}-global-and-project-search`, passed: true });

// Execute the same shell entry point installed by the plugin. The Node bridge,
// its SDK dependencies and API credential all come from the running container.
const client = await connectPlugin();
try {
  const tools = await client.listTools();
  for (const name of ['create', 'search', 'download', 'get_project_context', 'save_session', 'consolidate_project']) {
    assert(tools.tools.some(tool => tool.name === name), `Missing plugin tool: ${name}`);
  }
  const result = await client.callTool({ name: 'get_project_context', arguments: { project_id: receipt.projectId } });
  assert(!result.isError, JSON.stringify(result.content));
  const context = JSON.parse(result.content[0].text);
  assert.equal(context.memory.id, receipt.memoryId);
  assert.equal(context.memory.summary, receipt.memorySummary);
  assert(context.sessions.some(session => session.id === receipt.sessionId));
  assert.deepEqual(context.sessions.find(session => session.id === receipt.sessionId).decisions,
    ['Persist PostgreSQL, files, and model weights in Docker volumes.']);
  assert.deepEqual(context.sessions.find(session => session.id === receipt.sessionId).next_steps,
    ['Verify state through a fresh plugin process after restarting every service.']);
  assert(context.open_todos.some(todo => todo.id === receipt.todoId));
  for (const file of receipt.files) {
    const result = await client.callTool({ name: 'download', arguments: { id: file.id } });
    assert(!result.isError);
    const { download_url } = JSON.parse(result.content[0].text);
    const response = await fetch(new URL(download_url, base));
    assert(response.ok);
    const digest = createHash('sha256').update(Buffer.from(await response.arrayBuffer())).digest('hex');
    assert.equal(digest, file.sha256, `Original bytes changed: ${file.name}`);
  }
  await checkpoint({ check: `${phase}-container-plugin-and-durable-files`, tools: tools.tools.length, passed: true });
} finally { await client.close(); }

receipt[phase] = 'passed';
await writeFile(receiptPath, JSON.stringify(receipt, null, 2));
