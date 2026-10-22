import type { EngineInterface } from 'claude-code'
import { isFollowUp, judge, type Verdict } from './judge'
import type { Provider, Settings } from './settings'
import { main } from './state'
import { EFFORTS, type Effort } from './types'
import { t } from './ui/text'

export type BenchCase = { text: string; want: Effort; ok?: Effort[] }
/** none = no answer, conf = mean confidence, sure = hits at or above the threshold. */
export type BenchRow = { provider: string; hit: number; low: number; high: number; p50ms: number; none: number; conf: number; sure: number; cases: number }

const PROBE_MS = 5000   // a freshly started Kev takes longer than 1.5 s on its first question

export async function runBench($: EngineInterface, cases: BenchCase[], providers: string[]): Promise<BenchRow[]> {
  const signal = new AbortController().signal
  const asked = cases.filter(c => !isFollowUp(c.text))
  const rows: BenchRow[] = []
  for (const provider of providers) {
    const own = main.settings.judge
    // judge.url and judge.model belong to the selected judge only; other judges use their own defaults.
    const s: Settings = { ...main.settings, judge: { ...own, provider: provider as Provider, onFail: 'parent', ...(provider === own.provider ? {} : { url: undefined, model: undefined }) } }
    // An answer that fell back to Haiku (CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC) does not count for this judge.
    const ask = (text: string, cfg: Settings) => judge($, text, cfg, signal).catch(() => null).then(v => (v?.by === provider ? v : null))
    // A judge that does not answer the probe question is treated as not running and skipped.
    if (!asked.length || !(await ask(asked[0].text, { ...s, judge: { ...s.judge, timeoutMs: PROBE_MS } }))) continue
    const got: { c: BenchCase; v: Verdict | null; ms: number }[] = []
    for (const c of asked) {
      const t0 = Date.now()
      const v = await ask(c.text, s)
      got.push({ c, v, ms: Date.now() - t0 })
    }
    const grade = ({ c, v }: (typeof got)[number]) => {
      const ok = c.ok ?? [c.want]
      if (!v) return 'none'
      if (ok.includes(v.effort)) return 'hit'
      return EFFORTS.indexOf(v.effort) < Math.min(...ok.map(e => EFFORTS.indexOf(e))) ? 'low' : 'high'
    }
    const n = (k: string) => got.filter(g => grade(g) === k).length
    const answered = got.filter(g => g.v)
    const ms = got.map(g => g.ms).sort((a, b) => a - b)
    rows.push({
      provider, hit: n('hit'), low: n('low'), high: n('high'), none: n('none'), cases: got.length,
      p50ms: ms[Math.floor(ms.length / 2)] ?? 0,
      conf: answered.length ? answered.reduce((acc, g) => acc + g.v!.confidence, 0) / answered.length : 0,
      sure: got.filter(g => grade(g) === 'hit' && g.v!.confidence >= s.judge.threshold).length,
    })
  }
  return rows
}

export function benchTable(rows: BenchRow[], threshold: number): string {
  if (!rows.length) return t('bench.none')
  return [
    t('bench.head', { threshold }),
    '| --- | --- | --- | --- | --- | --- | --- | --- |',
    ...rows.map(r => `| ${r.provider} | ${r.hit}/${r.cases} | ${r.low} | ${r.high} | ${r.none} | ${r.p50ms} | ${r.conf.toFixed(2)} | ${r.sure} |`),
  ].join('\n')
}
