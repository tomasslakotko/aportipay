import type { ScenarioDefinition } from '../domain/types'

const emptyPassenger = {
  acceptedPax: 0,
  acceptedBags: 0,
  finalised: false,
  saleableConfiguration: '',
  booked: { first: 0, business: 0, economy: 0 },
  transit: { first: 0, business: 0, economy: 0 },
  accepted: { male: 0, female: 0, child: 0, infant: 0, cbbgExst: 0 },
  seatingConditions: '',
  passengersInCrewSeats: 0,
  rushBags: 0,
  baggage: ['P', 'C', 'J', 'Y', 'D', 'H', 'T', 'T1', 'X'].map((code) => ({
    code,
    pieces: 0,
    weightKg: 0,
  })),
}

const baseState = {
  flightNo: 'AT7401',
  route: 'LIR-GO-RO',
  status: 'open' as const,
  holds: [
    { id: 'cpt1', name: 'CPT 1', maxWeightKg: 700 },
    { id: 'cpt2', name: 'CPT 2', maxWeightKg: 2500 },
    { id: 'cpt3', name: 'CPT 3', maxWeightKg: 3600 },
    { id: 'cpt4', name: 'CPT 4', maxWeightKg: 700 },
  ],
  commodities: [
    {
      id: 'cmd-1',
      code: 'BAG',
      label: 'Transfer bags',
      weightKg: 310,
      locationId: 'cpt4',
      status: 'loaded' as const,
    },
    {
      id: 'cmd-2',
      code: 'AVI',
      label: 'Live animal',
      weightKg: 19,
      locationId: 'cpt2',
      status: 'loaded' as const,
      isDangerousGoods: false,
    },
  ],
  passenger: structuredClone(emptyPassenger),
  fuel: { plannedKg: 6200, actualKg: 0, density: 0.8, status: 'pending' as const },
  messages: [],
  documents: [
    {
      id: 'doc-ldm',
      title: 'Load Summary',
      body: 'Initial loading summary prepared for training session.',
    },
  ],
  objectives: [
    { id: 'obj-load', label: 'Load all required commodities', completed: false },
    { id: 'obj-pax', label: 'Finalize passenger acceptance', completed: false },
    { id: 'obj-fuel', label: 'Confirm final fuel values', completed: false },
    { id: 'obj-clear', label: 'Complete ramp clearance', completed: false },
  ],
  rampClearedHoldIds: [],
}

export const scenarios: ScenarioDefinition[] = [
  {
    id: 'turnaround-basic',
    title: 'Basic Turnaround',
    level: 'basic',
    briefing: 'Handle a standard turnaround with limited deadload updates.',
    debriefTemplate:
      'Review timing, ensure no overweight hold events, and verify all closure prerequisites.',
    initialState: structuredClone(baseState),
  },
  {
    id: 'clearance-pressure',
    title: 'Clearance Under Time Pressure',
    level: 'intermediate',
    briefing: 'Manage cargo moves and complete ramp clearance before cutoff.',
    debriefTemplate:
      'Check sequence quality: movements, passenger finalization, fuel confirmation, then clearance.',
    initialState: {
      ...structuredClone(baseState),
      passenger: { ...structuredClone(emptyPassenger), acceptedPax: 124, acceptedBags: 98 },
      fuel: { plannedKg: 6200, actualKg: 6100, density: 0.79, status: 'pending' },
    },
  },
]
