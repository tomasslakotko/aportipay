import type { PassengerState } from '../domain/types'
import type { AdminFlight } from './flightApi'
import { formatSearchFlight } from './aaLidsPassengerSync'
import { createPassengerState } from '../store/useSimulatorStore'
import { resolveSnappApiBase } from './snappFlightApi'

export interface SnappIntegrationPassenger {
  id: string
  firstName: string
  lastName: string
  cabin: string
  seatNumber: string | null
  checkedIn: boolean
  boarded: boolean
  flags: {
    vip?: boolean
    wheelchair?: boolean
    unaccompanied_minor?: boolean
    pet?: boolean
    doc_validated?: boolean
  }
  dateOfBirth: string | null
  loyaltyTier: string | null
}

export interface SnappIntegrationBaggage {
  id: string
  passengerId: string
  tagNumber: string
  status: string
  weightKg: number
  destination: string
  bagType: string | null
  priority?: boolean
  heavy?: boolean
  isFinalDestination?: boolean
  finalDestination?: string | null
}

export interface SnappPassengerPayload {
  flightId: string
  destination: string
  origin: string
  flightNumber: string
  saleableConfiguration: string
  passengers: SnappIntegrationPassenger[]
  baggage: SnappIntegrationBaggage[]
  crewSeatsBlocked: number
}

const defaultBaggageCodes = ['P', 'C', 'J', 'Y', 'D', 'H', 'T', 'T1', 'X']

export const resolveSnappFlightId = (flightLabel: string, flights: AdminFlight[]): string | null => {
  const match = flights.find((row) => row.source === 'snapp' && formatSearchFlight(row) === flightLabel)
  return match?.id ?? null
}

const cabinBucket = (cabin: string): 'first' | 'business' | 'economy' => {
  const lower = cabin.toLowerCase()
  if (lower.includes('delta one') || lower.includes('first')) return 'first'
  if (lower.includes('business') || lower.includes('premium')) return 'business'
  return 'economy'
}

const ageYears = (dob: string | null): number | null => {
  if (!dob) return null
  const born = new Date(dob)
  if (Number.isNaN(born.getTime())) return null
  const now = new Date()
  let age = now.getFullYear() - born.getFullYear()
  const m = now.getMonth() - born.getMonth()
  if (m < 0 || (m === 0 && now.getDate() < born.getDate())) age -= 1
  return age
}

/** Heuristic gender when SNAPP has no title field. */
const inferGender = (
  passenger: SnappIntegrationPassenger,
): 'male' | 'female' | 'child' | 'infant' => {
  if (passenger.flags?.unaccompanied_minor) return 'child'
  const age = ageYears(passenger.dateOfBirth)
  if (age !== null) {
    if (age < 2) return 'infant'
    if (age < 12) return 'child'
  }
  const first = passenger.firstName.trim().toLowerCase()
  const femaleHints = ['anna', 'maria', 'sarah', 'emma', 'olivia', 'sophia', 'emily', 'carolyn', 'lisa', 'jennifer']
  if (femaleHints.some((n) => first === n || first.startsWith(n))) return 'female'
  return 'male'
}

/**
 * Map SNAPP bag → AirportPay commodity code for Accepted Joining Baggage.
 * P/J/Y follow cabin (or priority); H heavy/oversize; T/T1 transfer; C carry-on; X other.
 */
const commodityForBag = (
  bag: SnappIntegrationBaggage,
  passenger: SnappIntegrationPassenger | undefined,
  flightDestination: string,
): string => {
  const type = (bag.bagType || '').toLowerCase()
  const status = (bag.status || '').toLowerCase()
  const cabin = cabinBucket(passenger?.cabin || '')

  if (type.includes('carry')) return 'C'
  if (bag.heavy || type.includes('oversize') || type.includes('gate') || status.includes('heavy')) {
    return 'H'
  }

  const bagDest = (bag.finalDestination || bag.destination || '').toUpperCase()
  const flightDest = (flightDestination || '').toUpperCase()
  const isTransfer =
    bag.isFinalDestination === false ||
    (Boolean(bagDest) && Boolean(flightDest) && bagDest !== flightDest)

  if (isTransfer) {
    // Short-haul / same-region transfer vs long-haul — keep simple split
    return bagDest && flightDest && bagDest.slice(0, 1) === flightDest.slice(0, 1) ? 'T1' : 'T'
  }

  if (bag.priority || status.includes('priority') || cabin === 'first') return 'P'
  if (cabin === 'business') return 'J'
  if (type.includes('crew') || status.includes('crew')) return 'D'
  if (type.includes('empty') || status.includes('uld')) return 'X'
  return 'Y'
}

const seatingNotes = (passengers: SnappIntegrationPassenger[]): string => {
  const notes: string[] = []
  const vip = passengers.filter((p) => p.flags?.vip).length
  const wchr = passengers.filter((p) => p.flags?.wheelchair).length
  const um = passengers.filter((p) => p.flags?.unaccompanied_minor).length
  const pet = passengers.filter((p) => p.flags?.pet).length
  if (vip) notes.push(`${vip} VIP`)
  if (wchr) notes.push(`${wchr} WCHR`)
  if (um) notes.push(`${um} UM`)
  if (pet) notes.push(`${pet} PET`)
  return notes.join(' · ')
}

export const buildPassengerStateFromSnapp = (payload: SnappPassengerPayload): PassengerState => {
  const booked = { first: 0, business: 0, economy: 0 }
  const transit = { first: 0, business: 0, economy: 0 }
  const accepted = { male: 0, female: 0, child: 0, infant: 0, cbbgExst: 0 }
  const bagPiecesByCode: Record<string, number> = Object.fromEntries(defaultBaggageCodes.map((c) => [c, 0]))
  const bagWeightByCode: Record<string, number> = Object.fromEntries(defaultBaggageCodes.map((c) => [c, 0]))
  let rushBags = 0

  const paxById = new Map(payload.passengers.map((p) => [p.id, p]))

  for (const passenger of payload.passengers) {
    const cabin = cabinBucket(passenger.cabin)
    booked[cabin] += 1

    const acceptedStatus = passenger.checkedIn || passenger.boarded
    if (!acceptedStatus) continue

    const gender = inferGender(passenger)
    if (gender === 'infant') accepted.infant += 1
    else if (gender === 'child') accepted.child += 1
    else if (gender === 'female') accepted.female += 1
    else accepted.male += 1
  }

  // Accepted joining baggage = all bags tagged for this flight's passengers
  for (const bag of payload.baggage) {
    const passenger = paxById.get(bag.passengerId)
    const code = commodityForBag(bag, passenger, payload.destination)
    bagPiecesByCode[code] = (bagPiecesByCode[code] ?? 0) + 1
    bagWeightByCode[code] = (bagWeightByCode[code] ?? 0) + (Number(bag.weightKg) || 0)

    const status = (bag.status || '').toLowerCase()
    if (status.includes('rush') || status.includes('rushbag')) rushBags += 1
  }

  const baggage = defaultBaggageCodes.map((code) => ({
    code,
    pieces: bagPiecesByCode[code] ?? 0,
    weightKg: Math.round(bagWeightByCode[code] ?? 0),
  }))
  const acceptedBags = baggage.reduce((sum, row) => sum + row.pieces, 0)
  const acceptedPax = accepted.male + accepted.female + accepted.child

  return createPassengerState({
    booked,
    transit,
    accepted,
    acceptedPax,
    acceptedBags,
    passengersInCrewSeats: payload.crewSeatsBlocked ?? 0,
    rushBags,
    baggage,
    saleableConfiguration: payload.saleableConfiguration || '',
    seatingConditions: seatingNotes(payload.passengers),
  })
}

export const fetchSnappPassengerPayload = async (flightId: string): Promise<SnappPassengerPayload> => {
  const base = resolveSnappApiBase()
  const response = await fetch(`${base}/api/snapp/flights/${encodeURIComponent(flightId)}/passengers`)
  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as { error?: string } | null
    throw new Error(payload?.error || `Unable to load SNAPP passengers: ${response.status}`)
  }
  return response.json() as Promise<SnappPassengerPayload>
}

export const loadSnappPassengerState = async (flightId: string): Promise<PassengerState | null> => {
  const payload = await fetchSnappPassengerPayload(flightId)
  if (!payload.passengers?.length && !payload.baggage?.length && !payload.saleableConfiguration) {
    return null
  }
  return buildPassengerStateFromSnapp(payload)
}
