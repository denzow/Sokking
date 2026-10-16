/**
 * Claude Code prints its rate-limit refusals to the terminal, and the pty
 * output passes through main — so the guard watches the processing tabs'
 * output for those lines. On a hit, automatic launches pause with an
 * exponential backoff (alir's 1 min → ×2 → 1 h); a quiet period resets it.
 * Runs already open keep going.
 */
export const BACKOFF_INITIAL_MS = 60_000
export const BACKOFF_FACTOR = 2
export const BACKOFF_MAX_MS = 3_600_000
/** No hit for this long after a pause ends → the next pause starts from the initial value again. */
const RESET_AFTER_MS = 2 * 3_600_000

const RATE_LIMIT_RE = /rate.?limit|usage limit|limit reached|too many requests|claude usage limit/i

export function looksRateLimited(text: string): boolean {
  return RATE_LIMIT_RE.test(text)
}

export interface RateLimitStatus {
  pausedUntil: string | null
  hits: number
  lastHitAt: string | null
}

export class RateLimitGuard {
  private pausedUntil = 0
  private backoff = BACKOFF_INITIAL_MS
  private hits = 0
  private lastHit = 0
  /** Tail of each tab's recent output, so a phrase split across chunks still matches. */
  private tails = new Map<string, string>()

  constructor(private log: (message: string) => void = () => {}) {}

  /** Feeds a chunk of a tab's output; returns true when it triggered a pause. */
  noteOutput(tabId: string, chunk: string, now = Date.now()): boolean {
    const tail = ((this.tails.get(tabId) ?? '') + chunk).slice(-400)
    this.tails.set(tabId, tail)
    if (!looksRateLimited(tail)) return false
    this.tails.set(tabId, '')
    this.hit(now)
    return true
  }

  forgetTab(tabId: string): void {
    this.tails.delete(tabId)
  }

  hit(now = Date.now()): void {
    // A hit landing while already paused just extends; the backoff grows per pause.
    if (this.lastHit && now - this.lastHit > RESET_AFTER_MS) this.backoff = BACKOFF_INITIAL_MS
    if (now < this.pausedUntil) {
      this.lastHit = now
      return
    }
    this.hits++
    this.lastHit = now
    this.pausedUntil = now + this.backoff
    this.log(`レート制限を検知: 自動処理を ${Math.round(this.backoff / 60_000)} 分止めます`)
    this.backoff = Math.min(this.backoff * BACKOFF_FACTOR, BACKOFF_MAX_MS)
  }

  isPaused(now = Date.now()): boolean {
    return now < this.pausedUntil
  }

  /** Clears the pause (a person decided it's fine). */
  resume(): void {
    this.pausedUntil = 0
  }

  status(now = Date.now()): RateLimitStatus {
    return {
      pausedUntil: now < this.pausedUntil ? new Date(this.pausedUntil).toISOString() : null,
      hits: this.hits,
      lastHitAt: this.lastHit ? new Date(this.lastHit).toISOString() : null
    }
  }
}
