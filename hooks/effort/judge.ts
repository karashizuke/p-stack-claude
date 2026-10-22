import type { EngineInterface } from 'claude-code'
import type { Provider, Settings } from './settings'
import { isEffort, type Effort } from './types'

export type Verdict = { effort: Effort; confidence: number; by: string; why?: string }

/** The confidence as shown: only a served judge's is a probability; Haiku's say-so and a named level show none. */
export const sureOf = (by: string | undefined, confidence: number | undefined) =>
  by && by !== 'haiku' && by !== 'named' && confidence !== undefined ? confidence.toFixed(2) : ''

// The judge is effortless's (1.71.0): its instructions, the question it is asked, the follow-up and named-level rules.
// Changes here: the verdict's effort alone is used (the model is never switched), Japanese counts in isFollowUp and
// endsOnQuestion, and a served judge's answer (Kev, Jev, Laya) below judge.threshold leaves the effort as it is.
const CRITERIA: Record<Effort, string> = {
  low: 'quick answer, no tools, no planning',
  medium: 'normal work: a few tool calls or edits',
  high: 'hard or large multi-step job: many tool calls, costly mistakes',
  xhigh: 'very hard: a long investigation',
  max: 'the hardest research-level work',
}
const JEV_TASK =
  'Choose the reasoning effort (and model) an agentic assistant should use for the next user message. It reads files, ' +
  'runs tools and edits things, not only code. Pick the cheapest that still does the job well. Judge the scope and the ' +
  'amount of work, not whether it is code: "go through my whole drive and clean it up" is a big tool-heavy job. ' +
  'Effort is relative to current_model: a stronger model needs less for the same job. Opus at medium does about what ' +
  'Sonnet does at high, so for one task pick one step lower on Opus than on Sonnet. ' +
  'A short follow-up ("yes", "go", "ok", in any language) keeps the current effort. When the message answers a ' +
  "question in the assistant's last reply (picks an option), judge only the work that answer starts, not its length and " +
  'not the work before the question: yes/no to one small action, or picking a value for one setting (a log level, a colour), is low; picking which way to build something starts that build, so judge the build; ' +
  'approving a whole plan takes the effort of that plan; a plain yes to "Then I will build X" means judge X. Pushing back on or adding to a plan under discussion continues that work: keep its effort, never low. Thanks or a closing remark with no new request is low. A ' +
  'question about how to do something that needs no tools is low. "think hard", "ultrathink" or "be thorough" means ' +
  'at least high; "quick question" means low.'
// Kev's model names follow kev/serve.py MODEL_NAMES; the server's --run picks the checkpoint.
// Laya: start laya-serve with LAYA_PORT=8010 and pass the checkpoint name (multilingual) as model.
const PROVIDERS: Record<Exclude<Provider, 'haiku'>, { url: string; model: string }> = {
  kev: { url: 'http://127.0.0.1:8009/v1/systemone', model: 'kev-latest' },
  laya: { url: 'http://127.0.0.1:8010/v1/systemone', model: 'multilingual' },
  jev: { url: 'https://api.typesafe.ai/v1/systemone', model: 'jev-latest' },
  'jev-openrouter': { url: 'https://openrouter.ai/api/v1/systemone', model: 'typesafe/jev-1.14' },
}
const HAIKU_TIMEOUT_MS = 6000 // Haiku takes 1-2.5 s, so systemone's 1.5 s is too short
// Haiku 5.5 by name: builds that predate it map the plain alias to Haiku 4.5, at ten times the price; the alias stands in where 5.5 does not answer.
const HAIKU_MODEL = 'claude-haiku-5-5'
const JUDGE_SYSTEM = `You choose which Claude model and reasoning effort an agentic assistant (it reads files, runs tools and edits things, not only code) should use for the user's next message. Pick the cheapest pair that will still do the job well.

Models, cheapest first:
- haiku: quick questions, lookups, renames, small edits in one or two files, summaries, chit-chat. It can read files and run tools; pick it for any small, well-defined job.
- sonnet: normal coding, edits across a few files, explanations, writing.
- opus: hard debugging, architecture, large refactors, careful reviews.
- fable: the hardest long-horizon or research-level work.

Effort: low for quick answers, medium for normal work, high for hard problems, xhigh or max only for very hard ones.

Effort is relative to the model in use ("Current" names it): a stronger model needs less effort for the same job. Opus at medium does about what Sonnet does at high, and Fable is stronger again. So for one and the same task pick one step lower on Opus than on Sonnet, and lower still on Fable; on Sonnet, go one step higher for hard work than you would on Opus.

Judge the SCOPE and the amount of work, not whether it is code. A short message can ask for a lot: "go through my whole drive and clean it up", "review the entire repo", "migrate everything" are big, multi-step, tool-heavy jobs where mistakes are costly: never low, usually high. Low is only for answers that need no tools and no planning.

If the message answers a question in the assistant's last reply (picks an option, says which one, confirms a plan), judge only the work that answer starts, as the reply describes it, not the length of the answer and not the work done before the question: "B" can mean "build the complicated section B" (high), while "yes" or "no" to one small action ("should I archive this?", "delete the old ones too?") is low, and picking a value for one setting (a log level, a colour, a font) is low. But picking which way to build something ("option 1", "the same shapes", "B") starts that build: judge the build. Approving a whole plan or several steps takes the effort of that plan. A plain "yes", "ok" or "do it" after "Is that OK? Then I'll build X" or "Should I build X?" approves building X: judge X, not the word.

A message that pushes back on, corrects or adds to a plan or claim under discussion continues that work: keep at least the effort that work had, never drop to low for it. Thanks, praise or a closing remark with no new request is low. A question about how to do something, or about effort itself, that needs no tools is low.

If the person asks for deep thought ("think hard", "ultrathink", "be thorough"), pick at least high; if they ask for a quick answer, pick low.

If the message is a short follow-up to ongoing work ("yes", "go", "ok", "continue", or the same in any language), keep the current pair.

Reply with JSON only: {"model":"haiku|sonnet|opus|fable","effort":"low|medium|high|xhigh|max","sure":0.0-1.0 how sure you are of the effort,"why":"at most 6 words, in the user's language"}`

// The $.env.get name must be a string literal. Keys are never stored or logged.
async function keyFor($: EngineInterface, p: Provider): Promise<string | undefined> {
  if (p === 'kev') return $.env.get('KEV_API_KEY')
  if (p === 'jev') return $.env.get('TYPESAFE_API_KEY')
  if (p === 'jev-openrouter') return $.env.get('OPENROUTER_API_KEY')
  return undefined
}

const isConfidence = (c: unknown): c is number => typeof c === 'number' && c >= 0 && c <= 1

let askQuiet: Promise<string | undefined> | undefined

async function systemone($: EngineInterface, p: Exclude<Provider, 'haiku'>, text: string, s: Settings, signal: AbortSignal, current?: Current, context = ''): Promise<Verdict | null> {
  const url = s.judge.url || PROVIDERS[p].url
  const stop = new AbortController()
  signal.addEventListener('abort', () => stop.abort(), { once: true, signal: stop.signal })
  try {
    // Send the key only to the judge's default origin, never to a custom judge.url.
    const key = new URL(url).origin === new URL(PROVIDERS[p].url).origin ? await keyFor($, p).catch(() => undefined) : undefined
    const res = await Promise.race([
      $.http.fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...(key ? { authorization: `Bearer ${key}` } : {}) },
        body: JSON.stringify({
          model: s.judge.model || PROVIDERS[p].model,
          state: { task: JEV_TASK, current_model: current?.model ?? null, current_effort: current?.effort ?? null, recent_conversation: context, next_message: text.slice(0, 4000) },
          questions: { effort: { type: 'choice', instructions: 'Which effort fits the next message?', criteria: CRITERIA } },
        }),
      }),
      $.clock.sleep(s.judge.timeoutMs, { signal: stop.signal }).then(() => null),
    ])
    if (!res?.ok) return null
    const a = (JSON.parse(res.text) as { answers?: { effort?: { choice?: unknown; confidence?: unknown } } }).answers?.effort
    return isEffort(a?.choice) && isConfidence(a.confidence) ? { effort: a.choice, confidence: a.confidence, by: p } : null
  } catch {
    return null
  } finally {
    stop.abort()
  }
}

async function haiku($: EngineInterface, text: string, signal: AbortSignal, current?: Current, context = ''): Promise<Verdict | null> {
  const ask = (model: string) =>
    $.model.complete({ model, system: JUDGE_SYSTEM, prompt: judgeQuestion(text, current, context), maxTokens: 160, effort: 'low', timeoutMs: HAIKU_TIMEOUT_MS }, { signal })
  let r = await ask(HAIKU_MODEL)
  if (!r.isAnswered && !signal.aborted) r = await ask('haiku')
  const v = r.isAnswered ? parseVerdict(r.text) : undefined
  return v ? { ...v, by: 'haiku' } : null
}

export type Current = { model: string; effort?: string }

/** The text the judge reads: the current pair, the last turns and the next message. */
function judgeQuestion(prompt: string, current: Current | undefined, context: string): string {
  return [
    current ? `Current: ${current.model} / ${current.effort ?? 'none'}` : 'Current: none',
    context ? `Recent conversation:\n${context}` : '',
    `Next message:\n${prompt.slice(0, 2000)}`,
  ]
    .filter(Boolean)
    .join('\n\n')
}

/** `{ effort, sure, why }` out of a reply; the model it names is not used. A reply without `sure` counts as sure. */
export function parseVerdict(text: string): Omit<Verdict, 'by'> | undefined {
  const match = /\{[\s\S]*\}/.exec(text)
  if (!match) return undefined
  try {
    const { effort, sure, why } = JSON.parse(match[0]) as Record<string, unknown>
    if (!isEffort(effort)) return undefined
    return { effort, confidence: isConfidence(sure) ? sure : 1, why: typeof why === 'string' ? why.slice(0, 60) : undefined }
  } catch {
    return undefined
  }
}

/** The context text from the conversation so far: the last user message, short, and the assistant's last reply's end. */
export function contextFrom(messages: readonly { role: string; text?: string }[]): string {
  const lastUser = [...messages].reverse().find(m => m.role === 'user')
  const lastAssistant = [...messages].reverse().find(m => m.role === 'assistant' && m.text?.trim())?.text ?? ''
  return [lastUser?.text ? `user: ${lastUser.text.slice(0, 400)}` : '', lastAssistant ? `assistant: ${lastAssistant.slice(-2000)}` : '']
    .filter(Boolean)
    .join('\n')
}

const LEVEL_WORD = '(low|medium|high|xhigh|x-high|extra[- ]high|max|maximum)'
const NAMED_LEVEL = new RegExp(`\\b${LEVEL_WORD}\\s+effort\\b|\\beffort(?:\\s+level)?\\s*(?:[:=]|to|at|of|on)?\\s*${LEVEL_WORD}\\b|\\bxhigh\\b`, 'gi')
const LEVEL_OF: Record<string, Effort> = { low: 'low', medium: 'medium', high: 'high', xhigh: 'xhigh', 'x-high': 'xhigh', 'extra high': 'xhigh', 'extra-high': 'xhigh', max: 'max', maximum: 'max' }

/**
 * The level a prompt asks for by name ("max effort", "effort: high", "xhigh"), or nothing. The word effort must sit
 * beside the level, so "a medium sized image" names nothing, and "don't use max effort" is a no.
 */
export function namedEffort(text: string): Effort | undefined {
  for (const m of text.matchAll(NAMED_LEVEL)) {
    const before = text.slice(Math.max(0, m.index - 20), m.index).toLowerCase()
    if (/\b(not|no|don'?t|never|without|instead of)\b/.test(before)) continue
    return LEVEL_OF[(m[1] ?? m[2] ?? 'xhigh').toLowerCase().replace(/\s+/, ' ')]
  }
  return undefined
}

/** A short follow-up such as "go", "ok", "yes", "continue": two words and a dozen columns at most (a CJK character is two). */
export function isFollowUp(text: string): boolean {
  const t = text.trim()
  return t.length > 0 && t.replace(/[^\x00-\x7f]/g, '..').length <= 12 && t.split(/\s+/).length <= 2
}

/** Whether the assistant's last reply ended on a question ("Should I archive it?", "A、B どちら？"): a short message after one answers it. */
export function endsOnQuestion(context: string): boolean {
  const reply = context.split('\nassistant: ').pop() ?? ''
  return context.includes('assistant: ') && /[?？]/.test(reply.slice(-400))
}

/** A short follow-up that keeps the current effort: "go" between two steps, not an answer to a question. */
export const keepsEffort = (message: string, context: string) => isFollowUp(message) && !endsOnQuestion(context)

/** The message as the judge reads it: images and files it carries are named, since the judge sees only text. */
export function withAttachments(text: string, attachments?: readonly { type: string }[]): string {
  if (!attachments?.length) return text
  const counts = new Map<string, number>()
  for (const a of attachments) counts.set(a.type, (counts.get(a.type) ?? 0) + 1)
  const said = [...counts].map(([type, n]) => `${n} ${type}${n > 1 ? 's' : ''}`).join(', ')
  return `${text}

[The message comes with ${said} to look at.]`
}

/** The message as the judge reads it when it was typed while a task was still running. */
export function withMidTurn(text: string, effort: string): string {
  return `${text}

[Sent while the assistant was still working on the last task at ${effort} effort. If it adds to, corrects or steers that task, keep ${effort}; judge it on its own only if it is a separate new request.]`
}

/** Never throws: returns null on failure, timeout or an unreadable reply. */
export async function judge($: EngineInterface, text: string, s: Settings, signal: AbortSignal, current?: Current, context = ''): Promise<Verdict | null> {
  if (signal.aborted) return null
  const quiet = await (askQuiet = askQuiet ?? $.env.get('CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC')).catch(() => undefined)
  const p = s.judge.provider
  const first = p === 'haiku' || quiet ? null : await systemone($, p, text, s, signal, current, context)
  if (first || (p !== 'haiku' && !quiet && s.judge.onFail !== 'haiku')) return first
  return haiku($, text, signal, current, context).catch(() => null)
}

