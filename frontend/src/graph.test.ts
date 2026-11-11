import { describe, expect, it } from 'vitest';
import { layout } from './graph';
import { affectedBy, counts, questionStatus, type Workspace } from './model';
import { exampleQuestions } from './example';

function workspace(): Workspace {
  return { id: 'fixture', title: 'Repair café', description: '', revision: 1, updatedAt: 1,
    questions: structuredClone(exampleQuestions), answers: {}, needsReview: [], history: [], questionHistory: [], proposals: [] };
}

describe('decision dependency map', () => {
  it('keeps shared questions singular and draws each prerequisite edge', () => {
    const graph = layout(exampleQuestions);
    expect(graph.nodes.map(n => n.question.id).sort()).toEqual(['A4', 'B1', 'L6', 'R3', 'S5', 'V2']);
    expect(graph.edges.filter(e => e.from === 'V2').map(e => e.to).sort()).toEqual(['A4', 'L6', 'S5']);
    for (const edge of graph.edges) {
      expect(graph.nodes.find(n => n.question.id === edge.to)!.x).toBeGreaterThan(graph.nodes.find(n => n.question.id === edge.from)!.x);
    }
  });

  it('traces transitive impact without repeating shared dependents', () => {
    expect(affectedBy(workspace(), 'B1').map(q => q.id)).toEqual(['V2', 'R3', 'A4', 'S5', 'L6']);
    expect(affectedBy(workspace(), 'V2').map(q => q.id)).toEqual(['A4', 'S5', 'L6']);
  });

  it('shows review state ahead of an existing human answer', () => {
    const w = workspace();
    w.answers.V2 = { value: '24 people', reason: 'Recorded limit', at: 1 };
    w.needsReview = ['V2'];
    expect(questionStatus(w, w.questions[1])).toBe('Needs review');
    expect(counts(w)).toEqual({ decided: 0, open: 5, review: 1, proposals: 0 });
  });
});
