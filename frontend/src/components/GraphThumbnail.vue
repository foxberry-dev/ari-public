<script setup lang="ts">
import { computed } from 'vue';
import type { Workspace } from '../model';
import { layout, nodeWidth, nodeHeight } from '../graph';
const props = defineProps<{ workspace: Workspace }>();
const graph = computed(() => layout(props.workspace.questions));
</script>

<template>
  <div class="graph-thumbnail" aria-hidden="true">
    <svg v-if="graph.nodes.length" :viewBox="`0 0 ${graph.width} ${graph.height}`">
      <path v-for="edge in graph.edges" :key="edge.id" :d="edge.path" fill="none" stroke="#787466" stroke-width="2" />
      <g v-for="node in graph.nodes" :key="node.question.id" :transform="`translate(${node.x} ${node.y})`">
        <rect :width="nodeWidth" :height="nodeHeight" rx="9" fill="#20201c" :stroke="workspace.needsReview.includes(node.question.id) ? '#e6b85c' : '#57574c'" />
        <text x="16" y="30" fill="#b6a57d" font-size="12" font-family="monospace">{{ node.question.id }}</text>
        <text x="16" y="65" fill="#f0ebde" font-size="17">{{ node.question.title.slice(0, 22) }}</text>
        <text x="16" y="94" fill="#a6a397" font-size="13">{{ (workspace.answers[node.question.id]?.value || 'Awaiting an answer').slice(0, 25) }}</text>
      </g>
    </svg>
    <div v-else class="preview-empty"><i class="pi pi-sitemap"/><span>A question worth exploring</span></div>
  </div>
</template>
