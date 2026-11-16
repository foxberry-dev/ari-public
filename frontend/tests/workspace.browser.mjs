import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { once } from 'node:events';
import { access, mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { chromium } from 'playwright';
import { exampleGraph, exampleNodes } from '../src/example.ts';

const root = fileURLToPath(new URL('../../', import.meta.url));

test('development fixture publishes a complete typed history through MCP', { timeout: 30_000 }, async t => {
  const { base, tool } = await fixture(t);
  const { stdout } = await promisify(execFile)(process.execPath, [join(root, 'scripts/load-fixture.mjs'), '--url', base]);
  const result = JSON.parse(stdout);
  const sample = JSON.parse(await readFile(join(root, 'fixtures/team-lunch-graph.json'), 'utf8'));
  assert.equal(result.status, 'created');
  assert.equal(result.commits, sample.commits.length);
  const saved = await tool('get_clarification', { item: sample.id });
  assert.deepEqual(saved.commits.map(c => c.graph), sample.commits.map(c => c.graph));
  const page = await browserFor(t);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(base + '/#/clarifications/' + sample.id);
  await page.locator('.graph-node').first().waitFor();
  for (const [index, entry] of sample.commits.entries()) {
    await page.locator('.commit-entry').nth(index).click();
    for (const name of ['Tree', 'Grouped', 'Radial']) {
      await page.getByRole('button', { name, exact: true }).click();
      assert.equal(await page.locator('.graph-node').count(), entry.graph.nodes.length, `${entry.commit.title} renders in ${name}`);
    }
  }
});

async function fixture(t, { cherUrl } = {}) {
  const home = await mkdtemp(join(tmpdir(), 'ari-browser-'));
  const env = { ...process.env };
  delete env.ARI_CHER_URL;
  if (cherUrl) env.ARI_CHER_URL = cherUrl;
  const server = spawn(join(root, 'target/debug/ari'), ['--home', home, '--port', '0'], { stdio: ['ignore', 'ignore', 'pipe'], env });
  t.after(async () => { if (server.exitCode === null) { server.kill(); await once(server, 'exit'); } });
  const base = await new Promise((resolve, reject) => {
    let output = '';
    const timer = setTimeout(() => reject(new Error(`Server startup timed out: ${output}`)), 15_000);
    server.once('error', error => { clearTimeout(timer); reject(error); });
    server.once('exit', code => { clearTimeout(timer); reject(new Error(`Server exited ${code}: ${output}`)); });
    server.stderr.on('data', chunk => {
      output += chunk;
      const match = output.match(/Ari: (http:\/\/127\.0\.0\.1:\d+)/);
      if (match) { clearTimeout(timer); resolve(match[1]); }
    });
  });
  async function api(path, body) {
    const response = await fetch(`${base}/api${path}`, body === undefined ? {} : {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
    });
    assert.equal(response.status, 200, await response.clone().text());
    return response.json();
  }
  let rpcId = 0;
  async function rpc(method, params, expectParameterError = false) {
    const response = await fetch(`${base}/mcp`, {
      method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
      body: JSON.stringify({ jsonrpc: '2.0', id: ++rpcId, method, params }),
    });
    assert.equal(response.status, 200, await response.clone().text());
    const text = await response.text();
    const value = response.headers.get('content-type').includes('text/event-stream')
      ? JSON.parse(text.split('\n').find(line => line.startsWith('data:')).slice(5)) : JSON.parse(text);
    if (expectParameterError) { assert.equal(value.error?.code, -32602); return value.error; }
    assert.equal(value.error, undefined, JSON.stringify(value.error));
    return value.result;
  }
  await rpc('initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'ari-test', version: '1' } });
  async function tool(name, args = {}) {
    if (name === 'create_clarification' || name === 'publish_graph_commit') {
      args = { ...args, graph: args.graph ? { ...args.graph, nodes: args.graph.nodes.map(({ rationale, dependsOn, ...node }) => node) } : args.graph, commit: { title: args.commit.title, kind: args.commit.kind } };
    }
    const result = await rpc('tools/call', { name, arguments: args });
    assert.notEqual(result.isError, true, JSON.stringify(result));
    return JSON.parse(result.content[0].text);
  }
  return { base, api, tool, rpc };
}

async function browserFor(t) {
  let executablePath = process.env.CHROME_PATH;
  if (!executablePath) {
    try { await access('/usr/bin/google-chrome'); executablePath = '/usr/bin/google-chrome'; } catch { /* Use Playwright's installed browser. */ }
  }
  const browser = await chromium.launch({ executablePath, headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  t.after(() => assert.deepEqual(errors, [], 'The browser must not raise runtime errors'));
  return page;
}

test('agent graph commits stream into a read-only history with neutral and changed views', { timeout: 60_000 }, async t => {
  const { base, api, tool } = await fixture(t);
  const page = await browserFor(t);
  const writes = [];
  page.on('request', request => { if (request.method() !== 'GET') writes.push(request.url()); });
  const id = 'repair-cafe';
  await tool('create_clarification', { id, title: 'Plan a repair café', description: 'An isolated graph fixture',
    graph: exampleGraph(), commit: { title: 'Stage the topic', kind: 'topicStaged', summary: 'Forecast useful decisions.' } });
  await page.goto(base);
  await page.locator('.clarity-card').click();
  await page.locator('.graph-node').first().waitFor();
  const context = await tool('get_context');
  assert.equal(context.clarifications[0].id, id);
  for (const item of [id, 'Plan a repair café', '1']) assert.equal((await tool('get_clarification', { item })).id, id);
  const next = structuredClone(exampleNodes).filter(n => n.id !== 'insurance');
  Object.assign(next.find(n => n.id === 'admission'), { kind: 'decided', content: 'Hybrid admission' });
  next.push({ id: 'menu', title: 'Lunch menu', kind: 'assumption', content: 'No dietary restrictions assumed', rationale: 'Include volunteers.', alternatives: [{ label: 'No restrictions', description: '', recommended: false }, { label: 'Vegan meal', description: '', recommended: false }], selectedAlternative: 'No restrictions', dependsOn: ['budget'] });
  await tool('publish_graph_commit', { clarificationId: id, expectedRevision: 1, graph: exampleGraph(next),
    commit: { title: 'Plan admission together', kind: 'openDiscussion', summary: 'Hybrid admission; forecast lunch.', source: 'Use hybrid admission and think about lunch.' } });
  await page.locator('.graph-node').filter({ hasText: 'Hybrid admission' }).waitFor();
  assert.equal(await page.locator('.graph-node.added, .graph-node.answered, .graph-node.changed, .graph-node.removed').count(), 0);
  await page.getByRole('button', { name: 'Changed', exact: true }).click();
  await page.locator('.graph-node.removed').filter({ hasText: 'Insurance' }).waitFor();
  assert.equal(await page.locator('[data-node-id="admission"] .node-status').innerText(), 'Assumption · Resolved');
  await page.waitForFunction(() => getComputedStyle(document.querySelector('[data-node-id="admission"]')).borderTopColor === 'rgb(134, 181, 204)');
  const addedColors = await page.evaluate(() => ({
    assumption: getComputedStyle(document.querySelector('[data-node-id="menu"] .node-status')).color,
    answered: getComputedStyle(document.querySelector('[data-node-id="admission"]')).borderTopColor,
    edge: getComputedStyle(document.querySelector('.wires > path.added')).stroke,
  }));
  assert.deepEqual(addedColors, { assumption: 'rgb(169, 154, 194)', answered: 'rgb(134, 181, 204)', edge: 'rgb(101, 214, 173)' });
  await page.locator('.graph-node.answered').filter({ hasText: 'Admission' }).click();
  await page.getByRole('complementary', { name: 'Node details' }).getByRole('heading', { name: 'Admission', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Current', exact: true }).click();
  assert.equal(await page.locator('.graph-node').filter({ hasText: 'Insurance' }).count(), 0);
  await page.getByRole('button', { name: 'Close node details' }).click();
  await moveRevision(page, -1);
  await page.locator('.graph-node').filter({ hasText: 'Insurance' }).waitFor();
  const third = structuredClone(next); Object.assign(third.find(n => n.id === 'menu'), { content: 'One vegan volunteer', kind: 'decided', selectedAlternative: 'Vegan meal' });
  Object.assign(third.find(n => n.id === 'admission'), { content: 'Booked admission', selectedAlternative: 'Booked' });
  await tool('publish_graph_commit', { clarificationId: id, expectedRevision: 2, confirmedChanges: ['admission'], graph: exampleGraph(third), commit: { title: 'Dietary needs', kind: 'directAnswer', source: 'One vegan volunteer; use booked admission.' } });
  await page.waitForFunction(() => document.querySelectorAll('.commit-entry').length === 3);
  assert.match(await page.locator('.commit-entry.selected').innerText(), /Stage the topic/);
  await page.locator('.commit-entry').last().click();
  await page.locator('.graph-node').filter({ hasText: 'One vegan volunteer' }).waitFor();
  await page.getByRole('button', { name: 'Changed', exact: true }).click();
  for (const view of ['Tree', 'Grouped', 'Radial']) {
    await page.getByRole('button', { name: view, exact: true }).click();
    assert.equal(await page.locator('[data-node-id="menu"] .node-status').innerText(), 'Assumption · Resolved');
    assert.equal(await page.locator('[data-node-id="admission"] .node-status').innerText(), 'Changed');
    const colors = await page.locator('[data-node-id="menu"], [data-node-id="admission"]').evaluateAll(nodes => Object.fromEntries(nodes.map(n => [n.dataset.nodeId, getComputedStyle(n.querySelector('.node-status')).color])));
    assert.deepEqual(colors, { menu: 'rgb(134, 181, 204)', admission: 'rgb(237, 158, 82)' });
  }
  await page.getByRole('button', { name: 'Current', exact: true }).click();
  assert.equal(await page.locator('[data-node-id="menu"] .node-status').innerText(), 'Decided');
  await page.reload();
  await page.locator('.graph-node').filter({ hasText: 'One vegan volunteer' }).waitFor();
  assert.equal((await api('/workspaces/' + id)).commits.length, 3);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('navigation', { name: 'Revision history' }).waitFor();
  const revisionLayout = await page.evaluate(() => {
    const rail = document.querySelector('.mobile-revisions').getBoundingClientRect();
    const center = document.querySelector('.graph-center').getBoundingClientRect();
    return { height: rail.height, gap: center.y - rail.bottom };
  });
  assert.ok(revisionLayout.height < 116, `Revision selector fits its cards: ${revisionLayout.height}`);
  assert.ok(Math.abs(revisionLayout.gap) < 1, `Canvas follows the revision selector: ${revisionLayout.gap}`);
  await page.screenshot({ path: '/tmp/ari-mobile-revisions.png' });
  await page.getByRole('button', { name: 'Fit graph', exact: true }).click();
  await page.locator('[data-node-id="admission"]').click();
  await page.getByRole('complementary', { name: 'Node details' }).waitFor();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  assert.deepEqual(writes, [], 'The viewer only reads; graph writes belong to the agent MCP connection');
});

test('MCP publications appear in the shared library frame with a matching berry favicon', { timeout: 60_000 }, async t => {
  const { base, tool } = await fixture(t);
  const page = await browserFor(t);
  await page.setViewportSize({ width: 1920, height: 1095 });
  await Promise.all([page.waitForResponse(response => response.url().endsWith('/api/navigation')), page.goto(base)]);
  await page.getByText('Ask your agent to publish a clarification through Ari’s MCP tools.').waitFor();
  assert.equal(await page.getByRole('link', { name: 'Back to Cher', exact: true }).count(), 0);

  const favicon = await page.locator('link[rel="icon"]').getAttribute('href');
  assert.equal(await page.locator('.berry-mark').getAttribute('src'), favicon);
  const iconResponse = await page.request.get(`${base}${favicon}`);
  assert.equal(iconResponse.status(), 200);
  assert.match(iconResponse.headers()['content-type'], /image\/svg\+xml/);
  const iconSvg = await iconResponse.text();
  assert.match(iconSvg, /#d9ab32/);
  assert.match(iconSvg, /width="64" height="64" viewBox="14 2 228 228"/);
  const creation = await page.request.post(`${base}/api/workspaces`, { data: { id: 'browser', title: 'Browser request' } });
  assert.equal(creation.status(), 405, 'Clarification creation belongs to MCP');

  for (let i = 0; i < 7; i++) {
    await tool('create_clarification', { id: `library-${i}`, title: `Clarification ${i}`,
      description: `Description ${i}. Review the choices, their assumptions, and the questions that connect them. Keep the reasoning available as the decision develops.`,
      graph: exampleGraph(), commit: { title: 'Stage the topic', kind: 'topicStaged' } });
  }
  await page.waitForFunction(() => document.querySelectorAll('.clarity-card').length === 7);

  const layout = await page.evaluate(() => {
    const bounds = selector => document.querySelector(selector).getBoundingClientRect().toJSON();
    const style = selector => getComputedStyle(document.querySelector(selector));
    return { header: bounds('.page-header'), logo: bounds('.berry-mark'), wordmark: bounds('.wordmark'),
      eyebrow: bounds('.page-intro .eyebrow'), heading: bounds('.page-intro h1'), search: bounds('.search'),
      card: bounds('.clarity-card'), preview: bounds('.graph-thumbnail'),
      columns: style('.card-grid').gridTemplateColumns.split(' ').length, gap: style('.card-grid').gap,
      headingSize: style('.page-intro h1').fontSize, subtitleSize: style('.page-intro h1 span').fontSize,
      searchSize: style('.search input').fontSize, searchIcon: bounds('.search .pi'), searchInput: bounds('.search input'),
      searchInputPadding: style('.search input').padding, searchKey: bounds('.search kbd'), bodyPadding: style('.card-body').padding,
      footerPadding: style('.card-footer').padding, backdrop: style('.dotted-backdrop').backgroundImage };
  });
  assert.equal(layout.header.height, 66);
  assert.equal(layout.logo.x, 24);
  assert.equal(layout.logo.width, 32);
  assert.equal(layout.logo.height, 32);
  assert.equal(layout.wordmark.x, 66);
  assert.equal(layout.eyebrow.x, 24);
  assert.equal(layout.eyebrow.y, 94);
  assert.equal(layout.headingSize, '36px');
  assert.equal(layout.subtitleSize, '36px');
  assert.equal(layout.search.x, 24);
  assert.equal(layout.search.width, 1872);
  assert.ok(Math.abs(layout.search.y - 260) < 2, `Search starts at ${layout.search.y}`);
  assert.ok(Math.abs(layout.search.height - 46) < 2, `Search height is ${layout.search.height}`);
  assert.equal(layout.searchSize, '13px');
  assert.equal(layout.searchInput.x - layout.searchIcon.right, 12);
  assert.equal(layout.searchInputPadding, '1px 2px');
  assert.ok(Math.abs(layout.searchInput.y + layout.searchInput.height / 2 - layout.search.y - layout.search.height / 2) < .5, 'Search text stays vertically centered');
  assert.ok(Math.abs(layout.searchKey.width - 20.8) < .1, `Search keycap width is ${layout.searchKey.width}`);
  assert.ok(Math.abs(layout.searchKey.y + layout.searchKey.height / 2 - layout.search.y - layout.search.height / 2) < .5, 'Search keycap stays vertically centered');
  assert.equal(layout.columns, 4);
  assert.equal(layout.gap, '20px');
  assert.equal(layout.card.width, 453);
  assert.ok(Math.abs(layout.card.y - 370) < 2, `Cards start at ${layout.card.y}`);
  assert.ok(Math.abs(layout.preview.width / layout.preview.height - 16 / 9) < .01);
  assert.equal(layout.bodyPadding, '22px');
  assert.equal(layout.footerPadding, '14px 22px');
  assert.match(layout.backdrop, /radial-gradient/);

  for (const [width, columns, inset, heading] of [[1050, 2, 24, '36px'], [700, 2, 16, '30px'], [650, 1, 16, '30px'], [390, 1, 16, '30px']]) {
    await page.setViewportSize({ width, height: 844 });
    assert.equal(await page.locator('.card-grid').evaluate(el => getComputedStyle(el).gridTemplateColumns.split(' ').length), columns);
    assert.equal((await page.locator('.search').boundingBox()).x, inset);
    assert.equal((await page.locator('.page-header').boundingBox()).height, 66);
    assert.equal(await page.locator('.page-intro h1').evaluate(el => getComputedStyle(el).fontSize), heading);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  }
});

test('library navigation follows rendered rows, respects search, and restores focus and scroll', { timeout: 60_000 }, async t => {
  const { base, tool } = await fixture(t);
  for (let i = 0; i < 7; i++) {
    await tool('create_clarification', { id: `keys-${i}`, title: `Clarification ${i}`,
      description: `Description ${i}. Find the decisions and keep the reasoning.`, graph: exampleGraph(), commit: { title: 'Stage the topic', kind: 'topicStaged' } });
  }
  const page = await browserFor(t);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 1920, height: 900 });
  await page.goto(base);
  await page.waitForFunction(() => document.querySelectorAll('.clarity-card').length === 7);
  const ids = await page.locator('.clarity-card').evaluateAll(cards => cards.map(card => card.dataset.clarificationId));
  const focus = async index => {
    await page.waitForFunction(id => document.activeElement?.getAttribute('data-clarification-id') === id, ids[index]);
    assert.equal(await page.locator('.clarity-card[tabindex="0"]').count(), 1);
  };
  await focus(0);
  for (const [key, index] of [['h', 0], ['ArrowLeft', 0], ['k', 0], ['ArrowUp', 0], ['l', 1], ['ArrowRight', 2], ['h', 1], ['ArrowLeft', 0], ['j', 4], ['ArrowRight', 5], ['ArrowDown', 5], ['ArrowUp', 1], ['k', 1]]) {
    await page.keyboard.press(key); await focus(index);
  }
  await page.locator('.clarity-card').nth(3).focus();
  await page.keyboard.press('ArrowDown'); await focus(6);
  await page.keyboard.press('j'); await focus(6);
  await page.keyboard.press('ArrowUp'); await focus(2);

  const search = page.getByRole('searchbox', { name: 'Search clarifications' });
  await page.keyboard.press('/');
  await page.keyboard.type('hjkl/');
  assert.equal(await search.inputValue(), 'hjkl/');
  await page.keyboard.press('Control+c');
  assert.equal(await search.inputValue(), '');
  await search.fill('Description 4');
  await page.waitForFunction(() => document.querySelectorAll('.clarity-card').length === 1);
  await page.keyboard.press('ArrowDown');
  assert.equal(await page.locator('.clarity-card:focus').getAttribute('data-clarification-id'), 'keys-4');
  await page.keyboard.press('Escape');
  assert.equal(await search.inputValue(), '');
  await page.waitForFunction(() => document.querySelectorAll('.clarity-card').length === 7);
  await page.keyboard.press('/');
  await search.fill('unmatched');
  await page.keyboard.press('Escape'); await focus(0);

  await page.setViewportSize({ width: 1000, height: 900 });
  await page.locator('.clarity-card').first().focus();
  await page.keyboard.press('j'); await focus(2);
  await page.keyboard.press('ArrowDown'); await focus(4);
  await page.keyboard.press('j'); await focus(6);
  await page.keyboard.press('j'); await focus(6);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('.clarity-card').first().focus();
  await page.keyboard.press('j'); await focus(1);
  await page.keyboard.press('ArrowUp'); await focus(0);

  await page.setViewportSize({ width: 1920, height: 900 });
  await page.keyboard.press('/');
  await search.fill('Clarification');
  await page.keyboard.press('Enter'); await focus(0);
  await page.locator('.clarity-card').nth(6).focus();
  await page.locator('.clarity-card').nth(6).scrollIntoViewIfNeeded();
  const scroll = await page.locator('.library-scroll').evaluate(el => el.scrollTop);
  assert.ok(scroll > 0);
  assert.equal((await page.locator('.page-intro .eyebrow').boundingBox()).y, 94 - scroll, 'The intro moves with the library');
  await page.keyboard.press('Enter');
  await page.locator('.graph-node').first().waitFor();
  assert.ok(page.url().endsWith(ids[6]));
  await page.getByRole('link', { name: 'Back to clarity library' }).click();
  await focus(6);
  assert.equal(await search.inputValue(), 'Clarification');
  assert.equal(await page.locator('.library-scroll').evaluate(el => el.scrollTop), scroll);
});

test('commit motion preserves the camera and keeps every edge attached to its nodes', { timeout: 60_000 }, async t => {
  const { base, tool } = await fixture(t);
  const sample = JSON.parse(await readFile(join(root, 'fixtures/team-lunch-graph.json'), 'utf8'));
  const [first, second] = sample.commits;
  await tool('create_clarification', { id: 'motion', title: 'Team lunch motion', graph: first.graph, commit: first.commit });
  await tool('publish_graph_commit', { clarificationId: 'motion', expectedRevision: 1, graph: second.graph, commit: second.commit });
  const page = await browserFor(t);
  await page.goto(base + '/#/clarifications/motion');
  await page.locator('.graph-node').first().waitFor();
  const camera = await page.locator('.graph-scene').evaluate(el => getComputedStyle(el).transform);
  await moveRevision(page, -1);
  const motion = await page.evaluate(async () => {
    const cameras = [], rootYs = [];
    let maxError = 0;
    for (let i = 0; i < 28; i++) await new Promise(resolve => requestAnimationFrame(() => {
      cameras.push(getComputedStyle(document.querySelector('.graph-scene')).transform);
      rootYs.push(document.querySelector('[data-node-id="people"]').getBoundingClientRect().y);
      for (const path of document.querySelectorAll('.wires > path')) {
        const from = document.querySelector('[data-node-id="' + path.dataset.from + '"]').getBoundingClientRect();
        const to = document.querySelector('[data-node-id="' + path.dataset.to + '"]').getBoundingClientRect();
        const start = path.getPointAtLength(0).matrixTransform(path.getScreenCTM());
        const end = path.getPointAtLength(path.getTotalLength()).matrixTransform(path.getScreenCTM());
        maxError = Math.max(maxError, Math.abs(start.x - from.right), Math.abs(start.y - from.y - from.height / 2), Math.abs(end.x - to.left), Math.abs(end.y - to.y - to.height / 2));
      }
      resolve();
    }));
    return { cameras, rootYs, maxError };
  });
  assert.deepEqual([...new Set(motion.cameras)], [camera], 'Commit navigation preserves both zoom and pan');
  assert.ok(Math.max(...motion.rootYs) - Math.min(...motion.rootYs) > 1, 'Node motion is sampled during the transition');
  assert.ok(motion.maxError < .75, 'All edge endpoints stay glued to node sides: ' + motion.maxError);
  const diet = page.locator('[data-node-id="diet"]');
  await diet.click();
  await page.locator('.detail-option.chosen').getByText('No restrictions', { exact: true }).waitFor();
  assert.match(await diet.innerText(), /No restrictions/);
  assert.match(await diet.innerText(), /Assumption/);
  assert.match(await page.locator('.detail-option.chosen').innerText(), /Assumed\s+No restrictions/i);
  const inspectedCamera = await page.locator('.graph-scene').evaluate(el => getComputedStyle(el).transform);
  assert.equal(inspectedCamera, camera, 'Opening details also preserves the camera');
  await moveRevision(page, 1);
  await page.locator('[data-node-id="people"]').click();
  assert.match(await page.locator('.detail-option.chosen').innerText(), /Decided\s+Core four teammates/i);
});

for (const layoutName of ['Grouped', 'Radial']) test(`${layoutName} shares selection, typed relationships, and immutable comparisons with hierarchy`, { timeout: 60_000 }, async t => {
  const { base, tool, rpc } = await fixture(t);
  const sample = JSON.parse(await readFile(join(root, 'fixtures/team-lunch-graph.json'), 'utf8'));
  const { graph, commit } = sample.commits.at(-1);
  await tool('create_clarification', { id: 'typed-lunch', title: 'Team lunch relationships', graph, commit });
  for (const name of ['create_clarification', 'publish_graph_commit']) {
    const args = name === 'create_clarification'
      ? { id: 'invalid-graph', title: 'Invalid graph', graph: { nodes: graph.nodes }, commit }
      : { clarificationId: 'typed-lunch', expectedRevision: 1, graph: { nodes: graph.nodes }, commit };
    const rejected = await rpc('tools/call', { name, arguments: args }, true);
    assert.match(rejected.message, /missing field `edges`/);
  }
  assert.equal((await tool('get_clarification', { item: 'typed-lunch' })).revision, 1);
  const schema = (await rpc('tools/list', {})).tools.find(t => t.name === 'publish_graph_commit').inputSchema;
  assert.ok(JSON.stringify(schema).includes('participants'), 'MCP advertises multi-node constraint scope');
  const page = await browserFor(t);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(base + '/#/clarifications/typed-lunch');
  await page.locator('.graph-node').first().waitFor();
  assert.equal(await page.locator('.wires > path').count(), graph.nodes.length - 1);
  await page.locator('[data-node-id="venue"]').click();
  await page.getByRole('complementary', { name: 'Node details' }).getByText('Requirement · Suitable meals', { exact: true }).waitFor();
  assert.equal(await page.locator('.wires > path[data-relationship-id="vegan-meals"]').count(), 3);
  assert.equal(await page.locator('.wires > path[data-relationship-id="spending-limit"]').count(), 0);
  await page.getByRole('button', { name: 'Changed', exact: true }).click();
  await page.getByRole('button', { name: layoutName, exact: true }).click();
  await page.getByRole('button', { name: 'Fit graph', exact: true }).click();
  assert.equal(await page.locator('[data-node-id="venue"]').getAttribute('aria-pressed'), 'true');
  assert.equal(await page.getByRole('button', { name: 'Changed', exact: true }).getAttribute('aria-pressed'), 'true');
  assert.equal(await page.locator('.constraint-junction').count(), graph.edges.filter(e => e.kind === 'constraint').length);
  assert.equal(await page.locator('.wires > path.parent').count(), graph.nodes.length - 1);
  const patterns = await page.evaluate(() => Object.fromEntries(['parent', 'input', 'constraint'].map(kind => {
    const path = document.querySelector('.wires > path.' + kind);
    return [kind, { dash: getComputedStyle(path).strokeDasharray, marker: path.getAttribute('marker-end') }];
  })));
  assert.equal(patterns.parent.dash, 'none');
  assert.equal(patterns.parent.marker, null);
  assert.equal(patterns.input.dash, '8px, 5px');
  assert.equal(patterns.input.marker, 'url(#atlas-arrow)');
  assert.equal(patterns.constraint.dash, '1px, 6px');
  assert.ok(await page.locator(layoutName === 'Grouped' ? '.island-region' : '.ring-guide').count() > 0);
  if (layoutName === 'Grouped') {
    const headings = await page.locator('[data-island-id]').evaluateAll(groups => groups.map(group => {
      const expected = group.dataset.islandId.replaceAll('-', ' ');
      const expectedTitle = expected.charAt(0).toUpperCase() + expected.slice(1);
      const text = group.querySelector('.island-title').getBoundingClientRect(), header = group.querySelector('.island-header').getBoundingClientRect();
      return { centerError: Math.abs((text.left + text.right - header.left - header.right) / 2), title: group.querySelector('.island-title').textContent, expectedTitle,
        headerBottom: group.querySelector('.island-header').getBoundingClientRect().bottom };
    }));
    for (const heading of headings) {
      assert.equal(heading.title, heading.expectedTitle);
      assert.ok(heading.centerError < .75, 'Group labels are centered in their title bars');
    }
  }
  const settled = await page.locator('.graph-node').evaluateAll(nodes => nodes.map(n => [n.dataset.nodeId, n.parentElement.style.transform]));
  const otherLayout = layoutName === 'Grouped' ? 'Radial' : 'Grouped';
  await page.getByRole('button', { name: otherLayout, exact: true }).click();
  assert.equal(await page.locator('[data-node-id="venue"]').getAttribute('aria-pressed'), 'true');
  await page.getByRole('button', { name: layoutName, exact: true }).click();
  assert.deepEqual(await page.locator('.graph-node').evaluateAll(nodes => nodes.map(n => [n.dataset.nodeId, n.parentElement.style.transform])), settled);

  const next = structuredClone(graph);
  next.edges = next.edges.filter(e => e.id !== 'vegan-exclusion');
  next.edges.find(e => e.id === 'walkability').rule = 'In this scripted test, collection within ten minutes is preferred.';
  next.nodes.find(n => n.id === 'headcount').content = 'Twelve confirmed attendees';
  await tool('publish_graph_commit', { clarificationId: 'typed-lunch', expectedRevision: 1, confirmedChanges: ['headcount'], graph: next,
    commit: { title: 'Review collection choices', kind: 'graphUpdated', summary: 'Scripted test of a changed rule and removed incompatibility.' } });
  await page.locator('[data-node-id="headcount"]').filter({ hasText: 'Twelve confirmed attendees' }).waitFor();
  assert.deepEqual(await page.locator('.graph-node').evaluateAll(nodes => nodes.map(n => [n.dataset.nodeId, n.parentElement.style.transform])), settled);
  assert.equal(await page.locator('.wires > path.constraint.removed[data-relationship-id="vegan-exclusion"]').count(), 2);
  assert.equal(await page.locator('.wires > path.constraint.changed[data-relationship-id="walkability"]').count(), 3);
  await page.getByRole('complementary', { name: 'Node details' }).getByRole('heading', { name: 'Previous relationships' }).waitFor();
  await page.getByRole('button', { name: 'Current', exact: true }).click();
  assert.equal(await page.locator('.wires > path.added, .wires > path.changed, .wires > path.removed').count(), 0);
  assert.equal(await page.locator('[data-constraint-id="vegan-exclusion"]').count(), 0);
  await page.getByRole('button', { name: 'Tree', exact: true }).click();
  assert.equal(await page.locator('[data-node-id="venue"]').getAttribute('aria-pressed'), 'true');
  await moveRevision(page, -1);
  await page.locator('[data-node-id="headcount"]').filter({ hasText: 'Twelve attendees' }).waitFor();
  await page.getByRole('button', { name: layoutName, exact: true }).click();
  assert.equal(await page.locator('[data-constraint-id="vegan-exclusion"]').count(), 1);
  await page.getByRole('button', { name: 'Fit graph', exact: true }).click();
  const centered = await page.evaluate(() => {
    const viewport = document.querySelector('.graph-viewport').getBoundingClientRect();
    const nodes = [...document.querySelectorAll('.graph-node,.island-region,.ring-guide')].map(n => n.getBoundingClientRect());
    return { nodeCenter: (Math.min(...nodes.map(n => n.left)) + Math.max(...nodes.map(n => n.right))) / 2,
      viewportCenter: viewport.x + viewport.width / 2 };
  });
  assert.ok(Math.abs(centered.nodeCenter - centered.viewportCenter) < 1, 'Fit centers the occupied graph bounds');
  await page.screenshot({ path: `/tmp/ari-${layoutName === 'Grouped' ? 'islands' : 'rings'}.png` });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'Fit graph', exact: true }).click();
  await page.locator('[data-node-id="diet"]').click();
  await page.getByRole('complementary', { name: 'Node details' }).getByText('Requirement · Incompatible choices', { exact: true }).waitFor();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
});


for (const width of [390, 825, 940]) test(`mobile node details overlay the full-height canvas from the right at ${width}px`, { timeout: 30_000 }, async t => {
  const { base, tool } = await fixture(t);
  const sample = JSON.parse(await readFile(join(root, 'fixtures/team-lunch-graph.json'), 'utf8'));
  const { graph, commit } = sample.commits.at(-1);
  await tool('create_clarification', { id: 'mobile-drawer', title: 'Mobile graph', graph, commit });
  const page = await browserFor(t);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width, height: 1000 });
  await page.goto(base + '/#/clarifications/mobile-drawer');
  const topic = page.locator('[data-node-id="topic"]');
  await topic.waitFor();
  await page.getByRole('button', { name: 'Fit graph', exact: true }).click();
  const camera = async () => page.evaluate(() => ({
    transform: document.querySelector('.graph-scene').style.transform,
    bounds: document.querySelector('.graph-viewport').getBoundingClientRect().toJSON(),
    scroll: [scrollX, scrollY],
  }));
  const before = await camera();
  assert.ok(Math.abs(before.bounds.bottom - 1000) < 1, 'The canvas fills the remaining screen');
  assert.equal(await page.evaluate(() => document.documentElement.scrollHeight), 1000, 'The page needs no space below the graph');
  await topic.click();
  const drawer = page.getByRole('dialog', { name: 'Node details' });
  await drawer.waitFor();
  assert.equal(await drawer.evaluate(el => el.matches(':modal')), true);
  const bounds = await drawer.boundingBox();
  assert.equal(bounds.y, 0);
  assert.equal(bounds.height, 1000);
  assert.ok(Math.abs(bounds.x + bounds.width - width) < 1, 'The drawer meets the right edge');
  assert.ok(bounds.x >= 32, 'The backdrop remains exposed');
  assert.equal(await drawer.evaluate(el => getComputedStyle(el, '::backdrop').backgroundColor), 'rgba(0, 0, 0, 0.6)');
  assert.deepEqual(await camera(), before, 'Opening details preserves the canvas dimensions, camera, and page position');
  assert.equal(await page.getByRole('button', { name: 'Close node details' }).evaluate(el => el === document.activeElement), true);
  await page.keyboard.press('Shift+Tab');
  assert.equal(await drawer.evaluate(el => !document.hasFocus() || el.contains(document.activeElement)), true, 'Page focus stays inside the modal');
  await page.keyboard.press('Tab');
  assert.equal(await drawer.evaluate(el => el.contains(document.activeElement)), true);
  await page.screenshot({ path: `/tmp/ari-mobile-drawer-${width}.png` });
  await page.getByRole('button', { name: 'Close node details' }).click();
  await drawer.waitFor({ state: 'hidden' });
  assert.equal(await topic.evaluate(el => el === document.activeElement), true, 'Closing restores focus to the selected node');
  assert.deepEqual(await camera(), before);
  await topic.click();
  await drawer.waitFor();
  await page.mouse.click(8, 500);
  await drawer.waitFor({ state: 'hidden' });
  await topic.click();
  await page.getByRole('button', { name: 'Close node details' }).click();
  await drawer.waitFor({ state: 'hidden' });
  assert.deepEqual(await camera(), before);
});

test('relationship checkboxes filter links and junctions independently while preserving the graph camera', { timeout: 30_000 }, async t => {
  const { base, tool } = await fixture(t);
  const sample = JSON.parse(await readFile(join(root, 'fixtures/team-lunch-graph.json'), 'utf8'));
  const { graph, commit } = sample.commits.at(-1);
  await tool('create_clarification', { id: 'relationship-filters', title: 'Filter relationships', graph, commit });
  const revised = structuredClone(graph);
  const headcount = revised.nodes.find(n => n.id === 'headcount');
  headcount.content = 'Fourteen attendees'; headcount.selectedAlternative = 'Fourteen attendees';
  headcount.alternatives.push({ label:'Fourteen attendees',description:'',recommended:false });
  const total = revised.nodes.find(n => n.id === 'amount');
  total.content = '€350 total'; total.selectedAlternative = '€350 total';
  total.alternatives.push({ label:'€350 total',description:'',recommended:false });
  const capacity = revised.nodes.find(n => n.id === 'capacity');
  capacity.content = 'Space for fourteen'; capacity.selectedAlternative = 'Space for fourteen';
  capacity.alternatives.push({ label:'Space for fourteen',description:'',recommended:false });
  await tool('publish_graph_commit', { clarificationId: 'relationship-filters', expectedRevision: 1, confirmedChanges: ['headcount','amount'], graph: revised,
    commit: { title: 'Update attendance', kind: 'directAnswer' } });
  const page = await browserFor(t);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(base + '/#/clarifications/relationship-filters');
  await page.locator('[data-node-id="venue"]').click();
  const inputs = page.getByRole('checkbox', { name: 'Show inputs', exact: true });
  const constraints = page.getByRole('checkbox', { name: 'Show constraints', exact: true });
  assert.equal(await inputs.isChecked(), true);
  assert.equal(await constraints.isChecked(), true);
  for (const name of ['Tree', 'Grouped', 'Radial']) {
    await page.getByRole('button', { name, exact: true }).click();
    await inputs.check(); await constraints.check();
    assert.ok(await page.locator('.wires > path.input').count() > 0);
    const constraintCount = await page.locator('.wires > path.constraint').count();
    assert.ok(constraintCount > 0);
    const snapshot = async () => page.evaluate(() => ({
      camera: document.querySelector('.graph-scene').style.transform,
      nodes: [...document.querySelectorAll('.graph-node')].map(n => [n.dataset.nodeId, n.parentElement.style.transform]),
    }));
    const before = await snapshot();
    await inputs.uncheck();
    assert.equal(await page.locator('.wires > path.input').count(), 0);
    assert.equal(await page.locator('.wires > path.constraint').count(), constraintCount);
    await constraints.uncheck();
    assert.equal(await page.locator('.wires > path.constraint, .constraint-junction').count(), 0);
    assert.equal(await page.locator('.wires > path.parent').count(), graph.nodes.length - 1);
    assert.deepEqual(await snapshot(), before);
    await page.getByRole('complementary', { name: 'Node details' }).getByText('Requirement · Suitable meals', { exact: true }).waitFor();
    await page.getByRole('button', { name: 'Changed', exact: true }).click();
    await moveRevision(page, -1);
    assert.equal(await inputs.isChecked(), false);
    assert.equal(await constraints.isChecked(), false);
    assert.equal(await page.locator('.wires > path.input, .wires > path.constraint, .constraint-junction').count(), 0);
    await moveRevision(page, 1);
    await page.getByRole('button', { name: 'Current', exact: true }).click();
    await page.locator('[data-node-id="venue"]').click();
  }
  await constraints.check();
  assert.equal(await page.locator('.wires > path.input').count(), 0);
  assert.ok(await page.locator('.constraint-junction').count() > 0);
  await inputs.check();
  assert.ok(await page.locator('.wires > path.input').count() > 0);
});

async function shortcutFixture(t) {
  const { base, tool, rpc } = await fixture(t);
  const sample = JSON.parse(await readFile(join(root, 'fixtures/team-lunch-graph.json'), 'utf8'));
  const [first, ...rest] = sample.commits;
  let saved = await tool('create_clarification', { id: sample.id, title: sample.title, description: sample.description, ...first });
  for (const entry of rest) saved = await tool('publish_graph_commit', { clarificationId: sample.id, expectedRevision: saved.revision, ...entry });
  const page = await browserFor(t);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(base + '/#/clarifications/' + sample.id);
  await page.locator('.graph-node').first().waitFor();
  return { page, base, sample, tool, rpc };
}

test('clarification shortcuts work from the header, graph, controls, inspector, and scrollbars', { timeout: 30_000 }, async t => {
  const { page, base, sample } = await shortcutFixture(t);
  page.setDefaultTimeout(5000);
  const revision = async n => assert.equal(await page.locator('.commit-entry').evaluateAll(rows => rows.findIndex(row => row.getAttribute('aria-current') === 'step') + 1), n);
  await page.getByRole('link', { name: 'Back to clarity library' }).focus();
  await page.keyboard.press('k'); await revision(6);
  await page.locator('.graph-viewport').focus();
  await page.keyboard.press('ArrowUp'); await revision(5);
  await page.getByRole('checkbox', { name: 'Show inputs', exact: true }).focus();
  await page.keyboard.press('j'); await revision(6);
  await page.locator('[data-node-id="topic"]').click();
  await page.getByRole('button', { name: 'Close node details' }).focus();
  await page.keyboard.press('ArrowDown'); await revision(7);
  await page.locator('[data-node-id="venue"]').click();
  await page.locator('.node-details .overlay-scrollbar:not([hidden])').first().focus();
  await page.keyboard.press('ArrowUp'); await revision(6);
  await page.keyboard.press('g'); await page.keyboard.press('g'); await revision(1);
  await page.keyboard.press('End'); await revision(7);
  await page.keyboard.press('Home'); await revision(1);
  await page.keyboard.press('G'); await revision(7);
  for (let i = 0; i < 8; i++) await page.keyboard.press('k');
  await revision(1);
  for (let i = 0; i < 8; i++) await page.keyboard.press('j');
  await revision(7);
  await page.locator('[data-node-id="topic"]').click();
  for (const name of ['Grouped', 'Radial', 'Tree']) {
    await page.keyboard.press(']');
    assert.equal(await page.getByRole('button', { name, exact: true }).getAttribute('aria-pressed'), 'true');
    assert.equal(await page.locator('[data-node-id="topic"]').getAttribute('aria-pressed'), 'true');
  }
  await page.keyboard.press('[');
  assert.equal(await page.getByRole('button', { name: 'Radial', exact: true }).getAttribute('aria-pressed'), 'true');
  const inputs = page.getByRole('checkbox', { name: 'Show inputs', exact: true });
  const constraints = page.getByRole('checkbox', { name: 'Show constraints', exact: true });
  await page.keyboard.press('i'); await page.keyboard.press('s');
  assert.equal(await inputs.isChecked(), false);
  assert.equal(await constraints.isChecked(), false);
  assert.equal(await page.locator('.wires > path.input, .wires > path.constraint, .constraint-junction').count(), 0);
  await page.keyboard.press('c');
  assert.equal(await page.getByRole('button', { name: 'Changed', exact: true }).getAttribute('aria-pressed'), 'true');
  assert.equal(await constraints.isChecked(), false);
  await page.keyboard.press('c');
  assert.equal(await page.getByRole('button', { name: 'Current', exact: true }).getAttribute('aria-pressed'), 'true');
  assert.equal(await constraints.isChecked(), false);
  await page.keyboard.press('Control+c');
  assert.equal(await constraints.isChecked(), false, 'System shortcuts retain their modifier behavior');
  await page.keyboard.press('?');
  const help = page.getByRole('dialog', { name: 'Keyboard shortcuts' });
  await help.waitFor();
  await page.keyboard.press('k'); await revision(6);
  assert.equal(await help.isVisible(), true);
  await page.keyboard.press('Escape');
  await help.waitFor({ state: 'hidden' });
  await page.keyboard.press('Escape');
  await page.locator('.library').waitFor();
  assert.ok(page.url().endsWith('#/'));
  await page.setViewportSize({ width: 390, height: 1000 });
  for (const key of ['Escape', 'Control+[']) {
    await page.goto(base + '/#/clarifications/' + sample.id);
    await page.locator('[data-node-id="topic"]').click();
    await page.getByRole('dialog', { name: 'Node details' }).waitFor();
    await page.keyboard.press(key);
    await page.getByRole('dialog', { name: 'Node details' }).waitFor({ state: 'hidden' });
    await page.keyboard.press(key);
    await page.locator('.library').waitFor();
    assert.ok(page.url().endsWith('#/'), `${key} returns to the overview after dismissing the inspector`);
  }
});

test('clarification header and quick reference match the Esi gallery treatment', { timeout: 30_000 }, async t => {
  const { page, sample } = await shortcutFixture(t);
  const back = page.getByRole('link', { name: 'Back to clarity library' });
  assert.equal(await back.innerText(), sample.title);
  const header = await page.evaluate(() => {
    const link = document.querySelector('.clarification-back'), svg = link.querySelector('svg'), title = link.querySelector('span');
    const help = document.querySelector('.shortcut-help').getBoundingClientRect(), connection = document.querySelector('.connection').getBoundingClientRect();
    return { arrow: svg.getBoundingClientRect().toJSON(), title: title.getBoundingClientRect().toJSON(), path: svg.querySelector('path').getAttribute('d'),
      size: getComputedStyle(title).fontSize, weight: getComputedStyle(title).fontWeight, helpWidth: help.width, helpHeight: help.height, statusGap: connection.left - help.right };
  });
  assert.equal(header.arrow.x, 16);
  assert.equal(header.arrow.width, 20);
  assert.equal(header.arrow.height, 20);
  assert.equal(header.title.x, 44);
  assert.equal(header.path, 'M19 12H5m7-7-7 7 7 7');
  assert.equal(header.size, '16.8px');
  assert.equal(header.weight, '600');
  assert.equal(header.helpWidth, 32);
  assert.equal(header.helpHeight, 32);
  assert.equal(header.statusGap, 12);
  await page.getByRole('button', { name: 'Keyboard shortcuts', exact: true }).click();
  const help = page.getByRole('dialog', { name: 'Keyboard shortcuts' });
  await help.waitFor();
  const style = await help.evaluate(el => ({ width: el.getBoundingClientRect().width, radius: getComputedStyle(el).borderRadius, background: getComputedStyle(el).backgroundColor,
    sections: ['.dialog-head', 'dl', '.dialog-foot'].map(selector => getComputedStyle(el.querySelector(selector)).padding),
    titleSize: getComputedStyle(el.querySelector('h2')).fontSize, keyHeight: el.querySelector('kbd').getBoundingClientRect().height }));
  assert.equal(style.width, 480);
  assert.equal(style.radius, '13px');
  assert.equal(style.background, 'rgb(42, 45, 48)');
  assert.deepEqual(style.sections, ['20px', '20px', '20px']);
  assert.equal(style.titleSize, '19px');
  assert.equal(style.keyHeight, 23);
  await page.screenshot({ path: '/tmp/ari-shortcut-reference.png' });
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await help.waitFor({ state: 'hidden' });
  await page.keyboard.press('?'); await help.waitFor();
  await page.keyboard.press('?'); await help.waitFor({ state: 'hidden' });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal((await back.locator('svg').boundingBox()).x, 8);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await page.keyboard.press('?'); await help.waitFor();
  assert.ok((await help.boundingBox()).width <= 358);
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await back.click();
  await page.locator('.library').waitFor();
});


test('Escape and Ctrl+[ dismiss dialogs and leave the graph before returning to configured Cher', { timeout: 30_000 }, async t => {
  const cherUrl = 'https://cher.example/';
  const { base, tool } = await fixture(t, { cherUrl });
  assert.deepEqual(await (await fetch(base + '/api/navigation')).json(), { cherUrl });
  await tool('create_clarification', { id: 'cher-return', title: 'Return navigation', graph: exampleGraph(),
    commit: { title: 'Stage the topic', kind: 'topicStaged' } });
  const page = await browserFor(t);
  await page.route(cherUrl, route => route.fulfill({ contentType: 'text/html', body: '<h1>Cher fixture</h1>' }));
  for (const key of ['Escape', 'Control+[']) {
    await page.goto(base + '/#/clarifications/cher-return');
    await page.locator('.graph-node').first().waitFor();
    assert.equal(await page.getByRole('link', { name: 'Back to Cher', exact: true }).count(), 0);
    await page.getByRole('button', { name: 'Keyboard shortcuts', exact: true }).click();
    await page.keyboard.press(key);
    assert.equal(await page.locator('#shortcut-reference').evaluate(dialog => dialog.open), false);
    assert.equal(new URL(page.url()).hash, '#/clarifications/cher-return');
    await page.keyboard.press(key);
    await page.waitForFunction(() => location.hash === '#/');
    await page.getByRole('searchbox', { name: 'Search clarifications' }).focus();
    await page.keyboard.press(key);
    await page.waitForURL(cherUrl);
  }
  for (const width of [1600, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto(base + '/#/');
    const back = page.getByRole('link', { name: 'Back to Cher', exact: true });
    await back.waitFor();
    assert.equal(await back.getAttribute('href'), cherUrl);
    await back.click();
    await page.waitForURL(cherUrl);
  }
});


async function moveRevision(page, delta) {
  const rows = page.locator('.commit-entry');
  const index = await rows.evaluateAll(entries => entries.findIndex(entry => entry.getAttribute('aria-current') === 'step'));
  await rows.nth(index + delta).click();
}

test('graph exports download the selected immutable revision in SVG PNG and PDF', { timeout: 60_000 }, async t => {
  const { page, base, sample } = await shortcutFixture(t);
  const endpoint = `${base}/api/workspaces/${sample.id}/export`;
  for (const [format, signature, mime] of [['svg', '<svg', 'image/svg+xml'], ['png', '\x89PNG', 'image/png'], ['pdf', '%PDF', 'application/pdf']]) {
    const response = await page.request.get(`${endpoint}?format=${format}&revision=2&layout=rings`);
    assert.equal(response.status(), 200, await response.text());
    assert.equal(response.headers()['content-type'], mime);
    assert.match(response.headers()['content-disposition'], new RegExp(`r2-rings\\.${format}`));
    const bytes = await response.body();
    assert.equal(bytes.subarray(0, signature.length).toString(format === 'png' ? 'latin1' : 'utf8'), signature);
    if (format === 'svg') { assert.ok(bytes.toString().includes('Four attendees')); assert.ok(!bytes.toString().includes('Twelve attendees')); }
  }
  for (const [query, status] of [['format=html',400],['revision=999',404],['layout=unknown',400],['selected=missing',400],['inputs=yes',400],['surprise=1',400]]) {
    assert.equal((await page.request.get(`${endpoint}?${query}`)).status(), status, query);
  }
  assert.equal((await page.request.get(`${endpoint}?format=svg`, { headers: { origin: 'https://outside.example' } })).status(), 403);
  const before = await (await page.request.get(`${base}/api/workspaces/${sample.id}`)).json();
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  let started;
  const pending = new Promise(resolve => { started = resolve; });
  await page.route('**/api/workspaces/*/export?**&format=svg', async route => {
    const response = await route.fetch(); started(); await gate; await route.fulfill({ response });
  });
  await page.getByRole('button', { name: 'Export graph', exact: true }).click();
  const downloadEvent = page.waitForEvent('download');
  await page.getByRole('menuitem', { name: 'SVG Vector image' }).click();
  await pending;
  await page.keyboard.press('g'); await page.keyboard.press('g');
  assert.equal(await page.locator('.commit-entry').first().getAttribute('aria-current'), 'step');
  release();
  const download = await downloadEvent;
  assert.match(download.suggestedFilename(), /-r7-hierarchy\.svg$/);
  assert.deepEqual(await (await page.request.get(`${base}/api/workspaces/${sample.id}`)).json(), before);
});

test('canvas minimap supports panning fit and actual size without moving graph nodes', { timeout: 30_000 }, async t => {
  const { page } = await shortcutFixture(t);
  const camera = () => page.locator('.graph-scene').evaluate(el => getComputedStyle(el).transform);
  const nodes = await page.locator('.graph-node').evaluateAll(items => items.map(n => n.parentElement.style.transform));
  await page.getByRole('button', { name: 'Zoom to 100% and focus' }).click();
  assert.equal(await page.getByRole('status', { name: 'Zoom level' }).textContent(), '100%');
  await page.locator('[data-node-id="topic"]').click();
  await page.getByRole('button', { name: 'Zoom to 100% and focus' }).click();
  const before = await camera();
  await page.locator('.viewport-buttons').hover();
  const window = await page.locator('.minimap-window').boundingBox();
  await page.mouse.move(window.x + window.width / 2, window.y + window.height / 2);
  await page.mouse.down();
  const grabbed = await camera();
  const coordinates = value => value.match(/[-\d.]+/g).map(Number);
  assert.ok(coordinates(grabbed).every((value, i) => Math.abs(value - coordinates(before)[i]) < .01), 'Grabbing the minimap window preserves out-of-bounds camera offsets');
  await page.mouse.move(window.x + window.width / 2 + 10, window.y + window.height / 2);
  await page.mouse.up();
  const map = page.getByRole('group', { name: 'Graph overview. Drag the viewport to pan.' });
  await page.locator('.viewport-buttons').hover();
  const rect = await map.boundingBox();
  await page.mouse.click(rect.x + rect.width * .8, rect.y + rect.height * .5);
  assert.notEqual(await camera(), before);
  assert.deepEqual(await page.locator('.graph-node').evaluateAll(items => items.map(n => n.parentElement.style.transform)), nodes);
  await page.getByRole('button', { name: 'Fit graph', exact: true }).click();
  assert.equal(await page.getByRole('button', { name: 'Fit graph', exact: true }).getAttribute('aria-pressed'), 'true');
  await page.getByRole('button', { name: 'Close node details' }).click();
  await page.getByRole('button', { name: 'Fit graph', exact: true }).click();
  await page.locator('.graph-viewport').focus();
  await page.keyboard.press('ArrowLeft');
  assert.equal(await page.getByRole('button', { name: 'Fit graph', exact: true }).getAttribute('aria-pressed'), 'false');
  const future = page.locator('.commit-entry').last();
  await page.keyboard.press('Home');
  assert.match(await future.getAttribute('class'), /future/);
  await page.locator('.viewport-buttons').hover();
  await page.screenshot({ path: '/tmp/ari-history-controls.png' });
  const alignment = await page.locator('.commit-entry').first().evaluate(row => {
    const dot = row.querySelector('.commit-dot').getBoundingClientRect(), title = row.querySelector('strong').getBoundingClientRect();
    return Math.abs(dot.y + dot.height / 2 - title.y - parseFloat(getComputedStyle(row.querySelector('strong')).lineHeight) / 2);
  });
  assert.ok(alignment < 1, `Dot aligns with the first title line: ${alignment}`);
});

test('yy copies a stable Ari reference with the shared success notification', { timeout: 30_000 }, async t => {
  const { page, sample, tool, rpc } = await shortcutFixture(t);
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.keyboard.press('y'); await page.keyboard.press('y');
  assert.equal(await page.evaluate(() => navigator.clipboard.readText()), `ari@${sample.id}`);
  assert.equal((await tool('get_clarification', { item: `ari@${sample.id}` })).id, sample.id);
  for (const item of ['ari@1', `ari@${sample.title}`]) assert.equal((await rpc('tools/call', { name: 'get_clarification', arguments: { item } })).isError, true);
  const notice = page.locator('.reference-notification');
  assert.equal(await notice.textContent(), `Copied ari@${sample.id}`);
  const style = await notice.evaluate(el => ({ color: getComputedStyle(el).color, background: getComputedStyle(el).backgroundColor, top: el.parentElement.getBoundingClientRect().y, right: innerWidth - el.parentElement.getBoundingClientRect().right }));
  assert.deepEqual(style, { color: 'rgb(101, 214, 173)', background: 'rgb(23, 59, 50)', top: 24, right: 24 });
});


test('zooming out never enlarges a graph fitted below five percent', { timeout: 30_000 }, async t => {
  const { base, tool } = await fixture(t);
  const nodes = Array.from({ length: 200 }, (_, i) => ({ id: `node-${i}`, title: `Decision ${i}`, kind: i === 0 ? 'topic' : 'decided', content: 'Scripted test', alternatives: [] }));
  const edges = nodes.slice(1).map((node, i) => ({ id: `parent-${i}`, kind: 'parent', from: nodes[i].id, to: node.id }));
  await tool('create_clarification', { id: 'long-graph', title: 'Long graph', graph: { nodes, edges }, commit: { title: 'Stage long graph', kind: 'topicStaged' } });
  const page = await browserFor(t);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(base + '/#/clarifications/long-graph');
  await page.locator('.graph-node').first().waitFor();
  await page.getByRole('button', { name: 'Fit graph', exact: true }).click();
  const before = await page.locator('.graph-scene').evaluate(el => el.style.transform);
  await page.locator('.graph-viewport').focus();
  await page.keyboard.press('-');
  assert.equal(await page.locator('.graph-scene').evaluate(el => el.style.transform), before);
  assert.equal(await page.getByRole('button', { name: 'Fit graph', exact: true }).getAttribute('aria-pressed'), 'true');
  await page.setViewportSize({ width: 390, height: 1000 });
  await page.waitForFunction(() => document.querySelector('[aria-label="Fit graph"]').getAttribute('aria-pressed') === 'false');
});

async function graphCamera(page) {
  return page.locator('.graph-scene').evaluate(el => {
    const matrix = new DOMMatrix(getComputedStyle(el).transform);
    return { x: matrix.e, y: matrix.f, scale: matrix.a };
  });
}
function graphAnchor(camera, point) { return { x: (point.x - camera.x) / camera.scale, y: (point.y - camera.y) / camera.scale }; }
function sameAnchor(before, after) { assert.ok(Math.hypot(before.x - after.x, before.y - after.y) < .1, `Gesture anchor moved: ${JSON.stringify({ before, after })}`); }
async function touchSession(page) {
  const session = await page.context().newCDPSession(page);
  await session.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 3 });
  return async (type, points) => session.send('Input.dispatchTouchEvent', { type, touchPoints: points.map(({ id, x, y }) => ({ id, x, y, radiusX: 1, radiusY: 1, force: 1 })) });
}

test('trackpad pinch and background double-click zoom around their anchors', { timeout: 30_000 }, async t => {
  const { page } = await shortcutFixture(t);
  const viewport = await page.locator('.graph-viewport').boundingBox();
  const point = { x: 24, y: 24 };
  const before = await graphCamera(page), anchor = graphAnchor(before, point);
  const prevented = await page.locator('.graph-viewport').evaluate((el, { x, y }) => {
    const event = new WheelEvent('wheel', { bubbles: true, cancelable: true, ctrlKey: true, deltaY: -Math.log(1.25) * 100, clientX: x, clientY: y });
    el.dispatchEvent(event); return event.defaultPrevented;
  }, { x: viewport.x + point.x, y: viewport.y + point.y });
  assert.equal(prevented, true);
  const pinched = await graphCamera(page);
  assert.ok(Math.abs(pinched.scale - before.scale * 1.25) < .001);
  sameAnchor(anchor, graphAnchor(pinched, point));
  const ordinary = await page.locator('.graph-viewport').evaluate(el => {
    const event = new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: 60 });
    el.dispatchEvent(event); return event.defaultPrevented;
  });
  assert.equal(ordinary, false);
  assert.deepEqual(await graphCamera(page), pinched);
  await page.locator('.graph-viewport').dispatchEvent('dblclick', { clientX: viewport.x + point.x, clientY: viewport.y + point.y });
  const doubled = await graphCamera(page);
  assert.ok(Math.abs(doubled.scale - Math.min(2, pinched.scale * 2)) < .001);
  sameAnchor(anchor, graphAnchor(doubled, point));
  await page.locator('[data-node-id="topic"]').dispatchEvent('dblclick', { clientX: viewport.x + point.x, clientY: viewport.y + point.y });
  assert.deepEqual(await graphCamera(page), doubled, 'Double-clicking a node is not a background zoom');
});

test('touch pinches over nodes preserve the moving midpoint and suppress selection', { timeout: 30_000 }, async t => {
  const { page } = await shortcutFixture(t);
  await page.setViewportSize({ width: 390, height: 1000 });
  await page.getByRole('button', { name: 'Fit graph', exact: true }).click();
  const touch = await touchSession(page);
  const viewport = await page.locator('.graph-viewport').boundingBox();
  const root = await page.locator('[data-node-id="topic"]').boundingBox();
  const first = { id: 1, x: root.x + root.width / 2, y: root.y + root.height / 2 };
  const second = { id: 2, x: first.x + 110, y: first.y };
  const midpoint = { x: (first.x + second.x) / 2 - viewport.x, y: first.y - viewport.y };
  const before = await graphCamera(page), anchor = graphAnchor(before, midpoint);
  const positions = await page.locator('.graph-node').evaluateAll(nodes => nodes.map(n => n.parentElement.style.transform));
  await touch('touchStart', [first]);
  await touch('touchStart', [first, second]);
  const movedFirst = { ...first, x: first.x + 10 }, movedSecond = { ...second, x: second.x + 60 };
  await touch('touchMove', [movedFirst, movedSecond]);
  const after = await graphCamera(page);
  assert.ok(Math.abs(after.scale - before.scale * (160 / 110)) < .001);
  sameAnchor(anchor, graphAnchor(after, { x: (movedFirst.x + movedSecond.x) / 2 - viewport.x, y: midpoint.y }));
  await touch('touchEnd', [movedSecond]);
  await touch('touchMove', [{ ...movedSecond, x: movedSecond.x + 10 }]);
  assert.deepEqual(await graphCamera(page), after, 'The remaining finger does not jump into a one-finger pan');
  await touch('touchEnd', []);
  assert.equal(await page.locator('.node-inspector').count(), 0);
  assert.deepEqual(await page.locator('.graph-node').evaluateAll(nodes => nodes.map(n => n.parentElement.style.transform)), positions);
  assert.equal(await page.evaluate(() => visualViewport.scale), 1, 'Pinching changes the graph instead of browser page scale');
  await touch('touchStart', [{ ...first, id: 3 }]);
  await touch('touchStart', [{ ...first, id: 3 }, { ...second, id: 4 }]);
  await touch('touchCancel', []);
  const node = await page.locator('[data-node-id="topic"]').boundingBox();
  await touch('touchStart', [{ id: 5, x: node.x + node.width / 2, y: node.y + node.height / 2 }]);
  await touch('touchEnd', []);
  await page.getByRole('dialog', { name: 'Node details' }).waitFor();
});

test('double-tapping blank canvas zooms once and cancelled taps do not pair', { timeout: 30_000 }, async t => {
  const { page } = await shortcutFixture(t);
  await page.setViewportSize({ width: 390, height: 1000 });
  await page.getByRole('button', { name: 'Fit graph', exact: true }).click();
  const touch = await touchSession(page);
  const viewport = await page.locator('.graph-viewport').boundingBox();
  const point = { x: 15, y: 20 }, location = { id: 1, x: viewport.x + point.x, y: viewport.y + point.y };
  const before = await graphCamera(page), anchor = graphAnchor(before, point);
  await touch('touchStart', [location]); await touch('touchEnd', []);
  await touch('touchStart', [{ ...location, id: 2 }]); await touch('touchEnd', []);
  const after = await graphCamera(page);
  assert.ok(Math.abs(after.scale - before.scale * 2) < .001, 'A double tap produces exactly one twofold zoom');
  sameAnchor(anchor, graphAnchor(after, point));
  assert.equal(await page.locator('.node-inspector').count(), 0);
  await touch('touchStart', [{ ...location, id: 3 }]); await touch('touchCancel', []);
  await touch('touchStart', [{ ...location, id: 4 }]); await touch('touchEnd', []);
  assert.deepEqual(await graphCamera(page), after, 'Cancelled contacts cannot become part of a double tap');
  await page.getByRole('button', { name: 'Fit graph', exact: true }).click();
  assert.equal(await page.getByRole('button', { name: 'Fit graph', exact: true }).getAttribute('aria-pressed'), 'true');
});

test('shift hjkl pans the canvas and minus equals zoom from inspector controls', { timeout: 30_000 }, async t => {
  const { page } = await shortcutFixture(t);
  await page.locator('[data-node-id="venue"]').click();
  const revision = await page.locator('.commit-entry[aria-current="step"]').textContent();
  const selected = await page.locator('.graph-node[aria-pressed="true"]').getAttribute('data-node-id');
  for (const [key, x, y] of [['Shift+h',187.5,0],['Shift+j',0,-187.5],['Shift+k',0,187.5],['Shift+l',-187.5,0]]) {
    await page.getByRole('button', { name: 'Close node details' }).focus();
    const before = await graphCamera(page);
    await page.keyboard.press(key);
    const after = await graphCamera(page);
    assert.ok(Math.abs(after.x - before.x - x) < .01 && Math.abs(after.y - before.y - y) < .01, key);
    assert.equal(after.scale, before.scale);
    assert.equal(await page.locator('.commit-entry[aria-current="step"]').textContent(), revision);
    assert.equal(await page.locator('.graph-node[aria-pressed="true"]').getAttribute('data-node-id'), selected);
  }
  const before = await graphCamera(page);
  await page.keyboard.press('=');
  assert.ok(Math.abs((await graphCamera(page)).scale - before.scale - .1) < .001);
  await page.keyboard.press('-');
  assert.ok(Math.abs((await graphCamera(page)).scale - before.scale) < .001);
});

test('inspector puts the selected assumption or answer first with plain yellow emphasis', { timeout: 30_000 }, async t => {
  const { page, sample } = await shortcutFixture(t);
  for (const id of ['venue', 'people', 'headcount']) {
    await page.getByRole('button', { name: 'Fit graph', exact: true }).click();
    await page.locator(`[data-node-id="${id}"]`).click();
    const node = sample.commits.at(-1).graph.nodes.find(n => n.id === id);
    const inspector = page.getByRole('complementary', { name: 'Node details' });
    const first = inspector.locator('.detail-option').first();
    assert.match(await first.getAttribute('class'), /chosen/);
    assert.equal(await first.locator('strong').textContent(), node.selectedAlternative);
    assert.equal(await first.locator('.option-state').textContent(), node.kind === 'assumption' ? 'Assumed' : 'Decided');
    const style = await first.evaluate(el => ({ color: getComputedStyle(el.querySelector('strong')).color, border: getComputedStyle(el).borderTopWidth, background: getComputedStyle(el).backgroundColor }));
    assert.deepEqual(style, { color: 'rgb(230, 184, 92)', border: '0px', background: 'rgba(0, 0, 0, 0)' });
    if (node.content !== node.selectedAlternative) assert.equal(await first.locator('.selected-answer').textContent(), node.content);
    const dividers = await inspector.locator('.detail-option').evaluateAll(options => options.map(el => [getComputedStyle(el).borderBottomWidth, getComputedStyle(el).borderBottomColor]));
    assert.ok(dividers.every(border => border[0] === '1px' && border[1] === dividers[0][1]));
    assert.equal(await inspector.locator('.node-kind').textContent(), node.kind === 'assumption' ? 'Assumption' : 'Decided');
    await inspector.getByRole('button', { name: 'Close node details' }).focus();
    await page.keyboard.press('Tab'); await page.keyboard.press('Shift+Tab');
    const closeStyle = await inspector.getByRole('button', { name: 'Close node details' }).evaluate(el => ({ color: getComputedStyle(el).color, outline: getComputedStyle(el).outlineStyle }));
    assert.deepEqual(closeStyle, { color: 'rgb(230, 184, 92)', outline: 'none' });
    if (id === 'venue') await page.screenshot({ path: '/tmp/ari-inspector-assumptions.png' });
    if (id === 'people') await page.screenshot({ path: '/tmp/ari-inspector-decided.png' });
  }
});

test('assumptions use a fixed thicker dashed border and graph focus uses a single border', { timeout: 30_000 }, async t => {
  const { page } = await shortcutFixture(t);
  await page.locator('[data-node-id="venue"]').click();
  await page.getByRole('button', { name: 'Zoom to 100% and focus' }).click();
  const node = page.locator('[data-node-id="venue"]');
  for (let i = 0; i < 5; i++) {
    await page.keyboard.press('-');
    assert.equal(await node.evaluate(el => getComputedStyle(el).borderTopWidth), '2px');
  }
  await node.focus();
  const style = await node.evaluate(el => ({ width: parseFloat(getComputedStyle(el).borderTopWidth), border: getComputedStyle(el).borderTopStyle, outline: getComputedStyle(el).outlineStyle }));
  assert.equal(style.border, 'dashed');
  assert.equal(style.width, 2);
  assert.equal(style.outline, 'none');
  await page.locator('.graph-viewport').focus();
  const canvas = await page.locator('.graph-viewport').evaluate(el => ({ outline: getComputedStyle(el).outlineStyle, shadow: getComputedStyle(el).boxShadow }));
  assert.deepEqual(canvas, { outline: 'none', shadow: 'none' });
  const revision = page.locator('.commit-entry[aria-current="step"]');
  await revision.focus();
  assert.equal(await revision.evaluate(el => getComputedStyle(el).outlineStyle), 'none');
});


test('holding shifted pan keys ramps into continuous motion and eases to a stop', { timeout: 30_000 }, async t => {
  const { page } = await shortcutFixture(t);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.getByRole('button', { name: 'Fit graph', exact: true }).click();
  const before = await graphCamera(page);
  await page.keyboard.down('Shift');
  await page.keyboard.down('h');
  await page.waitForFunction(x => new DOMMatrix(getComputedStyle(document.querySelector('.graph-scene')).transform).m41 > x + 10, before.x);
  const ramping = await graphCamera(page);
  assert.ok(ramping.x < before.x + 187.5, 'Pan starts gradually');
  await page.waitForFunction(x => new DOMMatrix(getComputedStyle(document.querySelector('.graph-scene')).transform).m41 > x + 400, before.x);
  const held = await graphCamera(page);
  await page.keyboard.down('h');
  await page.keyboard.up('h');
  await page.keyboard.up('Shift');
  await page.waitForTimeout(320);
  const stopped = await graphCamera(page);
  assert.ok(stopped.x > held.x, 'Release eases through the remaining distance');
  assert.equal(stopped.y, before.y);
  assert.equal(stopped.scale, before.scale);
  await page.waitForTimeout(120);
  assert.deepEqual(await graphCamera(page), stopped, 'Motion ends after release');
  await page.keyboard.down('Shift');
  await page.keyboard.down('l');
  await page.waitForFunction(x => new DOMMatrix(getComputedStyle(document.querySelector('.graph-scene')).transform).m41 < x - 10, stopped.x);
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  const blurred = await graphCamera(page);
  await page.waitForTimeout(180);
  assert.deepEqual(await graphCamera(page), blurred, 'Losing window focus cancels held motion');
  await page.keyboard.up('l'); await page.keyboard.up('Shift');
});


test('mobile revision lens uses responsive slots and horizontal shortcuts while desktop keeps vertical navigation', { timeout: 30_000 }, async t => {
  const { page } = await shortcutFixture(t);
  await page.setViewportSize({ width: 390, height: 1000 });
  await page.reload();
  const bar = page.getByRole('navigation', { name: 'Revision history' });
  await bar.waitFor();
  const current = async n => {
    await page.waitForFunction(n => document.querySelector('.revision-tile[aria-current="step"]')?.getAttribute('data-revision') === String(n), n);
  };
  const visible = async expected => {
    assert.deepEqual(await bar.locator('.revision-tile.visible').evaluateAll(rows => rows.map(row => Number(row.dataset.revision))), expected);
  };
  await current(7); await visible([7]);
  for (const [width, revisions] of [[495,[7]], [496,[6,7]], [825,[6,7]], [640,[6,7]]]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.waitForFunction(count => document.querySelectorAll('.revision-tile.visible').length === count, revisions.length);
    await visible(revisions);
  }
  await page.getByRole('button', { name: 'Graph options and color key' }).click();
  await page.getByRole('checkbox', { name: 'Show inputs', exact: true }).focus();
  await page.keyboard.press('h'); await current(6); await visible([5,6]);
  await page.keyboard.press('h'); await current(5); await visible([4,5]);
  await page.keyboard.press('l'); await current(6); await visible([6,7]);
  await page.keyboard.press('ArrowLeft'); await current(5); await visible([4,5]);
  await page.keyboard.press('Home'); await current(1); await visible([1,2]);
  await page.keyboard.press('h'); await current(1);
  await page.locator('.graph-viewport').focus();
  await page.keyboard.press('ArrowRight'); await current(2); await visible([2,3]);
  await page.keyboard.press('j'); await current(2);
  await page.keyboard.press('ArrowDown'); await current(2);
  await page.keyboard.press('End'); await current(7);
  await page.keyboard.press('l'); await current(7);
  await page.keyboard.press('?');
  const help = page.getByRole('dialog', { name: 'Keyboard shortcuts' });
  assert.equal(await help.locator('dt.mobile-revision').innerText(), 'h l / ← →');
  await page.keyboard.press('Escape');
  await page.setViewportSize({ width: 915, height: 1000 });
  await page.waitForFunction(() => getComputedStyle(document.querySelector('.revision-rail')).getPropertyValue('--slots') === '2');
  await page.setViewportSize({ width: 916, height: 1000 });
  await page.waitForFunction(() => getComputedStyle(document.querySelector('.revision-rail')).getPropertyValue('--slots') === '3');
  await page.keyboard.press('h'); await current(6); await visible([5,6,7]);
  const selected = await bar.locator('[aria-current="step"]').boundingBox();
  const rail = await bar.locator('.revision-rail').boundingBox();
  assert.ok(Math.abs(selected.x + selected.width / 2 - rail.x - rail.width / 2) < 1, 'The selected revision is centered between its neighbors');
  await page.setViewportSize({ width: 1100, height: 1000 });
  await visible([5,6,7]);
  await page.keyboard.press('End'); await current(7);
  await page.setViewportSize({ width: 1101, height: 1000 });
  await page.getByRole('navigation', { name: 'Conversation history' }).waitFor();
  await page.keyboard.press('k');
  assert.match(await page.locator('.commit-entry[aria-current="step"]').innerText(), /Whole team joins/);
  await page.keyboard.press('ArrowDown');
  assert.match(await page.locator('.commit-entry[aria-current="step"]').innerText(), /Map lunch relationships/);
});

test('mobile revision swipes move once, respect cancellation, and follow publications only from latest', { timeout: 30_000 }, async t => {
  const { page, tool, sample } = await shortcutFixture(t);
  await page.setViewportSize({ width: 640, height: 1000 });
  const bar = page.getByRole('navigation', { name: 'Revision history' });
  await bar.waitFor();
  const touch = await touchSession(page);
  const box = await bar.locator('.revision-rail').boundingBox();
  const point = { id: 1, x: box.x + box.width * .7, y: box.y + box.height / 2 };
  const swipe = async (x, y = 0, cancel = false) => {
    await touch('touchStart', [point]);
    await touch('touchMove', [{ ...point, x: point.x + x, y: point.y + y }]);
    await touch(cancel ? 'touchCancel' : 'touchEnd', []);
  };
  const current = async n => {
    await page.waitForFunction(n => document.querySelector('.revision-tile[aria-current="step"]')?.getAttribute('data-revision') === String(n), n);
  };
  await current(7);
  await swipe(80); await current(6);
  await swipe(-80); await current(7);
  await swipe(20); await current(7);
  await swipe(50,45); await current(7);
  await swipe(80,0,true); await current(7);
  await swipe(-80); await current(7);
  await bar.locator('.revision-tile.visible[data-revision="6"]').click(); await current(6);
  await page.keyboard.press('l'); await current(7);
  const graph = sample.commits.at(-1).graph;
  await tool('publish_graph_commit', { clarificationId: sample.id, expectedRevision: 7, graph, commit: { title: 'Confirm lunch logistics', kind: 'graphUpdated' } });
  await current(8);
  await page.keyboard.press('h'); await current(7);
  await tool('publish_graph_commit', { clarificationId: sample.id, expectedRevision: 8, graph, commit: { title: 'Record final details', kind: 'graphUpdated' } });
  await page.waitForFunction(() => document.querySelector('.revision-number')?.textContent.includes('/9'));
  await current(7);
  await page.keyboard.press('End'); await current(9);
});


test('desktop timeline uses the shared responsive sidebar and reveals the selected revision', { timeout: 30_000 }, async t => {
  const { page } = await shortcutFixture(t);
  const sidebar = page.locator('.conversation-rail');
  for (const [width, expected] of [[1600, 330], [1800, 370], [1180, 280]]) {
    await page.setViewportSize({ width, height: 520 });
    assert.equal((await sidebar.boundingBox()).width, expected);
    assert.equal(await sidebar.evaluate(el => getComputedStyle(el).backgroundColor), 'rgb(29, 31, 33)');
    await page.keyboard.press('Home');
    assert.equal(await sidebar.locator('.commit-entry.selected .commit-number').textContent(), '1/7');
    await page.keyboard.press('End');
    const row = await sidebar.locator('.commit-entry.selected').boundingBox(), nav = await sidebar.getByRole('navigation').boundingBox();
    assert.ok(row.y >= nav.y && row.y + row.height <= nav.y + nav.height + 1, 'Selected revision scrolls within the timeline');
  }
});

async function highlightedFrame(page, ids) {
  return page.evaluate(ids => {
    const viewport = document.querySelector('.graph-viewport').getBoundingClientRect();
    const boxes = [...document.querySelectorAll('.graph-node')].filter(el => ids ? ids.includes(el.dataset.nodeId) : el.matches('.added,.changed,.answered,.removed')).map(el => el.getBoundingClientRect());
    const left = Math.min(...boxes.map(b => b.left)), right = Math.max(...boxes.map(b => b.right));
    const top = Math.min(...boxes.map(b => b.top)), bottom = Math.max(...boxes.map(b => b.bottom));
    return { centerError: Math.hypot((left + right - viewport.left - viewport.right) / 2, (top + bottom - viewport.top - viewport.bottom) / 2), margin: Math.min(left - viewport.left, viewport.right - right, top - viewport.top, viewport.bottom - bottom), scale: new DOMMatrix(getComputedStyle(document.querySelector('.graph-scene')).transform).a };
  }, ids);
}

test('revision keys frame every highlighted node including answered added and removed nodes', { timeout: 30_000 }, async t => {
  const { page } = await shortcutFixture(t);
  await page.getByRole('button', { name: 'Changed', exact: true }).click();
  for (const layout of ['Tree', 'Grouped', 'Radial']) {
    await page.getByRole('button', { name: layout, exact: true }).click();
    await page.keyboard.press('Home');
    for (const [revision, highlight] of [[2,'removed'], [3,'answered'], [4,'added']]) {
      await page.keyboard.press('j');
      await page.waitForFunction(revision => document.querySelectorAll('.commit-entry')[revision - 1]?.getAttribute('aria-current') === 'step', revision);
      assert.ok(await page.locator('.graph-node.' + highlight).count() > 0);
      const frame = await highlightedFrame(page);
      assert.ok(frame.centerError < 1, `${layout} revision ${revision} centered: ${JSON.stringify(frame)}`);
      assert.ok(frame.margin >= 47, `${layout} revision ${revision} fits every highlight: ${JSON.stringify(frame)}`);
      assert.ok(frame.scale <= 1);
      if (layout === 'Tree' && revision === 4) {
        const added = await page.locator('.graph-node.added.decided').first().evaluate(el => ({ fill: getComputedStyle(el).backgroundColor, title: getComputedStyle(el.querySelector('strong')).color, answer: getComputedStyle(el.querySelector('.node-value')).color }));
        assert.deepEqual(added, { fill: 'rgb(29, 43, 40)', title: 'rgb(240, 235, 222)', answer: 'rgb(165, 173, 165)' });
      }
      const visibleChanges = await page.locator('.graph-node.added,.graph-node.changed,.graph-node.answered').evaluateAll(nodes => nodes.map(node => node.dataset.nodeId));
      await page.getByRole('button', { name: 'Current', exact: true }).click();
      await page.keyboard.press('k');
      await page.keyboard.press('j');
      const currentFrame = await highlightedFrame(page, visibleChanges);
      assert.ok(currentFrame.centerError < 1 && currentFrame.margin >= 47 && currentFrame.scale <= 1, `${layout} Current revision ${revision} frames its changed nodes: ${JSON.stringify(currentFrame)}`);
      await page.getByRole('button', { name: 'Changed', exact: true }).click();

    }
  }
  await page.setViewportSize({ width: 940, height: 1000 });
  await page.getByRole('navigation', { name: 'Revision history' }).waitFor();
  await page.keyboard.press('h');
  assert.ok((await highlightedFrame(page)).centerError < 1, 'Mobile horizontal revision keys frame the highlights');
  await page.getByRole('button', { name: 'Current', exact: true }).click();
  await page.keyboard.press('l');
  const currentFrame = await highlightedFrame(page, ['budget', 'venue', 'amount', 'timing', 'italian']);
  assert.ok(currentFrame.centerError < 1 && currentFrame.margin >= 47, 'Mobile Current revision keys frame the changed nodes');
});

test('revision framing animates smoothly retargets rapid navigation and yields to manual zoom', { timeout: 30_000 }, async t => {
  const { page } = await shortcutFixture(t);
  await page.getByRole('button', { name: 'Changed', exact: true }).click();
  await page.keyboard.press('Home');
  await page.keyboard.press('j');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  const before = await graphCamera(page);
  await page.keyboard.press('j');
  const cameras = await page.evaluate(async () => {
    const samples = [];
    for (let i = 0; i < 8; i++) await new Promise(resolve => requestAnimationFrame(() => { samples.push(getComputedStyle(document.querySelector('.graph-scene')).transform); resolve(); }));
    return samples;
  });
  assert.ok(new Set(cameras).size > 1, `Camera animates across frames: ${JSON.stringify({ before, cameras })}`);
  const intermediate = await graphCamera(page);
  await page.keyboard.press('j'); await page.keyboard.press('j');
  await page.waitForTimeout(720);
  const final = await highlightedFrame(page);
  assert.ok(final.centerError < 1 && final.margin >= 47, JSON.stringify(final));
  assert.notDeepEqual(await graphCamera(page), intermediate);
  await page.keyboard.press('k');
  await page.waitForTimeout(100);
  await page.keyboard.press('-');
  const zoomed = await graphCamera(page);
  await page.waitForTimeout(720);
  assert.deepEqual(await graphCamera(page), zoomed, 'Manual zoom interrupts framing');
});


test('mobile header retains desktop title sizing within 154 pixels of controls and keeps graph controls accessible without moving the camera', { timeout: 30_000 }, async t => {
  const { page } = await shortcutFixture(t);
  for (const width of [320,390,940,1100]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.getByRole('button', { name: 'Graph options and color key' }).waitFor();
    const geometry = await page.evaluate(() => ({
      header: document.querySelector('.page-header').getBoundingClientRect().height,
      titleSize: getComputedStyle(document.querySelector('.clarification-back span')).fontSize,
      revisions: document.querySelector('.mobile-revisions').getBoundingClientRect().height,
      toolbar: document.querySelector('.graph-toolbar').getBoundingClientRect().height,
      canvasTop: document.querySelector('.graph-viewport').getBoundingClientRect().top,
      overflow: document.documentElement.scrollWidth > innerWidth,
    }));
    assert.deepEqual(geometry, { header: 66, titleSize: '16.8px', revisions: 44, toolbar: 44, canvasTop: 154, overflow: false });
    const alignment = await page.locator('.compact-layout').evaluate(el => {
      const select = el.querySelector('select').getBoundingClientRect(), label = el.querySelector('.compact-layout-value').getBoundingClientRect();
      return Math.abs((select.top + select.bottom - label.top - label.bottom) / 2);
    });
    assert.ok(alignment < .5, 'Dropdown text is centered vertically at each mobile width');

  }
  await page.setViewportSize({ width: 390, height: 1000 });
  await page.getByRole('combobox', { name: 'Graph layout' }).selectOption('islands');
  const camera = await graphCamera(page);
  const options = page.getByRole('button', { name: 'Graph options and color key' });
  await options.click();
  const panel = page.getByRole('dialog', { name: 'Graph controls', exact: true });
  const palette = await panel.locator('.change-legend>span').evaluateAll(items => Object.fromEntries(items.map(el => [el.textContent, getComputedStyle(el).color])));
  assert.deepEqual(palette, { '+ Added': 'rgb(101, 214, 173)', '+ Assumption added': 'rgb(169, 154, 194)', '✓ Assumption resolved': 'rgb(134, 181, 204)', '~ Answer changed': 'rgb(237, 158, 82)', '− Node removed': 'rgb(255, 155, 172)' });
  assert.ok(await page.locator('.wires>path.input').count() > 0);
  await panel.getByRole('checkbox', { name: 'Show inputs' }).uncheck();
  assert.equal(await page.locator('.wires>path.input').count(), 0);
  await panel.getByRole('checkbox', { name: 'Show constraints' }).uncheck();
  assert.equal(await page.locator('.constraint-junction').count(), 0);
  assert.deepEqual(await graphCamera(page), camera);
  await page.keyboard.press('Escape');
  await panel.waitFor({ state: 'hidden' });
  assert.equal(await options.evaluate(el => el === document.activeElement), true);
  assert.ok(page.url().includes('/clarifications/'));
  await page.getByRole('button', { name: 'Changed', exact: true }).click();
  assert.deepEqual(await graphCamera(page), camera);
  await page.getByRole('combobox', { name: 'Graph layout' }).selectOption('hierarchy');
  await page.getByRole('button', { name: 'Current', exact: true }).click();
  const purple = await page.locator('.graph-node.assumption').first().evaluate(el => getComputedStyle(el).borderTopColor);
  assert.equal(purple, 'rgb(142, 123, 183)');
  await page.screenshot({ path: '/tmp/ari-compact-header.png' });
  await options.click();
  await page.keyboard.press('Control+[');
  await panel.waitFor({ state: 'hidden' });
  assert.ok(page.url().includes('/clarifications/'));
  await page.keyboard.press('Escape');
  await page.locator('.library').waitFor();
});


test('color fixture shows all five transitions together and retains unchanged decided and assumed examples', { timeout: 30_000 }, async t => {
  const { base, tool } = await fixture(t);
  const file = join(root, 'fixtures/graph-color-transitions.json');
  const sample = JSON.parse(await readFile(file, 'utf8'));
  const { stdout } = await promisify(execFile)(process.execPath, [join(root, 'scripts/load-fixture.mjs'), '--url', base, '--file', file]);
  assert.equal(JSON.parse(stdout).status, 'created');
  const saved = await tool('get_clarification', { item: sample.id });
  assert.deepEqual(saved.commits.map(c => c.graph), sample.commits.map(c => c.graph));
  const page = await browserFor(t);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(base + '/#/clarifications/' + sample.id);
  await page.getByRole('button', { name: 'Changed', exact: true }).click();
  for (const layout of ['Tree','Grouped','Radial']) {
    await page.getByRole('button', { name: layout, exact: true }).click();
    for (const [id, status, color] of [
      ['collector','Added','rgb(101, 214, 173)'],
      ['transport','Assumption · Added','rgb(169, 154, 194)'],
      ['venue','Assumption · Resolved','rgb(134, 181, 204)'],
      ['budget','Changed','rgb(237, 158, 82)'],
      ['booking','Assumption · Removed','rgb(255, 155, 172)'],
    ]) {
      const node = page.locator(`[data-node-id="${id}"]`);
      assert.equal(await node.locator('.node-status').textContent(), status);
      assert.equal(await node.evaluate(el => getComputedStyle(el).borderTopColor), color);
    }
    assert.equal(await page.locator('[data-node-id="people"] .node-status').textContent(), 'Decided');
    assert.equal(await page.locator('[data-node-id="drinks"] .node-status').textContent(), 'Assumption');
    assert.equal(await page.locator('[data-node-id="drinks"]').evaluate(el => getComputedStyle(el).borderTopColor), 'rgb(142, 123, 183)');
  }
  await page.getByRole('button', { name: 'Tree', exact: true }).click();
  await page.screenshot({ path: '/tmp/ari-all-colors.png' });
  const contentInsets = () => page.locator('[data-node-id="venue"]').evaluate(el => {
    const card = el.getBoundingClientRect();
    return ['strong', '.node-value', '.node-status'].map(selector => {
      const box = el.querySelector(selector).getBoundingClientRect();
      const scale = new DOMMatrix(getComputedStyle(document.querySelector('.graph-scene')).transform).a;
      return { x: Math.round((box.x - card.x) / scale * 100) / 100, y: Math.round((box.y - card.y) / scale * 100) / 100 };
    });
  });
  const resolvedInsets = await contentInsets();
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.keyboard.press('k');
  const opacities = await page.evaluate(async () => {
    const samples = [];
    for (let i = 0; i < 12; i++) await new Promise(resolve => requestAnimationFrame(() => {
      samples.push(...[...document.querySelectorAll('.graph-node')].map(el => Number(getComputedStyle(el).opacity)));
      resolve();
    }));
    return samples;
  });
  assert.ok(opacities.every(opacity => opacity === 1), 'Backward navigation keeps node content visible throughout motion');
  await page.waitForTimeout(700);
  assert.deepEqual(await contentInsets(), resolvedInsets, 'Solid and dashed borders reserve identical content space');

});

test('MCP schema exposes visible content and revisions require deliberate confirmed-answer changes', { timeout: 30_000 }, async t => {
  const { base, tool, rpc } = await fixture(t);
  const listing = await rpc('tools/list', {});
  const schema = listing.tools.find(tool => tool.name === 'publish_graph_commit').inputSchema;
  const variants = schema.$defs.PublicationNode.oneOf;
  assert.deepEqual(schema.required.toSorted(), ['clarificationId','commit','expectedRevision','graph']);
  assert.equal(schema.properties.expectedRevision.minimum, 1);
  assert.equal(schema.additionalProperties, false);
  const assumption = variants.find(variant => variant.properties.kind.const === 'assumption');
  assert.ok(assumption.required.includes('alternatives') && assumption.required.includes('selectedAlternative'));
  assert.equal(assumption.properties.alternatives.minItems, 2);
  for (const branch of variants) {
    assert.equal(branch.properties.rationale, undefined);
    assert.equal(branch.properties.dependsOn, undefined);
  }
  assert.deepEqual(Object.keys(schema.$defs.PublicationCommit.properties).toSorted(), ['kind','title']);
  assert.equal(schema.$defs.Participant.properties.alternative.type, 'string');
  const graph = { nodes: [
    { id:'budget',title:'Budget per person',kind:'decided',content:'€25',alternatives:[{label:'€25'},{label:'€30'}],selectedAlternative:'€25' },
    { id:'topic',title:'Team lunch',kind:'topic',content:'Plan lunch' },
  ], edges:[{id:'parent-budget',kind:'parent',from:'topic',to:'budget'}] };
  const created = await tool('create_clarification', { id:'review-contract',title:'Review contract',graph,commit:{title:'Confirm the allowance',kind:'directAnswer'} });
  assert.deepEqual(Object.keys(created).toSorted(), ['clarificationId','commitId','reference','revision','url']);
  let read = await tool('get_clarification', { item:created.reference });
  assert.equal(read.currentGraph.nodes[0].rationale, undefined);
  assert.deepEqual(read.latestCommit.metadata, { title:'Confirm the allowance',kind:'directAnswer' });
  assert.equal(read.nodeIndex.find(entry => entry.id === 'topic').number, 1);
  const reopen = structuredClone(read.currentGraph);
  reopen.nodes.find(node => node.id === 'budget').kind = 'assumption';
  const publish = { clarificationId:'review-contract',expectedRevision:1,graph:reopen,commit:{title:'Reconsider the allowance',kind:'openDiscussion'} };
  const rejected = await rpc('tools/call', {name:'publish_graph_commit',arguments:publish});
  assert.equal(rejected.isError, true);
  assert.equal(rejected.structuredContent.code, 'validation_error');
  assert.match(rejected.structuredContent.message, /confirmedChanges.*budget/);
  assert.equal((await tool('get_clarification', {item:created.reference})).revision, 1);
  const updated = await tool('publish_graph_commit', {...publish,confirmedChanges:['budget']});
  assert.equal(updated.revision, 2);
  const conflict = await rpc('tools/call', {name:'publish_graph_commit',arguments:{...publish,confirmedChanges:['budget']}});
  assert.equal(conflict.structuredContent.code, 'revision_conflict');
  assert.equal(conflict.structuredContent.currentRevision, 2);
  read = await tool('get_clarification', {item:'ari@review-contract@budget'});
  assert.equal(read.node.kind, 'assumption');
  assert.equal(read.nodeReference.number, 2);
  assert.equal(read.commits[0].graph.nodes.find(node => node.id === 'budget').kind, 'decided');
  const reconfirm = structuredClone(read.currentGraph);
  reconfirm.nodes.find(node => node.id === 'budget').kind = 'decided';
  await tool('publish_graph_commit', {clarificationId:'review-contract',expectedRevision:2,graph:reconfirm,commit:{title:'Confirm the allowance',kind:'directAnswer'}});
  const correction = structuredClone(reconfirm);
  Object.assign(correction.nodes.find(node => node.id === 'budget'), {content:'€30',selectedAlternative:'€30'});
  for (const declarations of [[],['budget','budget'],['topic']]) {
    const invalid = await rpc('tools/call', {name:'publish_graph_commit',arguments:{clarificationId:'review-contract',expectedRevision:3,graph:correction,commit:{title:'Revise the allowance',kind:'revisedDecision'},confirmedChanges:declarations}});
    assert.equal(invalid.isError, true);
  }
  await tool('publish_graph_commit', {clarificationId:'review-contract',expectedRevision:3,graph:correction,commit:{title:'Revise the allowance',kind:'revisedDecision'},confirmedChanges:['budget']});
  await tool('publish_graph_commit', {clarificationId:'review-contract',expectedRevision:4,graph:{nodes:correction.nodes.filter(node => node.id !== 'budget'),edges:[]},commit:{title:'Drop the allowance',kind:'revisedDecision'},confirmedChanges:['budget']});
  const removed = await tool('get_clarification', {item:'ari@review-contract@2'});
  assert.equal(removed.node.id, 'budget');
  assert.equal(removed.nodeRevision, 4);
  // Parameter-shape errors are MCP errors; they never reach publication validation.
  for (const patch of [{workspaceId:'review-contract'}, {graph:{...graph,nodes:graph.nodes.map(node=>({...node,rationale:'hidden'}))}}, {commit:{title:'Hidden text',kind:'graphUpdated',summary:'Not visible'}}]) {
    const response = await fetch(`${base}/mcp`, {method:'POST',headers:{'content-type':'application/json',accept:'application/json, text/event-stream'},body:JSON.stringify({jsonrpc:'2.0',id:900,method:'tools/call',params:{name:'publish_graph_commit',arguments:{...publish,expectedRevision:5,...patch}}})});
    const text = await response.text();
    const message = JSON.parse(response.headers.get('content-type').includes('text/event-stream') ? text.split('\n').find(line=>line.startsWith('data:')).slice(5) : text);
    assert.ok(message.error || message.result?.isError, text);
  }
  assert.equal((await tool('get_clarification', {item:created.reference})).revision, 5);
  const instructions = await readFile(join(root,'agent-instructions.md'),'utf8');
  const examples = [...instructions.matchAll(/```json\n([\s\S]*?)\n```/g)].map(match=>JSON.parse(match[1])).filter(example=>example.commit);
  assert.equal(examples.length,2);
  await tool('create_clarification',examples[0]);
  await tool('publish_graph_commit',examples[1]);
  const documented = await tool('get_clarification',{item:examples[0].id});
  assert.equal(documented.revision,2);
  assert.equal(documented.currentGraph.nodes.find(node=>node.id==='venue').kind,'decided');
  assert.equal(documented.currentGraph.nodes.find(node=>node.id==='people').content,'Four teammates');
  await tool('create_clarification',{id:'late-topic',title:'Later topic',graph:{nodes:[],edges:[]},commit:{title:'Start the topic',kind:'topicStaged'}});
  await tool('publish_graph_commit',{clarificationId:'late-topic',expectedRevision:1,graph,commit:{title:'Add the topic',kind:'graphUpdated'}});
  const late = await tool('get_clarification',{item:'late-topic'});
  assert.equal(late.nodeIndex.find(entry=>entry.id==='topic').number,1);
});

test('clarification content stays blank until its data is ready', { timeout: 30_000 }, async t => {
  const {base,tool} = await fixture(t);
  await tool('create_clarification', {id:'ready-page',title:'Ready page',graph:exampleGraph(),commit:{title:'Start the discussion',kind:'topicStaged'}});
  const page = await browserFor(t);
  let release, blocked;
  const gate = new Promise(resolve=>release=resolve), started = new Promise(resolve=>blocked=resolve);
  await page.route('**/api/workspaces/ready-page', async route=>{blocked();await gate;await route.continue();});
  await page.goto(base+'/#/clarifications/ready-page',{waitUntil:'domcontentloaded'});
  await started;
  assert.equal(await page.locator('.app').count(), 0);
  release();
  await page.locator('.graph-workspace').waitFor();
  assert.equal(await page.getByRole('link',{name:'Back to clarity library'}).innerText(),'Ready page');
});

test('internal navigation preserves the displayed view and app shell until the destination is ready', { timeout: 30_000 }, async t => {
  const { base, tool } = await fixture(t);
  await tool('create_clarification', { id: 'navigation', title: 'Navigation example', graph: exampleGraph(), commit: { title: 'Stage the topic', kind: 'topicStaged' } });
  const page = await browserFor(t);
  await page.goto(base);
  await page.locator('.clarity-card').waitFor();
  await page.evaluate(() => { window.navigationShell = document.querySelector('.app'); });
  for (const destination of ['detail', 'overview']) {
    let release, started;
    const gate = new Promise(resolve => { release = resolve; });
    const blocked = new Promise(resolve => { started = resolve; });
    const endpoint = destination === 'detail' ? '**/api/workspaces/navigation' : '**/api/workspaces';
    await page.route(endpoint, async route => { started(); await gate; await route.continue(); });
    if (destination === 'detail') await page.locator('.clarity-card').click();
    else await page.getByRole('link', { name: 'Back to clarity library', exact: true }).click();
    await blocked;
    assert.equal(await page.evaluate(() => window.navigationShell === document.querySelector('.app')), true);
    assert.equal(await page.locator(destination === 'detail' ? '.library' : '.graph-workspace').isVisible(), true);
    release();
    await page.locator(destination === 'detail' ? '.graph-workspace' : '.library').waitFor();
    assert.equal(await page.evaluate(() => window.navigationShell === document.querySelector('.app')), true);
    await page.unroute(endpoint);
  }
});

test('number shortcuts focus node neighborhoods without opening details and copy stable references', { timeout: 30_000 }, async t => {
  const {page,tool,sample} = await shortcutFixture(t);
  await page.context().grantPermissions(['clipboard-read','clipboard-write']);
  const record = await tool('get_clarification',{item:sample.id});
  const one = record.nodeIndex.find(entry=>entry.number===1), ten = record.nodeIndex.find(entry=>entry.number===10);
  assert.equal(one.id,'topic');
  assert.equal(await page.locator('.node-frame').filter({has:page.locator('[data-node-id="topic"]')}).locator('.node-number').textContent(),'#1');
  const before = await graphCamera(page);
  await page.keyboard.press('1');
  await page.waitForTimeout(300);
  assert.deepEqual(await graphCamera(page),before,'Ambiguous node 1 waits for a second digit');
  await page.keyboard.press('0');
  await page.locator(`[data-node-id="${ten.id}"].targeted`).waitFor();
  assert.equal(await page.locator('.node-inspector').count(),0);
  const neighborhood = [ten.id,...sample.commits.at(-1).graph.edges.filter(edge=>edge.kind==='parent'&&(edge.from===ten.id||edge.to===ten.id)).flatMap(edge=>[edge.from,edge.to])];
  const inside = await page.evaluate(ids=>{
    const viewport=document.querySelector('.graph-viewport').getBoundingClientRect();
    return [...new Set(ids)].every(id=>{const box=document.querySelector(`[data-node-id="${id}"]`).getBoundingClientRect();return box.left>=viewport.left+47&&box.right<=viewport.right-47&&box.top>=viewport.top+47&&box.bottom<=viewport.bottom-47;});
  },neighborhood);
  assert.equal(inside,true);
  await page.getByRole('button',{name:'Copy reference to node 10',exact:true}).click();
  assert.equal(await page.evaluate(()=>navigator.clipboard.readText()),ten.reference);
  await page.getByText(`Copied ${ten.reference}`,{exact:true}).waitFor();
  assert.equal((await tool('get_clarification',{item:ten.reference})).node.id,ten.id);
  await page.keyboard.press('1');
  await page.waitForTimeout(300);
  assert.equal(await page.locator('.graph-node.targeted').getAttribute('data-node-id'),ten.id);
  await page.locator('[data-node-id="topic"].targeted').waitFor();
  assert.equal(await page.locator('.node-inspector').count(),0);
  await page.getByRole('button',{name:'Fit graph',exact:true}).click();
  const frame=page.locator('.node-frame').filter({has:page.locator('[data-node-id="people"]')});
  const spacing=await frame.evaluate(frame=>{
    const card=frame.querySelector('.graph-node'), title=card.querySelector('strong'), status=card.querySelector('.node-status'), number=frame.querySelector('.node-number');
    const rect=card.getBoundingClientRect(), t=title.getBoundingClientRect(), s=status.getBoundingClientRect(), n=number.getBoundingClientRect();
    const scale=new DOMMatrix(getComputedStyle(document.querySelector('.graph-scene')).transform).a;
    return {top:(t.top-rect.top)/scale,left:(t.left-rect.left)/scale,footer:Math.abs(s.top+s.height/2-n.top-n.height/2)/scale};
  });
  assert.ok(Math.abs(spacing.top-spacing.left)<1 && spacing.top>=10 && spacing.top<=12,'Title padding is uniformly 10px inside the border');
  assert.ok(spacing.footer<1,`Status and node number share a center line: ${JSON.stringify(spacing)}`);
  await page.screenshot({path:'/tmp/ari-numbered-nodes.png'});
});

test('tracking follows live revisions at Latest and keeps its session preference across reloads', { timeout: 30_000 }, async t => {
  const { page, sample, tool } = await shortcutFixture(t);
  const tracking = () => page.getByRole('checkbox', { name: 'Track new revisions' });
  assert.equal(await tracking().isChecked(), true);
  const graph = structuredClone(sample.commits.at(-1).graph);
  const target = graph.nodes.find(node => node.kind === 'decided');
  let revision = sample.commits.length;
  async function publish() {
    target.content += ' updated';
    await tool('publish_graph_commit', { clarificationId: sample.id, expectedRevision: revision++, graph, confirmedChanges: [target.id], commit: { title: `Live revision ${revision}`, kind: 'directAnswer' } });
    await page.waitForFunction(count => document.querySelectorAll('.commit-entry').length === count, revision);
  }
  await page.keyboard.press('-');
  const before = await graphCamera(page);
  await publish();
  await page.waitForFunction(id => {
    const node = document.querySelector(`[data-node-id="${id}"]`).getBoundingClientRect();
    const viewport = document.querySelector('.graph-viewport').getBoundingClientRect();
    return Math.hypot((node.left + node.right - viewport.left - viewport.right) / 2, (node.top + node.bottom - viewport.top - viewport.bottom) / 2) < 1;
  }, target.id);
  assert.notDeepEqual(await graphCamera(page), before, 'Tracking frames the changed node even in Current view');
  await tracking().uncheck();
  await page.reload();
  await tracking().waitFor();
  assert.equal(await tracking().isChecked(), false);
  await page.keyboard.press('-');
  const fixed = await graphCamera(page);
  await publish();
  assert.deepEqual(await graphCamera(page), fixed, 'Disabled tracking preserves the camera');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'Graph options and color key' }).click();
  assert.equal(await page.getByRole('checkbox', { name: 'Track new revisions' }).isChecked(), false);
  await page.getByRole('checkbox', { name: 'Track new revisions' }).check();
  await page.keyboard.press('Escape');
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.keyboard.press('Home');
  const historical = await graphCamera(page);
  await publish();
  assert.equal(await page.locator('.commit-entry').first().getAttribute('aria-current'), 'step');
  assert.deepEqual(await graphCamera(page), historical, 'Tracking preserves historical browsing');
});

test('fullscreen animates the chrome away and restores the canvas controls without resetting the camera', { timeout: 30_000 }, async t => {
  const { page } = await shortcutFixture(t);
  for (const width of [1600, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    const camera = await graphCamera(page);
    const initial = await page.locator('.graph-viewport').boundingBox();
    await page.keyboard.press('f');
    await page.waitForTimeout(100);
    const intermediate = await page.locator('.graph-viewport').boundingBox();
    await page.waitForTimeout(300);
    const final = await page.locator('.graph-viewport').boundingBox();
    assert.ok(intermediate.height > initial.height && intermediate.height < final.height, 'Chrome slides out over time');
    assert.ok(Math.abs(final.y) < 1 && Math.abs(final.x) < 1 && Math.abs(final.width - width) < 1 && Math.abs(final.height - 1000) < 1, JSON.stringify(final));
    assert.deepEqual(await graphCamera(page), camera);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(350);
    assert.ok(page.url().includes('/clarifications/'));
    assert.deepEqual(await page.locator('.graph-viewport').boundingBox(), initial);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.keyboard.press('f');
    assert.ok(Math.abs((await page.locator('.graph-viewport').boundingBox()).y) < 1);
    await page.keyboard.press('f');
    assert.deepEqual(await graphCamera(page), camera);
  }
});

test('revision animation starts gently and retargets from the displayed camera and node positions', { timeout: 30_000 }, async t => {
  const { page } = await shortcutFixture(t);
  await page.keyboard.press('Home');
  await page.keyboard.press('j');
  await page.clock.install();
  await page.clock.pauseAt(new Date(Date.now() + 1000));
  await page.clock.runFor(1000);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  const snapshot = () => page.evaluate(() => {
    const camera = new DOMMatrix(getComputedStyle(document.querySelector('.graph-scene')).transform);
    return { camera: [camera.a, camera.e, camera.f], nodes: Object.fromEntries([...document.querySelectorAll('.node-frame')].map(el => {
      const matrix = new DOMMatrix(getComputedStyle(el).transform);
      return [el.querySelector('.graph-node').dataset.nodeId, [matrix.e, matrix.f]];
    })) };
  });
  const press = key => page.evaluate(key => document.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true })), key);
  const distance = (a, b) => Math.hypot(...a.map((value, index) => value - b[index]));
  const start = await snapshot();
  await press('j');
  await page.clock.runFor(48);
  const early = await snapshot();
  await page.clock.runFor(700);
  const end = await snapshot();
  const travel = distance(start.camera, end.camera);
  assert.ok(travel > 10, 'The test includes substantial camera travel');
  assert.ok(distance(start.camera, early.camera) / travel < .04, 'The camera accelerates gently over the first frames');
  await press('j');
  await page.clock.runFor(48);
  const nodeEarly = await snapshot();
  await page.clock.runFor(700);
  const nodeEnd = await snapshot();
  const moved = Object.keys(end.nodes).filter(id => nodeEnd.nodes[id] && distance(end.nodes[id], nodeEnd.nodes[id]) > 10);
  assert.ok(moved.length > 0, 'The test includes moving graph nodes');
  for (const id of moved) assert.ok(distance(end.nodes[id], nodeEarly.nodes[id]) / distance(end.nodes[id], nodeEnd.nodes[id]) < .04, `${id} accelerates gently over the first frames`);
  for (const key of ['k', 'j', 'k']) {
    await press(key);
    await page.clock.runFor(112);
    const displayed = await snapshot();
    await press(key === 'k' ? 'j' : 'k');
    const retargeted = await snapshot();
    assert.ok(distance(retargeted.camera, displayed.camera) < .001, 'Retargeting preserves the displayed camera');
    for (const id of Object.keys(displayed.nodes)) if (retargeted.nodes[id]) assert.ok(distance(retargeted.nodes[id], displayed.nodes[id]) < .001, `Retargeting preserves the displayed position of ${id}`);
    await page.clock.runFor(700);
  }
});


test('layout shortcuts animate the camera and preserve an interrupted view transition', { timeout: 30_000 }, async t => {
  const { page } = await shortcutFixture(t);
  await page.clock.install();
  await page.clock.pauseAt(new Date(Date.now() + 1000));
  await page.clock.runFor(1000);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  const press = key => page.evaluate(key => document.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true })), key);
  for (const key of [']', ']', '[', '[']) {
    const before = await graphCamera(page);
    await press(key);
    assert.deepEqual(await graphCamera(page), before, 'Switching layouts preserves the starting camera');
    await page.clock.runFor(250);
    const during = await graphCamera(page);
    await page.clock.runFor(278);
    const after = await graphCamera(page);
    assert.notDeepEqual(during, before, 'The camera moves during the layout transition');
    assert.notDeepEqual(during, after, 'The camera continues toward its destination');
    const travel = Math.hypot(after.x - before.x, after.y - before.y, (after.scale - before.scale) * 100);
    const halfway = Math.hypot(during.x - before.x, during.y - before.y, (during.scale - before.scale) * 100) / travel;
    assert.ok(halfway > .44 && halfway < .56, 'The camera is halfway through its 500ms transition at 250ms');
    await page.clock.runFor(200);
    assert.deepEqual(await graphCamera(page), after, 'The layout camera completes its transition within 500ms plus one frame');
  }
  await press(']');
  await page.clock.runFor(128);
  const interrupted = await graphCamera(page);
  await press(']');
  assert.deepEqual(await graphCamera(page), interrupted, 'Rapid layout switches start from the displayed camera');
  await page.clock.runFor(700);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await press('[');
  const reduced = await graphCamera(page);
  await page.clock.runFor(700);
  assert.deepEqual(await graphCamera(page), reduced, 'Reduced motion fits the new layout immediately');
});


test('MCP group labels round-trip and gather existing nodes under a canonical heading', { timeout: 30_000 }, async t => {
  const { base, tool, rpc } = await fixture(t);
  const graph = { nodes: [
    { id: 'topic', title: 'Lunch', kind: 'topic', content: 'Plan a lunch' },
    { id: 'collector', title: 'Who collects the food?', kind: 'decided', content: 'Alex' },
    { id: 'transport', title: 'How do we travel?', kind: 'decided', content: 'Walk' }
  ], edges: [
    { id: 'parent-collector', kind: 'parent', from: 'topic', to: 'collector' },
    { id: 'parent-transport', kind: 'parent', from: 'topic', to: 'transport' }
  ] };
  await tool('create_clarification', { id: 'group-label-demo', title: 'Scripted group label demo', graph, commit: { title: 'Plan lunch', kind: 'topicStaged' } });
  const schema = (await rpc('tools/list', {})).tools.find(tool => tool.name === 'publish_graph_commit').inputSchema;
  assert.equal(schema.$defs.GroupLabel.pattern, '^[a-z][a-z0-9]*(?:-[a-z0-9]+){0,5}$');
  assert.equal(schema.$defs.GroupLabel.maxLength, 64);
  const page = await browserFor(t);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(base + '/#/clarifications/group-label-demo');
  await page.getByRole('button', { name: 'Grouped', exact: true }).click();
  assert.equal(await page.locator('[data-island-id]').count(), 0);
  for (const node of graph.nodes.slice(1)) node.groupLabel = 'nicely-inside-the-panel';
  await tool('publish_graph_commit', { clarificationId: 'group-label-demo', expectedRevision: 1, graph, commit: { title: 'Group collection details', kind: 'graphUpdated' } });
  await page.locator('.island-title', { hasText: 'Nicely inside the panel' }).waitFor();
  assert.equal(await page.locator('.island-title').textContent(), 'Nicely inside the panel');
  assert.ok(Number(await page.locator('.island-region').getAttribute('width')) < 600, 'Existing members reflow into one compact group');
  const saved = await tool('get_clarification', { item: 'group-label-demo' });
  assert.deepEqual(saved.currentGraph.nodes.slice(1).map(node => node.groupLabel), ['nicely-inside-the-panel', 'nicely-inside-the-panel']);
  const svg = await (await page.request.get(base + '/api/workspaces/group-label-demo/export?layout=islands')).text();
  assert.ok(svg.includes('Nicely inside the panel'));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'Graph options and color key' }).click();
  const alignment = await page.locator('.graph-filters label').evaluateAll(labels => labels.map(label => {
    const input = label.querySelector('input').getBoundingClientRect(), text = label.querySelector('span').getBoundingClientRect();
    return { gap: text.left - input.right, centerError: Math.abs((input.top + input.bottom - text.top - text.bottom) / 2) };
  }));
  for (const row of alignment) assert.ok(row.gap === 8 && row.centerError < .5);
});


test('clarification-wide links persist through MCP publications and use a compact favicon popover', { timeout: 30_000 }, async t => {
  const { base, tool } = await fixture(t);
  const links = [
    { label: '<img src=x onerror=alert(1)>', url: 'https://esi.example/designs/checkout/index.html' },
    { label: 'System explanation', url: 'https://lain.example/?explanation=checkout' }
  ];
  const graph = exampleGraph();
  await tool('create_clarification', { id:'related-links',title:'Related artifact links',graph,links,commit:{title:'Stage the topic',kind:'topicStaged'} });
  assert.deepEqual((await tool('get_clarification',{item:'related-links'})).links,links);
  await tool('publish_graph_commit',{clarificationId:'related-links',expectedRevision:1,graph,commit:{title:'Preserve related work',kind:'graphUpdated'}});
  assert.deepEqual((await tool('get_clarification',{item:'related-links'})).links,links);
  const page = await browserFor(t);
  await page.context().route(url => ['esi.example', 'lain.example'].includes(url.hostname), route => route.fulfill(route.request().isNavigationRequest() ? {contentType:'text/html',body:'<h1>Related artifact</h1>'} : {contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><rect width="16" height="16" fill="gold"/></svg>'}));
  await page.goto(base+'/#/clarifications/related-links');
  const trigger=page.getByRole('button',{name:'Related links',exact:true});
  await trigger.waitFor();
  assert.equal(await trigger.textContent(),'Links · 2');
  const gap=await page.evaluate(()=>document.querySelector('.connection').getBoundingClientRect().left-document.querySelector('.related-links-trigger').getBoundingClientRect().right);
  assert.equal(gap,12);
  await trigger.click();
  const popup=page.getByRole('dialog',{name:'Related links',exact:true});await popup.waitFor();
  assert.deepEqual(await popup.locator('a').evaluateAll(items=>items.map(a=>[a.href,a.target,a.rel])),links.map(link=>[link.url,'','noopener noreferrer']));
  assert.equal(await popup.locator('.reference-text>span').first().textContent(),links[0].label);
  assert.equal(await popup.locator('.reference-text img').count(),0);
  await popup.locator('.reference-favicon img').first().waitFor();
  assert.equal(await popup.evaluate(el=>getComputedStyle(el).padding),'4px');
  assert.equal(await popup.locator('a').first().evaluate(el=>getComputedStyle(el).padding),'8px');
  await page.keyboard.press('Escape');await popup.waitFor({state:'hidden'});
  const revision = await page.locator('.commit-entry[aria-current="step"]').textContent();
  await page.keyboard.press('u');await popup.waitFor();
  assert.equal(await popup.locator('a').first().evaluate(el=>el===document.activeElement),true);
  for(const [key,index] of [['j',1],['k',0],['ArrowDown',1],['ArrowUp',0]]){
    await page.keyboard.press(key);
    assert.equal(await popup.locator('a').nth(index).evaluate(el=>el===document.activeElement),true);
  }
  assert.equal(await page.locator('.commit-entry[aria-current="step"]').textContent(),revision);
  const focusStyle=await popup.locator('a').first().evaluate(el=>({outline:getComputedStyle(el).outlineStyle,background:getComputedStyle(el).backgroundColor,decoration:getComputedStyle(el).textDecorationLine}));
  assert.deepEqual(focusStyle,{outline:'none',background:'rgb(42, 45, 48)',decoration:'none'});
  const newTab=page.context().waitForEvent('page');
  await page.keyboard.press('Control+Enter');
  const opened=await newTab;await opened.waitForLoadState('domcontentloaded');
  assert.equal(opened.url(),links[0].url);await opened.close();
  await popup.waitFor({state:'hidden'});
  assert.equal(await trigger.evaluate(el=>getComputedStyle(el).outlineStyle),'none');
  assert.ok(page.url().includes('/clarifications/related-links'));
  for(const width of [390,825,1100]){
    await page.setViewportSize({width,height:844});
    assert.equal(await page.getByRole('button',{name:'Keyboard shortcuts',exact:true}).isVisible(),false);
    assert.equal(await trigger.locator('span').isVisible(),false);
    assert.equal((await trigger.boundingBox()).width,32);
    const arrow=await page.locator('.clarification-back svg').boundingBox();assert.equal(arrow.x,8);assert.equal(arrow.width,20);
  }
  await trigger.click();await popup.waitFor();await page.keyboard.press('Control+[');await popup.waitFor({state:'hidden'});
  assert.ok(page.url().includes('/clarifications/'));
  await page.keyboard.press('u');await popup.waitFor();await page.keyboard.press('j');
  await page.keyboard.press('Enter');await page.waitForURL(links[1].url);
  await page.goto(base+'/#/clarifications/related-links');await trigger.waitFor();
  await tool('publish_graph_commit',{clarificationId:'related-links',expectedRevision:2,graph,links:[],commit:{title:'Clear related links',kind:'graphUpdated'}});
  await trigger.waitFor({state:'hidden'});
  assert.deepEqual((await tool('get_clarification',{item:'related-links'})).links,[]);
});

test('library card deletion matches the shared control and supports confirmation, undo, and expiry', { timeout: 30_000 }, async t => {
  const { base, api, tool } = await fixture(t);
  await tool('get_context');
  await tool('create_clarification', { id: 'delete-one', title: 'Disposable plan', graph: exampleGraph(), commit: { title: 'Stage plan', kind: 'topicStaged' } });
  const saved = await api('/workspaces/delete-one');
  const page = await browserFor(t);
  await page.goto(base);
  const remove = page.getByRole('button', { name: 'Delete Disposable plan', exact: true });
  await remove.waitFor();
  assert.deepEqual(await remove.evaluate(button => {
    const style = getComputedStyle(button), icon = button.querySelector('.pi-trash');
    const bounds = button.getBoundingClientRect(), card = button.parentElement.getBoundingClientRect();
    return { top: bounds.top - card.top, right: card.right - bounds.right, width: bounds.width, height: bounds.height,
      radius: style.borderRadius, background: style.backgroundColor, icon: !!icon };
  }), { top: 10, right: 10, width: 32, height: 32, radius: '6px', background: 'rgb(42, 45, 48)', icon: true });
  await remove.click();
  const dialog = page.getByRole('dialog', { name: 'Delete clarification?', exact: true });
  await dialog.waitFor();
  assert.deepEqual(await dialog.evaluate(element => {
    const padding = ['.p-dialog-header', '.p-dialog-content', '.p-dialog-footer'].map(selector => getComputedStyle(element.querySelector(selector)).padding);
    return { padding, gap: getComputedStyle(element.querySelector('.p-dialog-footer')).gap };
  }), { padding: ['20px', '20px', '20px'], gap: '10px' });
  assert.match(await dialog.innerText(), /all its revision history/);
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.waitForFunction(() => !document.querySelector('[role="dialog"]'));
  assert.equal((await api('/workspaces')).length, 1);
  await page.keyboard.press('x');
  await dialog.waitFor();
  const confirm = dialog.getByRole('button', { name: 'Delete clarification', exact: true });
  await confirm.focus();
  await page.keyboard.press('Tab');
  await page.keyboard.press('Shift+Tab');
  await page.waitForFunction(() => getComputedStyle(document.activeElement).backgroundColor === 'rgb(255, 155, 172)');
  await confirm.click();
  await page.waitForFunction(() => !document.querySelector('.clarity-card'));
  assert.equal((await api('/workspaces')).length, 0);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await remove.waitFor();
  assert.deepEqual(await api('/workspaces/delete-one'), saved);
  await page.setViewportSize({ width: 390, height: 844 });
  await remove.click();
  await dialog.waitFor();
  assert.ok((await dialog.boundingBox()).width <= 358);
  await page.keyboard.press('Control+[');
  await dialog.waitFor({ state: 'detached' });
  await remove.click();
  await dialog.getByRole('button', { name: 'Delete clarification', exact: true }).click();
  await page.getByRole('button', { name: 'Undo', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Undo', exact: true }).waitFor({ state: 'detached', timeout: 11_000 });
  await page.reload();
  await page.getByRole('heading', { name: 'A place for the next decision' }).waitFor();
});

test('delete all includes hidden cards and stale deletion refreshes before another attempt', { timeout: 30_000 }, async t => {
  const { base, api, tool } = await fixture(t);
  await tool('get_context');
  for (const id of ['visible', 'hidden']) {
    await tool('create_clarification', { id, title: `${id} plan`, graph: exampleGraph(), commit: { title: 'Stage plan', kind: 'topicStaged' } });
  }
  const page = await browserFor(t);
  await page.goto(base);
  const search = page.getByRole('searchbox', { name: 'Search clarifications' });
  await search.fill('visible');
  await page.getByRole('button', { name: 'Delete visible plan', exact: true }).click();
  const saved = await tool('get_clarification', { item: 'visible' });
  await tool('publish_graph_commit', { clarificationId: 'visible', expectedRevision: saved.revision, graph: saved.currentGraph, commit: { title: 'Review plan', kind: 'graphUpdated' } });
  await page.getByRole('dialog').getByRole('button', { name: 'Delete clarification', exact: true }).click();
  await page.getByRole('dialog').getByRole('alert').waitFor();
  assert.equal((await api('/workspaces')).length, 2);
  await page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).click();
  await page.getByRole('button', { name: 'Delete all', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Delete all clarifications?', exact: true });
  assert.match(await dialog.innerText(), /including clarifications hidden by search/);
  await dialog.getByRole('button', { name: 'Delete all clarifications', exact: true }).click();
  await page.getByRole('button', { name: 'Undo', exact: true }).waitFor();
  assert.deepEqual(await api('/workspaces'), []);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await page.getByRole('button', { name: 'Delete visible plan', exact: true }).waitFor();
  await search.fill('');
  await page.getByRole('button', { name: 'Delete hidden plan', exact: true }).waitFor();
  assert.equal((await api('/workspaces')).length, 2);
});

test('mobile library scrolls its intro and keeps opaque search and deletion controls above cards', { timeout: 60_000 }, async t => {
  const { base, tool } = await fixture(t);
  for (let i = 0; i < 7; i++) await tool('create_clarification', {
    id: `mobile-library-${i}`, title: `Mobile clarification ${i}`,
    graph: exampleGraph(), commit: { title: 'Stage the topic', kind: 'topicStaged' },
  });
  const page = await browserFor(t);
  for (const width of [320, 390, 700]) {
    await page.setViewportSize({ width, height: 844 });
    await page.goto(base);
    await page.waitForFunction(() => document.querySelectorAll('.clarity-card').length === 7);
    assert.equal(await page.locator('.library-toolbar').evaluate(el => getComputedStyle(el).boxShadow), 'none');
    assert.equal(await page.locator('.library-scroll').evaluate(el => el.scrollTop), 0);
    const introTop = (await page.locator('.page-intro').boundingBox()).y;
    await page.locator('.library-scroll').evaluate(el => el.scrollTop = 500);
    await page.waitForFunction(() => document.querySelector('.library-scroll').scrollTop >= 500);

    await page.waitForFunction(() => getComputedStyle(document.querySelector('.library-toolbar')).boxShadow !== 'none');
    const geometry = await page.locator('.library-toolbar').evaluate(strip => {
      const rect = strip.getBoundingClientRect();
      const style = getComputedStyle(strip);
      return { top: rect.top, left: rect.left, right: rect.right, background: style.backgroundColor,
        scrollbarAboveStrip: !!document.elementFromPoint(innerWidth - 6, rect.top + rect.height / 2)?.closest('.overlay-scrollbar'),
        covered: [1, innerWidth / 2, innerWidth - 1].every(x =>
          [rect.top + 1, rect.bottom - 1].every(y => strip.contains(document.elementFromPoint(x, y)))) };
    });
    assert.equal(geometry.left, 0);
    assert.equal(geometry.right, width);
    assert.ok(!geometry.background.endsWith(', 0)') && !geometry.background.startsWith('rgba('), geometry.background);
    assert.equal(geometry.covered, true, 'The strip covers the full width, including padding and gaps');
    assert.equal(geometry.scrollbarAboveStrip, true, 'The scrollbar stays visible and interactive over the sticky strip');

    assert.equal(geometry.top, 66);
    assert.ok((await page.locator('.page-intro').boundingBox()).y < introTop - 100);
    await page.getByRole('searchbox').fill('Mobile clarification 3');
    assert.equal(await page.locator('.clarity-card').count(), 1);
    await page.keyboard.press('Enter');
    assert.equal(await page.locator('.clarity-card:focus').count(), 1);
  }
});
