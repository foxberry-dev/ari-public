export interface Alternative { label: string; description: string; recommended: boolean }
export interface Question {
  id: string; title: string; question: string; rationale: string;
  assumption: boolean; alternatives: Alternative[]; dependsOn: string[];
}
export interface Answer { value: string; reason: string; at: number }
export interface HistoryEntry { questionId: string; previous: Answer | null; answer: Answer }
export interface Proposal {
  id: string; baseRevision: number; message: string; questions: Question[];
  status: 'pending' | 'accepted' | 'rejected'; at: number;
}
export interface Workspace {
  id: string; title: string; description: string; revision: number; updatedAt: number;
  questions: Question[]; answers: Record<string, Answer>; needsReview: string[];
  history: HistoryEntry[]; proposals: Proposal[];
  questionHistory: { previous: Question; proposed: Question; at: number }[];
}
export interface AgentStatus { waiting: number; queued: number; working: number }
export interface Action {
  kind: 'answer' | 'request' | 'acceptProposal' | 'rejectProposal';
  questionId?: string; value?: string; reason?: string; message?: string; proposalId?: string;
}

export function questionStatus(workspace: Workspace, question: Question): string {
  if (workspace.needsReview.includes(question.id)) return 'Needs review';
  if (workspace.answers[question.id]) return 'Decided';
  return question.assumption ? 'Assumption' : 'Open';
}

export function counts(workspace: Workspace) {
  return {
    decided: workspace.questions.filter(q => questionStatus(workspace, q) === 'Decided').length,
    open: workspace.questions.filter(q => ['Open', 'Assumption'].includes(questionStatus(workspace, q))).length,
    review: workspace.needsReview.length,
    proposals: workspace.proposals.filter(p => p.status === 'pending').length,
  };
}

export function affectedBy(workspace: Workspace, id: string): Question[] {
  const found = new Set<string>();
  const frontier = [id];
  while (frontier.length) {
    const current = frontier.pop()!;
    for (const question of workspace.questions) {
      if (question.dependsOn.includes(current) && !found.has(question.id)) {
        found.add(question.id);
        frontier.push(question.id);
      }
    }
  }
  return workspace.questions.filter(q => found.has(q.id));
}

export function formatTime(at: number) {
  return new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Amsterdam', dateStyle: 'medium', timeStyle: 'short' }).format(at);
}
