import type { Graph, GraphEdge } from './model';

export type Relationship = GraphEdge | { id: string; kind: 'legacy'; from: string; to: string };
export type GraphView = 'hierarchy' | 'islands' | 'rings';

export function relationships(graph: Graph): Relationship[] {
  return graph.edges ?? graph.nodes.flatMap(n => n.dependsOn.map(from => ({ id: `${from}:${n.id}`, kind: 'legacy' as const, from, to: n.id })));
}

export function participants(edge: Relationship): string[] {
  return edge.kind === 'constraint' ? edge.participants.map(p => p.nodeId) : [edge.from, edge.to];
}

export function relationshipSignature(edge: Relationship): string {
  return edge.kind === 'constraint'
    ? JSON.stringify([edge.kind, edge.label, edge.rule, edge.strength, edge.participants.map(p => [p.nodeId, p.alternative]).sort()])
    : JSON.stringify([edge.kind, edge.from, edge.to, edge.kind === 'input' ? edge.rationale : '']);
}

export function relationshipChanges(previous: Graph, current: Graph) {
  const old = new Map(relationships(previous).map(e => [e.id, relationshipSignature(e)]));
  const next = new Map(relationships(current).map(e => [e.id, relationshipSignature(e)]));
  const changes = new Map<string, 'added' | 'changed' | 'removed'>();
  for (const [id, signature] of next) {
    if (!old.has(id)) changes.set(id, 'added');
    else if (old.get(id) !== signature) changes.set(id, 'changed');
  }
  for (const id of old.keys()) if (!next.has(id)) changes.set(id, 'removed');
  return changes;
}
