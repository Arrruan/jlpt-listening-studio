import type { LoopCount } from '../types'

export interface BoundaryDecision {
  completedCycles: number
  shouldContinue: boolean
}

/** Pure loop state transition. Playback speed deliberately does not affect cycle counting. */
export const decideAtBoundary = (
  completedCycles: number,
  limit: LoopCount,
): BoundaryDecision => {
  const next = completedCycles + 1
  return {
    completedCycles: next,
    shouldContinue: limit === 'infinite' || next < limit,
  }
}

export const isValidLoopRange = (
  a: number | null,
  b: number | null,
  duration = Number.POSITIVE_INFINITY,
) =>
  a !== null &&
  b !== null &&
  Number.isFinite(a) &&
  Number.isFinite(b) &&
  a >= 0 &&
  b > a &&
  b <= duration + 0.05

export const clampTime = (time: number, duration: number) =>
  Math.max(0, Math.min(Number.isFinite(duration) ? duration : 0, time))

export const reachedBoundary = (
  currentTime: number,
  boundary: number,
  tolerance = 0.035,
) => currentTime >= boundary - tolerance
