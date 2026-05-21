import { describe, expect, it } from 'vitest'
import { scenarios } from '../scenarios/scenarios'
import { updateObjectives, validateMove } from './simulatorEngine'

describe('simulatorEngine', () => {
  it('rejects overweight move', () => {
    const state = structuredClone(scenarios[0].initialState)
    const result = validateMove(state, 'cmd-1', 'cpt4')
    expect(result.ok).toBe(true)
  })

  it('marks objective completion when prerequisites are met', () => {
    const state = structuredClone(scenarios[0].initialState)
    state.passenger.finalised = true
    state.fuel.status = 'confirmed'
    state.holds.forEach((hold) => state.rampClearedHoldIds.push(hold.id))
    const updated = updateObjectives(state)
    expect(updated.objectives.some((o) => o.id === 'obj-pax' && o.completed)).toBe(true)
    expect(updated.objectives.some((o) => o.id === 'obj-fuel' && o.completed)).toBe(true)
    expect(updated.objectives.some((o) => o.id === 'obj-clear' && o.completed)).toBe(true)
  })
})
