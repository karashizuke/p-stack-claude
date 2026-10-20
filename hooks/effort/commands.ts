import type { EngineInterface } from 'claude-code'
import { benchTable, runBench, type BenchCase } from './bench'
import { CARDS, CARDS_HOME, helpLines, PROVIDER_NAMES, saveSetting } from './settings'
import { modelName, stripTag } from './roles'
import { agents, main, ui } from './state'
import { openPane } from './ui/pane'
import { toast } from './ui/status'
import { openAgent } from './ui/viewing'
import { t } from './ui/text'
import type { Effort } from './types'

const help = () => helpLines(main.settings).map(l => `${l.command} — ${l.what}${l.key ? t('msg.helpKey', { key: l.key }) : ''}`).join('\n')

let benching = false

async function save($: EngineInterface, key: string, value: string) {
  main.apply(key, await saveSetting($, key, value))
}

export async function runCommand($: EngineInterface, args: string): Promise<{ text: string; failed?: true }> {
  const [verb = '', ...rest] = args.trim().split(/\s+/)
  try {
    if (verb === 'auto') {
      await save($, 'auto', rest[0] ?? (main.settings.auto ? 'off' : 'on'))
      return { text: t('msg.auto', { state: main.settings.auto ? 'on' : 'off' }) }
    }
    if (verb === 'bar') {
      await save($, 'bar', rest[0] ?? '')
      ui.set({ more: false })
      return { text: t('msg.bar', { value: main.settings.bar }) }
    }
    if (verb === '' || verb === 'settings') {
      const card = rest[0] ?? ui.card ?? CARDS_HOME
      if (card !== CARDS_HOME && !CARDS.some(c => c.id === card)) return { text: t('msg.noCard', { card, cards: CARDS.map(c => c.id).join(', ') }) }
      ui.set({ card, help: false })
      return { text: t('msg.settingsOpen', { card }) }
    }
    if (verb === 'help') {
      ui.set({ help: true })
      return { text: help() }
    }
    if (verb === 'set') {
      const [key = ''] = rest
      const value = rest.slice(1).join(' ')
      await save($, key, value)
      return { text: `${key} = ${value}` }
    }
    if (verb === 'panel') {
      ui.set({ hint: false })
      const r = await openPane($, true)
      if (!r) return { text: t('msg.panelFail'), failed: true }
      return r.isPlaced ? { text: t('msg.panelOpen') } : { text: t('msg.panelWait', { reason: r.reason }), failed: true }
    }
    if (verb === 'open') {
      const want = rest.join(' ').toLowerCase()
      const rec = want ? agents.all().find(r => r.agentId && stripTag(r.description).toLowerCase().startsWith(want)) : undefined
      if (!rec?.agentId) return { text: t('msg.noAgent', { name: want || '…' }) }
      await openAgent($, rec.agentId)
      return { text: t(ui.viewing === rec.agentId ? 'msg.viewing' : 'msg.openFail', { name: stripTag(rec.description) }), failed: true }
    }
    if (verb === 'bench') {
      if (benching) return { text: t('msg.benchRunning') }
      const file = JSON.parse(String(await $.fs.read(`${$.plugin.root.replace(/\/$/, '')}/tests/judge-cases.ja.json`))) as { cases: { message: string; ok: Effort[] }[] }
      const cases: BenchCase[] = file.cases.map(c => ({ text: c.message, want: c.ok[0], ok: c.ok }))
      const unknown = rest.filter(p => !(PROVIDER_NAMES as readonly string[]).includes(p))
      if (unknown.length) return { text: t('msg.unknownJudge', { names: unknown.join(', '), judges: PROVIDER_NAMES.join(', ') }), failed: true }
      const providers = rest.length ? rest : [...PROVIDER_NAMES]
      // Runs from a timer (one case at a time outlasts the 10 s command budget); the flag is set only once the timer is taken.
      $.clock.after(0, () =>
        void runBench($, cases, providers)
          .then(rows => benchTable(rows, main.settings.judge.threshold).split('\n').forEach(l => $.ui.log(l)))   // newlines do not render in one log line
          .catch(err => toast($, t('msg.benchFailed', { error: err instanceof Error ? err.message : String(err) })))
          .finally(() => (benching = false)),
      )
      benching = true
      return { text: t('msg.benchStart', { cases: cases.length, providers: providers.join(', ') }) }
    }
    if (verb === 'status') {
      const why = main.decided ? t(`rank.${main.decided.rank}`) : t('msg.noRequest')
      const effort = [modelName(main.model), main.sent ?? '?'].filter(Boolean).join(' ')
      return { text: t('msg.status', { effort, why, state: main.settings.auto ? 'on' : 'off', judge: main.settings.judge.provider }) }
    }
    return { text: help() }
  } catch (err) {
    return { text: err instanceof Error ? err.message : String(err), failed: true }
  }
}
