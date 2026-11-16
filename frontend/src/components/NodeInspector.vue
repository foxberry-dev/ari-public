<script setup lang="ts">
import { computed } from 'vue';
import { formatTime, isAssumption, nodeContent, nodeStatus, selectedAlternative, type GraphNode, type GraphCommit, type Graph, type Workspace } from '../model';
import type { ChangeKind } from '../graph';
import { participants, relationships, relationshipChanges, type Relationship } from '../relationships';
const props = defineProps<{ node: GraphNode; workspace: Workspace; commit: GraphCommit; previous: Graph; change?: ChangeKind }>();
const emit = defineEmits<{ select: [id: string]; close: [] }>();
const choice = computed(() => selectedAlternative(props.node));
const options = computed(() => [...props.node.alternatives].sort((a, b) => Number(b.label === choice.value) - Number(a.label === choice.value)));
const hasChoice = computed(() => options.value.some(option => option.label === choice.value));
const graph = computed(() => props.change === 'removed' ? props.previous : props.commit.graph);
const connected = computed(() => relationships(graph.value).filter(e => participants(e).includes(props.node.id)));
const priorConnections = computed(() => {
  if (!props.change || props.change === 'removed') return [];
  const changes = relationshipChanges(props.previous, props.commit.graph);
  return relationships(props.previous).filter(e => participants(e).includes(props.node.id) && ['removed', 'changed'].includes(changes.get(e.id) || ''));
});
function connectionLabel(edge: Relationship) {
  if (edge.kind === 'constraint') return `${edge.strength === 'requirement' ? 'Requirement' : 'Preference'} · ${edge.label}`;
  if (edge.kind === 'parent') return edge.from === props.node.id ? 'Child' : 'Parent';
  if (edge.kind === 'legacy') return 'Historical dependency';
  return edge.from === props.node.id ? 'Provides input to' : 'Uses input from';
}
function connectedNodes(edge: Relationship) {
  return participants(edge).filter(id => id !== props.node.id).map(id => graph.value.nodes.find(n => n.id === id) || props.previous.nodes.find(n => n.id === id)).filter((n): n is GraphNode => !!n);
}
const history = computed(() => props.workspace.history?.filter(h => h.questionId === props.node.id) || []);
const definitions = computed(() => props.workspace.questionHistory?.filter(h => h.previous.id === props.node.id) || []);
const proposals = computed(() => props.workspace.proposals?.filter(p => p.questions.some(q => q.id === props.node.id)) || []);
</script>
<template>
  <aside class="node-inspector" aria-label="Node details"><header class="inspector-heading"><div><h2>{{ node.title }}</h2><span class="node-kind" :class="{ assumption: isAssumption(node) }">{{ change === 'removed' ? 'Removed in this commit' : nodeStatus(node) }}</span></div><button class="quiet" aria-label="Close node details" autofocus @click="emit('close')">×</button></header>
    <p v-if="!hasChoice" :class="isAssumption(node) || node.kind === 'decided' ? 'selected-answer' : 'node-context'">{{ nodeContent(node) }}</p>
    <section v-if="options.length" class="node-assumptions"><article v-for="option in options" :key="option.label" class="detail-option" :class="{ chosen: choice === option.label }"><span v-if="choice === option.label" class="option-state">{{ isAssumption(node) ? 'Assumed' : 'Decided' }}</span><strong>{{ option.label }}</strong><span v-if="option.recommended" class="small muted"> · Suggested</span><p v-if="choice === option.label && node.content !== option.label" class="selected-answer">{{ node.content }}</p><p v-if="option.description">{{ option.description }}</p></article></section>
    <section v-if="node.kind === 'forecast'"><h3>Earlier forecast question</h3><p>{{ node.content }}</p></section>
    <section v-if="connected.length"><h3>Relationships</h3><article v-for="edge in connected" :key="edge.id" class="connection-detail"><h4>{{ connectionLabel(edge) }}</h4><p v-if="edge.kind === 'input'">{{ edge.rationale }}</p><p v-if="edge.kind === 'constraint'">{{ edge.rule }}</p><p v-if="edge.kind === 'constraint'" class="constraint-scope"><span v-for="p in edge.participants.filter(p => p.alternative)" :key="p.nodeId">{{ graph.nodes.find(n => n.id === p.nodeId)?.title }}: {{ p.alternative }}<br></span></p><button v-for="item in connectedNodes(edge)" :key="item.id" class="related-node" @click="emit('select', item.id)">{{ item.title }} →</button></article></section>
    <section v-if="priorConnections.length"><h3>Previous relationships</h3><article v-for="edge in priorConnections" :key="edge.id" class="connection-detail"><h4>{{ connectionLabel(edge) }}</h4><p v-if="edge.kind === 'constraint'">{{ edge.rule }}</p><p v-if="edge.kind === 'input'">{{ edge.rationale }}</p><p v-for="item in connectedNodes(edge)" :key="item.id">{{ item.title }}</p></article></section>
    <details v-if="history.length || definitions.length || proposals.length"><summary>Preserved earlier records</summary><article v-for="(entry, i) in history" :key="`answer-${i}`"><p>{{ entry.answer.value }}</p><p>{{ entry.answer.reason }}</p><time>{{ formatTime(entry.answer.at) }}</time></article><article v-for="(entry, i) in definitions" :key="`definition-${i}`"><p>{{ entry.previous.question }}</p><p>{{ entry.previous.rationale }}</p><p v-for="option in entry.previous.alternatives" :key="option.label">{{ option.label }} · {{ option.description }}</p></article><article v-for="proposal in proposals" :key="proposal.id"><p>{{ proposal.status }} · {{ proposal.message }}</p></article></details>
  </aside>
</template>
