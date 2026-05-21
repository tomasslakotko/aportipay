import type { FlightState, ModuleId, ValidationResult } from '../domain/types'

const now = () => new Date().toISOString()

const holdWeight = (state: FlightState, holdId: string) =>
  state.commodities
    .filter((c) => c.locationId === holdId && c.status === 'loaded')
    .reduce((sum, c) => sum + c.weightKg, 0)

const holdStations: Record<string, number> = {
  cpt1: -2.2,
  cpt2: -0.8,
  cpt3: 0.9,
  cpt4: 2.1,
}

export interface BalanceResult {
  index: number
  status: 'ok' | 'warning' | 'bad'
  label: string
  detail: string
  totalWeight: number
  aftWeight: number
  fwdWeight: number
}

export const calculateBalance = (state: FlightState): BalanceResult => {
  const loaded = state.commodities.filter((item) => item.status === 'loaded')
  const totalWeight = loaded.reduce((sum, item) => sum + item.weightKg, 0)
  const moment = loaded.reduce((sum, item) => {
    const station = holdStations[item.locationId] ?? 0
    return sum + item.weightKg * station
  }, 0)
  const index = totalWeight === 0 ? 0 : moment / totalWeight
  const aftWeight = holdWeight(state, 'cpt1') + holdWeight(state, 'cpt2')
  const fwdWeight = holdWeight(state, 'cpt3') + holdWeight(state, 'cpt4')
  const absIndex = Math.abs(index)
  const status = absIndex <= 0.45 ? 'ok' : absIndex <= 0.9 ? 'warning' : 'bad'
  const direction = index < -0.05 ? 'aft' : index > 0.05 ? 'forward' : 'centered'

  return {
    index,
    status,
    label: status === 'ok' ? 'BALANCE OK' : status === 'warning' ? 'BALANCE WARNING' : 'BALANCE BAD',
    detail: totalWeight === 0
      ? 'No load entered.'
      : `Load is ${direction}. AFT ${aftWeight} kg / FWD ${fwdWeight} kg.`,
    totalWeight,
    aftWeight,
    fwdWeight,
  }
}

export const validateMove = (
  state: FlightState,
  commodityId: string,
  toHoldId: string,
): ValidationResult => {
  const commodity = state.commodities.find((item) => item.id === commodityId)
  const hold = state.holds.find((item) => item.id === toHoldId)
  if (!commodity || !hold) return { ok: false, reason: 'Commodity or hold not found.' }

  const nextWeight = holdWeight(state, toHoldId) + commodity.weightKg
  if (nextWeight > hold.maxWeightKg) {
    return {
      ok: false,
      reason: `${hold.name} overweight: ${nextWeight}kg / ${hold.maxWeightKg}kg`,
    }
  }

  return { ok: true }
}

export const computeScoreDelta = (ok: boolean, moduleId: ModuleId): number => {
  if (!ok) return -10
  if (moduleId === 'clearance') return 15
  return 5
}

export const updateObjectives = (state: FlightState): FlightState => {
  const next = structuredClone(state)
  const allLoaded = next.commodities.every((item) => item.status === 'loaded')
  const fuelDone = next.fuel.status === 'confirmed'
  const paxDone = next.passenger.finalised
  const allHoldsCleared = next.holds.every((hold) => next.rampClearedHoldIds.includes(hold.id))

  next.objectives = next.objectives.map((objective) => {
    if (objective.id === 'obj-load') return { ...objective, completed: allLoaded }
    if (objective.id === 'obj-pax') return { ...objective, completed: paxDone }
    if (objective.id === 'obj-fuel') return { ...objective, completed: fuelDone }
    if (objective.id === 'obj-clear') return { ...objective, completed: allHoldsCleared }
    return objective
  })
  return next
}

export const buildEventId = () => `evt-${Math.random().toString(36).slice(2, 8)}-${Date.now()}`
export const eventTimestamp = now
