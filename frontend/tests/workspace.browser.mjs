import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { access, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { exampleQuestions } from '../src/example.ts';

const root = fileURLToPath(new URL('../../', import.meta.url));

async function fixture(t) {
  const home = await mkdtemp(join(tmpdir(), 'ari-browser-'));
  const server = spawn(join(root, 'target/debug/ari'), ['--home', home, '--port', '0'], { stdio: ['ignore', 'ignore', 'pipe'] });
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
  async function rpc(method, params) {
    const response = await fetch(`${base}/mcp`, {
      method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
      body: JSON.stringify({ jsonrpc: '2.0', id: ++rpcId, method, params }),
    });
    assert.equal(response.status, 200, await response.clone().text());
    const text = await response.text();
    const value = response.headers.get('content-type').includes('text/event-stream')
      ? JSON.parse(text.split('\n').find(line => line.startsWith('data:')).slice(5)) : JSON.parse(text);
    assert.equal(value.error, undefined, JSON.stringify(value.error));
    return value.result;
  }
  await rpc('initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'ari-test', version: '1' } });
  async function tool(name, args = {}) {
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

test('UI answers reach a background listener and MCP replies require human approval', { timeout: 60_000 }, async t => {
  const { base, api, tool } = await fixture(t);
  const page = await browserFor(t);
  const id = 'repair-cafe';
  await tool('create_clarification', { id, title: 'Plan a neighborhood repair café',
    description: 'Explore the budget, room, activities, admission, volunteers, and insurance.', questions: exampleQuestions });
  await page.goto(base);
  await page.locator('.clarity-card').click();
  await page.locator('.graph-node').first().waitFor();
  const context = await tool('get_context');
  assert.equal(context.clarifications[0].id, id);
  assert.equal(context.clarifications[0].questions, undefined);
  for (const item of [id, 'Plan a neighborhood repair café', '1']) {
    assert.equal((await tool('get_clarification', { item })).id, id);
  }
  const created = await api('/poll', { workspaceId: id, waitSeconds: 0 });
  let w = await api(`/workspaces/${id}`);
  await tool('reply_event', { eventId: created.event.id, token: created.token, expectedRevision: w.revision,
    message: 'The starting questions are ready. Choose an admission policy.', questions: [] });
  await page.getByRole('button', { name: 'Review reply', exact: true }).click();
  await page.getByRole('button', { name: 'Mark read', exact: true }).click();

  const listener = spawn(process.execPath, [join(root, 'scripts/listen.mjs'), '--url', base, '--workspace', id], { stdio: ['ignore', 'pipe', 'pipe'] });
  t.after(() => { if (listener.exitCode === null) listener.kill(); });
  const claimed = new Promise((resolve, reject) => {
    let output = '', error = '';
    listener.stdout.on('data', chunk => output += chunk);
    listener.stderr.on('data', chunk => error += chunk);
    listener.once('error', reject);
    listener.once('exit', code => {
      if (code !== 0) return reject(new Error(`Listener exited ${code}: ${error}`));
      try { resolve(JSON.parse(output)); } catch (cause) { reject(cause); }
    });
  });
  await page.locator('.tree-item').filter({ hasText: 'Admission' }).click();
  await page.locator('.option').filter({ hasText: 'Hybrid' }).click();
  await page.locator('#answer-reason').fill('Keep room for neighbors who cannot book.');
  await page.getByRole('button', { name: 'Choose answer', exact: true }).click();
  await page.getByRole('button', { name: 'Save answer', exact: true }).click();
  const claim = await claimed;
  assert.equal(claim.event.kind, 'answer');
  assert.equal(claim.event.questionId, 'A4');
  assert.equal(claim.event.snapshot.answers.A4.value, 'Hybrid');
  assert.equal(claim.event.snapshot.answers.A4.reason, 'Keep room for neighbors who cannot book.');
  w = await tool('get_clarification', { item: id });
  await tool('reply_event', { eventId: claim.event.id, token: claim.token, expectedRevision: w.revision,
    message: 'Hybrid admission needs an explicit arrival plan.', questions: [{ id: 'Q7', title: 'Arrival plan',
      question: 'Who handles booked and walk-in arrivals?', rationale: 'Keep both arrival routes visible.', dependsOn: ['A4'] }] });
  assert.equal((await api(`/workspaces/${id}`)).questions.length, 6);
  await page.getByRole('button', { name: 'Review reply', exact: true }).click();
  await page.getByRole('button', { name: 'Accept proposal', exact: true }).click();
  await page.locator('.graph-node').filter({ hasText: 'Arrival plan' }).waitFor();
  w = await api(`/workspaces/${id}`);
  assert.equal(w.questions.length, 7);
  assert.equal(w.answers.A4.value, 'Hybrid');
  assert.deepEqual(w.needsReview, ['S5']);

  await page.getByRole('button', { name: 'History', exact: true }).click();
  await page.getByRole('dialog').getByText('Keep room for neighbors who cannot book.', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Close', exact: true }).last().click();
  await page.getByRole('button', { name: 'Ari clarity library' }).click();
  await page.getByRole('searchbox', { name: 'Search clarifications' }).fill('unmatched-title');
  await page.getByRole('heading', { name: 'No matching clarifications' }).waitFor();
  await page.getByRole('searchbox', { name: 'Search clarifications' }).fill('');
  await page.locator('.clarity-card').click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('#question-picker').selectOption('A4');
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
});

test('MCP publications appear in the shared library frame with a matching berry favicon', { timeout: 60_000 }, async t => {
  const { base, tool } = await fixture(t);
  const page = await browserFor(t);
  await page.setViewportSize({ width: 1920, height: 1095 });
  await page.goto(base);
  await page.getByText('Ask your agent to publish a clarification through Ari’s MCP tools.').waitFor();

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
      questions: exampleQuestions });
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
  assert.equal(layout.searchInput.height, 20);
  assert.ok(Math.abs(layout.searchKey.width - 20.8) < .1, `Search keycap width is ${layout.searchKey.width}`);
  assert.equal(layout.searchKey.height, 20);
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
      description: `Description ${i}. Find the decisions and keep the reasoning.`, questions: exampleQuestions });
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
  assert.equal((await page.locator('.page-intro .eyebrow').boundingBox()).y, 94, 'The toolbar stays pinned while cards scroll');
  await page.keyboard.press('Enter');
  await page.locator('.graph-node').first().waitFor();
  assert.ok(page.url().endsWith(ids[6]));
  await page.getByRole('button', { name: 'Ari clarity library' }).click();
  await focus(6);
  assert.equal(await search.inputValue(), 'Clarification');
  assert.equal(await page.locator('.library-scroll').evaluate(el => el.scrollTop), scroll);
});
