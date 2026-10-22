import type { AgentInfo, TurnStepInput, TurnUsage } from 'claude-code'
import { DEFAULTS, type Settings } from './settings'
import { roleOf, type RoleLine } from './roles'
import type { Decision, Effort } from './types'
import type { Verdict } from './judge'
import { useLangSetting } from './ui/text'

type Sent = TurnStepInput['effort']

export type AgentRec = {
  toolUseId: string
  agentId?: string
  description: string
  label?: string   // the description as sent, with the effort the agent starts on
  role?: string
  model?: string
  type: string
  requested?: Effort
  foreign?: boolean
  danger?: boolean
  judged?: Verdict | null
  decided?: Decision
  sent?: Sent
  status: 'judging' | 'running' | 'done' | 'error'
  startedAt: number
  endedAt?: number
  steps: number
  tokens?: number
  skill?: string
  parent?: string   // agentId of the agent that started this one
  doing?: { verb: string; what: string }
  waiting?: string  // tool_use_id of a call that asked for approval
}

const VERB: Record<string, string> = {
  Read: 'reading', Grep: 'searching', Glob: 'searching', Edit: 'writing', Write: 'writing', NotebookEdit: 'writing',
  Bash: 'running', WebFetch: 'browsing', WebSearch: 'browsing', Agent: 'delegating',
}
const argOf = (input: Record<string, unknown>) =>
  String(input.description ?? input.command ?? input.file_path ?? input.pattern ?? input.query ?? input.url ?? '').split('\n')[0]?.slice(0, 60) ?? ''

const recs: AgentRec[] = []

export const live = (r: AgentRec) => r.status === 'running' || r.status === 'judging'

export const agents = {
  onCall(toolUseId: string, e: { description: string; subagent_type?: string; model?: string; effort?: Effort }): AgentRec {
    const rec: AgentRec = {
      toolUseId, description: e.description, role: roleOf(e.description), type: e.subagent_type ?? 'general-purpose', model: e.model,
      requested: e.effort, status: 'running', startedAt: Date.now(), steps: 0, skill: skills.current()?.name,
    }
    recs.push(rec)
    return rec
  },
  all: () => recs.filter(r => live(r) || Date.now() - (r.endedAt ?? 0) < main.settings.hideDone * 60_000),
  history: (): readonly AgentRec[] => recs,
  byToolUseId: (id: string) => recs.find(x => x.toolUseId === id),
  link(toolUseId: string, r: { agentId?: string; model?: string }, parent?: string) {
    const rec = recs.find(x => x.toolUseId === toolUseId)
    if (rec && r.agentId) Object.assign(rec, { agentId: r.agentId, model: r.model ?? rec.model, parent })
  },
  /** A subagent's tool call: what it is doing now. */
  onTool(agentId: string, tool: string, input: Record<string, unknown>) {
    const rec = recs.find(x => x.agentId === agentId)
    if (rec) rec.doing = { verb: VERB[tool] ?? tool.toLowerCase(), what: argOf(input) }
  },
  onAsk(agentId: string, toolUseId: string) {
    const rec = recs.find(x => x.agentId === agentId)
    if (rec) rec.waiting = toolUseId
  },
  /** The asked call ran or was refused. */
  onToolEnd(agentId: string, toolUseId: string): boolean {
    const rec = recs.find(x => x.agentId === agentId && x.waiting === toolUseId)
    if (rec) rec.waiting = undefined
    return !!rec
  },
  byAgentId: (agentId: string) => recs.find(x => x.agentId === agentId),
  /** When the first request arrives before agent.spawn resolves, match by description and type from $.agent.list(). */
  match(agentId: string, list: readonly AgentInfo[]): AgentRec | undefined {
    const info = list.find(a => a.id === agentId)
    const rec = info && recs.find(x => !x.agentId && (x.label ?? x.description) === info.description && x.type === info.type)
    if (rec) rec.agentId = agentId
    return rec
  },
  onDecided(rec: AgentRec, d: Decision, sent: Sent) {
    rec.decided = d
    rec.sent = sent
    rec.steps++
    rec.status = 'running'   // also for an agent resumed by SendMessage
  },
  /** Size of the last request including cache reads and writes: the context the agent uses now. */
  onUsage(rec: AgentRec, u: TurnUsage) {
    rec.tokens = u.input_tokens + u.cache_read_input_tokens + u.cache_creation_input_tokens + u.output_tokens
  },
  onHold(agentId: string) {
    const rec = recs.find(x => x.agentId === agentId)
    if (rec) rec.doing = { verb: 'waiting', what: 'on background work' }
  },
  onEnd(agentId: string, reason: string) {
    const rec = recs.find(x => x.agentId === agentId)
    if (rec) Object.assign(rec, { status: reason === 'answer' ? 'done' : 'error', endedAt: Date.now(), waiting: undefined })
  },
  fail(toolUseId: string) {
    const rec = recs.find(x => x.toolUseId === toolUseId)
    if (rec && !rec.agentId) Object.assign(rec, { status: 'error', endedAt: Date.now() })
  },
}

export const main: {
  settings: Settings
  roles: RoleLine[]
  humanEffort?: Effort
  judged?: Verdict | null
  held?: Verdict | null   // a lower call made mid-turn, applied when the main turn ends
  judging: boolean
  judgeDown?: boolean
  danger?: boolean
  decided?: Decision
  sent?: Sent
  model?: string   // the main agent's model at its last request, for display
  onDecided(d: Decision, sent: Sent): void
  apply(key: string, s: Settings): void
} = {
  settings: DEFAULTS,
  roles: [],
  judging: false,
  onDecided(d, sent) {
    main.decided = d
    main.sent = sent
  },
  apply(key, s) {
    main.settings = s
    if (key === 'auto' && s.auto) main.humanEffort = undefined
  },
}

useLangSetting(() => main.settings.lang)

export type SkillRec = { name: string; parent?: string; startedAt: number; endedAt?: number }
type Item = { id?: string; name: string; status: string }

const skillRecs: SkillRec[] = []
let items: Item[] = []
let mainDone = false   // the main turn has ended (turn.step resets it)
const open = () => skillRecs.filter(r => r.endedAt === undefined)
const endAll = () => {
  for (const r of open()) r.endedAt = Date.now()
  items = []
}

export const skills = {
  enter(name: string) {
    if (open().some(r => r.name === name)) return
    skillRecs.push({ name, parent: skills.current()?.name, startedAt: Date.now() })
  },
  start(name: string) {
    mainDone = false
    endAll()
    skills.enter(name)
  },
  mainTurn(running: boolean) {
    mainDone = !running
  },
  settle(): boolean {
    if (!mainDone || !open().length || recs.some(live)) return false
    endAll()
    return true
  },
  // shortcut: a skill ends when the main turn is over and no agent runs (or another pstack skill starts, or session.start). A skill that asks the user a question also ends that turn, and an agent that never sends turn.complete keeps it open. Revisit when a pstack_phase tool exists.
  current: (): SkillRec | undefined => open().at(-1),
  tree: (): SkillRec[] => [...skillRecs],
}

export const phase = {
  todos(list: readonly { content: string; status: string }[]) {
    if (skills.current()) items = list.map(t => ({ name: t.content, status: t.status }))
  },
  created(id: string | undefined, name: string) {
    if (skills.current()) items.push({ id, name, status: 'pending' })
  },
  updated(id: string, u: { subject?: string; status?: string }) {
    const it = items.find(x => x.id === id)
    if (!it) return
    if (u.status === 'deleted') items = items.filter(x => x !== it)
    else Object.assign(it, { name: u.subject ?? it.name, status: u.status ?? it.status })
  },
  all: (): readonly Item[] => items,
  current(): { name: string; index: number; total: number } | undefined {
    const i = items.findIndex(x => x.status === 'in_progress')
    return i < 0 ? undefined : { name: items[i].name, index: i + 1, total: items.length }
  },
}

export type UiState = {
  tab: 'agents' | 'settings'
  agentsView: 'list' | 'board'
  peek?: string
  viewing?: string
  opened: boolean
  hintShown: boolean
  hint: boolean
  rest?: { skill: string; ms: number; agents: number }   // the band's one line after a skill's turn ends
  card?: string
  help: boolean
  more: boolean
  draft: Record<string, string>
  columns?: number               // terminal width at the last draw; the status line does not get it, so take it from render hooks and command.run
  fullscreen?: boolean
  docked?: boolean
}

const UI: UiState = { tab: 'agents', agentsView: 'board', opened: false, hintShown: false, hint: false, help: false, more: false, draft: {} }

export const ui: UiState & { set(patch: Partial<UiState>): void } = {
  ...UI,
  set(patch) {
    Object.assign(ui, patch)
  },
}

export function resetState() {
  ui.set({ ...UI, rest: undefined, peek: undefined, viewing: undefined, columns: undefined, fullscreen: undefined, docked: undefined, card: undefined, draft: {} })
  recs.length = 0
  skillRecs.length = 0
  mainDone = false
  items = []
  Object.assign(main, { humanEffort: undefined, judged: undefined, held: undefined, judging: false, judgeDown: undefined, danger: undefined, decided: undefined, sent: undefined, model: undefined })
}
