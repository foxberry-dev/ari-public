import {createServer, request} from 'node:http';
import {pathToFileURL} from 'node:url';

export function createCatalogApi(upstreamPort = 38477) {
  return createServer((incoming, response) => {
    response.setHeader('Cache-Control', 'no-store');
    if (incoming.method !== 'GET' || (incoming.url !== '/health' && !/^\/api\/workspaces(?:\/[A-Za-z0-9_-]{1,64})?$/.test(incoming.url))) {
      response.writeHead(403).end('Read-only catalog API');
      return;
    }
    const path = incoming.url === '/health' ? '/api/workspaces' : incoming.url;
    const outgoing = request({hostname: '127.0.0.1', port: upstreamPort, path, method: 'GET',
      headers: {accept: 'application/json'}}, upstream => {
      response.writeHead(upstream.statusCode, {'Content-Type': upstream.headers['content-type'] || 'application/json'});
      upstream.pipe(response);
    });
    outgoing.on('error', error => {
      console.error(JSON.stringify({level: 'error', message: 'Development catalog upstream unavailable', code: error.code}));
      if (!response.headersSent) response.writeHead(502).end('Catalog unavailable');
      else response.destroy();
    });
    outgoing.setTimeout(10000, () => outgoing.destroy(new Error('Catalog request timeout')));
    response.on('close', () => outgoing.destroy());
    outgoing.end();
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const server = createCatalogApi();
  server.listen(8082, '0.0.0.0');
  const stop = () => { server.close(); setTimeout(() => process.exit(0), 5000).unref(); };
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
}
