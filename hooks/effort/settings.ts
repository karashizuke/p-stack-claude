import type { EngineInterface } from 'claude-code'
import { EFFORTS, isEffort, type Effort } from './types'
import { t, type TextKey } from './ui/text'

export const PROVIDER_NAMES = ['kev', 'laya', 'jev', 'jev-openrouter', 'haiku'] as const
export type Provider = (typeof PROVIDER_NAMES)[number]
export const JUDGE_NAMES: Record<string, string> = { kev: 'Kev', laya: 'Laya', jev: 'Jev', 'jev-openrouter': 'Jev', haiku: 'Haiku' }

export type Settings = {
  auto: boolean
  floor: Effort
  ceiling: Effort
  danger: boolean
  hideDone: number
  bar: 'open' | 'fold' | 'hide'
  motion: 'normal' | 'calm' | 'none'
  statusLine: boolean
  lang: 'auto' | 'en' | 'ja'
  judge: {
    provider: Provider
    threshold: number
    timeoutMs: number
    onFail: 'parent' | 'haiku'
    url?: string
    model?: string
  }
}

export const DEFAULTS: Settings = {
  auto: true, floor: 'medium', ceiling: 'xhigh', danger: true, hideDone: 10, bar: 'open', motion: 'normal', statusLine: false, lang: 'auto',
  judge: { provider: 'haiku', threshold: 0.6, timeoutMs: 1500, onFail: 'parent' },
}
const SETTINGS_VERSION = 1

export type Row = {
  key: string
  label: TextKey
  kind: 'toggle' | 'choice' | 'steps' | 'text'   // text only shows the value; change it by command (mobile has no Input)
  options?: readonly string[]
  optionLabel?: (option: string) => string
  default: string
  help: TextKey
  when?: (s: Settings) => boolean   // shown only when this holds; `set` still takes it
}
export type Card = { id: string; title: TextKey; icon: string; summary: (s: Settings) => string; rows: Row[] }
type CardDecl = Omit<Card, 'rows'> & { rows: Omit<Row, 'default'>[] }
export type Action = string
export type BarSlot = { id: string; label: (s: Settings) => string; help: TextKey; hotkey?: string; when?: (s: Settings) => boolean; press: Action }

// Threshold, fallback, timeout, URL and model belong to the served judges (Kev, Jev, Laya); Haiku has none of them.
const served = (s: Settings) => s.judge.provider !== 'haiku'
/** The rows a card shows now. */
export const shownRows = (c: Card, s: Settings) => c.rows.filter(r => !r.when || r.when(s))

const DECLARED: CardDecl[] = [
  {
    id: 'effort', title: 'card.effort', icon: '◔', summary: s => `Auto ${s.auto ? 'on' : 'off'} · ${s.floor}–${s.ceiling}`,
    rows: [
      { key: 'auto', label: 'row.auto.label', kind: 'toggle', help: 'row.auto.help' },
      { key: 'floor', label: 'row.floor.label', kind: 'steps', options: EFFORTS, help: 'row.floor.help' },
      { key: 'ceiling', label: 'row.ceiling.label', kind: 'steps', options: EFFORTS, help: 'row.ceiling.help' },
      { key: 'danger', label: 'row.danger.label', kind: 'toggle', help: 'row.danger.help' },
    ],
  },
  {
    id: 'judge', title: 'card.judge', icon: '⚖', summary: s => (served(s) ? `${JUDGE_NAMES[s.judge.provider]} · ${s.judge.threshold}` : JUDGE_NAMES[s.judge.provider]),
    rows: [
      { key: 'judge.provider', label: 'row.provider.label', kind: 'choice', options: PROVIDER_NAMES, help: 'row.provider.help',
        optionLabel: o => (o === 'jev-openrouter' ? 'Jev · OpenRouter' : JUDGE_NAMES[o] ?? o) },
      { key: 'judge.threshold', label: 'row.threshold.label', kind: 'choice', options: ['0.5', '0.6', '0.7', '0.8'], help: 'row.threshold.help', when: served },
      { key: 'judge.onFail', label: 'row.onFail.label', kind: 'choice', options: ['parent', 'haiku'], help: 'row.onFail.help', when: served },
      { key: 'judge.timeoutMs', label: 'row.timeout.label', kind: 'steps', options: ['1000', '1500', '3000', '5000'], help: 'row.timeout.help', when: served },
      { key: 'judge.url', label: 'row.url.label', kind: 'text', help: 'row.url.help', when: served },
      { key: 'judge.model', label: 'row.model.label', kind: 'text', help: 'row.model.help', when: served },
    ],
  },
  {
    id: 'view', title: 'card.view', icon: '◉', summary: s => t('card.view.summary', { bar: s.bar, motion: s.motion }) + (s.statusLine ? t('card.view.status') : ''),
    rows: [
      { key: 'bar', label: 'row.bar.label', kind: 'choice', options: ['open', 'fold', 'hide'], help: 'row.bar.help' },
      { key: 'motion', label: 'row.motion.label', kind: 'choice', options: ['normal', 'calm', 'none'], help: 'row.motion.help' },
      { key: 'hideDone', label: 'row.hideDone.label', kind: 'steps', options: ['0', '5', '10', '30', '60'], help: 'row.hideDone.help' },
      { key: 'statusLine', label: 'row.statusLine.label', kind: 'toggle', help: 'row.statusLine.help' },
    ],
  },
  { id: 'lab', title: 'card.lab', icon: '✦', summary: () => t('card.lab.summary'), rows: [] },
]

/** ui.card for the overview of all cards; any other value is the id of the card shown inside. */
export const CARDS_HOME = 'home'
export const CARDS: Card[] = DECLARED.map(c => ({ ...c, rows: c.rows.map(r => ({ ...r, default: valueOf(DEFAULTS, r.key) })) }))

/** The band shows the first four; the rest go under "…" (but with exactly five, all are shown and there is no "…"). */
export const BAR: BarSlot[] = [
  { id: 'auto', label: s => `Auto ${s.auto ? 'on' : 'off'}`, help: 'bar.auto.help', hotkey: 'a', press: 'auto' },
  { id: 'judge', label: s => JUDGE_NAMES[s.judge.provider], help: 'bar.judge.help', press: 'settings judge' },
  { id: 'agents', label: () => 'Agents', help: 'bar.agents.help', hotkey: 'g', press: 'panel' },
  { id: 'settings', label: () => t('settings'), help: 'bar.settings.help', hotkey: 's', press: 'settings' },
  { id: 'fold', label: () => '▾', help: 'bar.fold.help', hotkey: 'z', press: 'bar fold' },
]

const ROWS = () => CARDS.flatMap(c => c.rows)
const COMMANDS: { what: TextKey; command: string }[] = [
  { what: 'cmd.status', command: '/pstack-effort status' },
  { what: 'cmd.open', command: '/pstack-effort open <name>' },
  { what: 'cmd.bar', command: '/pstack-effort bar open|fold|hide' },
  { what: 'cmd.bench', command: '/pstack-effort bench [kev|laya|jev|jev-openrouter|haiku …]' },
  { what: 'cmd.help', command: '/pstack-effort help' },
]

export function helpLines(s: Settings): { what: string; button?: string; key?: string; command: string }[] {
  return [
    ...BAR.map(b => ({ what: t(b.help), button: b.label(s), key: b.hotkey, command: `/pstack-effort ${b.press}` })),
    ...CARDS.flatMap(c => c.rows.map(r => ({
      what: t('help.rowLine', { title: t(c.title), label: t(r.label), help: t(r.help), default: r.default || t('help.none') }),
      command: `/pstack-effort set ${r.key} ${r.options?.join('|') ?? (r.kind === 'toggle' ? 'on|off' : '<value>')}`,
    }))),
    ...COMMANDS.map(c => ({ ...c, what: t(c.what) })),
  ]
}

export function valueOf(s: Settings, key: string): string {
  const v = key.split('.').reduce<unknown>((o, k) => (o as Record<string, unknown> | undefined)?.[k], s)
  return typeof v === 'boolean' ? (v ? 'on' : 'off') : v === undefined ? '' : String(v)
}

export async function loadSettings($: EngineInterface): Promise<Settings> {
  const { settingsVersion: _, ...saved } = ((await $.store.get('settings')) ?? {}) as Partial<Settings> & { settingsVersion?: number }
  return { ...DEFAULTS, ...saved, judge: { ...DEFAULTS.judge, ...saved.judge } }
}

const onOff = (key: string, value: string) => {
  if (value !== 'on' && value !== 'off') throw new Error(t('err.onOff', { key }))
  return value === 'on'
}

const LOOPBACK = ['127.0.0.1', 'localhost', '[::1]']
function safeUrl(value: string): boolean {
  try {
    const u = new URL(value)
    return u.protocol === 'https:' || (u.protocol === 'http:' && LOOPBACK.includes(u.hostname))
  } catch {
    return false
  }
}

export async function saveSetting($: EngineInterface, key: string, value: string): Promise<Settings> {
  const s = await loadSettings($)
  if (key === 'auto' || key === 'danger') {
    s[key] = onOff(key, value)
  } else if (key === 'floor' || key === 'ceiling') {
    if (!isEffort(value)) throw new Error(t('err.oneOf', { key, list: EFFORTS.join(', ') }))
    s[key] = value
  } else if (key === 'hideDone') {
    const n = Number(value)
    if (!value || !Number.isInteger(n) || n < 0 || n > 1440) throw new Error(t('err.hideDone'))
    s.hideDone = n
  } else if (key === 'judge.threshold') {
    const n = Number(value)
    if (!value || !(n >= 0 && n <= 1)) throw new Error(t('err.threshold'))
    s.judge.threshold = n
  } else if (key === 'judge.timeoutMs') {
    const n = Number(value)
    // Cap 5000: a hook has 10 s, and a longer wait cuts prompt.submit off.
    if (!Number.isInteger(n) || n <= 0 || n > 5000) throw new Error(t('err.timeout'))
    s.judge.timeoutMs = n
  } else if (key === 'judge.provider') {
    if (!PROVIDER_NAMES.includes(value as Provider)) throw new Error(t('err.oneOf', { key: 'judge.provider', list: PROVIDER_NAMES.join(', ') }))
    s.judge.provider = value as Provider
  } else if (key === 'judge.onFail') {
    if (value !== 'parent' && value !== 'haiku') throw new Error(t('err.onFail'))
    s.judge.onFail = value
  } else if (key === 'judge.url' && value && !safeUrl(value)) {
    throw new Error(t('err.url'))
  } else if (key === 'judge.url' || key === 'judge.model') {
    s.judge[key === 'judge.url' ? 'url' : 'model'] = value || undefined
  } else {
    const row = ROWS().find(r => r.key === key)
    if (!row) throw new Error(t('err.unknown', { key, keys: ROWS().map(r => r.key).join(', ') }))
    // shortcut: values are stored as strings and 'a' of 'a.b' must already exist in Settings. Numeric rows and new nesting need their own branch above; 'text' rows have no options, so they are always refused here.
    const v = row.kind === 'toggle' ? onOff(key, value) : value
    if (row.kind !== 'toggle' && !row.options?.includes(value)) throw new Error(t('err.oneOf', { key, list: row.options?.join(', ') ?? t('err.nothing') }))
    const [a, b] = key.split('.') as [keyof Settings, string?]
    if (b) (s[a] as Record<string, unknown>)[b] = v
    else (s as Record<string, unknown>)[a] = v
  }
  await $.store.set('settings', { ...s, settingsVersion: SETTINGS_VERSION })
  return s
}
