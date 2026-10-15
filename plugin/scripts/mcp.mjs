#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';
const envPath = fileURLToPath(new URL('../../.env', import.meta.url));
let env = {};
try { env = Object.fromEntries(readFileSync(envPath, 'utf8').split('\n').filter(line => /^[A-Z_]+=/.test(line)).map(line => { const i = line.indexOf('='); return [line.slice(0,i),line.slice(i+1)]; })); } catch { /* Environment-only installations are also supported. */ }
const key = process.env.OPEN_BRAIN_LITE_API_KEY || process.env.OPEN_BRAIN_API_KEY || env.OPEN_BRAIN_API_KEY;
if (!key) { console.error('Open Brain Lite: run scripts/setup.sh or set OPEN_BRAIN_LITE_API_KEY.'); process.exit(1); }
const url = process.env.OPEN_BRAIN_LITE_URL || `http://127.0.0.1:${process.env.PORT || env.PORT || 3210}/mcp`;
const upstream = new Client({ name: 'open-brain-lite-plugin', version: '0.1.0' });
await upstream.connect(new StreamableHTTPClientTransport(new URL(url), { requestInit: { headers: { Authorization: `Bearer ${key}` } } }));
const server = new Server({ name: 'open-brain-lite', version: '0.1.0' }, { capabilities: { tools: {} }, instructions: 'Read the open-brain-lite skill. Resolve the project, call get_project_context at session start, and save_session with factual outcomes and next steps when work ends.' });
server.setRequestHandler(ListToolsRequestSchema, () => upstream.listTools());
server.setRequestHandler(CallToolRequestSchema, request => upstream.callTool(request.params));
await server.connect(new StdioServerTransport());
process.on('SIGINT', async () => { await upstream.close(); await server.close(); process.exit(0); });
