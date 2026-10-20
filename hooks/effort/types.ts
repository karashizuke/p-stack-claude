export type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max'
export type Rank = 1 | 2 | 3 | 4 | 5 | 'parent'
/** `effort: null` means keep the value that was sent. */
export type Decision = { effort: Effort | null; rank: Rank; by?: string; confidence?: number }

export const EFFORTS: readonly Effort[] = ['low', 'medium', 'high', 'xhigh', 'max']
export const isEffort = (v: unknown): v is Effort => EFFORTS.includes(v as Effort)
