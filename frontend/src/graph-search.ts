import type { GraphNode, Workspace } from './model';

export interface SearchContext { workspaceId: string; revision: number; nodes: GraphNode[] }
export interface SearchMatch { workspaceId: string; revision: number; nodeId: string; title: string; workspaceTitle: string }

export function searchNodes(workspaces: Workspace[], query: string, context?: SearchContext, all = false): SearchMatch[] {
  const term = query.trim().toLocaleLowerCase();
  if (!term) return [];
  return workspaces.flatMap(workspace => {
    if (!all && workspace.id !== context?.workspaceId) return [];
    const commit = workspace.commits.at(-1);
    const source = !all && context ? context : { nodes: commit?.graph.nodes || [], revision: commit?.revision || 0 };
    return source.nodes.filter(node => [node.id, node.title, node.content, node.selectedAlternative || '', ...node.alternatives.flatMap(option => [option.label, option.description])].join('\n').toLocaleLowerCase().includes(term))
      .map(node => ({ workspaceId: workspace.id, workspaceTitle: workspace.title, revision: source.revision, nodeId: node.id, title: node.title }));
  });
}
