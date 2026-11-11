import type { Question } from './model';

export interface Positioned { question: Question; x: number; y: number }
export const nodeWidth = 224;
export const nodeHeight = 126;

export function layout(questions: Question[]) {
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
  const columns: Question[][] = [];
  for (const q of questions) (columns[depth(q.id)] ??= []).push(q);
  const height = Math.max(1, ...columns.map(c => c.length)) * 178 + 32;
  const nodes: Positioned[] = columns.flatMap((column, x) => column.map((question, y) => ({
    question, x: 24 + x * 308, y: 24 + (height - 48 - column.length * 178) / 2 + y * 178,
  })));
  const positions = new Map(nodes.map(n => [n.question.id, n]));
  const edges = nodes.flatMap(n => n.question.dependsOn.flatMap(id => {
    const from = positions.get(id);
    if (!from) return [];
    const x = from.x + nodeWidth, y = from.y + nodeHeight / 2;
    const tx = n.x, ty = n.y + nodeHeight / 2;
    return [{ id: `${id}:${n.question.id}`, from: id, to: n.question.id,
      path: `M${x} ${y} C${x + 42} ${y} ${tx - 42} ${ty} ${tx} ${ty}` }];
  }));
  return { nodes, edges, width: Math.max(nodeWidth + 48, columns.length * 308 - 36), height };
}
