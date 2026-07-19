import { collection, getDocs, query, where } from 'firebase/firestore'
import type { PassengerState } from '../domain/types'
import type { AdminFlight } from './flightApi'
import { getFirebaseDb, isFirebaseConfigured } from './firebaseClient'
import { createPassengerState } from '../store/useSimulatorStore'

export interface AaLidsPassengerRow {
  id: string
  flightId: string
  firstName: string
  lastName: string
  title?: string
  status: 'BOOKED' | 'CHECKED_IN' | 'BOARDED'
  seat: string
  hasBags: boolean
  bagCount: number
  bagsLoaded?: number
  passengerType?: string
}

const defaultBaggageCodes = ['P', 'C', 'J', 'Y', 'D', 'H', 'T', 'T1', 'X']

const inferGender = (title?: string): 'male' | 'female' | 'child' => {
  const normalized = (title ?? '').trim().toUpperCase()
  if (normalized.includes('CHD') || normalized === 'MSTR') return 'child'
  if (normalized === 'MRS' || normalized === 'MS' || normalized === 'MISS') return 'female'
  return 'male'
}

const inferCabin = (seat: string): 'first' | 'business' | 'economy' => {
  const row = Number.parseInt(seat.match(/^\d+/)?.[0] ?? '99', 10)
  if (row <= 2) return 'first'
  if (row <= 6) return 'business'
  return 'economy'
}

export const formatSearchFlight = (row: AdminFlight) =>
  `${row.carrier} ${row.flightNo} ${row.date} ${row.dep}-${row.arr} ${row.aircraft} ${row.time} ${row.status}`

export const resolveAaLidsFlightId = (flightLabel: string, flights: AdminFlight[]): string | null => {
  const match = flights.find((row) => row.source === 'aa-lids' && formatSearchFlight(row) === flightLabel)
  if (!match) return null
  return match.id.startsWith('aalids-') ? match.id.slice('aalids-'.length) : match.id
}

export const fetchAaLidsPassengers = async (flightId: string): Promise<AaLidsPassengerRow[]> => {
  if (!isFirebaseConfigured()) return []
  const snapshot = await getDocs(query(
    collection(getFirebaseDb(), 'passengers'),
    where('flightId', '==', flightId),
  ))
  return snapshot.docs.map((document) => ({
    id: document.id,
    ...document.data(),
  })) as AaLidsPassengerRow[]
}

export const buildPassengerStateFromAaLids = (passengers: AaLidsPassengerRow[]): PassengerState => {
  const booked = { first: 0, business: 0, economy: 0 }
  const transit = { first: 0, business: 0, economy: 0 }
  const accepted = { male: 0, female: 0, child: 0, infant: 0, cbbgExst: 0 }
  let acceptedBags = 0
  let joiningBagPieces = 0
  let crewSeats = 0

  passengers.forEach((passenger) => {
    const cabin = inferCabin(passenger.seat)
    const isStaff = passenger.passengerType === 'STAFF_DUTY' || passenger.passengerType === 'STAFF_SBY'
    if (isStaff) crewSeats += 1

    if (passenger.status === 'BOOKED') {
      booked[cabin] += 1
      return
    }

    if (passenger.status === 'CHECKED_IN' || passenger.status === 'BOARDED') {
      booked[cabin] += 1
      const gender = inferGender(passenger.title)
      if (gender === 'child') accepted.child += 1
      else if (gender === 'female') accepted.female += 1
      else accepted.male += 1

      const bags = passenger.hasBags ? Math.max(0, passenger.bagCount ?? 0) : 0
      acceptedBags += bags
      joiningBagPieces += bags
    }
  })

  const acceptedPax = accepted.male + accepted.female + accepted.child
  const baggage = defaultBaggageCodes.map((code) => ({
    code,
    pieces: code === 'Y' ? joiningBagPieces : 0,
    weightKg: 0,
  }))

  return createPassengerState({
    booked,
    transit,
    accepted,
    acceptedPax,
    acceptedBags,
    passengersInCrewSeats: crewSeats,
    rushBags: 0,
    baggage,
    saleableConfiguration: '',
    seatingConditions: '',
  })
}

export const loadAaLidsPassengerState = async (flightId: string): Promise<PassengerState | null> => {
  const passengers = await fetchAaLidsPassengers(flightId)
  if (passengers.length === 0) return null
  return buildPassengerStateFromAaLids(passengers)
}
