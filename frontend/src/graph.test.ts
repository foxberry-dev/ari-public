import { describe, expect, it } from 'vitest';
import { comparisonLayout, graphChanges, layout, nodeHeight, nodeWidth, graphDecorations, groupTitle } from './graph';
import { exampleNodes } from './example';
import type { Graph } from './model';
import { readFileSync } from 'node:fs';
import { graphLayout } from './graph';
import { relationshipChanges } from './relationships';

describe('conversation decision graphs', () => {
  it('keeps shared nodes singular and every dependency left to right', () => {
    const graph = layout(exampleNodes);
    expect(graph.nodes.map(n => n.node.id).sort()).toEqual(['admission', 'budget', 'insurance', 'scope', 'team', 'venue']);
    expect(graph.edges.filter(e => e.from === 'venue').map(e => e.to).sort()).toEqual(['admission', 'insurance', 'team']);
    for (const edge of graph.edges) expect(graph.nodes.find(n => n.node.id === edge.to)!.x).toBeGreaterThan(graph.nodes.find(n => n.node.id === edge.from)!.x);
  });
  it('compares full snapshots including assumptions, rewired dependencies, and removals', () => {
    const before: Graph = { nodes: structuredClone(exampleNodes) };
    const after: Graph = { nodes: before.nodes.filter(n => n.id !== 'insurance').map(n => ({ ...n })) };
    after.nodes.find(n => n.id === 'admission')!.dependsOn = ['budget', 'venue'];
    after.nodes.find(n => n.id === 'venue')!.kind = 'decided';
    after.nodes.push({ id: 'menu', title: 'Lunch menu', kind: 'assumption', content: 'No dietary restrictions assumed', rationale: '', alternatives: [{ label: 'No restrictions', description: '', recommended: false }, { label: 'Vegan meal', description: '', recommended: false }], selectedAlternative: 'No restrictions', dependsOn: ['budget'] });
    expect(Object.fromEntries(graphChanges(before, after))).toEqual({ venue: 'changed', admission: 'changed', menu: 'added', insurance: 'removed' });
    expect(Object.fromEntries(graphChanges(after, before))).toEqual({ venue: 'changed', admission: 'changed', insurance: 'added', menu: 'removed' });
    const changed = comparisonLayout(after, before, true);
    expect(changed.nodes.find(n => n.node.id === 'insurance')).toBeDefined();
    expect(comparisonLayout(after, before, false).nodes.some(n => n.node.id === 'insurance')).toBe(false);
    for (const a of changed.nodes) for (const b of changed.nodes) if (a.node.id !== b.node.id && a.x === b.x) expect(Math.abs(a.y - b.y)).toBeGreaterThanOrEqual(nodeHeight);
  });
  it('can compare individually acyclic graphs whose combined links would form a cycle', () => {
    const a = { ...exampleNodes[0], id: 'a', dependsOn: [] };
    const b = { ...exampleNodes[1], id: 'b', dependsOn: ['a'] };
    const before: Graph = { nodes: [a, b] };
    const after: Graph = { nodes: [{ ...a, dependsOn: ['b'] }, { ...b, dependsOn: [] }] };
    expect(comparisonLayout(after, before, true).edges).toHaveLength(2);
  });
});

describe('typed decision relationships', () => {
  const fixture = JSON.parse(readFileSync(new URL('../../fixtures/team-lunch-graph.json', import.meta.url), 'utf8'));
  const graph: Graph = fixture.commits.at(-1).graph;

  it('keeps one parent per node and reveals cross-branch relationships on selection', () => {
    const hierarchy = graphLayout(graph, 'hierarchy');
    expect(hierarchy.edges).toHaveLength(graph.nodes.length - 1);
    expect(hierarchy.edges.every(e => e.relation.kind === 'parent')).toBe(true);
    const selected = graphLayout(graph, 'hierarchy', new Map(), 'venue');
    expect(selected.nodes).toEqual(hierarchy.nodes);
    expect(selected.edges.some(e => e.relation.id === 'vegan-meals')).toBe(true);
    expect(selected.edges.some(e => e.relation.id === 'input-venue-deadline')).toBe(true);
    expect(selected.edges.some(e => e.relation.id === 'spending-limit')).toBe(false);
    for (const edge of hierarchy.edges) expect(hierarchy.nodes.find(n => n.node.id === edge.from)!.x).toBeLessThan(hierarchy.nodes.find(n => n.node.id === edge.to)!.x);
  });

  it.each(['islands', 'rings'] as const)('%s shows all relationships with one junction for a multi-node rule and keeps settled nodes still', view => {
    const first = graphLayout(graph, view);
    expect(new Set(first.edges.map(e => e.relation.id)).size).toBe(graph.edges!.length);
    const spending = first.edges.filter(e => e.relation.id === 'spending-limit');
    expect(spending.map(e => e.from).sort()).toEqual(['amount', 'budget', 'drinks', 'headcount']);
    expect(new Set(spending.map(e => e.to))).toEqual(new Set(['constraint:spending-limit']));
    expect(first.nodes).toEqual(graphLayout(graph, view).nodes);
    for (const edge of first.edges) expect(edge.path).toMatch(/^M[-\d.e ]+ L[-\d.e ]+$/);
    for (const a of first.nodes) for (const b of first.nodes) if (a !== b) {
      expect(Math.abs(a.x - b.x) >= 224 || Math.abs(a.y - b.y) >= 126).toBe(true);
    }
    const revised = structuredClone(graph);
    revised.nodes.find(n => n.id === 'headcount')!.content = 'Fourteen attendees';
    const anchors = new Map(first.nodes.map(n => [n.node.id, { x: n.x, y: n.y }]));
    const next = graphLayout(revised, view, anchors);
    expect(next.nodes.map(n => [n.node.id, n.x, n.y])).toEqual(first.nodes.map(n => [n.node.id, n.x, n.y]));
  });

  it('compares relationship rules and retains removed constraints in Changed in either view', () => {
    const revised = structuredClone(graph);
    revised.edges = revised.edges!.filter(e => e.id !== 'vegan-exclusion');
    const rule = revised.edges!.find(e => e.id === 'walkability');
    if (rule?.kind !== 'constraint') throw new Error('Expected a constraint fixture');
    rule.rule = 'The human prefers collection within ten minutes of the office.';
    expect(Object.fromEntries(relationshipChanges(graph, revised))).toEqual({ walkability: 'changed', 'vegan-exclusion': 'removed' });
    for (const view of ['hierarchy', 'islands', 'rings'] as const) {
      const changed = comparisonLayout(revised, graph, true, view, new Map(), 'venue');
      expect(changed.edges.filter(e => e.relation.id === 'vegan-exclusion')).toHaveLength(2);
      expect(comparisonLayout(revised, graph, false, view, new Map(), 'venue').edges.some(e => e.relation.id === 'vegan-exclusion')).toBe(false);
    }
    expect(graphChanges(graph, revised).get('venue')).toBe('changed');
  });

  it.each(['islands', 'rings'] as const)('%s keeps removed nodes readable beside the current snapshot', view => {
    const revised = structuredClone(graph);
    revised.nodes = revised.nodes.filter(n => n.id !== 'payment');
    revised.edges = revised.edges!.filter(e => e.kind === 'constraint' || (e.from !== 'payment' && e.to !== 'payment'));
    const changed = comparisonLayout(revised, graph, true, view);
    expect(changed.nodes.find(n => n.node.id === 'payment')).toBeDefined();
    for (const a of changed.nodes) for (const b of changed.nodes) if (a !== b) {
      expect(Math.abs(a.x - b.x) >= 224 || Math.abs(a.y - b.y) >= 126).toBe(true);
    }
  });
});


describe('graph arrangement guides', () => {
  const fixture = JSON.parse(readFileSync(new URL('../../fixtures/team-lunch-graph.json', import.meta.url), 'utf8'));
  const graph: Graph = fixture.commits.at(-1).graph;

  it('centers the topic in rings independently of node status and relationship depth', () => {
    const first = graphLayout(graph, 'rings');
    const unrelated = structuredClone(graph);
    unrelated.nodes.reverse();
    unrelated.edges = [];
    for (const node of unrelated.nodes) if (node.kind !== 'topic') node.kind = 'decided';
    expect(graphLayout(unrelated, 'rings').nodes.map(n => [n.node.id, n.x, n.y])).toEqual(first.nodes.map(n => [n.node.id, n.x, n.y]));
    const root = first.nodes.find(n => n.node.kind === 'topic')!;
    const guides = graphDecorations(graph, 'rings', first.nodes);
    expect(guides.rings.length).toBeGreaterThan(1);
    for (const ring of guides.rings) {
      expect(ring.x).toBe(root.x + nodeWidth / 2);
      expect(ring.y).toBe(root.y + nodeHeight / 2);
    }
  });

  it('groups only explicit matching labels and formats concise headings', () => {
    const first = graphLayout(graph, 'islands');
    const guides = graphDecorations(graph, 'islands', first.nodes);
    const labels = [...new Set(graph.nodes.flatMap(node => node.groupLabel ? [node.groupLabel] : []))];
    expect(guides.islands.map(region => region.id).sort()).toEqual(labels.sort());
    for (const region of guides.islands) {
      const members = first.nodes.filter(n => n.node.groupLabel === region.id);
      expect(members.length).toBeGreaterThanOrEqual(2);
      expect(region.title).toBe(groupTitle(region.id));
      for (const node of members) {
        expect(node.x).toBeGreaterThan(region.x);
        expect(node.y).toBeGreaterThan(region.y + 40);
      }
      for (const other of guides.islands) if (region !== other) {
        expect(region.x + region.width <= other.x || other.x + other.width <= region.x || region.y + region.height <= other.y || other.y + other.height <= region.y).toBe(true);
      }
    }
    const unlabeled = structuredClone(graph);
    for (const node of unlabeled.nodes) delete node.groupLabel;
    expect(graphDecorations(unlabeled, 'islands', graphLayout(unlabeled, 'islands').nodes).islands).toEqual([]);
    expect(groupTitle('nicely-inside-the-panel')).toBe('Nicely inside the panel');
    const renamed = structuredClone(graph);
    renamed.nodes.find(node => node.groupLabel === 'attendance')!.groupLabel = 'invited-teammates';
    expect(graphChanges(graph, renamed).size).toBe(1);
  });

  it.each(['islands', 'rings'] as const)('%s adds nodes without moving existing nodes or overlapping cards', view => {
    const first = graphLayout(graph, view);
    const anchors = new Map(first.nodes.map(n => [n.node.id, { x: n.x, y: n.y }]));
    const grown = structuredClone(graph);
    for (let i = 0; i < 20; i++) {
      const id = `extra-${i}`;
      grown.nodes.push({ ...structuredClone(graph.nodes[1]!), id });
      grown.edges!.push({ id: `parent-${id}`, kind: 'parent', from: 'people', to: id });
    }
    const next = graphLayout(grown, view, anchors);
    for (const old of first.nodes) {
      const node = next.nodes.find(n => n.node.id === old.node.id)!;
      expect([node.x, node.y]).toEqual([old.x, old.y]);
    }
    for (const a of next.nodes) for (const b of next.nodes) if (a !== b) {
      expect(Math.abs(a.x - b.x) >= nodeWidth || Math.abs(a.y - b.y) >= nodeHeight).toBe(true);
    }
  });
});
