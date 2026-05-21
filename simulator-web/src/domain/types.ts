export type ModuleId =
  | 'ramp'
  | 'clearance'
  | 'documents'
  | 'messenger'
  | 'passenger'
  | 'fuel'
  | 'freight'

export interface Commodity {
  id: string
  code: string
  label: string
  weightKg: number
  locationId: string
  status: 'loaded' | 'offloaded'
  isDangerousGoods?: boolean
}

export interface Hold {
  id: string
  name: string
  maxWeightKg: number
}

export interface FuelState {
  plannedKg: number
  actualKg: number
  density: number
  status: 'pending' | 'confirmed'
}

export interface PassengerCabinCounts {
  first: number
  business: number
  economy: number
}

export interface PassengerAcceptedCounts {
  male: number
  female: number
  child: number
  infant: number
  cbbgExst: number
}

export interface PassengerBaggageEntry {
  code: string
  pieces: number
  weightKg: number
}

export interface PassengerState {
  acceptedPax: number
  acceptedBags: number
  finalised: boolean
  saleableConfiguration: string
  booked: PassengerCabinCounts
  transit: PassengerCabinCounts
  accepted: PassengerAcceptedCounts
  seatingConditions: string
  passengersInCrewSeats: number
  rushBags: number
  baggage: PassengerBaggageEntry[]
}

export interface Message {
  id: string
  author: string
  text: string
  createdAt: string
  recipient: string
  priority: 'low' | 'medium' | 'high'
  status: 'sent' | 'published'
}

export interface FlightDocument {
  id: string
  title: string
  body: string
}

export interface EventLogEntry {
  id: string
  ts: string
  action: string
  detail: string
  moduleId: ModuleId
  scoreDelta: number
}

export interface ScenarioObjective {
  id: string
  label: string
  completed: boolean
}

export interface FlightState {
  flightNo: string
  route: string
  status: 'open' | 'boarding' | 'clearance' | 'closed'
  holds: Hold[]
  commodities: Commodity[]
  passenger: PassengerState
  fuel: FuelState
  messages: Message[]
  documents: FlightDocument[]
  objectives: ScenarioObjective[]
  rampClearedHoldIds: string[]
}

export interface ScenarioDefinition {
  id: string
  title: string
  level: 'basic' | 'intermediate' | 'advanced'
  briefing: string
  debriefTemplate: string
  initialState: FlightState
}

export interface ValidationResult {
  ok: boolean
  reason?: string
}
