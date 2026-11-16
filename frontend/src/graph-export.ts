import { comparisonLayout, constraintCenter, graphBounds, graphChanges, graphDecorations, nodeChangeLabel, nodeHeight, groupHeaderHeight, nodeWidth } from './graph';
import { participants, relationshipChanges } from './relationships';
import { assumptionColor, changeColors, nodeChangeColor } from './graph-presentation';
import { nodeStatus, type Graph, type NodeReference } from './model';
import type { GraphView } from './relationships';

export interface ExportPlan {
  title: string; current: Graph; previous: Graph;
  nodeIndex?: NodeReference[];
  options: { layout: GraphView; display: 'current' | 'changed'; inputs: boolean; constraints: boolean; selected?: string; format: 'svg' | 'png' | 'pdf' };
}
const escape = (text: string) => text.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uD800-\uDFFF\uFFFE\uFFFF]/gu, '�').replace(/[&<>"']/g, value => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[value]!);
function lines(text: string, maximum: number, count: number) {
  const words = text.replace(/\s+/g, ' ').trim().split(' ');
  const result: string[] = [];
  let line = '';
  for (const word of words) {
    if (line && line.length + word.length + 1 > maximum) { result.push(line); line = ''; }
    line += (line ? ' ' : '') + word;
  }
  if (line) result.push(line);
  return result.slice(0, count).map((line, index) => line.length > maximum || index === count - 1 && result.length > count ? line.slice(0, maximum - 1) + '…' : line);
}

export function graphImage(plan: ExportPlan) {
  if (!plan.current.edges) throw new Error('This historical revision has no typed relationships.');
  const changed = plan.options.display === 'changed';
  const graph = comparisonLayout(plan.current, plan.previous, changed, plan.options.layout, new Map(), plan.options.selected);
  const guides = graphDecorations(plan.current, plan.options.layout, graph.nodes);
  const bounds = graphBounds(plan.current, plan.options.layout, graph.nodes);
  const minX = bounds.x - 24, minY = bounds.y - 24;
  const width = bounds.width + 48, height = bounds.height + 48;
  const factor = Math.min(1, 8192 / width, 8192 / height, Math.sqrt(16_000_000 / (width * height)));
  const outputWidth = Math.max(1, Math.floor(width * factor)), outputHeight = Math.max(1, Math.floor(height * factor));
  const changes = graphChanges(plan.previous, plan.current), edgeChanges = relationshipChanges(plan.previous, plan.current);
  const previousNodes = new Map(plan.previous.nodes.map(n => [n.id, n]));
  const wires = graph.edges.filter(e => (e.relation.kind !== 'input' || plan.options.inputs) && (e.relation.kind !== 'constraint' || plan.options.constraints));
  const nodes = graph.nodes.map(({ node, x, y }) => {
    const change = changed ? changes.get(node.id) : undefined;
    const color = change ? nodeChangeColor(previousNodes.get(node.id), node, change) : node.kind === 'assumption' ? assumptionColor : '#4b5148';
    const fill = color === changeColors.answered ? '#20292e' : change === 'removed' ? '#2d2527' : node.kind === 'assumption' ? '#25232d' : change === 'added' ? '#1d2b28' : node.kind === 'topic' ? '#2b2c26' : '#18191b';
    const label = change ? (node.kind === 'assumption' ? 'Assumption · ' : '') + nodeChangeLabel(previousNodes.get(node.id), node, change) : nodeStatus(node);
    const title = lines(node.title, 26, 1).map(line => `<text x="10" y="24" font-size="14" font-weight="600" fill="${node.kind === 'assumption' ? '#c7beda' : '#f0ebde'}">${escape(line)}</text>`).join('');
    const answer = lines(node.content, 32, 2).map((line, i) => `<text x="10" y="${45 + i * 16}" font-size="11" fill="${node.kind === 'assumption' ? '#a79ab9' : '#a5ada5'}">${escape(line)}</text>`).join('');
    const number = plan.nodeIndex?.find(entry => entry.id === node.id)?.number;
    const numberLabel = number ? `<text x="${nodeWidth - 10}" y="${nodeHeight - 12}" text-anchor="end" font-size="9" fill="#9caa96">#${number}</text>` : '';
    return `<g transform="translate(${x} ${y})"><rect width="${nodeWidth}" height="${nodeHeight}" rx="11" fill="${fill}" stroke="${color}" stroke-width="2" ${node.kind === 'assumption' || change === 'removed' ? 'stroke-dasharray="4 3"' : ''}/>${title}${answer}<text x="10" y="${nodeHeight - 12}" font-size="9" fill="${change || node.kind === 'assumption' ? color : '#a6a397'}">${escape(label)}</text>${numberLabel}</g>`;
  }).join('');
  const edges = wires.map(edge => `<path d="${escape(edge.path)}" fill="none" stroke="${changed && edgeChanges.has(edge.relation.id) ? changeColors[edgeChanges.get(edge.relation.id)!] : '#858585'}" stroke-width="1.5" ${edge.relation.kind === 'input' ? 'stroke-dasharray="8 5" marker-end="url(#arrow)"' : edge.relation.kind === 'constraint' ? 'stroke-dasharray="1 6" stroke-linecap="round"' : ''}/>`).join('');
  const junctions = [...new Map(wires.filter(e => e.relation.kind === 'constraint').map(e => [e.relation.id, e.relation])).values()].map(edge => {
    const center = constraintCenter(edge, graph.nodes);
    const color = changed && edgeChanges.has(edge.id) ? changeColors[edgeChanges.get(edge.id)!] : '#a6a397';
    const label = plan.options.selected && participants(edge).includes(plan.options.selected) && edge.kind === 'constraint' ? `<text x="${center.x}" y="${center.y - 12}" text-anchor="middle" font-size="11" fill="#d9ded4" paint-order="stroke" stroke="#101113" stroke-width="5">${escape(edge.label)}</text>` : '';
    return `<circle cx="${center.x}" cy="${center.y}" r="4" fill="#101113" stroke="${color}"/>${label}`;
  }).join('');
  const regions = guides.islands.map(r => `<rect x="${r.x}" y="${r.y}" width="${r.width}" height="${r.height}" rx="8" fill="#171a1b" stroke="#303632"/><rect x="${r.x + 1}" y="${r.y + 1}" width="${r.width - 2}" height="${groupHeaderHeight}" rx="7" fill="#1d1f21"/><svg x="${r.x + 16}" y="${r.y}" width="${r.width - 32}" height="${groupHeaderHeight}"><text x="50%" y="26" text-anchor="middle" fill="#f0ebde" font-size="13" font-weight="550">${escape(r.title)}</text></svg>`).join('') + guides.rings.map(r => `<ellipse cx="${r.x}" cy="${r.y}" rx="${r.rx}" ry="${r.ry}" fill="none" stroke="#687268" stroke-width="1.25" stroke-dasharray="3 7"/>`).join('');
  return { width: outputWidth, height: outputHeight, svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${outputWidth}" height="${outputHeight}" viewBox="${minX} ${minY} ${width} ${height}" role="img"><title>${escape(plan.title)}</title><defs><pattern id="dots" width="18" height="18" patternUnits="userSpaceOnUse"><circle cx="6" cy="6" r=".7" fill="#ffffff" fill-opacity=".11"/></pattern><marker id="arrow" viewBox="0 0 10 10" refX="10" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M0 0 10 5 0 10" fill="context-stroke"/></marker></defs><rect x="${minX}" y="${minY}" width="${width}" height="${height}" fill="#101113"/><rect x="${minX}" y="${minY}" width="${width}" height="${height}" fill="url(#dots)"/><g font-family="Arial,Helvetica,sans-serif">${regions}${edges}${junctions}${nodes}</g></svg>` };
}
