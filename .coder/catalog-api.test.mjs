import assert from 'node:assert/strict';
import {createServer, request} from 'node:http';
import {once} from 'node:events';
import test from 'node:test';
import {createCatalogApi} from './catalog-api.mjs';

async function listen(server, t) {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => { server.closeAllConnections(); server.close(); });
  return `http://127.0.0.1:${server.address().port}`;
}

test('the private catalog permits clarification reads and strips caller headers while denying agent and mutation routes', async t => {
  const reads = [];
  const upstream = createServer((request, response) => {
    reads.push({path: request.url, headers: request.headers});
    response.writeHead(200, {'Content-Type': 'application/json'});
    response.end('[{"id":"saved"}]');
  });
  await listen(upstream, t);
  const base = await listen(createCatalogApi(upstream.address().port), t);
  for (const path of ['/api/workspaces', '/api/workspaces/saved', '/health']) {
    const result = await fetch(base + path, {headers: {authorization: 'Bearer private', cookie: 'private=1',
      origin: 'https://attacker.test', forwarded: 'host=attacker.test', 'x-forwarded-host': 'attacker.test'}});
    assert.equal(result.status, 200);
    assert.deepEqual(await result.json(), [{id: 'saved'}]);
    const {headers} = reads.at(-1);
    assert.equal(headers.host, `127.0.0.1:${upstream.address().port}`);
    for (const name of ['authorization', 'cookie', 'origin', 'forwarded', 'x-forwarded-host']) assert.equal(headers[name], undefined);
  }
  assert.deepEqual(reads.map(read => read.path), ['/api/workspaces', '/api/workspaces/saved', '/api/workspaces']);
  const count = reads.length;
  for (const path of ['/mcp', '/', '/api/events', '/api/context', '/api/poll', '/api/reply',
    '/api/workspaces/saved/actions', '/api/workspaces/saved/agent', '/api/workspaces?redirect=1',
    '/api/workspaces/%2e%2e/mcp', '//attacker.test/api/workspaces']) {
    const status = await new Promise((resolve, reject) => {
      const outgoing = request(base, {path}, response => { response.resume(); resolve(response.statusCode); });
      outgoing.on('error', reject);
      outgoing.end();
    });
    assert.equal(status, 403, path);
  }
  for (const method of ['POST', 'PUT', 'DELETE', 'PATCH', 'HEAD']) {
    assert.equal((await fetch(`${base}/api/workspaces/saved`, {method})).status, 403, method);
  }
  assert.equal(reads.length, count);
});
