import type { GraphNode } from './model';

export interface SelectionContext {
  workspaceId: string;
  revision: number;
  selected: GraphNode[];
  existingIds: ReadonlySet<string>;
}
const actions = [
  { id: 'accept', label: 'Accept assumptions', description: 'Confirm the selected provisional answers.', scope: 'assumptions',
    request: 'Confirm these assumptions; keep answers and IDs.' },
  { id: 'add', label: 'Add assumptions', description: 'Develop useful details beneath these nodes.', scope: 'existing',
    request: 'Add useful provisional details below these nodes; preserve existing decisions.' },
  { id: 'alternatives', label: 'Suggest alternative answers', description: 'Add meaningful choices alongside the current answers.', scope: 'existing',
    request: 'Suggest alternative answers; keep current choices.' },
  { id: 'remove', label: 'Remove nodes', description: 'Remove selected nodes and all descendants.', scope: 'existing',
    request: 'Remove these nodes and all descendants; preserve unrelated nodes.' },
  { id: 'explain', label: 'Explain the reasoning', description: 'Explain the basis, dependencies, and uncertainty.', scope: 'context',
    request: 'Explain the answers, dependencies, and uncertainty. No graph changes.' },
  { id: 'gaps', label: 'Find gaps', description: 'Review missing details without changing the graph.', scope: 'context',
    request: 'Find missing details and useful questions. No graph changes.' },
] as const;

export function selectionShortcutOptions(context: SelectionContext) {
  const reference = (nodes: GraphNode[]) => `ari@${context.workspaceId}@${nodes.map(node => node.id).join(',')}`;
  return actions.map(action => {
    const targets = context.selected.filter(node => {
      if (action.scope === 'context') return true;
      if (!context.existingIds.has(node.id)) return false;
      if (action.scope === 'assumptions') return node.kind === 'assumption';
      return node.kind === 'topic' || node.kind === 'decided' || node.kind === 'assumption';
    });
    const lines = [action.request, '', reference(targets)];
    if (targets.length !== context.selected.length) lines.push(`Context: ${reference(context.selected)}`);
    lines.push(`Viewed r${context.revision}; preserve later changes.`);
    return { id: action.id, label: action.label, description: action.description, count: targets.length, prompt: targets.length ? lines.join('\n') : undefined };
  });
}
