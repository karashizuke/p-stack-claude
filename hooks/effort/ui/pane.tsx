import type { EngineInterface, RenderChildren, RenderInput, UiOpenResult } from 'claude-code'
import { family, modelName, stripTag } from '../roles'
import { CARD_EDGE, EFFORT_COLOR, MODEL_COLOR, STATE_COLOR, VIEW_TEXT, WAIT_BG, WAIT_TEXT } from './art'
import { CARDS, saveSetting, shownRows, valueOf, type Row } from '../settings'
import { agents, live, main, phase, skills, ui, type AgentRec, type UiState } from '../state'
import { effortText, took } from './row'
import { redraw, toast } from './status'
import { t } from './text'
import { change, closePeek, openAgent, showPeek, syncView } from './viewing'

export const PANE_ID = 'pstack-effort'
const PANEL_SKILLS = ['architect', 'arena', 'interrogate']
const MARK: Record<AgentRec['status'], string> = { judging: '◌', running: '●', done: '✓', error: '✗' }
// The dock's width: a list of agents, not a second transcript.
const PANE_COLUMNS = 44
const RAIL: Record<string, string> = { completed: '✓', in_progress: '▶' }

const nameOf = (r: AgentRec) => stripTag(r.description)
const effortOf = (r: AgentRec) => (r.status === 'judging' ? t('pane.judging') : effortText(r))
const wordOf = (r: AgentRec) => r.sent ?? r.decided?.effort ?? undefined
const clip = (text: string, n: number) => (text.length > n ? `${text.slice(0, n - 1)}…` : text)
const picked = (r: AgentRec) => !!r.agentId && (ui.peek === r.agentId || ui.viewing === r.agentId)
const ago = (r: AgentRec) => took((r.endedAt ?? Date.now()) - r.startedAt)
const count = (words: (string | undefined)[]) =>
  Object.entries(words.reduce<Record<string, number>>((n, w) => (w ? { ...n, [w]: (n[w] ?? 0) + 1 } : n), {})).map(([w, n]) => `${w} ${n}`).join(' · ')

export async function openPane($: EngineInterface, asked: boolean): Promise<UiOpenResult | undefined> {
  ui.set({ opened: true })
  const r = await $.ui.open({ id: PANE_ID, title: 'pstack', rows: 3, columns: PANE_COLUMNS }).catch(() => undefined)
  // A hidden band cannot draw the hint, so do not spend hintShown on it.
  // A mod-opened pane only docks from 144 columns; the person can open it narrower, so offer the hint once at 110-143.
  if (asked || !r || r.isPlaced || ui.hintShown || main.settings.bar === 'hide') return r
  const columns = ui.columns ?? 0
  if (columns >= 110 && columns < 144) {
    change($, { hintShown: true, hint: true })
  }
  return r
}

export function autoOpen($: EngineInterface) {
  if (!ui.opened && ui.fullscreen === true && agents.all().some(live)) void openPane($, false)
}

function pick($: EngineInterface, r: AgentRec) {
  return () => {
    if (!r.agentId) return
    if (ui.peek === r.agentId) return openAgent($, r.agentId)
    showPeek($, r.agentId)
  }
}

const arg = (input: Record<string, unknown>) =>
  String(input.description ?? input.command ?? input.file_path ?? input.pattern ?? input.query ?? '').split('\n')[0].slice(0, 60)

type Row1 = { role: string; text?: string; toolUses?: { tool: string; input: Record<string, unknown> }[] }
const lastSaid = (rows: unknown) =>
  (Array.isArray(rows) ? (rows as Row1[]) : []).filter(m => m.role === 'assistant' && m.text).at(-1)?.text?.replace(/\s+/g, ' ').slice(0, 80)
/** A card's last line: what the agent last said, else its last tool call (an agent that answers by a tool says nothing). */
function lastLine(rows: unknown): string | undefined {
  const use = (Array.isArray(rows) ? (rows as Row1[]) : []).flatMap(m => m.toolUses ?? []).at(-1)
  const said = typeof use?.input.message === 'string' ? use.input.message.replace(/\s+/g, ' ').slice(0, 80) : use && `${use.tool} ${arg(use.input)}`.trim()
  return lastSaid(rows) ?? said
}

async function peekBox($: EngineInterface, e: RenderInput<'Pane'>, id: string) {
  const { Box, Text, Button } = $.ui.resolve(e)
  const rec = agents.byAgentId(id)
  const got = await $.session.messages({ agentId: id }).catch((err: unknown) => ({ deny: String(err) }))
  const rows = Array.isArray(got) ? got : []
  const uses = rows.flatMap(m => m.toolUses).slice(-5)
  const said = lastSaid(rows)
  return (
    <Box key="peek" flexDirection="column" borderStyle="round" borderColor={CARD_EDGE} paddingX={1}>
      <Text bold>{rec ? nameOf(rec) : id}</Text>
      {!Array.isArray(got) && <Text dimColor>{got.deny}</Text>}
      {uses.map(u => <Text dimColor wrap="truncate">{u.tool} {arg(u.input)}</Text>)}
      {said && <Text wrap="truncate">{said}</Text>}
      <Box flexDirection="row" gap={1}>
        <Button key="peek:open" variant="primary" onPress={() => openAgent($, id)}>{t('pane.open')}</Button>
        <Button key="peek:close" plain onPress={() => closePeek($)}>{t('pane.close')}</Button>
      </Box>
    </Box>
  )
}

function mark($: EngineInterface, e: RenderInput<'Pane'>, r: AgentRec) {
  const { Text } = $.ui.resolve(e)
  if (r.waiting) return <Text color={WAIT_TEXT}>?</Text>
  const running = r.status === 'running'
  return <Text color={running ? MODEL_COLOR[family(r.model) ?? ''] ?? STATE_COLOR.running : STATE_COLOR[r.status]} dimColor={r.status === 'judging'}>{running ? '●' : MARK[r.status]}</Text>
}

function nameButton($: EngineInterface, e: RenderInput<'Pane'>, r: AgentRec, room: number) {
  const { Text, Button } = $.ui.resolve(e)
  return (
    <Button key={`agent:${r.toolUseId}`} plain onPress={pick($, r)}>
      <Text bold={picked(r)}>{clip(nameOf(r), room)}</Text>
    </Button>
  )
}

function agentRow($: EngineInterface, e: RenderInput<'Pane'>, r: AgentRec) {
  const { Box, Text } = $.ui.resolve(e)
  return (
    <Box key={`row:${r.toolUseId}`} flexDirection="row" columnGap={1}>
      <Box flexShrink={0}>{mark($, e, r)}</Box>
      <Box flexShrink={0}>{nameButton($, e, r, 18)}</Box>
      <Box flexGrow={1} flexShrink={1} minWidth={0}><Text dimColor wrap="truncate">{r.role ?? ''}</Text></Box>
      {/* Only the role gives way; the facts on the right keep their width. */}
      <Box flexShrink={0} flexDirection="row" columnGap={1}>
        <Text dimColor>{family(r.model) ?? r.type}</Text>
        <Text color={EFFORT_COLOR[wordOf(r) ?? '']}>{effortOf(r)}</Text>
        <Text dimColor>{ago(r)}</Text>
        {ui.viewing === r.agentId && <Text color={VIEW_TEXT}>◉</Text>}
      </Box>
    </Box>
  )
}

/** One agent of a role line: its name and model, state, effort and time, and the start of its last message. */
function agentCard($: EngineInterface, e: RenderInput<'Pane'>, r: AgentRec, width: number, said?: string) {
  const { Box, Text } = $.ui.resolve(e)
  return (
    <Box key={`agentcard:${r.toolUseId}`} flexDirection="column" width={width} paddingX={1} borderStyle="round" borderColor={CARD_EDGE}>
      <Box flexDirection="row" columnGap={1}>
        <Box flexShrink={0}>{nameButton($, e, r, width - 8)}</Box>
        <Box flexGrow={1} flexShrink={1} minWidth={0}><Text dimColor wrap="truncate">{family(r.model) ?? r.type}</Text></Box>
        <Box flexShrink={0}>{mark($, e, r)}</Box>
      </Box>
      <Text wrap="truncate">
        <Text color={EFFORT_COLOR[wordOf(r) ?? '']}>{effortOf(r)}</Text> <Text dimColor>{ago(r)}</Text>
      </Text>
      <Text dimColor wrap="truncate">{said ?? ' '}</Text>
    </Box>
  )
}

async function board($: EngineInterface, e: RenderInput<'Pane'>, list: AgentRec[]) {
  const { Box, Text } = $.ui.resolve(e)
  const lines = main.roles.filter(l => list.some(r => r.role === l.role))
  const rest = list.filter(r => !lines.some(l => l.role === r.role))
  const carded = list.filter(r => r.agentId && lines.some(l => l.role === r.role))
  // shortcut: reads each carded agent's conversation on every draw; cache by agent if boards grow past a handful.
  const said = new Map(await Promise.all(carded.map(async r => [r.toolUseId, lastLine(await $.session.messages({ agentId: r.agentId! }).catch(() => []))] as const)))
  const width = Math.max(16, Math.floor((e.props.bodyColumns - 1) / 2))
  return [
    ...lines.map(l => (
      <Box key={`card:${l.role}`} flexDirection="column">
        <Text dimColor wrap="truncate">{l.role} · {l.seats.map(seat => [seat.model, seat.effort].filter(Boolean).join(' ')).join(', ')}</Text>
        <Box flexDirection="row" flexWrap="wrap" columnGap={1}>
          {list.filter(r => r.role === l.role).map(r => agentCard($, e, r, width, said.get(r.toolUseId)))}
        </Box>
      </Box>
    )),
    ...agentRows($, e, rest),
  ]
}

/** Agents as a tree: each one's children under it, and under a live one what it is doing now. */
function agentRows($: EngineInterface, e: RenderInput<'Pane'>, list: AgentRec[]): RenderChildren[] {
  const { Box, Text } = $.ui.resolve(e)
  const ids = new Set(list.map(r => r.agentId).filter(Boolean))
  const walk = (level: AgentRec[], lead: string): RenderChildren[] =>
    level.flatMap((r, i) => {
      const last = i === level.length - 1
      const under = `${lead}${last ? '  ' : '│ '}`
      const kids = r.agentId ? list.filter(k => k.parent === r.agentId) : []
      const doing = live(r) && (r.waiting ? { verb: 'needs approval', what: r.doing?.what ?? '' } : r.doing)
      return [
        <Box key={`tree:${r.toolUseId}`} flexDirection="row" {...(r.waiting ? { backgroundColor: WAIT_BG } : {})}>
          <Box flexShrink={0}><Text color={CARD_EDGE}>{`${lead}${last ? '└ ' : '├ '}`}</Text></Box>
          <Box flexGrow={1} minWidth={0}>{agentRow($, e, r)}</Box>
        </Box>,
        doing && (
          <Box key={`doing:${r.toolUseId}`} flexDirection="row" columnGap={1} {...(r.waiting ? { backgroundColor: WAIT_BG } : {})}>
            <Box flexShrink={0}><Text color={CARD_EDGE}>{`${under}  `}</Text></Box>
            <Box flexShrink={0}><Text color={r.waiting ? WAIT_TEXT : VIEW_TEXT}>{doing.verb}</Text></Box>
            <Box flexGrow={1} minWidth={0}><Text dimColor wrap="truncate">{doing.what}</Text></Box>
          </Box>
        ),
        ...walk(kids, under),
      ].filter(Boolean)
    })
  return walk(list.filter(r => !r.parent || !ids.has(r.parent)), '  ')
}

/** Agents and skills in one tree: each skill run as a heading with its agents under it, then agents started outside a skill. */
async function crewTab($: EngineInterface, e: RenderInput<'Pane'>) {
  const { Box, Text, Button } = $.ui.resolve(e)
  const list = agents.all()
  const all = agents.history()   // history, so agents hidden by hideDone still count
  const now = skills.current()
  const panel = PANEL_SKILLS.includes(now?.name ?? '')
  const carded = list.some(r => r.skill === now?.name && main.roles.some(l => l.role === r.role))
  const isBoard = panel && carded && ui.agentsView === 'board'
  const depth = new Map<string, number>()
  const items = phase.all()
  const groups = await Promise.all(skills.tree().map(async (s, i) => {
    const d = s.parent ? (depth.get(s.parent) ?? 0) + 1 : 0
    depth.set(s.name, d)
    const mine = all.filter(r => r.skill === s.name)
    const shown = list.filter(r => r.skill === s.name)
    const running = s === now
    const facts = [took((s.endedAt ?? Date.now()) - s.startedAt), mine.length && `${mine.length} agent`, count(mine.map(r => r.sent ?? undefined))]
    const rows = [
      <Box key={`skill:${i}`} flexDirection="row" columnGap={1}>
        <Text color={running ? STATE_COLOR.running : STATE_COLOR.done}>{running ? '◆' : '◇'}</Text>
        <Text bold={running} dimColor={!running}>{s.name}</Text>
        <Box flexGrow={1} minWidth={0}><Text dimColor wrap="truncate">{facts.filter(Boolean).join(' · ')}</Text></Box>
        {running && panel && carded && (
          <Button key="agents:view" plain dimColor onPress={() => change($, { agentsView: isBoard ? 'list' : 'board' })}>{isBoard ? t('pane.listView') : t('pane.boardView')}</Button>
        )}
      </Box>,
      running && items.length > 0 && <Box key={`rail:${i}`} paddingLeft={2}><Text dimColor wrap="wrap">{items.map(todo => `${RAIL[todo.status] ?? '○'} ${todo.name}`).join(' ─ ')}</Text></Box>,
      ...(running && isBoard ? (await board($, e, shown)).map((el, n) => <Box key={`board:${n}`} flexDirection="column" paddingLeft={2}>{el}</Box>) : agentRows($, e, shown)),
    ]
    // A nested skill's rows all step in under its parent.
    return rows.filter(Boolean).map((el, n) => (d ? <Box key={`in:${i}:${n}`} paddingLeft={d * 2}>{el}</Box> : el))
  }))
  const loose = list.filter(r => !r.skill || !skills.tree().some(s => s.name === r.skill))
  const used = new Set(all.map(r => r.role).filter(role => main.roles.some(l => l.role === role))).size
  // The main conversation's model and effort heads the list, with or without a pstack skill.
  const top = main.sent ?? main.decided?.effort ?? undefined
  const head = main.model && (
    <Box key="crew:main" flexDirection="row" columnGap={1}>
      <Text color={MODEL_COLOR[family(main.model) ?? ''] ?? STATE_COLOR.running}>●</Text>
      <Text bold>main</Text>
      <Box flexGrow={1} minWidth={0}><Text dimColor wrap="truncate">{modelName(main.model) ?? ''}</Text></Box>
      {top ? <Text color={EFFORT_COLOR[top]} bold>{top}</Text> : null}
    </Box>
  )
  return [
    head,
    ...groups.flat(),
    loose.length > 0 && groups.length > 0 && <Text key="crew:loose" dimColor>{t('pane.noSkillAgents')}</Text>,
    ...agentRows($, e, loose),
    list.length === 0 && groups.length === 0 && <Text key="crew:none" dimColor>{t('pane.none')}</Text>,
    all.length > 0 && <Text key="crew:sum" dimColor>{t('pane.rolesUsed', { used, total: main.roles.length })} · {count(all.map(r => r.sent ?? undefined))}</Text>,
    ui.peek && (await peekBox($, e, ui.peek)),
  ]
}

type Els = ReturnType<EngineInterface['ui']['resolve']>

function edit($: EngineInterface, key: string, value: string) {
  const { [key]: _, ...rest } = ui.draft
  change($, { draft: value === valueOf(main.settings, key) ? rest : { ...rest, [key]: value } })
}

/** One setting: its label, then every choice as a button with the current one marked (effortless's pickers). */
export function settingRow($: EngineInterface, els: Els, r: Row, labelWidth?: number) {
  const { Box, Text, Button } = els
  const now = ui.draft[r.key] ?? valueOf(main.settings, r.key)
  const k = `set:${r.key}`
  const opts = r.kind === 'toggle' ? ['on', 'off'] : r.options ?? []
  const control =
    r.kind === 'text' ? (
      <Text dimColor wrap="truncate">{now || t('setting.default')} · /pstack-effort set {r.key} …</Text>
    ) : (
      [
        ...opts.map(o => (
          <Button key={`${k}:${o}`} {...(o === now ? { variant: 'primary' as const } : { plain: true as const, dimColor: true })} onPress={() => edit($, r.key, o)}>
            {r.optionLabel?.(o) ?? o}
          </Button>
        )),
        // A value set by command outside the choices still shows.
        !opts.includes(now) && <Text>{now}</Text>,
      ]
    )
  return (
    <Box key={`row:${r.key}`} flexDirection="row" flexWrap="wrap" columnGap={1}>
      <Box width={labelWidth} flexShrink={0}><Text>{t(r.label)}{ui.draft[r.key] !== undefined ? ' *' : ''}</Text></Box>
      {control}
    </Box>
  )
}

export async function saveDraft($: EngineInterface): Promise<boolean> {
  for (const [key, value] of Object.entries(ui.draft)) {
    try {
      main.apply(key, await saveSetting($, key, value))
    } catch (err) {
      toast($, err instanceof Error ? err.message : String(err))
      redraw($)
      return false
    }
    const { [key]: _, ...rest } = ui.draft
    ui.set({ draft: rest })
  }
  redraw($)
  return true
}

function settingsTab($: EngineInterface, e: RenderInput<'Pane'>) {
  const els = $.ui.resolve(e)
  const { Box, Text, Button } = els
  const dirty = Object.keys(ui.draft).length > 0
  return [
    ...CARDS.map(c => (
      <Box key={`settings:${c.id}`} flexDirection="column">
        <Text bold>{c.icon} {t(c.title)} <Text dimColor>{c.summary(main.settings)}</Text></Text>
        {shownRows(c, main.settings).map(r => settingRow($, els, r))}
      </Box>
    )),
    dirty && (
      <Box key="settings:bar" flexDirection="row" gap={1}>
        <Button key="settings:save" variant="primary" onPress={() => void saveDraft($)}>{t('save')}</Button>
        <Button key="settings:drop" plain onPress={() => change($, { draft: {} })}>{t('discard')}</Button>
      </Box>
    ),
  ]
}

function strip($: EngineInterface, e: RenderInput<'Pane'>) {
  const { Box, Text, Button } = $.ui.resolve(e)
  const list = agents.all()
  return (
    <Box key="strip" flexDirection="row" flexWrap="wrap" columnGap={2}>
      {list.length === 0 && <Text dimColor>{t('pane.stripNone')}</Text>}
      {list.map(r => (
        <Box key={`strip:${r.toolUseId}`} flexDirection="row" columnGap={1}>
          {mark($, e, r)}
          <Button key={`agent:${r.toolUseId}`} plain onPress={() => r.agentId && openAgent($, r.agentId)}>{nameOf(r)}</Button>
          <Text color={EFFORT_COLOR[wordOf(r) ?? '']}>{effortOf(r)}</Text>
        </Box>
      ))}
    </Box>
  )
}

export async function renderPane($: EngineInterface, e: RenderInput<'Pane'>) {
  syncView($, e.props.view)
  const docked = e.props.placement === 'dock'
  // shortcut: while docked, the viewport is the transcript's width. The terminal width is transcript + 1 divider column + body (40 + 1 + 119 = 160 on 2.1.303). Switch once the engine passes the terminal width. While another plugin's tab hides this pane no render arrives, so docked and columns keep their last values.
  ui.set({ docked, columns: docked && e.viewport ? e.viewport.columns + 1 + e.props.bodyColumns : ui.columns })
  // Docked means the hint has done its job.
  if (docked && ui.hint) change($, { hint: false })
  if (!docked) return strip($, e)
  const { Box, Button } = $.ui.resolve(e)
  const tab = (id: UiState['tab'], label: string) => (
    <Button key={`tab:${id}`} {...(ui.tab === id ? { variant: 'primary' as const } : { plain: true as const, dimColor: true })} onPress={() => change($, { tab: id })}>{label}</Button>
  )
  return (
    <Box key="pane" flexDirection="column">
      <Box key="tabs" flexDirection="row" columnGap={2}>
        {tab('agents', 'Agents · Skills')}
        {tab('settings', t('settings'))}
      </Box>
      {ui.tab === 'agents' ? await crewTab($, e) : settingsTab($, e)}
    </Box>
  )
}
