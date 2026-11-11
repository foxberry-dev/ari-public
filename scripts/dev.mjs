import { spawn } from 'node:child_process';
import { watch } from 'node:fs';
import { access } from 'node:fs/promises';
import { createServer } from 'node:net';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const children = new Set();
const lifetime = new AbortController();
let backend;
let stopping = false;
let rebuilding = false;
let pending = false;
let timer;

function child(command, args, cwd = root) {
  const process = spawn(command, args, { cwd, stdio: 'inherit' });
  children.add(process);
  process.on('exit', () => children.delete(process));
  return process;
}

function run(command, args, cwd) {
  return new Promise((resolveRun, reject) => {
    const process = child(command, args, cwd);
    process.once('error', reject);
    process.once('exit', (code, signal) => code === 0 ? resolveRun() : reject(new Error(`${command} exited ${code ?? signal}`)));
  });
}

async function stop(process) {
  if (!process || process.exitCode !== null || process.signalCode !== null) return;
  const exited = new Promise(resolveExit => process.once('exit', resolveExit));
  process.kill('SIGTERM');
  const force = setTimeout(() => process.kill('SIGKILL'), 3000);
  await exited;
  clearTimeout(force);
}

async function shutdown(code) {
  if (stopping) return;
  stopping = true;
  lifetime.abort();
  clearTimeout(timer);
  await Promise.all([...children].map(stop));
  process.exitCode = code;
}

process.on('SIGINT', () => void shutdown(130));
process.on('SIGTERM', () => void shutdown(143));

async function available(port) {
  await new Promise((resolvePort, reject) => {
    const server = createServer();
    server.once('error', () => reject(new Error(`Port ${port} is busy. Stop that process before starting Ari.`)));
    server.listen(port, '127.0.0.1', () => server.close(resolvePort));
  });
}

function startBackend() {
  backend = child(resolve(root, 'target/debug/ari'), ['--home', resolve(root, process.env.ARI_DEV_HOME || '.ari-dev'), '--port', '38477']);
  backend.once('error', error => { console.error(error); void shutdown(1); });
  backend.once('exit', code => {
    if (!rebuilding && !stopping) { console.error(`Ari backend exited ${code}`); void shutdown(1); }
  });
}

async function rebuild() {
  if (stopping) return;
  if (rebuilding) { pending = true; return; }
  rebuilding = true;
  try {
    console.log('Rebuilding Ari backend…');
    await run('cargo', ['build']);
    if (!stopping) { await stop(backend); startBackend(); }
  } catch (error) {
    if (!stopping) console.error(`Build failed; the running backend stays available. ${error.message}`);
  } finally {
    rebuilding = false;
    if (pending) { pending = false; void rebuild(); }
  }
}

try {
  await Promise.all([available(38477), available(5175)]);
  try { await access(resolve(root, 'frontend/node_modules/.bin/vite')); }
  catch { await run('npm', ['install'], resolve(root, 'frontend')); }
  await run('npm', ['run', 'build'], resolve(root, 'frontend'));
  await run('cargo', ['build']);
  if (!stopping) {
    startBackend();
    const vite = child('npm', ['run', 'dev'], resolve(root, 'frontend'));
    vite.once('error', error => { console.error(error); void shutdown(1); });
    vite.once('exit', code => { if (!stopping) void shutdown(code || 1); });
    console.log('\nAri → http://127.0.0.1:5175\nMCP → http://127.0.0.1:38477/mcp\nVue/CSS hot reload · Rust rebuild/restart\n');
    function schedule() {
      clearTimeout(timer);
      timer = setTimeout(() => void rebuild(), 250);
    }
    watch(resolve(root, 'src'), { recursive: true, signal: lifetime.signal }, schedule);
    for (const path of ['Cargo.toml', 'agent-instructions.md']) {
      watch(resolve(root, path), { signal: lifetime.signal }, schedule);
    }
  }
} catch (error) {
  if (!stopping) { console.error(error.message); await shutdown(1); }
}
