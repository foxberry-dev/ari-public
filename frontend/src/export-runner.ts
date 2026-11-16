import { readFileSync } from 'node:fs';
import { graphImage, type ExportPlan } from './graph-export';

const plan: ExportPlan = JSON.parse(readFileSync(0, 'utf8'));
const image = graphImage(plan);
if (plan.options.format === 'svg') process.stdout.write(image.svg);
else {
  const { chromium } = await import('playwright');
  const browser = await chromium.launch({ headless: true, executablePath: process.env.ARI_CHROME_PATH || undefined });
  try {
    const context = await browser.newContext({ viewport: { width: image.width, height: image.height }, serviceWorkers: 'block' });
    await context.route('**/*', route => route.abort());
    const page = await context.newPage();
    await page.setContent(`<html><head><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:"><style>html,body{margin:0;padding:0;background:#101113}svg{display:block}@page{margin:0}</style></head><body>${image.svg}</body></html>`);
    await page.evaluate(() => document.fonts.ready);
    process.stdout.write(plan.options.format === 'png' ? await page.screenshot({ type: 'png' }) : await page.pdf({ width: `${image.width}px`, height: `${image.height}px`, printBackground: true, margin: { top: 0, bottom: 0, left: 0, right: 0 } }));
  } finally { await browser.close(); }
}
