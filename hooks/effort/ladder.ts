import type { RoleLine } from './roles'
import { EFFORTS, type Decision, type Effort } from './types'

export type LadderInput = {
  who: 'main' | 'sub'
  auto: boolean
  floor: Effort
  ceiling: Effort
  humanEffort?: Effort
  agentEffort?: Effort
  roleEffort?: Effort
  foreign?: boolean   // untagged subagent outside a pstack skill: after rank 2, use the parent's effort
  structural?: Effort
  judged?: { effort: Effort; confidence: number; by: string }
  threshold: number
  danger?: boolean   // raises ranks 4 and 5 to at least high
}

export const DANGER_WORDS = [
  'deploy', 'デプロイ', 'rm -rf', 'drop table', 'drop database', 'force push', 'push --force',
  '削除', '課金', 'billing', '本番', 'production',
]
// shortcut: checks word starts only, so "deployed" and "deploying" also match; add a trailing boundary if that gets noisy.
const DANGER_RE = new RegExp(
  DANGER_WORDS.map(w => (/^[\x00-\x7f]+$/.test(w) ? '(?<![a-z0-9])' : '') + w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'),
  'i',
)
export const isDangerous = (text: string) => DANGER_RE.test(text)

const at = (e: Effort) => EFFORTS.indexOf(e)
const clamp = (e: Effort, lo: Effort, hi: Effort): Effort => EFFORTS[Math.min(Math.max(at(e), at(lo)), at(hi))]
// Danger overrides the ceiling.
const guess = (e: Effort, i: LadderInput): Effort => {
  const c = clamp(e, i.floor, i.ceiling)
  return i.danger && at(c) < at('high') ? 'high' : c
}

export function decide(i: LadderInput): Decision {
  if (i.who === 'main' && i.humanEffort) return { effort: i.humanEffort, rank: 1 }
  if (i.who === 'sub' && i.agentEffort) return { effort: i.agentEffort, rank: 2 }
  if (i.foreign) return { effort: null, rank: 'parent' }
  if (i.who === 'sub' && i.roleEffort) return { effort: i.roleEffort, rank: 3 }
  if (!i.auto) return { effort: null, rank: 'parent' }
  if (i.structural) return { effort: guess(i.structural, i), rank: 4 }
  // A level the person named in the prompt is theirs: past floor and ceiling.
  if (i.judged?.by === 'named') return { effort: i.judged.effort, rank: 5, by: 'named', confidence: 1 }
  // Haiku's confidence is its own say-so and sits near 0.9 whatever it picks, so only the served judges' probabilities meet the threshold.
  if (i.judged && (i.judged.by === 'haiku' || i.judged.confidence >= i.threshold))
    return { effort: guess(i.judged.effort, i), rank: 5, by: i.judged.by, confidence: i.judged.confidence }
  return { effort: null, rank: 'parent' }
}

export function structuralEffort(ctx: { who: 'main' | 'sub'; subagentType?: string; skill?: string; roles: RoleLine[] }): Effort | undefined {
  if (ctx.who === 'sub' && ctx.subagentType === 'Explore') return 'medium'
  if (ctx.who === 'main' && ctx.skill) return ctx.roles.find(l => l.role === 'judgment and prose')?.seats[0]?.effort
  return undefined
}
