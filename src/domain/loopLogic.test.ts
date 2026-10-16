import { describe, expect, it } from 'vitest'
import { clampTime, decideAtBoundary, isValidLoopRange, reachedBoundary } from './loopLogic'

describe('A-B 循环状态机', () => {
  it('恰好完成 5 次后停止', () => {
    let completed = 0
    const decisions = []
    for (let cycle = 0; cycle < 5; cycle += 1) {
      const decision = decideAtBoundary(completed, 5)
      completed = decision.completedCycles
      decisions.push(decision.shouldContinue)
    }
    expect(completed).toBe(5)
    expect(decisions).toEqual([true, true, true, true, false])
  })

  it('无限循环始终继续', () => {
    let completed = 0
    for (let cycle = 0; cycle < 100; cycle += 1) {
      const decision = decideAtBoundary(completed, 'infinite')
      expect(decision.shouldContinue).toBe(true)
      completed = decision.completedCycles
    }
    expect(completed).toBe(100)
  })

  it('循环次数与播放速度无关', () => {
    const rates = [0.5, 0.75, 1, 1.25, 1.5]
    const results = rates.map(() => decideAtBoundary(4, 5))
    expect(results).toEqual(rates.map(() => ({ completedCycles: 5, shouldContinue: false })))
  })

  it('拒绝越界或反向区间，并允许接近边界的检测', () => {
    expect(isValidLoopRange(3, 6, 10)).toBe(true)
    expect(isValidLoopRange(6, 3, 10)).toBe(false)
    expect(isValidLoopRange(3, 11, 10)).toBe(false)
    expect(isValidLoopRange(null, 3, 10)).toBe(false)
    expect(reachedBoundary(5.98, 6)).toBe(true)
    expect(clampTime(-2, 10)).toBe(0)
    expect(clampTime(12, 10)).toBe(10)
  })
})
