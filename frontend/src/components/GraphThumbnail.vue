<script setup lang="ts">
import { computed } from 'vue';
import { isAssumption, latestGraph, nodeContent, type Workspace } from '../model';
import { graphLayout, nodeWidth, nodeCardHeight } from '../graph';
import { assumptionColor } from '../graph-presentation';
const props = defineProps<{ workspace: Workspace }>();
const graph = computed(() => graphLayout(latestGraph(props.workspace), 'hierarchy'));
</script>

<template>
  <div class="graph-thumbnail" aria-hidden="true">
    <svg v-if="graph.nodes.length" :viewBox="`0 0 ${graph.width} ${graph.height}`">
      <path v-for="edge in graph.edges" :key="edge.id" :d="edge.path" fill="none" stroke="#787466" stroke-width="2" />
      <g v-for="node in graph.nodes" :key="node.node.id" :transform="`translate(${node.x} ${node.y})`">
        <rect :width="nodeWidth" :height="nodeCardHeight(node.node)" rx="9" fill="#20201c" :stroke="isAssumption(node.node) ? assumptionColor : '#57574c'" :stroke-dasharray="isAssumption(node.node) ? '4 3' : undefined" />
        <text x="16" y="22" fill="#b6a57d" font-size="12" font-family="monospace">{{ node.node.id }}</text>
        <text x="16" y="43" fill="#f0ebde" font-size="17">{{ node.node.title.slice(0, 22) }}</text>
        <text x="16" y="66" fill="#a6a397" font-size="13">{{ nodeContent(node.node).slice(0, 25) }}</text>
      </g>
    </svg>
    <div v-else class="preview-empty"><i class="pi pi-sitemap"/><span>A question worth exploring</span></div>
  </div>
</template>
