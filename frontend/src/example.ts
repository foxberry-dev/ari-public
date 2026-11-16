import type { Graph, GraphEdge, GraphNode } from './model';
function assumption(id: string, title: string, choices: string[], pick: string, rationale: string, dependsOn: string[]): GraphNode {
  return { id, title, kind: 'assumption', content: pick, rationale,
    alternatives: choices.map(label => ({ label, description: '', recommended: false })), selectedAlternative: pick, dependsOn };
}
export const exampleNodes: GraphNode[] = [
  assumption('budget', 'Budget', ['€600', '€1,000', '€1,500'], '€600', 'Start with a small community grant; the amount is unconfirmed.', []),
  assumption('venue', 'Venue capacity', ['12 people', '24 people', '40 people'], '24 people', 'Assume a modest room, pending the venue-specific occupancy limit.', ['budget']),
  assumption('scope', 'Repair scope', ['Clothing and mechanical', 'Electrical repairs', 'Clothing only'], 'Clothing and mechanical', 'Start with common repairs while skills and insurance are confirmed.', ['budget']),
  assumption('admission', 'Admission', ['Booked', 'Drop-in', 'Hybrid'], 'Hybrid', 'Reserve some places and keep room for walk-ins.', ['venue']),
  assumption('team', 'Volunteer team', ['Four volunteers', 'Six volunteers', 'Eight volunteers'], 'Six volunteers', 'An illustrative balance of repairers and intake support.', ['venue', 'scope', 'admission']),
  assumption('insurance', 'Insurance', ['Venue cover applies', 'Separate cover required'], 'Separate cover required', 'Use separate cover as the working premise until coverage is confirmed in writing.', ['venue', 'scope']),
];

export function exampleGraph(nodes: GraphNode[] = exampleNodes): Graph {
  const edges: GraphEdge[] = nodes.flatMap(n => [
    { id: `parent-${n.id}`, kind: 'parent' as const, from: n.id === 'menu' ? 'budget' : 'topic', to: n.id },
    ...n.dependsOn.map(from => ({ id: `input-${from}-${n.id}`, kind: 'input' as const, from, to: n.id, rationale: 'Planning information used to develop this answer.' })),
  ]);
  return { nodes: [{ id: 'topic', title: 'Repair café', kind: 'topic', content: 'Plan a community repair café.', rationale: '', alternatives: [], dependsOn: [] }, ...nodes.map(n => ({ ...n, dependsOn: [] }))], edges };
}
