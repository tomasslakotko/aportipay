import { create } from 'zustand'
import { scenarios } from '../scenarios/scenarios'
import type { EventLogEntry, FlightState, ModuleId, PassengerState } from '../domain/types'
import {
  buildEventId,
  computeScoreDelta,
  eventTimestamp,
  updateObjectives,
  validateMove,
} from '../engine/simulatorEngine'

export interface SimulatorSnapshot {
  version: 1
  scenarioId: string
  isLoggedIn: boolean
  loginName: string
  loginRole: string
  profile: UserProfile
  state: FlightState
  flightStates: Record<string, FlightState>
  finalizedFlights: Record<string, FinalizedFlight>
  log: EventLogEntry[]
  score: number
  openFlights: string[]
  subscribedFlights: string[]
  activeFlightIndex: number
  flightAssignments: Record<string, RampAgentAssignment>
}

export interface FlightSeed {
  flightNo: string
  route: string
  plannedFuelKg?: number
  acceptedPax?: number
  acceptedBags?: number
}

export interface UserProfile {
  firstName: string
  surname: string
  phoneCountry: string
  phoneArea: string
  phoneNumber: string
  faxCountry: string
  faxArea: string
  faxNumber: string
  printer: string
  radioId: string
  role: string
  notificationSound: 'soft' | 'classic' | 'loud'
}

export interface FinalizedFlight {
  signature: string
  closedAt: string
}

export interface RampAgentAssignment {
  name: string
  phone: string
  radioId: string
  assignedAt: string
}

export interface SimulatorStore {
  scenarioId: string
  profile: UserProfile
  state: FlightState
  flightStates: Record<string, FlightState>
  finalizedFlights: Record<string, FinalizedFlight>
  log: EventLogEntry[]
  score: number
  isLoggedIn: boolean
  loginName: string
  loginRole: string
  openFlights: string[]
  subscribedFlights: string[]
  activeFlightIndex: number
  flightAssignments: Record<string, RampAgentAssignment>
  setProfile: (profile: UserProfile) => void
  login: (name: string, role: string) => void
  logout: () => void
  finalizeActiveFlight: (signature: string) => void
  unlockFlight: (flightLabel: string) => void
  setScenario: (scenarioId: string) => void
  moveCommodity: (commodityId: string, toHoldId: string) => void
  offloadCommodity: (commodityId: string) => void
  onloadCommodity: (commodityId: string) => void
  clearHold: (holdId: string) => void
  sendMessage: (text: string, recipient?: string, priority?: 'low' | 'medium' | 'high') => void
  sendMessageToFlight: (flightLabel: string, text: string, recipient?: string, priority?: 'low' | 'medium' | 'high') => void
  publishMessage: (flightLabel: string, messageId: string) => void
  setPassenger: (passenger: PassengerState) => void
  setFuel: (actualKg: number, density: number, confirmed: boolean) => void
  addFreight: (label: string, weightKg: number, holdId: string) => void
  updateFreight: (commodityId: string, patch: { code: string; label: string; weightKg: number; locationId: string }) => void
  deleteFreight: (commodityId: string) => void
  openFlight: (flightLabel: string, initialState?: FlightState) => void
  subscribeFlight: (flightLabel: string) => void
  assignRampAgentToFlight: (flightLabel: string) => void
  closeActiveFlight: () => void
  setActiveFlightIndex: (index: number) => void
  hydrateSession: (snapshot: SimulatorSnapshot) => void
}

const initialScenario = scenarios[0]
const defaultProfile: UserProfile = {
  firstName: 'Angela',
  surname: 'Pickup',
  phoneCountry: '33',
  phoneArea: '4',
  phoneNumber: '97230045',
  faxCountry: '',
  faxArea: '',
  faxNumber: '',
  printer: '1A00BEE7',
  radioId: '1245789632145',
  role: 'Ramp Agent',
  notificationSound: 'soft',
}

const defaultBaggageEntries = ['P', 'C', 'J', 'Y', 'D', 'H', 'T', 'T1', 'X'].map((code) => ({
  code,
  pieces: 0,
  weightKg: 0,
}))

const normalizeProfile = (profile?: Partial<UserProfile>): UserProfile => ({
  ...defaultProfile,
  ...(profile ?? {}),
})

export const createPassengerState = (patch: Partial<PassengerState> = {}): PassengerState => ({
  acceptedPax: patch.acceptedPax ?? 0,
  acceptedBags: patch.acceptedBags ?? 0,
  finalised: patch.finalised ?? false,
  saleableConfiguration: patch.saleableConfiguration ?? '',
  booked: {
    first: patch.booked?.first ?? 0,
    business: patch.booked?.business ?? 0,
    economy: patch.booked?.economy ?? 0,
  },
  transit: {
    first: patch.transit?.first ?? 0,
    business: patch.transit?.business ?? 0,
    economy: patch.transit?.economy ?? 0,
  },
  accepted: {
    male: patch.accepted?.male ?? 0,
    female: patch.accepted?.female ?? 0,
    child: patch.accepted?.child ?? 0,
    infant: patch.accepted?.infant ?? 0,
    cbbgExst: patch.accepted?.cbbgExst ?? 0,
  },
  seatingConditions: patch.seatingConditions ?? '',
  passengersInCrewSeats: patch.passengersInCrewSeats ?? 0,
  rushBags: patch.rushBags ?? 0,
  baggage: defaultBaggageEntries.map((defaultEntry) => ({
    ...defaultEntry,
    ...patch.baggage?.find((entry) => entry.code === defaultEntry.code),
  })),
})

const normalizeFlightState = (state: FlightState): FlightState => ({
  ...removeSeedMockCargo(state),
  passenger: createPassengerState(state.passenger),
  messages: state.messages.map((message) => ({
    ...message,
    recipient: message.recipient ?? 'Ramp',
    priority: message.priority ?? 'medium',
    status: message.status ?? 'sent',
  })),
})

export const createFlightState = (seed: FlightSeed): FlightState => {
  const state = structuredClone(initialScenario.initialState)
  state.flightNo = seed.flightNo
  state.route = seed.route
  state.status = 'open'
  state.commodities = []
  state.passenger = createPassengerState({
    acceptedPax: seed.acceptedPax ?? 0,
    acceptedBags: seed.acceptedBags ?? 0,
    finalised: false,
  })
  state.fuel = {
    ...state.fuel,
    plannedKg: seed.plannedFuelKg ?? state.fuel.plannedKg,
    actualKg: 0,
    status: 'pending',
  }
  state.messages = []
  state.rampClearedHoldIds = []

  return state
}

export const createSimulatorSnapshot = (store: SimulatorStore): SimulatorSnapshot => ({
  version: 1,
  scenarioId: store.scenarioId,
  isLoggedIn: store.isLoggedIn,
  loginName: store.loginName,
  loginRole: store.loginRole,
  profile: structuredClone(store.profile),
  state: structuredClone(store.state),
  flightStates: structuredClone(store.flightStates),
  finalizedFlights: structuredClone(store.finalizedFlights),
  log: structuredClone(store.log),
  score: store.score,
  openFlights: [...store.openFlights],
  subscribedFlights: [...store.subscribedFlights],
  activeFlightIndex: store.activeFlightIndex,
  flightAssignments: structuredClone(store.flightAssignments),
})

const addLog = (
  current: EventLogEntry[],
  moduleId: ModuleId,
  action: string,
  detail: string,
  scoreDelta: number,
): EventLogEntry[] => [
  {
    id: buildEventId(),
    ts: eventTimestamp(),
    moduleId,
    action,
    detail,
    scoreDelta,
  },
  ...current,
].slice(0, 80)

const activeFlightLabel = (store: Pick<SimulatorStore, 'openFlights' | 'activeFlightIndex'>) =>
  store.openFlights[store.activeFlightIndex]

const isActiveFlightFinalized = (store: SimulatorStore) => {
  const flightLabel = activeFlightLabel(store)
  return Boolean(flightLabel && store.finalizedFlights[flightLabel])
}

const stateForActiveFlight = (store: SimulatorStore, state: FlightState) => {
  const flightLabel = activeFlightLabel(store)
  if (!flightLabel) return { state }

  return {
    state,
    flightStates: {
      ...store.flightStates,
      [flightLabel]: state,
    },
  }
}

const removeSeedMockCargo = (state: FlightState): FlightState => ({
  ...state,
  commodities: state.commodities.filter((item) => item.id !== 'cmd-1' && item.id !== 'cmd-2'),
})

export const useSimulatorStore = create<SimulatorStore>((set) => ({
  scenarioId: initialScenario.id,
  profile: defaultProfile,
  state: structuredClone(initialScenario.initialState),
  flightStates: {},
  finalizedFlights: {},
  log: [],
  score: 0,
  isLoggedIn: false,
  loginName: '',
  loginRole: '',
  openFlights: [],
  subscribedFlights: [],
  activeFlightIndex: 0,
  flightAssignments: {},
  setProfile: (profile) => set({ profile }),
  login: (name, role) =>
    set((store) => {
      const parts = name.trim().split(/\s+/).filter(Boolean)
      const firstName = parts[0] || store.profile.firstName
      const surname = parts.slice(1).join(' ') || store.profile.surname
      return {
        isLoggedIn: true,
        loginName: name.trim(),
        loginRole: role,
        profile: {
          ...store.profile,
          firstName,
          surname,
          role,
        },
      }
    }),
  logout: () => set({ isLoggedIn: false, loginName: '', loginRole: '' }),
  finalizeActiveFlight: (signature) =>
    set((store) => {
      const flightLabel = activeFlightLabel(store)
      if (!flightLabel) return {}
      const state = structuredClone(store.state)
      state.status = 'closed'
      const nextOpenFlights = store.openFlights.filter((label) => label !== flightLabel)
      const nextSubscribedFlights = store.subscribedFlights.filter((label) => label !== flightLabel)
      const nextActiveFlightIndex = Math.min(store.activeFlightIndex, Math.max(0, nextOpenFlights.length - 1))
      const nextActiveLabel = nextOpenFlights[nextActiveFlightIndex]
      const nextState = nextActiveLabel
        ? structuredClone(store.flightStates[nextActiveLabel] ?? store.state)
        : structuredClone(initialScenario.initialState)
      return {
        state: nextState,
        openFlights: nextOpenFlights,
        subscribedFlights: nextSubscribedFlights,
        activeFlightIndex: nextOpenFlights.length === 0 ? 0 : nextActiveFlightIndex,
        flightStates: {
          ...store.flightStates,
          [flightLabel]: state,
        },
        finalizedFlights: {
          ...store.finalizedFlights,
          [flightLabel]: {
            signature,
            closedAt: eventTimestamp(),
          },
        },
      }
    }),
  unlockFlight: (flightLabel) =>
    set((store) => {
      const { [flightLabel]: _removed, ...finalizedFlights } = store.finalizedFlights
      const unlockedState = structuredClone(store.flightStates[flightLabel] ?? store.state)
      unlockedState.status = 'open'
      const isActive = activeFlightLabel(store) === flightLabel
      return {
        finalizedFlights,
        flightStates: {
          ...store.flightStates,
          [flightLabel]: unlockedState,
        },
        state: isActive ? unlockedState : store.state,
      }
    }),
  setScenario: (scenarioId) => {
    const selected = scenarios.find((item) => item.id === scenarioId) ?? scenarios[0]
    set({
      scenarioId: selected.id,
      profile: defaultProfile,
      state: structuredClone(selected.initialState),
      flightStates: {},
      finalizedFlights: {},
      log: [],
      score: 0,
      openFlights: [],
      subscribedFlights: [],
      activeFlightIndex: 0,
      flightAssignments: {},
    })
  },
  moveCommodity: (commodityId, toHoldId) =>
    set((store) => {
      if (isActiveFlightFinalized(store)) return {}
      const validation = validateMove(store.state, commodityId, toHoldId)
      const scoreDelta = computeScoreDelta(validation.ok, 'ramp')

      if (!validation.ok) {
        return {
          log: addLog(store.log, 'ramp', 'MOVE_REJECTED', validation.reason ?? 'Validation failed', scoreDelta),
          score: store.score + scoreDelta,
        }
      }

      const state = structuredClone(store.state)
      const commodity = state.commodities.find((item) => item.id === commodityId)
      if (commodity) commodity.locationId = toHoldId
      const updated = updateObjectives(state)
      return {
        ...stateForActiveFlight(store, updated),
        log: addLog(store.log, 'ramp', 'MOVE_COMMODITY', `${commodityId} -> ${toHoldId}`, scoreDelta),
        score: store.score + scoreDelta,
      }
    }),
  offloadCommodity: (commodityId) =>
    set((store) => {
      if (isActiveFlightFinalized(store)) return {}
      const state = structuredClone(store.state)
      const commodity = state.commodities.find((item) => item.id === commodityId)
      if (commodity) commodity.status = 'offloaded'
      const updated = updateObjectives(state)
      const scoreDelta = computeScoreDelta(true, 'ramp')
      return {
        ...stateForActiveFlight(store, updated),
        log: addLog(store.log, 'ramp', 'OFFLOAD_ITEM', commodityId, scoreDelta),
        score: store.score + scoreDelta,
      }
    }),
  onloadCommodity: (commodityId) =>
    set((store) => {
      if (isActiveFlightFinalized(store)) return {}
      const state = structuredClone(store.state)
      const commodity = state.commodities.find((item) => item.id === commodityId)
      if (commodity) commodity.status = 'loaded'
      const updated = updateObjectives(state)
      const scoreDelta = computeScoreDelta(true, 'ramp')
      return {
        ...stateForActiveFlight(store, updated),
        log: addLog(store.log, 'ramp', 'ONLOAD_ITEM', commodityId, scoreDelta),
        score: store.score + scoreDelta,
      }
    }),
  clearHold: (holdId) =>
    set((store) => {
      if (isActiveFlightFinalized(store)) return {}
      const state = structuredClone(store.state)
      if (!state.rampClearedHoldIds.includes(holdId)) state.rampClearedHoldIds.push(holdId)
      const updated = updateObjectives(state)
      const scoreDelta = computeScoreDelta(true, 'clearance')
      return {
        ...stateForActiveFlight(store, updated),
        log: addLog(store.log, 'clearance', 'CLEAR_HOLD', holdId, scoreDelta),
        score: store.score + scoreDelta,
      }
    }),
  sendMessage: (text, recipient = 'Ramp', priority = 'high') =>
    set((store) => {
      if (isActiveFlightFinalized(store)) return {}
      const state = structuredClone(store.state)
      const author = `${store.profile.firstName} ${store.profile.surname} - ${store.profile.role}`
      state.messages.unshift({
        id: `msg-${Date.now()}`,
        author,
        text,
        recipient,
        priority,
        status: 'sent',
        createdAt: eventTimestamp(),
      })
      return {
        ...stateForActiveFlight(store, state),
        log: addLog(store.log, 'messenger', 'SEND_MESSAGE', text, 2),
        score: store.score + 2,
      }
    }),
  sendMessageToFlight: (flightLabel, text, recipient = 'Ramp', priority = 'high') =>
    set((store) => {
      if (store.finalizedFlights[flightLabel]) return {}
      const isActive = activeFlightLabel(store) === flightLabel
      const state = structuredClone(isActive ? store.state : store.flightStates[flightLabel])
      if (!state) return {}
      const author = `${store.profile.firstName} ${store.profile.surname} - ${store.profile.role}`
      state.messages.unshift({
        id: `msg-${Date.now()}`,
        author,
        text,
        recipient,
        priority,
        status: 'sent',
        createdAt: eventTimestamp(),
      })
      return {
        state: isActive ? state : store.state,
        flightStates: {
          ...store.flightStates,
          [flightLabel]: state,
        },
        log: addLog(store.log, 'messenger', 'SEND_MESSAGE', text, 2),
        score: store.score + 2,
      }
    }),
  publishMessage: (flightLabel, messageId) =>
    set((store) => {
      const isActive = activeFlightLabel(store) === flightLabel
      const state = structuredClone(isActive ? store.state : store.flightStates[flightLabel])
      if (!state) return {}
      state.messages = state.messages.map((message) =>
        message.id === messageId ? { ...message, status: 'published' } : message,
      )
      return {
        state: isActive ? state : store.state,
        flightStates: {
          ...store.flightStates,
          [flightLabel]: state,
        },
      }
    }),
  setPassenger: (passenger) =>
    set((store) => {
      if (isActiveFlightFinalized(store)) return {}
      const state = structuredClone(store.state)
      state.passenger = createPassengerState(passenger)
      const updated = updateObjectives(state)
      return {
        ...stateForActiveFlight(store, updated),
        log: addLog(store.log, 'passenger', 'SET_PAX', `${passenger.acceptedPax} pax / ${passenger.acceptedBags} bags`, 3),
        score: store.score + 3,
      }
    }),
  setFuel: (actualKg, density, confirmed) =>
    set((store) => {
      if (isActiveFlightFinalized(store)) return {}
      const state = structuredClone(store.state)
      state.fuel = { ...state.fuel, actualKg, density, status: confirmed ? 'confirmed' : 'pending' }
      const updated = updateObjectives(state)
      return {
        ...stateForActiveFlight(store, updated),
        log: addLog(store.log, 'fuel', 'SET_FUEL', `${actualKg}kg @${density}`, 3),
        score: store.score + 3,
      }
    }),
  addFreight: (label, weightKg, holdId) =>
    set((store) => {
      if (isActiveFlightFinalized(store)) return {}
      const state = structuredClone(store.state)
      state.commodities.push({
        id: `frt-${Date.now()}`,
        code: 'FRT',
        label,
        weightKg,
        locationId: holdId,
        status: 'loaded',
      })
      const updated = updateObjectives(state)
      return {
        ...stateForActiveFlight(store, updated),
        log: addLog(store.log, 'freight', 'ADD_FREIGHT', `${label} ${weightKg}kg`, 4),
        score: store.score + 4,
      }
    }),
  updateFreight: (commodityId, patch) =>
    set((store) => {
      if (isActiveFlightFinalized(store)) return {}
      const state = structuredClone(store.state)
      const commodity = state.commodities.find((item) => item.id === commodityId)
      if (commodity) {
        commodity.code = patch.code
        commodity.label = patch.label
        commodity.weightKg = patch.weightKg
        commodity.locationId = patch.locationId
      }
      const updated = updateObjectives(state)
      return {
        ...stateForActiveFlight(store, updated),
        log: addLog(store.log, 'freight', 'UPDATE_FREIGHT', commodityId, 2),
        score: store.score + 2,
      }
    }),
  deleteFreight: (commodityId) =>
    set((store) => {
      if (isActiveFlightFinalized(store)) return {}
      const state = structuredClone(store.state)
      state.commodities = state.commodities.filter((item) => item.id !== commodityId)
      const updated = updateObjectives(state)
      return {
        ...stateForActiveFlight(store, updated),
        log: addLog(store.log, 'freight', 'DELETE_FREIGHT', commodityId, 1),
        score: store.score + 1,
      }
    }),
  openFlight: (flightLabel, initialState) =>
    set((store) => {
      const exists = store.openFlights.includes(flightLabel)
      if (exists) {
        const activeFlightIndex = store.openFlights.indexOf(flightLabel)
        return {
          activeFlightIndex,
          state: structuredClone(store.flightStates[flightLabel] ?? store.state),
        }
      }
      const openFlights = [flightLabel, ...store.openFlights]
      const flightState = structuredClone(initialState ?? createFlightState({
        flightNo: flightLabel.split(' ').slice(0, 2).join(' '),
        route: flightLabel.split(' ')[3] ?? 'TRAINING',
      }))
      return {
        openFlights,
        activeFlightIndex: 0,
        state: flightState,
        flightStates: {
          ...store.flightStates,
          [flightLabel]: flightState,
        },
      }
    }),
  subscribeFlight: (flightLabel) =>
    set((store) => {
      if (store.subscribedFlights.includes(flightLabel)) return {}
      return { subscribedFlights: [flightLabel, ...store.subscribedFlights] }
    }),
  assignRampAgentToFlight: (flightLabel) =>
    set((store) => {
      const normalizedLabel = flightLabel.trim()
      if (!normalizedLabel) return {}
      const currentRole = (store.loginRole || store.profile.role || '').trim().toLowerCase()
      const isRampLogin = currentRole === 'ramp agent'
      // Do not overwrite Ramp assignment from non-ramp accounts (e.g. Supervisor/Admin).
      if (!isRampLogin) return {}
      const name = `${store.profile.firstName} ${store.profile.surname}`.trim() || store.loginName || 'Unknown'
      const phone = `${store.profile.phoneCountry} ${store.profile.phoneArea} ${store.profile.phoneNumber}`.trim()
      return {
        flightAssignments: {
          ...store.flightAssignments,
          [normalizedLabel]: {
            name,
            phone: phone || 'Not set',
            radioId: store.profile.radioId || 'Not set',
            assignedAt: new Date().toISOString(),
          },
        },
      }
    }),
  closeActiveFlight: () =>
    set((store) => {
      if (store.openFlights.length === 0) return {}
      const next = store.openFlights.filter((_, idx) => idx !== store.activeFlightIndex)
      if (next.length === 0) return { openFlights: [], activeFlightIndex: 0 }
      const activeFlightIndex = Math.min(store.activeFlightIndex, next.length - 1)
      const nextActive = next[activeFlightIndex]
      return {
        openFlights: next,
        activeFlightIndex,
        state: structuredClone(store.flightStates[nextActive] ?? store.state),
      }
    }),
  setActiveFlightIndex: (index) =>
    set((store) => {
      const activeFlightIndex = Math.max(0, Math.min(index, store.openFlights.length - 1))
      const flightLabel = store.openFlights[activeFlightIndex]
      return {
        activeFlightIndex,
        state: structuredClone(store.flightStates[flightLabel] ?? store.state),
      }
    }),
  hydrateSession: (snapshot) =>
    set((store) => {
      const flightStates = Object.fromEntries(
        Object.entries(structuredClone(snapshot.flightStates ?? {})).map(([flightLabel, flightState]) => [
          flightLabel,
          {
            ...normalizeFlightState(flightState),
            // Keep per-device message streams local; chat is synchronized separately.
            messages: structuredClone(store.flightStates[flightLabel]?.messages ?? []),
          },
        ]),
      )
      const openFlights = [...(snapshot.openFlights ?? [])]
      const activeFlightIndex = Math.max(0, Math.min(snapshot.activeFlightIndex, openFlights.length - 1))
      const flightLabel = openFlights[activeFlightIndex]
      return {
        scenarioId: snapshot.scenarioId,
        // Keep auth/profile local per device even in shared ramp mode.
        isLoggedIn: store.isLoggedIn,
        loginName: store.loginName,
        loginRole: store.loginRole,
        profile: normalizeProfile(structuredClone(store.profile ?? defaultProfile)),
        state: structuredClone({
          ...(flightStates[flightLabel] ?? normalizeFlightState(initialScenario.initialState)),
          messages: structuredClone(store.state.messages ?? []),
        }),
        flightStates,
        finalizedFlights: structuredClone(snapshot.finalizedFlights ?? {}),
        log: structuredClone(snapshot.log),
        score: snapshot.score,
        openFlights,
        subscribedFlights: [...snapshot.subscribedFlights],
        activeFlightIndex,
        flightAssignments: structuredClone(snapshot.flightAssignments ?? store.flightAssignments ?? {}),
      }
    }),
}))
