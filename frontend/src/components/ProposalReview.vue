<script setup lang="ts">
import Button from 'primevue/button';
import Dialog from 'primevue/dialog';
import { computed } from 'vue';
import type { Proposal, Workspace } from '../model';

const props = defineProps<{ workspace: Workspace; proposal: Proposal | null; busy: boolean }>();
const emit = defineEmits<{ close: []; accept: [id: string]; reject: [id: string]; refresh: [id: string] }>();
const stale = computed(() => props.proposal?.baseRevision !== props.workspace.revision);
</script>

<template>
  <Dialog :visible="!!proposal" modal header="Review the agent proposal" :style="{ width: '620px' }" @update:visible="emit('close')">
    <template v-if="proposal">
      <div class="row between"><span class="eyebrow">Based on revision {{ proposal.baseRevision }}</span><span class="badge gold">{{ proposal.questions.length ? 'Proposed questions' : 'Agent reply' }}</span></div>
      <p class="proposal-message">{{ proposal.message }}</p>
      <p v-if="stale" class="callout">The plan changed after this proposal. Ask the agent to refresh it against your current answers.</p>
      <article v-for="q in proposal.questions" :key="q.id" class="proposal-question">
        <div class="row between"><span class="eyebrow">{{ q.id }} · {{ workspace.questions.some(old => old.id === q.id) ? 'Revise question' : 'Add question' }}</span><span v-if="q.assumption" class="badge gold">Assumption</span></div>
        <h3>{{ q.title }}</h3><p>{{ q.question }}</p>
        <details v-if="workspace.questions.some(old => old.id === q.id)"><summary>Current definition</summary><p>{{ workspace.questions.find(old => old.id === q.id)?.question }}</p><p class="small muted">{{ workspace.questions.find(old => old.id === q.id)?.rationale }}</p><p v-for="old in workspace.questions.find(old => old.id === q.id)?.alternatives" :key="old.label" class="small">{{ old.label }} — {{ old.description }}</p></details>
        <p v-if="q.rationale" class="small muted section-gap">{{ q.rationale }}</p><p v-for="option in q.alternatives" :key="option.label" class="small section-gap"><strong>{{ option.label }}</strong> — {{ option.description }}</p><p class="tiny muted section-gap">Depends on: {{ q.dependsOn.join(', ') || 'No prerequisites' }}</p>
        <p v-if="workspace.answers[q.id]" class="callout">Your answer stays “{{ workspace.answers[q.id].value }}” and will need review.</p>
      </article>
      <p class="small muted section-gap">Only your approval changes the question map. Your answers and history remain yours.</p>
    </template>
    <template #footer><Button label="Leave unaccepted" severity="secondary" text :disabled="busy" @click="proposal && emit('reject', proposal.id)"/><Button v-if="stale" label="Request a fresh proposal" :disabled="busy" @click="proposal && emit('refresh', proposal.id)"/><Button v-else :label="proposal?.questions.length ? 'Accept proposal' : 'Mark read'" :loading="busy" @click="proposal && emit('accept', proposal.id)"/></template>
  </Dialog>
</template>
