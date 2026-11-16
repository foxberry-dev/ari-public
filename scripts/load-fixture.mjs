import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const options = {};
for (let i = 0; i < args.length; i += 2) {
  if (!['--url', '--file'].includes(args[i]) || !args[i + 1]) throw new Error('Usage: node scripts/load-fixture.mjs [--url http://127.0.0.1:38477] [--file fixtures/team-lunch-graph.json]');
  options[args[i].slice(2)] = args[i + 1];
}
const base = new URL(options.url || 'http://127.0.0.1:38477');
if (base.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(base.hostname)) throw new Error('Fixtures can only be loaded into an explicitly selected loopback development server.');
const file = options.file || fileURLToPath(new URL('../fixtures/team-lunch-graph.json', import.meta.url));
const fixture = JSON.parse(await readFile(file, 'utf8'));
if (!fixture.commits?.length) throw new Error('A fixture must contain at least one complete graph commit.');
let rpcId = 0;
async function rpc(method, params) {
  const response = await fetch(new URL('/mcp', base), {
    method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id: ++rpcId, method, params }),
  });
  if (!response.ok) throw new Error(`MCP request failed (${response.status}). Read the current clarification before retrying a publication.`);
  const text = await response.text();
  const message = response.headers.get('content-type')?.includes('text/event-stream')
    ? JSON.parse(text.split('\n').find(line => line.startsWith('data:')).slice(5)) : JSON.parse(text);
  if (message.error) throw new Error(message.error.message);
  return message.result;
}
async function tool(name, input = {}) {
  const result = await rpc('tools/call', { name, arguments: input });
  if (result.isError) throw new Error(result.content.find(c => c.type === 'text')?.text || 'MCP publication failed.');
  return JSON.parse(result.content.find(c => c.type === 'text').text);
}
await rpc('initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'ari-development-fixture', version: '1' } });
const context = await tool('get_context');
const existing = context.clarifications.find(c => c.id === fixture.id);
if (existing) {
  console.log(JSON.stringify({ status: 'already-exists', id: existing.id, revision: existing.revision, url: existing.url }));
} else {
  const [first, ...rest] = fixture.commits;
  let result = await tool('create_clarification', { id: fixture.id, title: fixture.title, description: fixture.description, ...first });
  for (const entry of rest) {
    result = await tool('publish_graph_commit', { clarificationId: fixture.id, expectedRevision: result.revision, ...entry });
  }
  console.log(JSON.stringify({ status: 'created', id: fixture.id, revision: result.revision, commits: fixture.commits.length, url: result.url }));
}
