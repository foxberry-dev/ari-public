<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import Button from 'primevue/button';
import Dialog from 'primevue/dialog';
import { affectedBy, formatTime, questionStatus, type Question, type Workspace } from '../model';

const props = defineProps<{ workspace: Workspace; question: Question; busy: boolean }>();
const emit = defineEmits<{ answer: [value: string, reason: string]; request: [message: string]; select: [id: string] }>();
const tab = ref('Answer');
const value = ref('');
const reason = ref('');
const message = ref('');
const confirm = ref(false);
const answer = computed(() => props.workspace.answers[props.question.id]);
const affected = computed(() => affectedBy(props.workspace, props.question.id));
const history = computed(() => props.workspace.history.filter(entry => entry.questionId === props.question.id).toReversed());
const questionHistory = computed(() => props.workspace.questionHistory.filter(entry => entry.previous.id === props.question.id).toReversed());
watch(() => [props.question.id, answer.value?.at], () => {
  value.value = answer.value?.value || ''; reason.value = answer.value?.reason || ''; confirm.value = false;
}, { immediate: true });
watch(() => props.question.id, () => { tab.value = 'Answer'; message.value = ''; });
function send() { if (message.value.trim()) { emit('request', message.value); message.value = ''; } }
</script>

<template>
  <aside class="inspector" aria-label="Question details">
    <div class="row between"><span class="eyebrow">{{ question.id }} · {{ question.title }}</span><span class="badge" :class="{ gold: workspace.needsReview.includes(question.id), good: !!answer }">{{ questionStatus(workspace, question) }}</span></div>
    <h2>{{ question.question }}</h2>
    <div class="tabs" role="tablist" aria-label="Question information"><button v-for="name in ['Answer', 'Reasoning', 'Activity']" :key="name" role="tab" :aria-selected="tab === name" :class="{ active: tab === name }" @click="tab = name">{{ name }}</button></div>
    <section v-if="tab === 'Answer'" role="tabpanel" aria-label="Answer">
      <p v-if="question.rationale" class="context-note">{{ question.rationale }}</p>
      <p v-if="question.assumption && !answer" class="callout">This premise needs confirmation. An agent suggestion is not evidence.</p>
      <div v-if="question.alternatives.length" class="options" role="group" aria-label="Answer alternatives">
        <button v-for="option in question.alternatives" :key="option.label" class="option" :class="{ chosen: value === option.label }" :aria-pressed="value === option.label" @click="value = option.label"><span class="radio"/><span><strong>{{ option.label }}</strong><span v-if="option.recommended" class="recommend">Suggested starting point</span><small>{{ option.description }}</small></span></button>
      </div>
      <label class="input-label" for="answer-value">{{ question.alternatives.length ? 'Your answer, or another alternative' : 'Your answer' }}</label><textarea id="answer-value" v-model="value" maxlength="32768" rows="2" placeholder="What works for you?"/>
      <label class="input-label" for="answer-reason">Your reason</label><textarea id="answer-reason" v-model="reason" maxlength="32768" rows="2" placeholder="Keep the reasoning behind your choice."/>
      <div class="actions"><Button label="Choose answer" :disabled="busy || !value.trim()" @click="confirm = true"/><Button label="Develop this" icon="pi pi-sparkles" severity="secondary" outlined :disabled="busy" @click="emit('request', `Explore ${value || 'the alternatives'} for ${question.id}. Explain the trade-offs without committing an answer.`)"/></div>
      <div v-if="answer" class="saved-answer small"><i class="pi pi-check"/> Saved: {{ answer.value }}<p v-if="workspace.needsReview.includes(question.id)" class="gold-text">Review the changed context, then confirm or revise this answer.</p></div>
      <div class="rule"/><p class="eyebrow">What this informs</p>
      <div v-for="q in affected" :key="q.id" class="impact-item"><button class="text-button" @click="emit('select', q.id)">{{ q.id }} ↗</button><span>{{ q.title }}</span><span class="badge">{{ questionStatus(workspace, q) }}</span></div><p v-if="!affected.length" class="small muted section-gap">No later questions recorded yet.</p>
      <div class="rule"/><label class="ask-label" for="agent-message"><i class="pi pi-sparkles"/>Ask your agent about {{ question.id }}</label><div class="askbox"><textarea id="agent-message" v-model="message" maxlength="32768" rows="3" placeholder="What am I overlooking here?" @keydown.ctrl.enter.prevent="send"/><Button icon="pi pi-send" aria-label="Send to agent" :disabled="busy || !message.trim()" @click="send"/></div><p class="tiny muted section-gap">Requests include this question and the current plan. Ctrl+Enter sends.</p>
    </section>
    <section v-else-if="tab === 'Reasoning'" role="tabpanel" aria-label="Reasoning"><p class="body-copy">{{ question.rationale || 'No rationale recorded yet.' }}</p><div class="rule"/><p class="eyebrow">Depends on</p><button v-for="id in question.dependsOn" :key="id" class="relation" @click="emit('select', id)"><span class="gold-text mono">{{ id }}</span><strong>{{ workspace.questions.find(q => q.id === id)?.title }}</strong><small>{{ workspace.answers[id]?.value || 'Unanswered' }}</small></button><p v-if="!question.dependsOn.length" class="small muted section-gap">This question starts the plan.</p><div class="rule"/><Button label="Challenge this reasoning" icon="pi pi-sparkles" severity="secondary" outlined :disabled="busy" @click="emit('request', `Challenge the assumptions and reasoning behind ${question.id}. Identify evidence gaps.`)"/></section>
    <section v-else role="tabpanel" aria-label="Activity"><p class="eyebrow">Answer history</p><article v-for="(entry, index) in history" :key="index" class="history-entry"><time>{{ formatTime(entry.answer.at) }}</time><p v-if="entry.previous" class="previous">{{ entry.previous.value }}</p><strong>{{ entry.answer.value }}</strong><p>{{ entry.answer.reason || 'No reason recorded.' }}</p></article><p v-if="!history.length" class="small muted section-gap">No human answers recorded for this question yet.</p><template v-if="questionHistory.length"><div class="rule"/><p class="eyebrow">Earlier question definitions</p><article v-for="(entry, index) in questionHistory" :key="index" class="history-entry"><time>{{ formatTime(entry.at) }}</time><strong>{{ entry.previous.question }}</strong><p>{{ entry.previous.rationale }}</p><p v-for="option in entry.previous.alternatives" :key="option.label">{{ option.label }} — {{ option.description }}</p></article></template></section>
    <Dialog v-model:visible="confirm" modal header="Confirm your answer" :style="{ width: '480px' }">
      <p class="muted">{{ question.question }}</p><div class="change-line"><span class="mono gold-text">{{ question.id }}</span><span v-if="answer" class="previous">{{ answer.value }} →</span><strong>{{ value }}</strong></div><p v-if="reason" class="body-copy">{{ reason }}</p><p v-if="affected.length" class="callout">{{ affected.map(q => q.id).join(', ') }} will need review. Their current answers and earlier reasoning stay intact.</p><p class="small muted section-gap">Saving also queues this answer for your agent.</p>
      <template #footer><Button label="Keep exploring" severity="secondary" text @click="confirm = false"/><Button label="Save answer" :loading="busy" @click="emit('answer', value, reason); confirm = false"/></template>
    </Dialog>
  </aside>
</template>
