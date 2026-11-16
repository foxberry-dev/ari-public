export interface Alternative { label: string; description: string; recommended: boolean }
export type NodeKind = 'topic' | 'decided' | 'assumption' | 'question' | 'forecast';
export interface GraphNode {
  id: string; title: string; kind: NodeKind; content: string; groupLabel?: string;
  rationale: string; alternatives: Alternative[]; selectedAlternative?: string; dependsOn: string[];
}
export interface Participant { nodeId: string; alternative?: string }
export type GraphEdge =
  | { id: string; kind: 'parent'; from: string; to: string }
  | { id: string; kind: 'input'; from: string; to: string; rationale: string }
  | { id: string; kind: 'constraint'; participants: Participant[]; label: string; rule: string; strength: 'requirement' | 'preference' };
export interface Graph { nodes: GraphNode[]; edges?: GraphEdge[] }
export type CommitKind = 'topicStaged' | 'directAnswer' | 'openDiscussion' | 'followUpQuestion' | 'revisedDecision' | 'forecastUpdated' | 'graphUpdated' | 'imported';
export interface CommitMetadata { title: string; kind: CommitKind; summary: string; source: string }
export interface GraphCommit { id: string; revision: number; at: number; metadata: CommitMetadata; graph: Graph }
export interface NodeReference { number: number; id: string; reference: string }
export interface RelatedLink { label: string; url: string }
export interface Workspace {
  links?: RelatedLink[];
  id: string; title: string; description: string; revision: number; updatedAt: number;
  commits: GraphCommit[];
  nodeIndex?: NodeReference[];
  history?: { questionId: string; previous: { value: string; reason: string } | null; answer: { value: string; reason: string; at: number } }[];
  questionHistory?: { previous: { id: string; question: string; rationale: string; alternatives: Alternative[] }; proposed: { id: string; question: string; rationale: string; alternatives: Alternative[] }; at: number }[];
  proposals?: { id: string; message: string; status: string; questions: { id: string; question: string; rationale: string; alternatives: Alternative[] }[] }[];
}
export const commitLabels: Record<CommitKind, string> = {
  topicStaged: 'Topic staged', directAnswer: 'Direct answer', openDiscussion: 'Open discussion',
  followUpQuestion: 'Follow-up question', revisedDecision: 'Revised decision', forecastUpdated: 'Assumptions updated', graphUpdated: 'Graph updated', imported: 'Imported history',
};
export function latestGraph(workspace: Workspace): Graph { return workspace.commits.at(-1)?.graph ?? { nodes: [] }; }
export function counts(workspace: Workspace) {
  const nodes = latestGraph(workspace).nodes;
  return { decided: nodes.filter(n => n.kind === 'decided').length,
    assumptions: nodes.filter(isAssumption).length };
}
export function formatTime(at: number) {
  return new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short' }).format(at);
}

export function isAssumption(node: GraphNode): boolean { return node.kind === 'assumption'; }
export function selectedAlternative(node: GraphNode): string | undefined {
  if (node.selectedAlternative) return node.selectedAlternative;
  if (node.kind !== 'decided') return undefined;
  return node.alternatives.find(a => a.label.trim().toLocaleLowerCase() === node.content.trim().toLocaleLowerCase())?.label;
}
export function nodeContent(node: GraphNode): string {
  return node.content;
}

export function nodeStatus(node: GraphNode): string {
  return node.kind === 'assumption' ? 'Assumption' : node.kind === 'decided' ? 'Decided' : node.kind === 'topic' ? 'Topic' : node.kind === 'forecast' ? 'Historical forecast' : 'Historical question';
}
