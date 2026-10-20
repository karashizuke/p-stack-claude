import type { EngineInterface, Register } from 'claude-code'
import { decide, isDangerous, structuralEffort } from './ladder'
import { effortFor, family, parseModels, stripTag } from './roles'
import { loadSettings } from './settings'
import { runCommand } from './commands'
import { contextFrom, judge, keepsEffort, namedEffort, withAttachments, withMidTurn, type Verdict } from './judge'
import { agents, live, main, phase, resetState, skills, ui, type AgentRec } from './state'
import { EFFORTS, isEffort, type Decision } from './types'
import { labelled, renderAgentRow } from './ui/row'
import { autoOpen, PANE_ID, renderPane } from './ui/pane'
import { redraw, toast } from './ui/status'
import { stopPeek } from './ui/viewing'
import { renderBar, resetArt } from './ui/bar'
import { renderFooter } from './ui/footer'
import { langFromSetting, setDetectedLang, t } from './ui/text'

// Env vars do not change during a session, so ask once. The $.env.get name must be a string literal.
let askLog: Promise<string | undefined> | undefined
const logLines: string[] = []

async function log($: EngineInterface, line: string) {
  const path = await (askLog = askLog ?? $.env.get('PSTACK_EFFORT_LOG')).catch(() => undefined)
  if (!path) return
  logLines.push(`${new Date().toISOString()} ${line}`)
  if (logLines.length > 200) logLines.splice(0, logLines.length - 200)
  await $.fs.write(path, logLines.join('\n') + '\n').catch(() => undefined)
}

const said = (v: Verdict | null | undefined) => (v ? `${v.effort} ${v.confidence.toFixed(2)} by ${v.by}` : 'none')

/** Seats are picked by the resolved model just before sending, because an Agent call may omit model. */
function decideFor(rec: AgentRec | undefined, isSub: boolean, model: string): Decision {
  const s = main.settings
  return decide({
    who: isSub ? 'sub' : 'main',
    auto: s.auto, floor: s.floor, ceiling: s.ceiling, threshold: s.judge.threshold,
    humanEffort: isSub ? undefined : main.humanEffort,
    agentEffort: rec?.requested,
    roleEffort: rec?.role ? effortFor(main.roles, rec.role, model) : undefined,
    foreign: rec?.foreign,
    structural: structuralEffort({ who: isSub ? 'sub' : 'main', subagentType: rec?.type, skill: skills.current()?.name, roles: main.roles }),
    judged: (isSub ? rec?.judged : main.judged) ?? undefined,
    danger: isSub ? rec?.danger : main.danger,
  })
}

// SKILL.md and playbooks of pstack skills. principle-* files are reading, not skills.
const SKILL_PATH = /^skills\/([^/]+)\/(?:SKILL\.md|playbooks\/([^/]+)\.md)$/

const byPerson = (o: { kind: string } | undefined) => o?.kind === 'composer' || o?.kind === 'bridge' || o?.kind === 'sdk'
const MUTATING = new Set(['set', 'auto', 'bar', 'bench'])

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    stopPeek()
    resetArt()
    resetState()
    // $.fs does not expand ~.
    const home = await $.env.get('HOME').catch(() => undefined)
    const text = home ? await $.fs.read(`${home}/.claude/rules/pstack-models.md`).catch(() => '') : ''
    main.roles = parseModels(String(text ?? ''))
    main.settings = await loadSettings($).catch(() => main.settings)
    setDetectedLang(langFromSetting(await Promise.resolve().then(() => $.settings.read()).then(s => s.language).catch(() => undefined)))
    redraw($)
    return next(e)
  })

  // /clear and an in-process resume send no session.start. Drop skill and agent records but keep the person's /effort.
  on('session.end', async ($, e, next) => {
    if (e.reason === 'clear' || e.reason === 'resume') {
      const kept = main.humanEffort
      stopPeek()
      resetArt()
      resetState()
      main.humanEffort = kept
      redraw($)
    }
    return next(e)
  }).catch(($, e, next) => next(e))

  on('prompt.submit', async ($, e, next) => {
    if (!byPerson(e.origin) || e.isMeta) return next(e)
    main.judgeDown = undefined   // a prompt that skips the judge must not keep the previous "judge down"
    ui.set({ rest: undefined })
    // Settings are shared by all sessions, so they are re-read on every prompt.
    const s = (main.settings = await loadSettings($).catch(() => main.settings))
    // Re-mark danger even on a short reply ("deploy prod"); the judgment carries over on short replies.
    main.danger = s.danger && isDangerous(e.text)
    const rows = await $.session.messages().catch(() => [])
    const context = contextFrom((Array.isArray(rows) ? rows : []) as { role: string; text?: string }[])
    // "go", "ok", "yes" between two steps of work keep the effort already chosen; a message with an image is new work.
    if (main.judged && !e.attachments?.length && keepsEffort(e.text, context)) return next(e)
    // A lower call for a message typed mid-turn waits for the turn to end, so the running task keeps its effort; a higher one helps it now.
    const before = main.judged
    const settle = (v: Verdict | null) => {
      const lower = e.turnId !== undefined && isEffort(main.sent) && (!v || EFFORTS.indexOf(v.effort) < EFFORTS.indexOf(main.sent))
      main.held = lower ? v : undefined
      main.judged = lower ? before : v
    }
    // Slash commands are not judged, and the previous prompt's judgment must not carry over, so clear it before the command check.
    settle(null)
    const structural = structuralEffort({ who: 'main', skill: skills.current()?.name, roles: main.roles })
    if (e.command || !s.auto || main.humanEffort || structural) return next(e)
    // "max effort", "effort: low": the person said the level, so it runs past floor and ceiling, and no judge is asked.
    const named = namedEffort(e.text)
    if (named) {
      settle({ effort: named, confidence: 1, by: 'named', why: 'you asked for it' })
      redraw($)
      return next(e)
    }
    main.judging = true
    redraw($)
    const current = main.model ? { model: family(main.model) ?? main.model, effort: isEffort(main.sent) ? main.sent : undefined } : undefined
    const shown = e.turnId !== undefined && current?.effort ? withMidTurn(withAttachments(e.text, e.attachments), current.effort) : withAttachments(e.text, e.attachments)
    const verdict = await judge($, shown, s, next.signal, current, context).catch(() => null)
    settle(verdict)
    main.judging = false
    main.judgeDown = verdict === null && !next.signal.aborted
    redraw($)
    await log($, `main judged ${said(verdict)}${main.held !== undefined ? ' (held until the turn ends)' : ''}`)
    return next(e)
  }).catch(($, e, next) => next(e))

  on('skill.prompt', async ($, e, next) => {
    // Do not end on other plugins' skills: a Skill tool call or a subagent preload looks the same as one the person typed.
    if (e.pluginName !== 'pstack') return next(e)
    skills.start(e.skill.replace(/^pstack:/, ''))
    redraw($)
    return next(e)
  }).catch(($, e, next) => next(e))

  on('tool.call', async ($, e, next) => {
    if (e.agentId) {
      const id = e.agentId
      agents.onTool(id, e.tool, e as unknown as Record<string, unknown>)
      redraw($)
      try {
        return await next(e)
      } finally {
        if (agents.onToolEnd(id, e.tool_use_id)) redraw($)
      }
    }
    if (e.tool === 'TaskCreate') {
      const r = await next(e)
      phase.created((r.result as { task?: { id?: string } } | undefined)?.task?.id, e.subject)
      redraw($)
      return r
    }
    if (e.tool === 'Read') {
      const root = `${$.plugin.root.replace(/\/$/, '')}/`
      const m = e.file_path.startsWith(root) ? SKILL_PATH.exec(e.file_path.slice(root.length)) : null
      const name = m && (m[2] ?? m[1])
      if (!name || name.startsWith('principle-')) return next(e)
      skills.enter(name)
    } else if (e.tool === 'TodoWrite') phase.todos(e.todos)
    else if (e.tool === 'TaskUpdate') phase.updated(e.taskId, e)
    else return next(e)
    redraw($)
    return next(e)
  }).catch(($, e, next) => next(e))

  on('tool.call', { tool: 'Agent' }, async ($, e, next) => {
    const s = main.settings
    const rec = agents.onCall(e.tool_use_id, e)
    rec.foreign = !rec.role && !skills.current()
    rec.danger = s.danger && isDangerous(`${e.description}\n${e.prompt}`)
    const declared = e.effort ?? (rec.role ? effortFor(main.roles, rec.role, e.model ?? '') : undefined)
    if (s.auto && !declared && !rec.foreign && !structuralEffort({ who: 'sub', subagentType: rec.type, roles: main.roles })) {
      rec.status = 'judging'
      redraw($)
      rec.judged = await judge($, `${stripTag(e.description)}\n\n${e.prompt.slice(0, 2000)}`, s, next.signal).catch(() => null)
      rec.status = 'running'
      await log($, `${e.tool_use_id} judged ${said(rec.judged)}`)
    }
    rec.decided = decideFor(rec, true, e.model ?? '')
    // The transcript folds parallel and background agents into rows only the description reaches, so it carries the effort the agent starts on (the parent's when nothing is decided).
    const starts = rec.decided.effort ?? main.sent
    if (starts) rec.label = `${e.description} · ${starts}`
    redraw($)
    let r: Awaited<ReturnType<typeof next>>
    try {
      r = await next(rec.label ? { ...e, description: rec.label } : e)
    } catch (err) {
      // If next throws, do not leave an agent that never started as running (the skill would never end).
      agents.fail(e.tool_use_id)
      redraw($)
      throw err
    }
    if (r.deny || r.isError) {
      agents.fail(e.tool_use_id)
      redraw($)
    }
    return r
  }).catch(($, e, next) => next(e))

  // shortcut: an ask shows as waiting until the call ends, so an approved call reads "needs approval" while it runs; clear it earlier if an event for the answer appears.
  on('tool.check', async ($, e, next) => {
    const r = await next(e)
    if (e.agentId && e.tool_use_id && r.decision === 'ask') {
      agents.onAsk(e.agentId, e.tool_use_id)
      redraw($)
    }
    return r
  }).catch(($, e, next) => next(e))

  on('agent.spawn', async ($, e, next) => {
    const r = await next(e)
    if (r.deny) agents.fail(e.tool_use_id)
    else agents.link(e.tool_use_id, r, e.parentAgentId)
    redraw($)
    autoOpen($)
    return r
  }).catch(($, e, next) => next(e))

  on('turn.step', async function* ($, e, next) {
    const isSub = e.agentId !== undefined
    const modelChanged = !isSub && main.model !== e.model
    if (!isSub) {
      skills.mainTurn(true)
      main.model = e.model
    }
    if (modelChanged) redraw($)
    // Changing effort mid-turn on Fable rewrites the cache, so keep the turn's first value.
    if (!isSub && e.index > 0 && /fable/i.test(e.model)) {
      await log($, `main step ${e.index} ${e.model}: held ${main.sent ?? 'none'}`)
      return yield* next(main.sent ? { ...e, effort: main.sent } : e)
    }
    const rec = isSub
      ? agents.byAgentId(e.agentId!) ?? agents.match(e.agentId!, await $.agent.list().catch(() => []))
      : undefined
    const role = rec?.role
    const d = decideFor(rec, isSub, e.model)
    const effort = d.effort ?? e.effort
    const changed = rec ? rec.sent !== effort || rec.status !== 'running' : main.sent !== effort
    if (rec) agents.onDecided(rec, d, effort)
    else if (!isSub) main.onDecided(d, effort)
    if (changed) redraw($)
    const by = d.by ? ` by ${d.by} ${d.confidence?.toFixed(2)}` : ''
    await log($, `${e.agentId ?? 'main'} step ${e.index} ${e.model}${role ? ` [${role}]` : ''}: ${e.effort ?? 'none'} -> ${effort ?? 'none'} rank ${d.rank}${by}`)
    const r = yield* next(d.effort ? { ...e, effort: d.effort } : e)
    if (rec && r.usage) agents.onUsage(rec, r.usage)
    return r
  })

  // A subagent ends with a turn.complete carrying agentId, not SubagentStop; without agentId it ends the main turn.
  on('turn.complete', async ($, e, next) => {
    // A subagent that ends a turn to wait on its own background work is still running; it gets another turn.
    const held = e.agentId && e.reason === 'answer' && (await $.agent.list().catch(() => [])).some(a => a.id === e.agentId && a.status === 'waiting')
    if (e.agentId && held) agents.onHold(e.agentId)
    else if (e.agentId) agents.onEnd(e.agentId, e.reason)
    else {
      skills.mainTurn(false)
      if (main.held !== undefined) [main.judged, main.held] = [main.held, undefined]
    }
    const settled = skills.settle()
    // The main turn is over with nothing running: fold the band to one line on the last skill, until the person writes again.
    const last = skills.tree().at(-1)
    if (!e.agentId && last?.endedAt && !skills.current() && !agents.all().some(live)) {
      ui.set({ rest: { skill: last.name, ms: last.endedAt - last.startedAt, agents: agents.history().filter(r => r.skill === last.name).length } })
      redraw($)
    } else if (settled || e.agentId) redraw($)
    return next(e)
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'ToolUse', props: { tool: 'Agent' } }, async ($, e, next) => {
    // With a docked panel the viewport is the transcript's width, so leave columns to command.run's terminal width.
    ui.set({ columns: (!ui.docked && e.viewport?.columns) || ui.columns, fullscreen: e.viewport?.isFullscreen ?? ui.fullscreen })
    const rec = agents.byToolUseId(e.props.tool_use_id)
    if (!rec) return next(e)
    autoOpen($)   // only a render hook knows whether it is fullscreen
    return renderAgentRow($, e, rec, await next(labelled(e, rec)))
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'Pane', requestId: PANE_ID }, ($, e) => renderPane($, e)).catch(($, e, next) => next(e))

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => (e.props.hasSurvey ? next(e) : (renderBar($, e) as never) ?? next(e)))
    .catch(($, e, next) => next(e))

  on('ui.render', { component: 'SessionMode' }, async ($, e, next) => (renderFooter($, e) as never) ?? next(e))
    .catch(($, e, next) => next(e))

  on('ui.close', { id: PANE_ID }, async ($, e, next) => {
    stopPeek()
    ui.set({ peek: undefined, docked: false })
    return next(e)
  }).catch(($, e, next) => next(e))

  on('command.run', async ($, e, next) => {
    ui.set({ columns: e.presentation?.columns ?? ui.columns, fullscreen: e.presentation?.isFullscreen ?? ui.fullscreen })
    if (e.command === 'effort') {
      const picked = e.args.trim()
      if (isEffort(picked) && byPerson(e.origin)) {
        main.humanEffort = picked
        await runCommand($, 'auto off')
        redraw($)
        toast($, t('msg.autoOff', { effort: picked }))
      }
      // The /effort command itself still runs.
      return next(e)
    }
    if (e.command !== 'pstack-effort' && e.command !== 'pstack:pstack-effort') return next(e)
    if (MUTATING.has(e.args.trim().split(/\s+/)[0]) && !byPerson(e.origin)) return { text: t('msg.personOnly') }
    const url = main.settings.judge.url
    const { text } = await runCommand($, e.args)
    if (main.settings.judge.url !== url) toast($, t('msg.urlNow', { url: main.settings.judge.url || t('msg.theDefault') }))
    redraw($)
    return { text }
  }).catch(($, e, next) => next(e))
}
