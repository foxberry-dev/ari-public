import { nodeChangeClass, type ChangeKind } from './graph';
import type { GraphNode } from './model';

export const changeColors = { added: '#65d6ad', assumption: '#a99ac2', answered: '#86b5cc', changed: '#ed9e52', removed: '#ff9bac' } as const;
export const assumptionColor = '#8e7bb7';
export function nodeChangeColor(before: GraphNode | undefined, node: GraphNode, change: ChangeKind) {
  if (change === 'added' && node.kind === 'assumption') return changeColors.assumption;
  if (nodeChangeClass(before, node, change) === 'answered') return changeColors.answered;
  return changeColors[change];
}
export const changeTheme = Object.fromEntries(Object.entries(changeColors).map(([key, value]) => [`--change-${key}`, value]));
