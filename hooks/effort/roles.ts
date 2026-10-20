import { isEffort, type Effort } from './types'

export type Seat = { model: string; effort?: Effort }
export type RoleLine = { role: string; seats: Seat[] }

export function parseModels(text: string): RoleLine[] {
  return text.split('\n')
    .map(l => l.trim())
    .filter(l => l && !l.startsWith('#') && l.includes(':'))
    .map(l => {
      const at = l.indexOf(':')
      const seats = l.slice(at + 1).split(',').map(s => s.trim()).filter(Boolean).map(s => {
        const [model, effort] = s.split(/\s+/)
        return { model, effort: isEffort(effort) ? effort : undefined }
      })
      return { role: l.slice(0, at).trim(), seats }
    })
}

export const roleOf = (description: string) => /^\[([^\]]+)\]\s*/.exec(description)?.[1].trim()
export const family = (model?: string) => (model && /opus|sonnet|haiku|fable/i.exec(model)?.[0].toLowerCase()) || model
/** `claude-opus-5-5` → `Opus 5.5`, a bare `opus` → `Opus`; anything else as given. */
export function modelName(model?: string): string | undefined {
  const [, name = '', major, minor] = (model && /(opus|fable|sonnet|haiku)(?:-(\d+)-(\d+))?/i.exec(model)) || []
  return name ? `${name.charAt(0).toUpperCase()}${name.slice(1).toLowerCase()}${major ? ` ${major}.${minor}` : ''}` : model
}
export const stripTag = (description: string) => description.replace(/^\[[^\]]+\]\s*/, '')

/** A panel line uses the seat matching the Agent's model; a one-seat line uses that seat. */
export function effortFor(lines: RoleLine[], role: string, model: string): Effort | undefined {
  const line = lines.find(l => l.role === role)
  if (!line) return undefined
  const seat = line.seats.length === 1 ? line.seats[0] : line.seats.find(s => model.includes(s.model))
  return seat?.effort
}
