<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import Button from 'primevue/button';
import Dialog from 'primevue/dialog';
import BerryMark from './components/BerryMark.vue';
import ClarityLibrary from './components/ClarityLibrary.vue';
import DependencyAtlas from './components/DependencyAtlas.vue';
import QuestionInspector from './components/QuestionInspector.vue';
import ProposalReview from './components/ProposalReview.vue';
import { api, ApiError } from './api';
import { counts, formatTime, questionStatus, type Action, type AgentStatus, type Proposal, type Workspace } from './model';
import { installOverlayScrollbars } from './scrollbars';

const items = ref<Workspace[]>([]);
const workspace = ref<Workspace | null>(null);
const selected = ref('');
const loading = ref(true);
const busy = ref(false);
const connected = ref(false);
const error = ref('');
const notice = ref('');
const showHistory = ref(false);
const reviewId = ref('');
const libraryState = ref({ query: '', selectedId: '', scrollTop: 0 });
const request = ref('');
const status = ref<AgentStatus>({ waiting: 0, queued: 0, working: 0 });
const currentQuestion = computed(() => workspace.value?.questions.find(q => q.id === selected.value));
const pending = computed(() => workspace.value?.proposals.filter(p => p.status === 'pending').toReversed() || []);
const reviewing = computed(() => workspace.value?.proposals.find(p => p.id === reviewId.value) || null);
const stats = computed(() => workspace.value ? counts(workspace.value) : null);
let events: EventSource;
let interval: ReturnType<typeof setInterval>;
let noticeTimer: ReturnType<typeof setTimeout>;
let refreshSequence = 0;
let disposeScrollbars: (() => void) | undefined;

function routeId() { return decodeURIComponent(location.hash.match(/^#\/clarifications\/([^/]+)$/)?.[1] || ''); }
function open(id: string) { location.hash = `/clarifications/${encodeURIComponent(id)}`; }
function home() { location.hash = '/'; }
function notify(message: string) { notice.value = message; clearTimeout(noticeTimer); noticeTimer = setTimeout(() => notice.value = '', 4500); }

async function refresh() {
  const sequence = ++refreshSequence;
  const id = routeId();
  try {
    const [all, detail, agent] = await Promise.all([
      api<Workspace[]>('/workspaces'),
      id ? api<Workspace>(`/workspaces/${encodeURIComponent(id)}`) : Promise.resolve(null),
      id ? api<AgentStatus>(`/workspaces/${encodeURIComponent(id)}/agent`) : Promise.resolve({ waiting: 0, queued: 0, working: 0 }),
    ]);
    if (sequence !== refreshSequence || id !== routeId()) return;
    items.value = all; workspace.value = detail; status.value = agent;
    if (detail && !detail.questions.some(q => q.id === selected.value)) selected.value = detail.questions.find(q => !detail.answers[q.id])?.id || detail.questions[0]?.id || '';
  } catch (cause) {
    if (sequence === refreshSequence) error.value = cause instanceof Error ? cause.message : 'Cannot reach Ari';
  } finally { if (sequence === refreshSequence) loading.value = false; }
}

async function navigate() {
  workspace.value = null; reviewId.value = ''; selected.value = ''; error.value = ''; loading.value = true;
  await refresh();
}

async function act(action: Action) {
  const current = workspace.value;
  if (!current || busy.value) return;
  busy.value = true; error.value = '';
  try {
    const result = await api<Workspace>(`/workspaces/${encodeURIComponent(current.id)}/actions`, { ...action, expectedRevision: current.revision });
    if (routeId() === result.id) workspace.value = result;
    if (action.kind === 'answer') notify('Answer saved. Connected questions are marked for review.');
    if (action.kind === 'request') notify('Request queued for your agent.');
    reviewId.value = '';
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : 'Could not save';
    if (cause instanceof ApiError && cause.status === 409) await refresh();
  } finally { busy.value = false; await refresh(); }
}

function ask(message: string, questionId = selected.value || undefined) {
  return act({ kind: 'request', questionId, message });
}

async function copy(text: string) { try { await navigator.clipboard.writeText(text); notify('Copied to clipboard.'); } catch { error.value = 'Clipboard unavailable. Select and copy the text instead.'; } }
function review(proposal: Proposal) { reviewId.value = proposal.id; }

onMounted(() => {
  disposeScrollbars = installOverlayScrollbars();
  window.addEventListener('hashchange', navigate);
  events = new EventSource('/api/events');
  events.onopen = () => { connected.value = true; void refresh(); };
  events.onmessage = () => void refresh();
  events.onerror = () => { connected.value = false; };
  interval = setInterval(() => { if (document.visibilityState === 'visible') void refresh(); }, 5000);
  void refresh();
});
onUnmounted(() => { disposeScrollbars?.(); events?.close(); clearInterval(interval); clearTimeout(noticeTimer); window.removeEventListener('hashchange', navigate); });
</script>

<template>
  <div class="app" :class="{ 'in-workspace': !!workspace }">
    <header class="page-header"><div class="header-inner" :class="workspace ? 'workspace-header' : 'library-header'">
      <button class="identity quiet" aria-label="Ari clarity library" @click="home"><BerryMark/><span class="wordmark">ari</span></button><template v-if="workspace"><span class="identity-divider"/><span class="identity-label">{{ workspace.title }}</span></template><span class="spacer"/>
      <button v-if="workspace" class="quiet" aria-label="History" @click="showHistory = true"><i class="pi pi-history" aria-hidden="true"/><span class="header-action-label">History</span></button>
      <span class="connection" :title="connected ? 'The browser is connected to Ari. This is separate from the agent listener.' : 'Reconnecting to the Ari server'"><i class="pi" :class="connected ? 'pi-check-circle good-text' : 'pi-exclamation-circle gold-text'"/><span>{{ connected ? 'Connected' : 'Reconnecting' }}</span></span>
    </div></header>
    <div v-if="error" class="error-notice" role="alert"><i class="pi pi-exclamation-triangle"/><span>{{ error }}</span><button @click="error = ''; refresh()">Retry</button><button aria-label="Dismiss error" class="quiet" @click="error = ''">×</button></div>
    <ClarityLibrary v-if="!workspace && !routeId()" v-model:state="libraryState" :items="items" :loading="loading" @open="open"/>
    <main v-else-if="!workspace" class="container loading-page"><p>{{ loading ? 'Opening your clarification…' : 'This clarification could not be opened.' }}</p><Button label="Back to library" severity="secondary" outlined @click="home"/></main>
    <template v-else>
      <div class="taskbar"><button class="quiet back-button" aria-label="Back to library" @click="home"><i class="pi pi-arrow-left"/></button><div><h1>{{ workspace.title }}</h1><p>{{ workspace.description || 'Clarify the choices. Keep the reasoning.' }}</p></div><span class="spacer"/><div class="workspace-counts"><span class="badge good">{{ stats?.decided }} decided</span><span class="badge">{{ stats?.open }} open</span><span v-if="stats?.review" class="badge gold">{{ stats.review }} to check</span></div></div>
      <div class="mobile-picker"><label for="question-picker">Question</label><select id="question-picker" v-model="selected"><option v-for="q in workspace.questions" :key="q.id" :value="q.id">{{ q.id }} · {{ q.title }}</option></select></div>
      <div class="workspace">
        <aside class="outline"><p class="eyebrow">Plan outline</p><div class="tree-root">{{ workspace.title }}</div><nav aria-label="Questions" class="tree-list"><button v-for="q in workspace.questions" :key="q.id" class="tree-item" :class="{ selected: selected === q.id }" :aria-current="selected === q.id ? 'true' : undefined" @click="selected = q.id"><span class="mono">{{ q.id }}</span><span><strong>{{ q.title }}</strong><small>{{ questionStatus(workspace, q) }}</small></span></button></nav><p class="outline-note"><i class="pi pi-share-alt"/>Shared questions stay connected.<span>One decision can inform several others.</span></p></aside>
        <DependencyAtlas :workspace="workspace" :selected="selected" @select="selected = $event">
          <div class="agent-activity" :class="{ pending: pending.length || status.queued }"><span class="activity-icon"><i class="pi pi-sparkles"/></span><div><strong>{{ pending.length ? `${pending.length} agent ${pending.length === 1 ? 'reply' : 'replies'} to review` : status.working ? 'Your agent has picked up work' : status.waiting ? 'Your agent is listening' : status.queued ? 'Waiting for your agent' : 'No agent listener' }}</strong><p>{{ pending.length ? 'Review the reasoning before changing the plan.' : status.queued ? `${status.queued} queued event${status.queued === 1 ? '' : 's'} · saved until a listener picks them up` : status.waiting ? 'Answer a question or send a request.' : status.working ? 'An event is claimed. Replies appear here.' : 'A running listener lets UI actions reach your agent.' }}</p></div><button v-if="pending.length" class="primary" @click="review(pending[0])">Review reply</button><button v-else-if="status.waiting || status.working" :disabled="busy" @click="ask('Explore what is missing. Propose useful questions and make assumptions explicit.')">Explore gaps</button></div>
        </DependencyAtlas>
        <QuestionInspector v-if="currentQuestion" :workspace="workspace" :question="currentQuestion" :busy="busy" @select="selected = $event" @answer="(value, reason) => act({ kind: 'answer', questionId: selected, value, reason })" @request="ask($event)"/>
        <aside v-else class="inspector getting-started"><p class="eyebrow">From idea to clarity</p><h2>What do you need to figure out?</h2><p class="context-note">Describe the outcome you want. Your agent can propose the first connected questions.</p><label class="input-label" for="first-request">Ask your agent</label><textarea id="first-request" v-model="request" rows="5" placeholder="Help me find the decisions and assumptions behind this idea."/><Button label="Send request" icon="pi pi-sparkles" :disabled="busy || !request.trim()" @click="ask(request, undefined); request = ''"/><p class="tiny muted section-gap">The creation request is already queued. Connect a listener to start the conversation.</p></aside>
      </div>
      <footer class="workspace-footer"><span>{{ status.waiting ? 'Agent listening' : status.working ? 'Agent working' : 'No agent listener' }}</span><span class="spacer"/><span>Dependency atlas</span><span class="mono">revision {{ workspace.revision }}</span><button class="text-button mono" @click="copy(`ari@${workspace.id}`)">ari@{{ workspace.id }}</button></footer>
      <ProposalReview :workspace="workspace" :proposal="reviewing" :busy="busy" @close="reviewId = ''" @accept="act({ kind: 'acceptProposal', proposalId: $event })" @reject="act({ kind: 'rejectProposal', proposalId: $event })" @refresh="ask(`Refresh proposal ${$event} against the current answers and revision. Preserve the user's decisions.`); reviewId = ''"/>
    </template>
    <Dialog v-model:visible="showHistory" modal header="Decision history" :style="{ width: '600px' }"><template v-if="workspace"><p class="eyebrow">Human answers</p><article v-for="(entry, index) in workspace.history.toReversed()" :key="index" class="history-entry"><div class="row between"><span class="gold-text mono">{{ entry.questionId }}</span><time>{{ formatTime(entry.answer.at) }}</time></div><p v-if="entry.previous" class="previous">{{ entry.previous.value }} →</p><strong>{{ entry.answer.value }}</strong><p>{{ entry.answer.reason || 'No reason recorded.' }}</p></article><p v-if="!workspace.history.length" class="small muted section-gap">No answers saved yet.</p><div class="rule"/><p class="eyebrow">Agent proposals and replies</p><article v-for="proposal in workspace.proposals.toReversed()" :key="proposal.id" class="history-entry"><span class="badge">{{ proposal.status }}</span><p>{{ proposal.message }}</p><button v-if="proposal.status === 'pending'" @click="showHistory = false; review(proposal)">Review reply</button></article></template><template #footer><Button label="Close" severity="secondary" @click="showHistory = false"/></template></Dialog>
    <div v-if="notice" class="notice" role="status"><i class="pi pi-check-circle"/>{{ notice }}</div>
  </div>
</template>
