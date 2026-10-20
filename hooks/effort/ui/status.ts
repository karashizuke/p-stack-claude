import type { EngineInterface } from 'claude-code'
import { sureOf } from '../judge'
import { family, modelName, stripTag } from '../roles'
import { JUDGE_NAMES } from '../settings'
import { agents, live, main, phase, skills, ui } from '../state'
import { t } from './text'

export type Snapshot = {
  skill?: string
  phase?: { name: string; index: number; total: number }
  main?: string
  model?: string
  auto: 'on' | 'off' | 'judging' | 'down'
  judge?: string
  agents: number
  viewing?: string
}

const autoWord = (a: Snapshot['auto']) => (a === 'judging' ? t('band.judging') : a === 'down' ? t('band.judgeDown') : a)
export const AUTO_SHORT = { on: 'A', off: 'A-', judging: 'A…', down: 'A?' } as const

// Width of the "  ⚠ pstack: " prefix the engine puts before the line.
const PREFIX = 12
const WIDE = /[\u1100-\u115f\u2e80-\u303e\u3041-\u33ff\u3400-\u4dbf\u4e00-\u9fff\ua000-\ua4cf\uac00-\ud7a3\uf900-\ufaff\ufe30-\ufe4f\uff00-\uff60\uffe0-\uffe6]/
export const cells = (str: string) => [...str].reduce((n, c) => n + (WIDE.test(c) ? 2 : 1), 0)

type Parts = { judge: boolean; progress: boolean; agents: boolean; skill: boolean; phase?: string; shortAuto: boolean }

function line(s: Snapshot, p: Parts): string {
  const phase = p.phase && (p.progress && s.phase ? `${p.phase} ${s.phase.index}/${s.phase.total}` : p.phase)
  const where = [p.skill && s.skill, phase].filter(Boolean).join(' › ')
  const auto = p.shortAuto ? AUTO_SHORT[s.auto] : `Auto ${autoWord(s.auto)}${p.judge && s.judge && s.auto !== 'off' ? ` (${s.judge})` : ''}`
  const count = p.agents && s.skill ? `${s.agents} agent${s.agents === 1 ? '' : 's'}` : ''
  return [where, [s.model, s.main ?? '?'].filter(Boolean).join(' '), auto, count].filter(Boolean).join(' · ')
}

/**
 * The status line. The engine prepends "pstack:", so we do not. Unknown width counts as 80 columns.
 * If it does not fit, drop in this order: judge name, progress, agent count, skill name, phase. The phase name is shortened with "…" before the skill name goes.
 * Last, Auto shrinks to one letter. The main effort is never dropped.
 */
export function statusText(s: Snapshot, columns = 80): string {
  if (s.viewing) return t('status.viewing', { name: s.viewing })
  const room = columns - PREFIX
  const p: Parts = { judge: true, progress: true, agents: true, skill: true, phase: s.phase?.name, shortAuto: false }
  const fits = () => cells(line(s, p)) <= room
  const shrinkPhase = () => {
    const name = [...(s.phase?.name ?? '')]
    for (let n = name.length - 1; n >= 1 && !fits(); n--) p.phase = `${name.slice(0, n).join('')}…`
  }
  const steps = [
    () => (p.judge = false),
    () => (p.progress = false),
    () => (p.agents = false),
    shrinkPhase,
    () => ((p.skill = false), (p.phase = s.phase?.name)),
    () => (p.phase = undefined),
    () => (p.shortAuto = true),
  ]
  for (const step of steps) {
    if (fits()) break
    step()
  }
  return line(s, p)
}

export function snapshot(): Snapshot {
  const s = main.settings
  const viewed = ui.viewing ? agents.byAgentId(ui.viewing) : undefined
  return {
    skill: skills.current()?.name,
    phase: phase.current(),
    main: main.sent ?? main.decided?.effort ?? undefined,
    model: modelName(main.model),
    auto: !s.auto ? 'off' : main.judging ? 'judging' : main.judgeDown ? 'down' : 'on',
    judge: JUDGE_NAMES[s.judge.provider],
    agents: agents.all().filter(live).length,
    viewing: viewed ? [stripTag(viewed.description), [family(viewed.model) ?? viewed.type, viewed.sent].filter(Boolean).join(' ')].join(' · ') : ui.viewing,
  }
}

/** Why the main effort is what it is, in a few words: the band's second line. */
export function whyText(): string {
  const s = main.settings
  const judge = JUDGE_NAMES[s.judge.provider]
  const d = main.decided
  const j = main.judged
  if (main.judging) return t('why.judging', { judge })
  if (main.judgeDown) return t('why.down')
  // humanEffort, not rank 1: right after /effort the last decision is still the old one.
  if (main.humanEffort) return t('why.you')
  if (!s.auto) return t('why.off')
  if (d?.rank === 4) return t('why.default', { skill: skills.current()?.name ?? '' })
  if (d?.rank === 5) {
    if (d.by === 'named') return t('why.named')
    const head = t('why.judge', { judge: JUDGE_NAMES[d.by ?? ''] ?? d.by, confidence: sureOf(d.by, d.confidence) }).trim()
    return j?.why ? `${head}: ${j.why}` : head
  }
  if (j && d?.rank === 'parent') return t('why.unsure', { judge: JUDGE_NAMES[j.by] ?? j.by, confidence: j.confidence.toFixed(2), threshold: s.judge.threshold })
  return t('why.next')
}

export function toast($: EngineInterface, text: string) {
  try {
    $.ui.toast(text)
  } catch {
    // no UI or clock here (e.g. -p); never fail the hook
  }
}

export function redraw($: EngineInterface) {
  try {
    $.ui.invalidate('ui.render')
    // The engine draws every plugin's status line as a yellow warning, so it is off unless asked for.
    $.ui.status(main.settings.statusLine ? statusText(snapshot(), ui.columns) : undefined)
  } catch {
    // no UI or clock here (e.g. -p); never fail the hook
  }
}
