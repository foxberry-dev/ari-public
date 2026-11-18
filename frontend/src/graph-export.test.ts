import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { graphImage, type ExportPlan } from './graph-export';

const fixture = JSON.parse(readFileSync(new URL('../../fixtures/team-lunch-graph.json', import.meta.url), 'utf8'));
function plan(): ExportPlan {
  return { title: 'Team lunch', current: structuredClone(fixture.commits.at(-1).graph), previous: structuredClone(fixture.commits.at(-2).graph), options: { layout: 'rings', display: 'current', inputs: true, constraints: true, format: 'svg' } };
}
describe('graph export serialization', () => {
  it('escapes authored text and replaces invalid XML characters', () => {
    const input = plan();
    input.title = '<script>danger & test</script>\u0000\uFFFE\uFFFF';
    input.current.nodes[0]!.content = '<img onerror=alert(1)> & data';
    const { svg } = graphImage(input);
    expect(svg).toContain('&lt;script&gt;danger &amp; test&lt;/script&gt;���');
    expect(svg).toContain('&lt;img onerror=alert(1)&gt; &amp; data');
    expect(svg).not.toContain('<script>');
    expect(svg).not.toContain('\u0000');
  });
  it('exports every line of node titles and answers', () => {
    const input = plan();
    input.current.nodes[0]!.title = ['Heading one', 'Heading two', 'Heading three', 'Heading four'].join('\n');
    input.current.nodes[0]!.content = Array.from({ length: 12 }, (_, i) => `Answer line ${i + 1}`).join('\n');
    const { svg } = graphImage(input);
    expect(svg).toContain('>Heading four</text>');
    expect(svg).toContain('>Answer line 12</text>');
  });
  it('exports only enabled relationship types while retaining node content', () => {
    const input = plan();
    input.options.inputs = false; input.options.constraints = false;
    const { svg } = graphImage(input);
    expect(svg).not.toContain('marker-end="url(#arrow)"');
    expect(svg).not.toContain('stroke-dasharray="1 6"');
    expect(svg).toContain('Twelve attendees');
  });
  it('uses distinct colors for provisional nodes and each answer transition', () => {
    const input = plan();
    const node = (id: string, kind: 'topic' | 'assumption' | 'decided', content = id) => ({ id, title: id, kind, content, rationale: '', alternatives: [], dependsOn: [] });
    const previous = [node('topic', 'topic'), node('assumed', 'assumption'), node('answered', 'assumption'), node('changed', 'decided', 'Earlier answer'), node('removed', 'decided')];
    const current = [node('topic', 'topic'), node('assumed', 'assumption'), node('added', 'decided'), node('provisional', 'assumption'), node('answered', 'decided'), node('changed', 'decided', 'New answer')];
    const edges = (nodes: typeof current) => nodes.slice(1).map(n => ({ id: `parent-${n.id}`, kind: 'parent' as const, from: 'topic', to: n.id }));
    input.previous = { nodes: previous, edges: edges(previous) };
    input.current = { nodes: current, edges: edges(current) };
    input.options.display = 'changed';
    const { svg } = graphImage(input);
    for (const [id, color] of Object.entries({ added: '#65d6ad', provisional: '#a99ac2', answered: '#86b5cc', changed: '#ed9e52', removed: '#ff9bac', assumed: '#8e7bb7' })) {
      const group = svg.split('<g transform=').find(group => group.includes(`>${id}</text>`));
      expect(group?.match(/<rect[^>]+stroke="([^"]+)"/)?.[1]).toBe(color);
    }
  });
  it('exports human-readable group-label headings', () => {
    const input = plan();
    input.options.layout = 'islands';
    for (const node of input.current.nodes.filter(node => node.groupLabel === 'attendance')) node.groupLabel = 'nicely-inside-the-panel';
    const { svg } = graphImage(input);
    expect(svg).toMatch(/<svg [^>]*height="40"><text[^>]*>Nicely inside the panel<\/text><\/svg>/);
  });
  it('keeps raster dimensions within the renderer budget across layouts', () => {
    for (const layout of ['hierarchy', 'islands', 'rings'] as const) {
      const input = plan(); input.options.layout = layout;
      const image = graphImage(input);
      expect(image.width).toBeLessThanOrEqual(8192);
      expect(image.height).toBeLessThanOrEqual(8192);
      expect(image.width * image.height).toBeLessThanOrEqual(16_000_000);
      expect(image.svg).not.toMatch(/NaN|Infinity/);
    }
  });
});
