import { describe, expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'
import type { Engine } from 'claude-code/testing'
import { decide, isDangerous, structuralEffort } from '../hooks/effort/ladder'
import { effortFor, modelName, parseModels, roleOf } from '../hooks/effort/roles'
import { statusText } from '../hooks/effort/ui/status'
import { keepsEffort, namedEffort, parseVerdict, sureOf } from '../hooks/effort/judge'
import { ART_COLUMNS, ART_ROWS, EFFORT_COLOR, rasterFrame } from '../hooks/effort/ui/art'

const base = { auto: true, floor: 'medium', ceiling: 'xhigh', threshold: 0.6 } as const

describe('ladder', () => {
  test('an explicit Agent effort is used as is, even with Auto off or a judgment', () => {
    expect(decide({ ...base, who: 'sub', agentEffort: 'max', judged: { effort: 'low', confidence: 0.99, by: 'kev' } }))
      .toEqual({ effort: 'max', rank: 2 })
    expect(decide({ ...base, auto: false, who: 'sub', agentEffort: 'max' })).toEqual({ effort: 'max', rank: 2 })
  })
  test('a role line ignores floor and ceiling', () => {
    expect(decide({ ...base, who: 'sub', roleEffort: 'max' })).toEqual({ effort: 'max', rank: 3 })
  })
  test('Auto off stops the default and judge ranks', () => {
    expect(decide({ ...base, auto: false, who: 'sub', structural: 'medium' })).toEqual({ effort: null, rank: 'parent' })
  })
  test('Haiku\'s answer is used whatever its confidence; a served judge\'s is held to the threshold', () => {
    expect(decide({ ...base, who: 'main', judged: { effort: 'high', confidence: 0.3, by: 'haiku' } }).effort).toBe('high')
    expect(decide({ ...base, who: 'main', judged: { effort: 'high', confidence: 0.3, by: 'jev' } }).rank).toBe('parent')
  })
  test('a judgment below the threshold is dropped', () => {
    expect(decide({ ...base, who: 'main', judged: { effort: 'low', confidence: 0.4, by: 'kev' } }).rank).toBe('parent')
  })
  test('a judgment is raised to the floor', () => {
    expect(decide({ ...base, who: 'main', judged: { effort: 'low', confidence: 0.9, by: 'kev' } }).effort).toBe('medium')
  })
  test('a subagent from outside pstack skips defaults and judging unless the Agent call sets effort', () => {
    const judged = { effort: 'max', confidence: 0.99, by: 'kev' } as const
    expect(decide({ ...base, who: 'sub', foreign: true, structural: 'medium', judged })).toEqual({ effort: null, rank: 'parent' })
    expect(decide({ ...base, who: 'sub', foreign: true, agentEffort: 'low' })).toEqual({ effort: 'low', rank: 2 })
  })
  test('a danger word raises the default and judge ranks to high and leaves ranks 1-3 alone', () => {
    expect(decide({ ...base, ceiling: 'medium', who: 'main', danger: true, structural: 'low' })).toEqual({ effort: 'high', rank: 4 })
    expect(decide({ ...base, who: 'sub', danger: true, roleEffort: 'low' })).toEqual({ effort: 'low', rank: 3 })
    expect(isDangerous('本番に deploy して')).toBe(true)
  })
  test('structural defaults: Explore is medium; the main agent in a pstack skill uses the judgment and prose line', () => {
    const roles = parseModels('judgment and prose: opus high\n')
    expect(structuralEffort({ who: 'sub', subagentType: 'Explore', roles })).toBe('medium')
    expect(structuralEffort({ who: 'main', skill: 'architect', roles })).toBe('high')
    expect(structuralEffort({ who: 'main', roles })).toBeUndefined()
  })
})

const MODELS = '# c\ninterrogate reviewers: opus xhigh, fable xhigh, sonnet xhigh\nhow explorer: inherit-parent\n'

describe('roles', () => {
  const lines = parseModels(MODELS)
  test('picks the seat from the tag and model', () => {
    expect(roleOf('[interrogate reviewers] Reviewer B')).toBe('interrogate reviewers')
    expect(effortFor(lines, 'interrogate reviewers', 'claude-fable-5-1')).toBe('xhigh')
    expect(effortFor(lines, 'how explorer', 'claude-opus-5-5')).toBeUndefined()
    expect(roleOf('find callers')).toBeUndefined()
  })
})

function recordSteps(on: On) {
  const sent: { agentId?: string; effort: unknown; model?: string }[] = []
  on('turn.step', async function* (_$, e) {
    sent.push({ agentId: e.agentId, effort: e.effort, model: e.model })
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn', usage: null }
  })
  return sent
}

async function step($: Engine, effort: 'low' | 'medium' | 'high' | 'xhigh' | 'max' = 'high', agentId?: string) {
  for await (const _ of $.turn.step({ turnId: 't1', index: 0, model: 'claude-opus-5-5', effort, messageCount: 1, agentId } as never)) {
    // drain
  }
}

/** The layer below Agent calls and spawns. Call before spawn(): lower hooks must be added before $ is used. */
function engine(on: On, agentId: string) {
  screen(on)
  const ids: string[] = []
  on('tool.call', (_$, e) => (ids.push(e.tool_use_id), { result: 'ok', isError: false }) as never)
  on('agent.spawn', () => ({ agentId, model: 'claude-opus-5-5' }) as never)
  return ids
}

/** Calls Agent and pretends the subagent started. */
async function spawn($: Engine, ids: string[], args: Record<string, unknown>) {
  await $.tool.call({ tool: 'Agent', prompt: 'p', ...args } as never)
  await $.agent.spawn({ tool_use_id: ids.at(-1), prompt: 'p', description: args.description, subagentType: 'general-purpose' } as never)
}

describe('turn.step', () => {
  test('the Agent effort becomes the subagent\'s sent value', async ($, on) => {
    const ids = engine(on, 'a2')
    const sent = recordSteps(on)
    await spawn($, ids, { description: 'find callers', effort: 'max' })
    await step($, 'medium', 'a2')
    expect(sent[0].effort).toBe('max')
    // Only the effort changes; the model stays the one Claude Code chose.
    expect(sent[0].model).toBe('claude-opus-5-5')
  })

  test('the role line effort becomes the subagent\'s sent value', async ($, on) => {
    mock.env(on, { HOME: '/home/me' })
    on('fs.read', () => ({ value: MODELS }) as never)
    on('session.start', (_$, e) => ({ cwd: e.cwd }) as never)
    const ids = engine(on, 'a3')
    const sent = recordSteps(on)
    await $.session.start({ cwd: '.', surface: null, isInteractive: false } as never)
    await spawn($, ids, { description: '[interrogate reviewers] Reviewer A', model: 'opus' })
    await step($, 'medium', 'a3')
    expect(sent[0].effort).toBe('xhigh')
  })
})

/** A systemone answer. */
const reply = (effort: string, confidence = 0.9) =>
  ({ value: { status: 200, ok: true, headers: {}, text: JSON.stringify({ answers: { effort: { choice: effort, confidence } } }) } }) as never
const PERSON = { kind: 'composer' } as const
const ASK = { text: 'この関数を全部見直して', wait: false, origin: { kind: 'composer' } } as const

/** Receives redraws and returns the lines shown on the status line. */
function screen(on: On) {
  const lines: (string | undefined)[] = []
  on('ui.status', (_$, e) => (lines.push(e.text), { value: undefined }) as never)
  on('ui.invalidate', () => ({ value: undefined }) as never)
  return lines
}

/** Resets the mod's state with session.start (world adds the lower layer). Call first so tests do not depend on order. */
const fresh = ($: Engine) => $.session.start({ cwd: '.', surface: null, isInteractive: false } as never)

/** For judge tests that use Kev; the default judge is Haiku. */
const freshKev = async ($: Engine) => (await fresh($), $.command.run({ command: 'pstack-effort', args: 'set judge.provider kev', origin: PERSON }))

/** Lower layer for judge tests: a store with only the status line on (these tests read it), empty env, a stopped clock, and receivers for prompt, toast, screen and session.start. */
function world(on: On) {
  mock.store(on, { settings: { statusLine: true } })
  mock.env(on, {})
  mock.clock(on)
  on('prompt.submit', (_$, e) => ({ text: e.text }) as never)
  on('ui.toast', () => ({ value: undefined }) as never)
  on('session.start', (_$, e) => ({ cwd: e.cwd }) as never)
  return screen(on)
}

describe('judge', () => {
  test('a judgment at or above the threshold is clamped to floor/ceiling and sent', async ($, on) => {
    world(on)
    on('http.fetch', () => reply('max'))
    const sent = recordSteps(on)
    await freshKev($)
    await $.prompt.submit(ASK)
    await step($, 'high')
    expect(sent[0].effort).toBe('xhigh')   // ceiling
  })
  test('a lower call for a message typed mid-turn waits for the turn to end; a higher one applies at once', async ($, on) => {
    world(on)
    const answers = ['max', 'low', 'max']
    on('http.fetch', () => reply(answers.shift()!))
    on('turn.complete', (_$, e) => ({ text: e.answer }) as never)
    const sent = recordSteps(on)
    await freshKev($)
    await $.prompt.submit(ASK)
    await step($, 'high')
    await $.prompt.submit({ ...ASK, text: 'ついでにREADMEも見直しておいて', turnId: 't1' } as never)
    await step($, 'high')
    expect(sent.map(x => x.effort)).toEqual(['xhigh', 'xhigh'])
    await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' } as never)
    await step($, 'high')
    expect(sent.at(-1)?.effort).toBe('medium')   // low, raised to the floor
    await $.prompt.submit({ ...ASK, turnId: 't2' } as never)
    await step($, 'high')
    expect(sent.at(-1)?.effort).toBe('xhigh')
  })
  test('when the judge is down, the incoming value stays', async ($, on) => {
    world(on)
    on('http.fetch', () => { throw new Error('ECONNREFUSED') })
    const sent = recordSteps(on)
    await freshKev($)
    await $.prompt.submit(ASK)
    await step($, 'high')
    expect(sent[0].effort).toBe('high')
  })
  test('a short reply keeps the judgment of the work under way; a short first message is judged', async ($, on) => {
    world(on)
    let asked = 0
    on('http.fetch', () => (asked++, reply('max')))
    await freshKev($)
    await $.prompt.submit({ ...ASK, text: 'hello' })
    expect(asked).toBe(1)
    await $.prompt.submit(ASK)
    await $.prompt.submit({ ...ASK, text: 'go' })
    await $.prompt.submit({ ...ASK, text: 'お願いします' })
    expect(asked).toBe(2)
  })
  test('with Auto off the main agent ignores the judge and keeps the incoming value', async ($, on) => {
    world(on)
    on('http.fetch', () => reply('max'))
    const sent = recordSteps(on)
    await freshKev($)
    await $.prompt.submit(ASK)
    await step($, 'high')
    await $.command.run({ command: 'pstack-effort', args: 'auto off', origin: PERSON })
    await $.prompt.submit(ASK)
    await step($, 'high')
    expect(sent.map(x => x.effort)).toEqual(['xhigh', 'high'])
  })
  test('picking /effort takes the top rank and turns Auto off; auto on hands it back', async ($, on) => {
    world(on)
    on('command.run', () => ({ text: '' }) as never)
    on('http.fetch', () => reply('max'))
    const sent = recordSteps(on)
    await freshKev($)
    await $.command.run({ command: 'effort', args: 'low', origin: PERSON })
    await $.prompt.submit(ASK)
    await step($, 'high')
    await $.command.run({ command: 'pstack-effort', args: 'auto on', origin: PERSON })
    await $.prompt.submit(ASK)
    await step($, 'high')
    expect(sent.map(x => x.effort)).toEqual(['low', 'xhigh'])
  })
  test('with onFail haiku, a failed judge falls back to Haiku', async ($, on) => {
    world(on)
    on('http.fetch', () => { throw new Error('ECONNREFUSED') })
    on('model.complete', () => ({ value: { isAnswered: true, text: '```json\n{"model":"sonnet","effort":"high","sure":0.8,"why":"x"}\n```', usage: {} } }) as never)
    const sent = recordSteps(on)
    await fresh($)
    await $.command.run({ command: 'pstack-effort', args: 'set judge.onFail haiku', origin: PERSON })
    await $.prompt.submit(ASK)
    await step($, 'low')
    expect(sent[0].effort).toBe('high')
  })
  test('the key goes only to the judge\'s default origin; judge.url accepts https or loopback http only', async ($, on) => {
    mock.store(on)
    mock.env(on, { KEV_API_KEY: 'k' })
    mock.clock(on)
    screen(on)
    on('prompt.submit', (_$, e) => ({ text: e.text }) as never)
    on('session.start', (_$, e) => ({ cwd: e.cwd }) as never)
    const calls: { url: string; auth?: string }[] = []
    on('http.fetch', (_$, e) => (calls.push({ url: e.url, auth: (e.init?.headers as Record<string, string>)?.authorization }), reply('high')))
    await freshKev($)
    await $.prompt.submit(ASK)
    await $.command.run({ command: 'pstack-effort', args: 'set judge.url http://evil.example/v1/systemone', origin: PERSON })
    await $.command.run({ command: 'pstack-effort', args: 'set judge.url https://evil.example/v1/systemone', origin: PERSON })
    await $.prompt.submit(ASK)
    expect(calls).toEqual([
      { url: 'http://127.0.0.1:8009/v1/systemone', auth: 'Bearer k' },
      { url: 'https://evil.example/v1/systemone', auth: undefined },
    ])
  })
  test('the default judge is Haiku: systemone is not called and Haiku\'s answer is used', async ($, on) => {
    world(on)
    let fetched = 0
    on('http.fetch', () => (fetched++, reply('max')))
    on('model.complete', () => ({ value: { isAnswered: true, text: '{"model":"sonnet","effort":"high","sure":0.8,"why":"x"}', usage: {} } }) as never)
    const sent = recordSteps(on)
    await fresh($)
    await $.prompt.submit(ASK)
    await step($, 'low')
    expect(fetched).toBe(0)
    expect(sent[0].effort).toBe('high')
  })
  test('only the person\'s origin can change settings; others are refused and the store stays', async ($, on) => {
    world(on)
    const calls: string[] = []
    on('http.fetch', (_$, e) => (calls.push(e.url), reply('high')))
    on('model.complete', () => ({ value: { isAnswered: true, text: '{}', usage: {} } }) as never)
    await fresh($)
    const url = 'https://example.com/v1/systemone'
    const refused = await $.command.run({ command: 'pstack-effort', args: `set judge.url ${url}`, origin: { kind: 'plugin', name: 'x' } } as never)
    expect(JSON.stringify(refused)).not.toContain(url)
    expect(JSON.stringify(await $.command.run({ command: 'pstack-effort', args: 'status' }))).not.toContain('only the person')
    await $.command.run({ command: 'pstack-effort', args: 'auto off', origin: { kind: 'unclassified' } } as never)
    const status = async () => JSON.stringify(await $.command.run({ command: 'pstack-effort', args: 'status' }))
    expect(await status()).toContain('Auto on')
    await fresh($)   // reloading from the store shows no url
    await $.prompt.submit(ASK)
    await $.command.run({ command: 'pstack-effort', args: `set judge.provider kev`, origin: PERSON })
    await $.prompt.submit(ASK)
    expect(calls).toEqual(['http://127.0.0.1:8009/v1/systemone'])
    await $.command.run({ command: 'pstack-effort', args: `set judge.url ${url}`, origin: PERSON })
    await $.prompt.submit(ASK)
    expect(calls.at(-1)).toBe(url)
  })
  test('/clear (session.end with reason clear) drops skills and agents but keeps the person\'s effort', async ($, on) => {
    const lines = world(on)
    on('command.run', () => ({ text: '' }) as never)
    on('session.end', (_$, e) => ({ sessionId: e.sessionId }) as never)
    on('skill.prompt', (_$, e) => ({ text: e.text }) as never)
    const ids: string[] = []
    on('tool.call', (_$, e) => (ids.push(e.tool_use_id), { result: 'ok', isError: false }) as never)
    on('agent.spawn', () => ({ agentId: 'cl1', model: 'claude-opus-5-5' }) as never)
    const sent = recordSteps(on)
    await fresh($)
    await $.command.run({ command: 'effort', args: 'low', origin: PERSON })
    await $.skill.prompt({ skill: 'architect', text: 'x', pluginName: 'pstack' } as never)
    await spawn($, ids, { description: 'review', effort: 'high' })
    expect(lines.at(-1)).toContain('architect')
    await $.session.end({ reason: 'clear', sessionId: 's1', resume: {} } as never)
    expect(lines.at(-1) ?? '').not.toContain('architect')
    expect(lines.at(-1) ?? '').not.toContain('agent')
    await step($, 'high')
    expect(sent.at(-1)?.effort).toBe('low')
  })
  test('a confidence outside 0-1 is dropped as an unreadable answer', async ($, on) => {
    world(on)
    on('http.fetch', () => reply('max', 85))
    const sent = recordSteps(on)
    await fresh($)
    await $.prompt.submit(ASK)
    await step($, 'high')
    expect(sent[0].effort).toBe('high')
  })
  test('a short dangerous prompt still re-marks danger, and "production" inside a word does not count', async ($, on) => {
    world(on)
    on('http.fetch', () => reply('low'))
    const sent = recordSteps(on)
    await freshKev($)
    await $.prompt.submit(ASK)
    await step($, 'high')
    await $.prompt.submit({ ...ASK, text: 'deploy prod' })
    await step($, 'high')
    expect(sent.map(x => x.effort)).toEqual(['medium', 'high'])
    expect([isDangerous('reproduction steps'), isDangerous('go to Production'), isDangerous('本番へ')]).toEqual([false, true, true])
  })
  test('set auto on clears the person\'s pick just like auto on', async ($, on) => {
    world(on)
    on('command.run', () => ({ text: '' }) as never)
    on('http.fetch', () => reply('max'))
    const sent = recordSteps(on)
    await freshKev($)
    await $.command.run({ command: 'effort', args: 'low', origin: PERSON })
    await $.command.run({ command: 'pstack-effort', args: 'set auto on', origin: PERSON })
    await $.prompt.submit(ASK)
    await step($, 'high')
    expect(sent[0].effort).toBe('xhigh')
  })
  test('an untagged subagent defers to the parent outside a pstack skill and is judged at spawn inside one', async ($, on) => {
    world(on)
    let asked = 0
    on('http.fetch', () => (asked++, reply('high')))
    on('skill.prompt', (_$, e) => ({ text: e.text }) as never)
    const ids: string[] = []
    on('tool.call', (_$, e) => (ids.push(e.tool_use_id), { result: 'ok', isError: false }) as never)
    on('agent.spawn', () => ({ agentId: `a5-${ids.length}`, model: 'claude-opus-5-5' }) as never)
    const sent = recordSteps(on)
    await freshKev($)
    await spawn($, ids, { description: 'review the diff' })
    await step($, 'low', 'a5-1')
    await $.skill.prompt({ skill: 'architect', text: 'x', pluginName: 'pstack' } as never)
    await spawn($, ids, { description: 'review the diff' })
    await step($, 'low', 'a5-2')
    expect(asked).toBe(1)
    expect(sent.map(x => x.effort)).toEqual(['low', 'high'])
  })
})

// Where the plugin lives while tests run ($.plugin.root).
const ROOT = new URL('..', import.meta.url).pathname.replace(/\/$/, '')

describe('status', () => {
  const snap = { skill: 'orchestrate', phase: { name: 'VERIFY', index: 2, total: 4 }, main: 'xhigh', model: 'Opus 5.5', auto: 'on', judge: 'Kev', agents: 3 } as const
  test('everything when wide; when narrow, parts drop in order and effort and Auto stay', () => {
    expect(statusText(snap, 180)).toBe('orchestrate › VERIFY 2/4 · Opus 5.5 xhigh · Auto on (Kev) · 3 agents')
    expect(statusText(snap, 60)).toBe('orchestrate › VERIFY · Opus 5.5 xhigh · Auto on')
    // CJK counts 2 columns. The phase name shrinks before the skill name goes.
    expect(statusText({ ...snap, phase: { ...snap.phase, name: 'レビューを統合' } }, 61)).toBe('orchestrate › レビュ… · Opus 5.5 xhigh · Auto on')
  })
  test('the status line is off by default and on once set; the model is named by family and version', async ($, on) => {
    mock.store(on)
    mock.env(on, {})
    mock.clock(on)
    on('session.start', (_$, e) => ({ cwd: e.cwd }) as never)
    const lines = screen(on)
    await fresh($)
    await $.command.run({ command: 'pstack-effort', args: 'status' })
    expect(lines.length).toBeGreaterThan(0)
    expect(lines.every(l => l === undefined)).toBe(true)
    await $.command.run({ command: 'pstack-effort', args: 'set statusLine on', origin: PERSON })
    expect(lines.at(-1)).toContain('Auto on')
    expect(['claude-opus-5-5', 'claude-fable-5-1[1m]', 'haiku', 'gpt-x'].map(modelName)).toEqual(['Opus 5.5', 'Fable 5.1', 'Haiku', 'gpt-x'])
  })
  test('without a pstack skill', () => {
    expect(statusText({ ...snap, skill: undefined, phase: undefined }, 180)).toBe('Opus 5.5 xhigh · Auto on (Kev)')
    // Before the first request there is no model yet: the effort stands alone.
    expect(statusText({ ...snap, skill: undefined, phase: undefined, model: undefined }, 180)).toBe('xhigh · Auto on (Kev)')
  })
  test('todos made while no pstack skill runs, and subagent todos, are not phases', async ($, on) => {
    const lines = world(on)
    on('tool.call', () => ({ result: 'ok', isError: false }) as never)
    const todos = [{ content: 'Write tests', status: 'in_progress', activeForm: 'Write tests' }]
    await fresh($)
    await $.tool.call({ tool: 'TodoWrite', tool_use_id: 'td1', todos } as never)
    // A pstack skill starts when its file is Read; earlier todos do not carry in.
    await $.tool.call({ tool: 'Read', tool_use_id: 'rd1', file_path: `${ROOT}/skills/architect/SKILL.md` } as never)
    expect(lines.at(-1)).toMatch(/^architect · /)
    await $.tool.call({ tool: 'TodoWrite', tool_use_id: 'td2', todos } as never)
    expect(lines.at(-1)).toContain('architect › Write tests 1/1')
    // A subagent's todos and skill Reads are not the main agent's.
    const sub = [{ content: 'Sub step', status: 'in_progress', activeForm: 'Sub step' }]
    await $.tool.call({ tool: 'TodoWrite', tool_use_id: 'td3', agentId: 'a9', todos: sub } as never)
    await $.tool.call({ tool: 'Read', tool_use_id: 'rd2', agentId: 'a9', file_path: `${ROOT}/skills/interrogate/SKILL.md` } as never)
    expect(lines.at(-1)).toContain('architect › Write tests 1/1')
  })
  test('a skill does not end on another plugin\'s skill and is replaced by the next pstack skill', async ($, on) => {
    const lines = world(on)
    on('http.fetch', () => reply('high'))
    on('skill.prompt', (_$, e) => ({ text: e.text }) as never)
    await fresh($)
    // The skill.prompt name arrives with the plugin name.
    await $.skill.prompt({ skill: 'pstack:architect', text: 'x', pluginName: 'pstack' } as never)
    await $.skill.prompt({ skill: 'superpowers:brainstorming', text: 'x', pluginName: 'superpowers' } as never)
    await $.prompt.submit({ ...ASK, text: 'use option B please, because it keeps the API small' })
    expect(lines.at(-1)).toMatch(/^architect · /)
    await $.skill.prompt({ skill: 'pstack:interrogate', text: 'x', pluginName: 'pstack' } as never)
    expect(lines.at(-1)).toMatch(/^interrogate · /)
  })
  test('an Agent that never started (failed or denied) is not counted as running', async ($, on) => {
    const lines = world(on)
    on('skill.prompt', (_$, e) => ({ text: e.text }) as never)
    const ids: string[] = []
    on('tool.call', (_$, e) => (ids.push(e.tool_use_id), { result: 'x', isError: !!(e as { description?: string }).description?.startsWith('fails') }) as never)
    on('agent.spawn', () => ({ deny: 'no' }) as never)
    await fresh($)
    await $.skill.prompt({ skill: 'architect', text: 'x', pluginName: 'pstack' } as never)
    await $.tool.call({ tool: 'Agent', description: 'fails', prompt: 'p', effort: 'low' } as never)
    expect(lines.at(-1)).toContain('0 agents')
    await $.tool.call({ tool: 'Agent', description: 'denied', prompt: 'p', effort: 'low' } as never)
    expect(lines.at(-1)).toContain('1 agent')
    await $.agent.spawn({ tool_use_id: ids.at(-1), prompt: 'p', description: 'denied', subagentType: 'general-purpose' } as never)
    expect(lines.at(-1)).toContain('0 agents')
  })
})

describe('agent row', () => {
  test('the Agent call carries the effort it starts on in its description', async ($, on) => {
    world(on)
    const sent: string[] = []
    on('tool.call', (_$, e) => (sent.push(String((e as { description?: string }).description)), { result: 'ok', isError: false }) as never)
    await fresh($)
    await $.tool.call({ tool: 'Agent', tool_use_id: 'd1', description: 'find callers', prompt: 'x', effort: 'high' } as never)
    expect(sent.at(-1)).toBe('find callers · high')
  })
  test('shows the role, model and sent effort', async ($, on) => {
    world(on)
    on('tool.call', () => ({ result: 'ok', isError: false }) as never)
    // Stands in for the engine row: prints the description it receives.
    on('ui.render', (_$, e) => ({ type: 'Text', props: {}, children: [String((e.props as { input: { description?: string } }).input.description)] }) as never)
    await fresh($)
    await $.tool.call({ tool: 'Agent', tool_use_id: 'tu1', description: '[interrogate reviewers] Reviewer A', model: 'opus', prompt: 'x' } as never)
    const ui = await $.ui.mount({ plugin: 'pstack', surface: 'terminal', component: 'ToolUse',
      props: { tool_use_id: 'tu1', tool: 'Agent', input: {}, isRunning: true, isErrored: false, isInterrupted: false } } as never)
    const text = JSON.stringify(await ui.drawn())
    expect(text).toContain('interrogate reviewers')
    expect(text).toContain('Reviewer A')
    await ui.unmount()
  })
})

const PANE = { title: 'pstack', isFocused: false, bodyColumns: 40, scroll: { offset: 0, bodyRows: 20 }, view: {} } as const

/** Lower layer for panel and conversation tests: empty store and env, a stopped clock, a screen, and the conversation a peek reads. Collects toasts. */
function viewer(on: On, agentId: string) {
  mock.store(on)
  mock.env(on, {})
  const clock = mock.clock(on)
  on('session.start', (_$, e) => ({ cwd: e.cwd }) as never)
  on('session.messages', () => ({ value: [] }) as never)
  on('ui.render', () => ({ type: 'Text', props: {}, children: ['lower'] }) as never)   // what is drawn when the band yields
  const toasts: string[] = []
  on('ui.toast', (_$, e) => (toasts.push(String(e.text)), { value: undefined }) as never)
  return { ids: engine(on, agentId), toasts, clock }
}

const drawPane = async ($: Engine, placement: 'dock' | 'inline') => {
  const ui = await $.ui.mount({ plugin: 'pstack', surface: 'terminal', component: 'Pane', requestId: 'pstack-effort', props: { ...PANE, placement } } as never)
  const tree = await ui.drawn()
  // The plugin name to press: scripts/test-effort.sh loads by folder name, so take it from the drawn tree.
  return { ui, text: JSON.stringify(tree), plugin: (tree as { part?: { plugin?: string } }).part?.plugin }
}

describe('judge text (effortless rules)', () => {
  test('a named level, a follow-up, an answer to a question, and a verdict without sure', () => {
    expect(namedEffort('use max effort on this')).toBe('max')
    expect(namedEffort("don't use max effort")).toBeUndefined()
    expect(namedEffort('a medium sized image')).toBeUndefined()
    expect(keepsEffort('go', 'user: fix it\nassistant: Done.')).toBe(true)
    expect(keepsEffort('はい', 'user: x\nassistant: A と B どちらにしますか？')).toBe(false)
    expect(keepsEffort('この設定を全部見直して', '')).toBe(false)
    expect(parseVerdict('{"model":"opus","effort":"low","why":"hi"}')).toEqual({ effort: 'low', confidence: 1, why: 'hi' })
    // Only a served judge's confidence is shown.
    expect(sureOf('haiku', 0.95)).toBe('')
    expect(sureOf('kev', 0.8)).toBe('0.80')
  })
})

describe('crew', () => {
  test('a row shows what its agent is doing, and an ask turns it to needs approval', async ($, on) => {
    const { ids } = viewer(on, 'c1')
    on('tool.check', () => ({ decision: 'ask' }) as never)
    await fresh($)
    await spawn($, ids, { description: 'reader', effort: 'high' })
    await $.tool.call({ tool: 'Read', file_path: 'notes.md', agentId: 'c1' } as never)
    const reading = await drawPane($, 'dock')
    expect(reading.text).toContain('reading')
    expect(reading.text).toContain('notes.md')
    await reading.ui.unmount()
    await $.tool.check({ tool: 'Bash', input: { command: 'rm -r build' }, agentId: 'c1', tool_use_id: 't-ask' } as never)
    const asked = await drawPane($, 'dock')
    expect(asked.text).toContain('needs approval')
    await asked.ui.unmount()
  })
})

describe('viewer', () => {
  test('a refused view shows a toast and falls back to a peek when the panel is docked', async ($, on) => {
    const { ids, toasts } = viewer(on, 'v1')
    on('ui.view', () => ({ value: { deny: 'not in the tasks list' } }) as never)
    await fresh($)
    await spawn($, ids, { description: 'verifier', effort: 'high' })
    const pane = await drawPane($, 'dock')
    await $.command.run({ command: 'pstack-effort', args: 'open veri' })
    expect(toasts.join()).toContain('not in the tasks list')
    // After the redraw (ui.invalidate), a fresh draw shows the peek.
    await pane.ui.unmount()
    const again = await drawPane($, 'dock')
    expect(again.text).toContain('"key":"peek"')
    await again.ui.unmount()
  })
  test('a refused view without a docked panel shows only a toast and starts no peek', async ($, on) => {
    const { ids, toasts } = viewer(on, 'v1b')
    on('ui.view', () => ({ value: { deny: 'not in the tasks list' } }) as never)
    await fresh($)
    await spawn($, ids, { description: 'verifier', effort: 'high' })
    await $.command.run({ command: 'pstack-effort', args: 'open veri' })
    expect(toasts.join()).toContain('not in the tasks list')
    const { ui, text } = await drawPane($, 'dock')
    expect(text).not.toContain('"key":"peek"')
    await ui.unmount()
  })
  test('one press on a name peeks, a second opens the conversation and the viewing band appears', async ($, on) => {
    const { ids } = viewer(on, 'v2')
    const views: unknown[] = []
    on('ui.view', (_$, e) => (views.push(e), { value: {} }) as never)
    await fresh($)
    await spawn($, ids, { description: 'verifier', effort: 'high' })
    const pane = await drawPane($, 'dock')
    const name = { key: `agent:${ids.at(-1)}`, plugin: pane.plugin }
    await pane.ui.press(name)
    expect(views).toEqual([])
    await pane.ui.press(name)
    expect(views).toEqual([{ agentId: 'v2' }])
    await pane.ui.unmount()
    const band = await $.ui.mount({ plugin: 'pstack', surface: 'terminal', component: 'AbovePrompt',
      props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 80, scroll: { offset: 0, bodyRows: 10 }, view: { agentId: 'v2' } } } as never)
    expect(JSON.stringify(await band.drawn())).toContain('"key":"viewing"')
    await band.unmount()
    // When the screen's view empties (the person left the conversation), the band goes too.
    const gone = await $.ui.mount({ plugin: 'pstack', surface: 'terminal', component: 'AbovePrompt',
      props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 80, scroll: { offset: 0, bodyRows: 10 }, view: {} } } as never)
    expect(JSON.stringify((await gone.drawn()) ?? null)).not.toContain('"key":"viewing"')
    await gone.unmount()
  })
  test('an inline panel draws as a strip', async ($, on) => {
    viewer(on, 'v3')
    await fresh($)
    const { ui, text } = await drawPane($, 'inline')
    expect(text).toContain('"key":"strip"')
    await ui.unmount()
  })
})

describe('auto open', () => {
  const at = (columns: number, isFullscreen: boolean) =>
    ({ command: 'pstack-effort', args: 'status', presentation: { columns, isFullscreen } }) as never
  test('unasked opening happens only in fullscreen; if not placed, a hint shows once at 110-143 columns', async ($, on) => {
    const { ids, toasts } = viewer(on, 'ao1')
    let opened = 0
    on('ui.open', () => (opened++, { value: { isPlaced: false, reason: 'narrow' } }) as never)
    await fresh($)
    const settle = () => new Promise(r => setTimeout(r, 0))
    await $.command.run(at(120, false))
    await spawn($, ids, { description: 'one', effort: 'high' })
    await settle()
    expect(opened).toBe(0)
    await $.command.run(at(120, true))
    await spawn($, ids, { description: 'two', effort: 'high' })
    await settle()
    await spawn($, ids, { description: 'three', effort: 'high' })
    await settle()
    expect(opened).toBe(1)
    // The hint appears in the band, not as a toast.
    expect(toasts).toEqual([])
    const band = await drawBand($)
    expect(band.text).toContain('"key":"hint"')
    await band.ui.unmount()
  })
})

const BAND = { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 120, scroll: { offset: 0, bodyRows: 10 } } as const

/** Draws the band and returns the tree as text plus the plugin name to press. To see a redraw, draw again. */
async function drawBand($: Engine, surface: 'terminal' | 'desktop' = 'terminal', view: { agentId?: string } = {}) {
  const ui = await $.ui.mount({ plugin: 'pstack', surface, component: 'AbovePrompt', props: { ...BAND, view } } as never)
  const tree = await ui.drawn()
  return { ui, text: JSON.stringify(tree ?? null), plugin: (tree as { part?: { plugin?: string } } | null)?.part?.plugin }
}

describe('bar', () => {
  test('the viewing band shows even when the band is hidden', async ($, on) => {
    const { ids } = viewer(on, 'b1')
    on('ui.view', () => ({ value: {} }) as never)
    await fresh($)
    await spawn($, ids, { description: 'verifier', effort: 'high' })
    await $.command.run({ command: 'pstack-effort', args: 'bar hide', origin: PERSON })
    const hidden = await drawBand($)
    expect(hidden.text).not.toContain('"key":"bar"')
    await hidden.ui.unmount()
    await $.command.run({ command: 'pstack-effort', args: 'open veri' })
    // The engine draws the conversation of the agent whose view was opened.
    const band = await drawBand($, 'terminal', { agentId: 'b1' })
    expect(band.text).toContain('"key":"viewing"')
    await band.ui.unmount()
  })
  test('the UI stays English and lang is no longer a setting', async ($, on) => {
    viewer(on, 'l1')
    await fresh($)
    const bad = JSON.stringify(await $.command.run({ command: 'pstack-effort', args: 'set lang ja', origin: PERSON }))
    const band = await drawBand($)
    expect(band.text).toContain('Settings')
    expect(band.text).not.toContain('設定')
    expect(bad).not.toContain('lang = ja')
    await band.ui.unmount()
  })
  test('rows added to the declarations appear in set and help', async ($, on) => {
    world(on)
    await fresh($)
    const r = await $.command.run({ command: 'pstack-effort', args: 'help' })
    expect(JSON.stringify(r)).toContain('/pstack-effort set judge.provider')
    // A declaration-only row (no dedicated branch) is validated against its declared options.
    expect(JSON.stringify(await $.command.run({ command: 'pstack-effort', args: 'set motion wild', origin: PERSON }))).toContain('takes one of')
    expect(JSON.stringify(await $.command.run({ command: 'pstack-effort', args: 'set motion calm', origin: PERSON }))).not.toContain('takes one of')
  })
  test('on desktop, folding draws in SessionMode instead of the band', async ($, on) => {
    viewer(on, 'b3')
    await fresh($)
    const open = await $.ui.mount({ plugin: 'pstack', surface: 'desktop', component: 'SessionMode', props: { modes: [] } } as never)
    expect(JSON.stringify((await open.drawn()) ?? null)).not.toContain('pstack ·')
    await open.unmount()
    await $.command.run({ command: 'pstack-effort', args: 'bar fold', origin: PERSON })
    const band = await drawBand($, 'desktop')
    expect(band.text).not.toContain('"key":"bar"')
    await band.ui.unmount()
    const foot = await $.ui.mount({ plugin: 'pstack', surface: 'desktop', component: 'SessionMode', props: { modes: [] } } as never)
    expect(JSON.stringify(await foot.drawn())).toContain('pstack')
    await foot.unmount()
    // On the terminal it is a folded one-line band.
    const term = await drawBand($)
    expect(term.text).toContain('"key":"bar:open"')
    await term.ui.unmount()
  })
  test('the fold button is in the band without opening "…" and folds when pressed', async ($, on) => {
    viewer(on, 'b5')
    await fresh($)
    const open = await drawBand($)
    expect(open.text).toContain('"key":"bar:fold"')
    expect(open.text).not.toContain('"key":"bar:more"')
    await open.ui.press({ key: 'bar:fold', plugin: open.plugin })
    await open.ui.unmount()
    const folded = await drawBand($)
    expect(folded.text).toContain('"key":"bar:open"')
    await folded.ui.unmount()
  })
  test('a failed command shows a toast; a successful one shows none', async ($, on) => {
    const { toasts } = viewer(on, 'b6')
    on('ui.open', () => ({ value: { isPlaced: false, reason: 'another dock holds the slot' } }) as never)
    await fresh($)
    const band = await drawBand($)
    await band.ui.press({ key: 'bar:auto', plugin: band.plugin })
    expect(toasts).toEqual([])
    await band.ui.press({ key: 'bar:agents', plugin: band.plugin })
    expect(toasts.join()).toContain('another dock holds the slot')
    await band.ui.unmount()
  })
  test('if placing fails while the band is hidden, the hint is not saved for later', async ($, on) => {
    const { ids } = viewer(on, 'b7')
    on('ui.open', () => ({ value: { isPlaced: false, reason: 'narrow' } }) as never)
    await fresh($)
    await $.command.run({ command: 'pstack-effort', args: 'bar hide', origin: PERSON })
    await $.command.run({ command: 'pstack-effort', args: 'status', presentation: { columns: 120, isFullscreen: true } } as never)
    await spawn($, ids, { description: 'one', effort: 'high' })
    await new Promise(r => setTimeout(r, 0))
    await $.command.run({ command: 'pstack-effort', args: 'bar open', origin: PERSON })
    const band = await drawBand($)
    expect(band.text).not.toContain('"key":"hint"')
    await band.ui.unmount()
  })
  test('toggling Auto from the band and saving a choice on the Judge card persists to the next session', async ($, on) => {
    viewer(on, 'b4')
    await fresh($)
    const status = async () => JSON.stringify(await $.command.run({ command: 'pstack-effort', args: 'status' }))
    const first = await drawBand($)
    await first.ui.press({ key: 'bar:auto', plugin: first.plugin })
    expect(await status()).toContain('Auto off')
    await first.ui.press({ key: 'bar:judge', plugin: first.plugin })
    await first.ui.unmount()
    const cards = await drawBand($)
    expect(cards.text).toContain('"key":"cards"')
    await cards.ui.press({ key: 'set:judge.provider:laya', plugin: cards.plugin })
    // Until saved it is only a draft.
    expect(await status()).toContain('judge haiku')
    await cards.ui.unmount()
    const draft = await drawBand($)
    await draft.ui.press({ key: 'cards:save', plugin: draft.plugin })
    await draft.ui.unmount()
    await fresh($)   // a new session reloads from the store
    expect(await status()).toContain('judge laya')
    expect(await status()).toContain('Auto off')
  })
})

describe('skill end', () => {
  const complete = ($: Engine, agentId?: string) =>
    $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer', agentId } as never)
  /** Starts a main turn inside a pstack skill. */
  async function begin($: Engine, on: On) {
    const lines = world(on)
    on('skill.prompt', (_$, e) => ({ text: e.text }) as never)
    on('turn.complete', (_$, e) => ({ text: e.answer }) as never)
    const ids: string[] = []
    on('tool.call', (_$, e) => (ids.push(e.tool_use_id), { result: 'ok', isError: false }) as never)
    on('agent.spawn', () => ({ agentId: `se-${ids.length}`, model: 'claude-opus-5-5' }) as never)
    recordSteps(on)
    await fresh($)
    await $.skill.prompt({ skill: 'pstack:architect', text: 'x', pluginName: 'pstack' } as never)
    await step($)
    return { lines, ids, inSkill: () => /^architect/.test(lines.at(-1) ?? '') }
  }
  test('the skill ends when the main turn ends and no agent runs', async ($, on) => {
    const { inSkill } = await begin($, on)
    expect(inSkill()).toBe(true)
    await complete($)
    expect(inSkill()).toBe(false)
  })
  test('the skill continues while agents run after the main turn and ends with the last agent', async ($, on) => {
    const { ids, inSkill } = await begin($, on)
    await spawn($, ids, { description: 'bg one', effort: 'high' })
    await spawn($, ids, { description: 'bg two', effort: 'high' })
    await complete($)
    expect(inSkill()).toBe(true)
    await complete($, 'se-1')
    expect(inSkill()).toBe(true)
    await complete($, 'se-2')
    expect(inSkill()).toBe(false)
  })
  test('agents finishing and a next wave starting inside one turn keeps the skill alive until the turn ends', async ($, on) => {
    const { ids, inSkill } = await begin($, on)
    await spawn($, ids, { description: 'wave one', effort: 'high' })
    await complete($, 'se-1')
    expect(inSkill()).toBe(true)
    await spawn($, ids, { description: 'wave two', effort: 'high' })
    await complete($, 'se-2')
    expect(inSkill()).toBe(true)
    await complete($)
    expect(inSkill()).toBe(false)
  })
  test('a new turn does not inherit the previous turn\'s end', async ($, on) => {
    const { ids, inSkill } = await begin($, on)
    await spawn($, ids, { description: 'bg', effort: 'high' })
    await complete($)
    await step($)   // next turn; the background agent still runs
    await complete($, 'se-1')
    expect(inSkill()).toBe(true)
    await complete($)
    expect(inSkill()).toBe(false)
  })
})

describe('agent fail', () => {
  test('if an Agent call throws below, it is not left running and the skill still ends', async ($, on) => {
    const lines = world(on)
    on('skill.prompt', (_$, e) => ({ text: e.text }) as never)
    on('turn.complete', (_$, e) => ({ text: e.answer }) as never)
    on('tool.call', () => {
      throw new Error('boom')
    })
    recordSteps(on)
    await fresh($)
    await $.skill.prompt({ skill: 'pstack:architect', text: 'x', pluginName: 'pstack' } as never)
    await step($)
    await $.tool.call({ tool: 'Agent', prompt: 'p', description: 'thrower', effort: 'high' } as never).catch(() => undefined)
    await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' } as never)
    expect(lines.at(-1)).not.toMatch(/^architect/)
  })
})

describe('art', () => {
  test('a frame is 24x3 with one critter per agent; a waiting one has yellow eyes', () => {
    const crew = [{ color: '#c4a3ff', waiting: false }, { color: '#5fd4c0', waiting: true }]
    const words = new Uint32Array(Uint8Array.from(atob(rasterFrame('agents', 3, crew)), c => c.charCodeAt(0)).buffer)
    expect(words.length).toBe(ART_COLUMNS * ART_ROWS * 3)
    const colors = [...words].filter((_, i) => i % 3 !== 0)
    const n = (hex: string) => colors.filter(c => c === parseInt(hex.slice(1), 16)).length
    // Frame 3 is mid-stride (two legs); the waiting one stands on three and raises an arm.
    expect(n('#c4a3ff')).toBe(13)
    expect(n('#5fd4c0')).toBe(15)
    expect(n('#ffd166')).toBe(2)
  })
  test('no art at rest; motion none draws no Raster even while an agent runs', async ($, on) => {
    const { ids } = viewer(on, 'r1')
    await fresh($)
    const rest = await drawBand($)
    expect(rest.text).not.toContain('"key":"art"')
    await rest.ui.unmount()
    await spawn($, ids, { description: 'mover', effort: 'high' })
    const normal = await drawBand($)
    expect(normal.text).toContain('"key":"art"')
    await normal.ui.unmount()
    await $.command.run({ command: 'pstack-effort', args: 'set motion none', origin: PERSON })
    const none = await drawBand($)
    expect(none.text).not.toContain('"key":"art"')
    await none.ui.unmount()
    // Desktop uses an Svg (CSS motion).
    await $.command.run({ command: 'pstack-effort', args: 'set motion normal', origin: PERSON })
    const desk = await drawBand($, 'desktop')
    expect(desk.text).toContain('@keyframes')
    await desk.ui.unmount()
  })
  test('frames are sent only while an agent runs and stop when folded', async ($, on) => {
    const { ids, clock } = viewer(on, 'r2')
    let blits = 0
    on('ui.blit', (_$, e, next) => (blits++, next(e)))
    await fresh($)
    await spawn($, ids, { description: 'mover', effort: 'high' })
    const band = await drawBand($)
    await clock.advance(350)
    expect(blits).toBeGreaterThan(0)
    await band.ui.press({ key: 'bar:fold', plugin: band.plugin })
    await band.ui.unmount()
    const folded = await drawBand($)
    const before = blits
    await clock.advance(500)
    expect(blits).toBe(before)
    await folded.ui.unmount()
  })
})

describe('bench', () => {
  test('only judges that answer appear in the table; silent ones are skipped', async ($, on) => {
    mock.store(on)
    mock.env(on, {})
    const clock = mock.clock(on)
    on('session.start', (_$, e) => ({ cwd: e.cwd }) as never)
    on('http.fetch', (_$, e) => (String(e.url).includes('8009') ? reply('high', 0.9) : { value: { status: 502, ok: false, headers: {}, text: '' } }) as never)
    const logs: string[] = []
    on('ui.log', (_$, e) => (logs.push(String(e.text)), { value: undefined }) as never)
    const cases = [
      { message: '決済モジュールを新しい API に移行して', ok: ['high'] },
      { message: 'README のタイトルの typo を直して', ok: ['low'] },
      { message: 'コンパイラの誤った最適化の原因を突き止めて', ok: ['xhigh', 'max'] },
      { message: 'はい', ok: ['low'] },   // short replies are not judged, so they are not counted
    ]
    on('fs.read', () => ({ value: JSON.stringify({ cases }) }) as never)
    await fresh($)
    await $.command.run({ command: 'pstack-effort', args: 'bench kev laya', origin: PERSON })
    await clock.settle()
    const table = logs.join('\n')
    expect(table).toContain('| kev | 1/3 | 1 | 1 |')
    expect(table).not.toContain('| laya |')
  })
})
describe('flash', () => {
  test('text flashes when effort changes, but not with motion none', async ($, on) => {
    viewer(on, 'f1')
    recordSteps(on)
    await fresh($)
    const colorAfter = async (effort: 'medium' | 'high') => {
      await step($, effort)
      const band = await drawBand($)
      await band.ui.unmount()
      // The color of the Text that draws the effort word.
      return band.text.match(new RegExp(`"color":"([^"]*)"[^{}]*\\},"children":\\["${effort}"\\]`))?.[1]
    }
    expect(await colorAfter('medium')).toBe(EFFORT_COLOR.medium)
    expect(await colorAfter('high')).not.toBe(EFFORT_COLOR.high)
    await $.command.run({ command: 'pstack-effort', args: 'set motion none', origin: PERSON })
    expect(await colorAfter('medium')).toBe(EFFORT_COLOR.medium)
  })
})
