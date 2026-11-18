import type { GraphNode } from './model';

export function cardLines(text: string, maximum: number): string[] {
  const result: string[] = [];
  for (const paragraph of text.split('\n')) {
    let line = '';
    for (const character of paragraph) {
      line += character;
      if (line.length > maximum) {
        const space = line.lastIndexOf(' ', maximum);
        const end = space > 0 ? space : maximum;
        result.push(line.slice(0, end));
        line = line.slice(space > 0 ? end + 1 : end);
      }
    }
    result.push(line);
  }
  return result;
}

const heights = new Map<string, number>();

export function nodeCardHeight(node: GraphNode): number {
  if (typeof document === 'undefined') return 50 + cardLines(node.title, 26).length * 19.6 + cardLines(node.content, 32).length * 16.5;
  const key = JSON.stringify([node.title, node.content]);
  const cached = heights.get(key);
  if (cached !== undefined) return cached;
  const card = document.createElement('div');
  card.className = 'graph-node';
  Object.assign(card.style, { position: 'fixed', inset: 'auto', left: '-10000px', width: '224px', height: 'auto', visibility: 'hidden', pointerEvents: 'none' });
  const title = document.createElement('strong');
  title.textContent = node.title;
  const answer = document.createElement('span');
  answer.className = 'node-value';
  answer.textContent = node.content;
  const status = document.createElement('span');
  status.className = 'node-status';
  Object.assign(status.style, { position: 'static', marginTop: '5px', flexShrink: '0' });
  card.append(title, answer, status);
  document.body.append(card);
  const height = Math.ceil(card.getBoundingClientRect().height);
  card.remove();
  if (heights.size >= 1000) heights.clear();
  heights.set(key, height);
  return height;
}
