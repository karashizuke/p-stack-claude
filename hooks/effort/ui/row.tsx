import type { EngineInterface, RenderElement, RenderInput } from 'claude-code'
import { sureOf } from '../judge'
import { family, stripTag } from '../roles'
import type { AgentRec } from '../state'
import { JUDGE_NAMES } from '../settings'
import { t } from './text'

export const took = (ms: number) => `${Math.floor(ms / 60_000)}m${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}s`
const tok = (n: number) => (n >= 1000 ? `${Math.round(n / 1000)}k` : String(n))

export const effortText = (rec: AgentRec) => rec.sent ?? (rec.decided?.effort ? `${rec.decided.effort}?` : '?')

export function agentLabel(rec: AgentRec): string {
  const d = rec.decided
  const effort = rec.status === 'judging' ? t('row.judging') : effortText(rec)
  const why = !d || rec.status === 'judging' ? '' : d.rank === 5 ? t('row.judgeBy', { name: JUDGE_NAMES[d.by ?? ''] ?? d.by, confidence: sureOf(d.by, d.confidence) }).trim() : t(`rank.${d.rank}`)
  return [stripTag(rec.description), `[${rec.role ?? '—'}]`, family(rec.model) ?? rec.type, effort, why].filter(Boolean).join(' ')
}

// Replacing the description beats a Text beside the engine row, which made that row wrap into a thin column.
export const labelled = (e: RenderInput<'ToolUse'>, rec: AgentRec): RenderInput<'ToolUse'> =>
  ({ ...e, props: { ...e.props, input: { ...(e.props.input as object), description: agentLabel(rec) } } })

export function renderAgentRow($: EngineInterface, e: RenderInput<'ToolUse'>, rec: AgentRec, base: RenderElement) {
  if (rec.status !== 'done' && rec.status !== 'error') return base
  const { Box, Text } = $.ui.resolve(e)
  const mark = rec.status === 'done' ? '✓' : '✗'
  const tokens = rec.tokens ? ` · ${tok(rec.tokens)} tok` : ''
  return (
    <Box flexDirection="column">
      {base}
      <Text dimColor>  ⎿ {mark} {took((rec.endedAt ?? rec.startedAt) - rec.startedAt)}{tokens} · {rec.steps} step</Text>
    </Box>
  )
}
