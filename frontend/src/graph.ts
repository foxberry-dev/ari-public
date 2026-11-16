import type { Graph, GraphNode } from './model';
import { participants, relationships, relationshipChanges, type GraphView, type Relationship } from './relationships';

export interface Positioned { node: GraphNode; x: number; y: number }
export interface Wire { id: string; relation: Relationship; from: string; to: string; path: string }
export interface GraphLayout { nodes: Positioned[]; edges: Wire[]; width: number; height: number }
export const nodeWidth = 224;
export const nodeHeight = 104;
export const groupHeaderHeight = 40;
const hierarchyStepY = nodeHeight + 52;

export function layout(questions: GraphNode[]) {
  const byId = new Map(questions.map(q => [q.id, q]));
  const depths = new Map<string, number>();
  function depth(id: string, active = new Set<string>()): number {
    if (depths.has(id)) return depths.get(id)!;
    if (active.has(id)) return 0;
    active.add(id);
    const dependencies = byId.get(id)?.dependsOn.filter(d => byId.has(d)) ?? [];
    const value = dependencies.length ? 1 + Math.max(...dependencies.map(d => depth(d, new Set(active)))) : 0;
    depths.set(id, value);
    return value;
  }
  const columns: GraphNode[][] = [];
  for (const q of questions) (columns[depth(q.id)] ??= []).push(q);
  const height = Math.max(1, ...columns.map(c => c.length)) * hierarchyStepY + 32;
  const nodes: Positioned[] = columns.flatMap((column, x) => column.map((question, y) => ({
    node: question, x: 24 + x * 308, y: 24 + (height - 48 - column.length * hierarchyStepY) / 2 + y * hierarchyStepY,
  })));
  const positions = new Map(nodes.map(n => [n.node.id, n]));
  const edges = nodes.flatMap(n => n.node.dependsOn.flatMap(id => {
    const from = positions.get(id);
    if (!from) return [];
    const x = from.x + nodeWidth, y = from.y + nodeHeight / 2;
    const tx = n.x, ty = n.y + nodeHeight / 2;
    return [{ id: `${id}:${n.node.id}`, relation: { id: `${id}:${n.node.id}`, kind: 'legacy' as const, from: id, to: n.node.id }, from: id, to: n.node.id,
      path: `M${x} ${y} C${x + 42} ${y} ${tx - 42} ${ty} ${tx} ${ty}` }];
  }));
  return { nodes, edges, width: Math.max(nodeWidth + 48, columns.length * 308 - 36), height };
}

export type ChangeKind = 'added' | 'changed' | 'removed';
export function nodeChangeLabel(before: GraphNode | undefined, node: GraphNode, change: ChangeKind): string {
  if (change === 'changed' && before && before.kind !== 'decided' && node.kind === 'decided') return 'Assumption · Resolved';
  return { added: 'Added', changed: 'Changed', removed: 'Removed' }[change];
}
export function nodeChangeClass(before: GraphNode | undefined, node: GraphNode, change: ChangeKind): string {
  return change === 'changed' && before && before.kind !== 'decided' && node.kind === 'decided' ? 'answered' : change;
}
function nodeSignature(node: GraphNode) {
  return JSON.stringify([node.title, node.kind, node.content, node.groupLabel, node.alternatives, node.selectedAlternative, [...(node.dependsOn || [])].sort()]);
}
export function graphChanges(previous: Graph, current: Graph): Map<string, ChangeKind> {
  const old = new Map(previous.nodes.map(n => [n.id, n]));
  const next = new Set(current.nodes.map(n => n.id));
  const result = new Map<string, ChangeKind>();
  for (const node of current.nodes) {
    const before = old.get(node.id);
    if (!before) result.set(node.id, 'added');
    else if (nodeSignature(before) !== nodeSignature(node)) result.set(node.id, 'changed');
  }
  for (const node of previous.nodes) if (!next.has(node.id)) result.set(node.id, 'removed');
  const edgeChanges = relationshipChanges(previous, current);
  for (const edge of [...relationships(previous), ...relationships(current)]) {
    if (edge.kind === 'legacy') continue;
    if (!edgeChanges.has(edge.id)) continue;
    for (const id of participants(edge)) if (next.has(id) && !result.has(id)) result.set(id, 'changed');
  }
  return result;
}
export function comparisonLayout(current: Graph, previous: Graph, changed: boolean, view: GraphView = 'hierarchy', anchors = new Map<string, { x: number; y: number }>(), selected = ''): GraphLayout {
  const next = graphLayout(current, view, anchors, selected);
  if (!changed) return next;
  const old = graphLayout(previous, view, anchors, selected);
  const changes = graphChanges(previous, current);
  for (const removed of old.nodes.filter(n => changes.get(n.node.id) === 'removed')) {
    let y = removed.y;
    while (next.nodes.some(n => Math.abs(n.x - removed.x) < nodeWidth + 24 && Math.abs(n.y - y) < nodeHeight + 24)) y += hierarchyStepY;
    next.nodes.push({ ...removed, y });
    next.width = Math.max(next.width, removed.x + nodeWidth + 24);
    next.height = Math.max(next.height, y + nodeHeight + 24);
  }
  const positions = new Map(next.nodes.map(n => [n.node.id, n]));
  for (const edge of old.edges.filter(e => !next.edges.some(n => n.id === e.id))) {
    const a = positions.get(edge.from), b = positions.get(edge.to);
    if (!a || (!b && edge.relation.kind !== 'constraint')) continue;
    next.edges.push(edge);
  }
  next.edges = positionWires(next.nodes, next.edges, view);
  return next;
}

export function graphLayout(graph: Graph, view: GraphView, anchors = new Map<string, { x: number; y: number }>(), selected = ''): GraphLayout {
  const parents = relationships(graph).filter(e => e.kind === 'parent' || e.kind === 'legacy');
  const tree = layout(graph.nodes.map(n => ({ ...n, dependsOn: parents.filter(e => e.to === n.id).map(e => e.from) })));
  const originals = new Map(graph.nodes.map(n => [n.id, n]));
  tree.nodes = tree.nodes.map(n => ({ ...n, node: originals.get(n.node.id)! }));
  const nodes = view === 'islands' ? topicIslands(graph, anchors) : view === 'rings' ? concentricRings(graph, anchors) : tree.nodes;
  const visible = relationships(graph).filter(e => view !== 'hierarchy' || e.kind === 'parent' || e.kind === 'legacy' || (selected && participants(e).includes(selected)));
  const wires = visible.flatMap<Wire>(relation => {
    if (relation.kind !== 'constraint') return [{ id: relation.id, relation, from: relation.from, to: relation.to, path: '' }];
    return relation.participants.map(p => ({ id: `${relation.id}:${p.nodeId}`, relation, from: p.nodeId, to: `constraint:${relation.id}`, path: '' }));
  });
  return { nodes, edges: positionWires(nodes, wires, view),
    width: Math.max(nodeWidth + 48, ...nodes.map(n => n.x + nodeWidth + 24)),
    height: Math.max(nodeHeight + 48, ...nodes.map(n => n.y + nodeHeight + 24)) };
}

export function constraintCenter(edge: Relationship, nodes: Positioned[]) {
  const ids = new Set(participants(edge));
  const connected = nodes.filter(n => ids.has(n.node.id));
  return { x: connected.reduce((sum, n) => sum + n.x + nodeWidth / 2, 0) / Math.max(1, connected.length),
    y: connected.reduce((sum, n) => sum + n.y + nodeHeight / 2, 0) / Math.max(1, connected.length) };
}

export function positionWires(nodes: Positioned[], wires: Wire[], view: GraphView): Wire[] {
  const positions = new Map(nodes.map(n => [n.node.id, n]));
  return wires.flatMap(wire => {
    const from = positions.get(wire.from);
    if (!from) return [];
    const to = positions.get(wire.to);
    if (wire.relation.kind === 'constraint') {
      const center = constraintCenter(wire.relation, nodes);
      const start = boundary(from, center);
      return [{ ...wire, path: `M${start.x} ${start.y} L${center.x} ${center.y}` }];
    }
    if (!to) return [];
    if (view === 'hierarchy' && (wire.relation.kind === 'parent' || wire.relation.kind === 'legacy')) {
      const x = from.x + nodeWidth, y = from.y + nodeHeight / 2, tx = to.x, ty = to.y + nodeHeight / 2;
      return [{ ...wire, path: `M${x} ${y} C${x + 42} ${y} ${tx - 42} ${ty} ${tx} ${ty}` }];
    }
    const start = boundary(from, { x: to.x + nodeWidth / 2, y: to.y + nodeHeight / 2 });
    const end = boundary(to, { x: from.x + nodeWidth / 2, y: from.y + nodeHeight / 2 });
    return [{ ...wire, path: `M${start.x} ${start.y} L${end.x} ${end.y}` }];
  });
}

function boundary(node: Positioned, target: { x: number; y: number }) {
  const x = node.x + nodeWidth / 2, y = node.y + nodeHeight / 2;
  const dx = target.x - x, dy = target.y - y;
  const ratio = 1 / Math.max(Math.abs(dx) / (nodeWidth / 2), Math.abs(dy) / (nodeHeight / 2), .001);
  return { x: x + dx * ratio, y: y + dy * ratio };
}

type Anchors = Map<string, { x: number; y: number }>;
const islandStepX = nodeWidth + 56;
const islandStepY = nodeHeight + 56;
const ringStepX = (nodeWidth + 48) * 1.5;
const ringStepY = (nodeHeight + 48) * 1.5;

function orderedNodes(graph: Graph) {
  return [...graph.nodes].sort((a, b) => a.id.localeCompare(b.id));
}

function topicNode(graph: Graph) {
  return orderedNodes(graph).find(n => n.kind === 'topic') ?? orderedNodes(graph)[0];
}

export function groupTitle(label: string): string {
  const title = label.replaceAll('-', ' ');
  return title.charAt(0).toUpperCase() + title.slice(1);
}

function labeledGroups(graph: Graph): GraphNode[][] {
  const root = topicNode(graph);
  const groups = new Map<string, GraphNode[]>();
  for (const node of orderedNodes(graph)) {
    if (node.id === root?.id) continue;
    const key = node.groupLabel ? `group:${node.groupLabel}` : `node:${node.id}`;
    const members = groups.get(key) ?? [];
    members.push(node); groups.set(key, members);
  }
  return [...groups].sort(([a], [b]) => a.localeCompare(b)).map(([, nodes]) => nodes);
}

function overlaps(a: { x: number; y: number }, b: { x: number; y: number }) {
  return Math.abs(a.x - b.x) < nodeWidth + 32 && Math.abs(a.y - b.y) < nodeHeight + 32;
}

function topicIslands(graph: Graph, anchors: Anchors): Positioned[] {
  const root = topicNode(graph);
  if (!root) return [];
  const groups = labeledGroups(graph);
  const upperRows = Math.max(1, ...groups.filter((_, i) => i % 4 < 2).map(g => Math.ceil(g.length / 2)));
  const rootPosition = anchors.get(root.id) ?? { x: 80 + islandStepX * 2 + 150, y: upperRows * islandStepY + 180 };
  const placed = graph.nodes.flatMap(node => anchors.has(node.id) ? [{ node, ...anchors.get(node.id)! }] : []);
  if (!anchors.has(root.id)) placed.push({ node: root, ...rootPosition });
  groups.forEach((group, index) => {
    let lane = index;
    function origin(slot: number) {
      const band = Math.floor(slot / 4), right = slot % 2 === 1;
      return { x: rootPosition.x + (right ? nodeWidth + 150 + band * 720 : -150 - islandStepX * 2 - band * 720),
        y: rootPosition.y + (slot % 4 < 2 ? -240 : 240) };
    }
    let base = anchors.get(group[0]!.id) ?? origin(lane);
    if (!anchors.has(group[0]!.id)) {
      while (placed.some(n => overlaps(n, base))) { lane += 4; base = origin(lane); }
    }
    const direction = base.y < rootPosition.y ? -1 : 1;
    let slot = 0;
    for (const node of group) {
      if (anchors.has(node.id)) continue;
      let candidate: { x: number; y: number };
      do {
        candidate = { x: base.x + (slot % 2) * islandStepX, y: base.y + direction * Math.floor(slot / 2) * islandStepY };
        slot++;
      } while (placed.some(n => overlaps(n, candidate)));
      placed.push({ node, ...candidate });
    }
  });
  return placed.sort((a, b) => a.node.id.localeCompare(b.node.id));
}

function concentricRings(graph: Graph, anchors: Anchors): Positioned[] {
  const root = topicNode(graph);
  if (!root) return [];
  const nodes = orderedNodes(graph);
  let levels = 1;
  while (3 * levels * (levels + 1) < nodes.length - 1) levels++;
  const center = anchors.get(root.id) ?? { x: ringStepX * levels + 48, y: ringStepY * levels + 48 };
  const placed = nodes.flatMap(node => anchors.has(node.id) ? [{ node, ...anchors.get(node.id)! }] : []);
  if (!anchors.has(root.id)) placed.push({ node: root, ...center });
  const pending = nodes.filter(n => n.id !== root.id && !anchors.has(n.id));
  let level = 1;
  while (pending.length) {
    const slots = anchors.size ? 6 * level : Math.min(6 * level, pending.length);
    for (let slot = 0; slot < slots && pending.length; slot++) {
      const angle = -Math.PI / 2 + slot * 2 * Math.PI / slots;
      const candidate = { x: center.x + ringStepX * level * Math.cos(angle), y: center.y + ringStepY * level * Math.sin(angle) };
      if (!placed.some(n => overlaps(n, candidate))) placed.push({ node: pending.shift()!, ...candidate });
    }
    level++;
  }
  return placed.sort((a, b) => a.node.id.localeCompare(b.node.id));
}

export function graphDecorations(graph: Graph, view: GraphView, nodes: Positioned[]) {
  const byId = new Map(nodes.map(n => [n.node.id, n]));
  const islands = view !== 'islands' ? [] : labeledGroups({ ...graph, nodes: nodes.map(item => item.node) }).flatMap(group => {
    const members = group.flatMap(n => byId.has(n.id) ? [byId.get(n.id)!] : []);
    if (members.length < 2 || !group[0]!.groupLabel) return [];
    const x = Math.min(...members.map(n => n.x)) - 32, y = Math.min(...members.map(n => n.y)) - 32 - groupHeaderHeight;
    return [{ id: group[0]!.groupLabel, title: groupTitle(group[0]!.groupLabel), x, y, width: Math.max(...members.map(n => n.x + nodeWidth)) + 32 - x,
      height: Math.max(...members.map(n => n.y + nodeHeight)) + 32 - y }];
  });
  const root = topicNode(graph), center = root && byId.get(root.id);
  const rings = view !== 'rings' || !center ? [] : [...new Set(nodes.filter(n => n.node.id !== root!.id).map(n =>
    Math.round(Math.hypot((n.x - center.x) / ringStepX, (n.y - center.y) / ringStepY))))].filter(level => level > 0).sort((a, b) => a - b).map(level =>
      ({ level, x: center.x + nodeWidth / 2, y: center.y + nodeHeight / 2, rx: ringStepX * level, ry: ringStepY * level }));
  return { islands, rings };
}


export function graphBounds(graph: Graph, view: GraphView, nodes: Positioned[]) {
  const guides = graphDecorations(graph, view, nodes);
  const boxes = [...nodes.map(n => ({ x: n.x, y: n.y, width: nodeWidth, height: nodeHeight })), ...guides.islands,
    ...guides.rings.map(r => ({ x: r.x - r.rx, y: r.y - r.ry, width: r.rx * 2, height: r.ry * 2 }))];
  if (!boxes.length) return { x: 0, y: 0, width: 272, height: 174 };
  const x = Math.min(...boxes.map(n => n.x)), y = Math.min(...boxes.map(n => n.y));
  return { x, y, width: Math.max(...boxes.map(n => n.x + n.width)) - x, height: Math.max(...boxes.map(n => n.y + n.height)) - y };
}
