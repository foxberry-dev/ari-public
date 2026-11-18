import { describe, expect, it } from 'vitest';
import { selectionShortcutOptions } from './selection-shortcuts';
import type { GraphNode } from './model';

function node(id: string, kind: GraphNode['kind']): GraphNode {
  return { id, kind, title: id, content: 'Answer A', rationale: '', dependsOn: [],
    alternatives: kind === 'topic' ? [] : [{ label: 'a', description: 'Answer A', recommended: false }, { label: 'b', description: 'Answer B', recommended: false }],
    ...(kind === 'topic' ? {} : { selectedAlternative: 'a' }) };
}

describe('selection shortcut requests', () => {
  it('limits changes to applicable retained nodes and keeps the complete selection as context', () => {
    const selected = [node('topic', 'topic'), node('guess', 'assumption'), node('answer', 'decided'), node('removed', 'assumption')];
    const options = selectionShortcutOptions({ workspaceId: 'recipe', revision: 7, selected, existingIds: new Set(['topic', 'guess', 'answer']) });
    expect(options.map(action => [action.label, action.count])).toEqual([
      ['Accept assumptions', 1], ['Add assumptions', 3], ['Suggest alternative answers', 3], ['Remove nodes', 3], ['Explain the reasoning', 4], ['Find gaps', 4],
    ]);
    expect(options[0].prompt?.split('\n').filter(line => line.startsWith('ari@') || line.startsWith('Context:'))).toEqual([
      'ari@recipe@guess', 'Context: ari@recipe@topic,guess,answer,removed',
    ]);
    expect(options[3].prompt?.split('\n').find(line => line.startsWith('ari@'))).toEqual('ari@recipe@topic,guess,answer');
    expect(options[5].prompt?.split('\n').find(line => line.startsWith('ari@'))).toEqual('ari@recipe@topic,guess,answer,removed');
    expect(options[5].prompt?.split('\n').at(-1)).toEqual('Viewed r7; preserve later changes.');
  });

  it('allows topic expansion and branch removal while requiring assumptions for confirmation', () => {
    const context = { workspaceId: 'recipe', revision: 2, selected: [node('topic', 'topic')], existingIds: new Set(['topic']) };
    const options = selectionShortcutOptions(context);
    expect(options.map(action => action.count)).toEqual([0, 1, 1, 1, 1, 1]);
    expect(options.filter(action => !action.count).map(action => action.prompt)).toEqual([undefined]);
    expect(selectionShortcutOptions({ ...context, selected: [] }).map(action => action.prompt)).toEqual(Array(6).fill(undefined));
  });
});
