import type { ChatMessage } from './chatApi'
import { resolveSnappApiBase } from './snappFlightApi'

export interface SnappConversationMessage {
  id: string
  flightId: string
  authorId: string
  authorRole: string
  body: string
  priority: 'normal' | 'high'
  recipients: string[]
  replies: Array<{
    id: string
    authorId: string
    authorRole: string
    body: string
    createdAt: string
  }>
  createdAt: string
}

const recipientFromSnapp = (recipients: string[]): string => {
  const joined = recipients.join(' ').toLowerCase()
  if (joined.includes('crew')) return 'Supervisor'
  if (joined.includes('check')) return 'Check-in'
  if (joined.includes('load')) return 'Load Controller'
  if (joined.includes('station') || joined.includes('ramp')) return 'Ramp'
  if (joined.includes('occ')) return 'Supervisor'
  return recipients[0] || 'Supervisor'
}

const recipientsForAirportPay = (recipient: string): string[] => {
  const key = recipient.toLowerCase()
  if (key.includes('ramp')) return ['Station Ops', 'OCC']
  if (key.includes('check')) return ['Check-in', 'OCC']
  if (key.includes('load')) return ['Load Control', 'OCC']
  if (key.includes('supervisor')) return ['OCC', 'Station Ops']
  return ['OCC', 'Station Ops']
}

/** Flatten SNAPP threads (+ replies) into AirportPay Messenger rows. */
export const mapSnappConversationsToChat = (
  flightLabel: string,
  messages: SnappConversationMessage[],
): ChatMessage[] => {
  const rows: ChatMessage[] = []
  for (const message of messages) {
    rows.push({
      id: message.id,
      flightLabel,
      author: message.authorRole || 'SNAPP',
      text: message.body,
      recipient: recipientFromSnapp(message.recipients),
      priority: message.priority === 'high' ? 'high' : 'medium',
      status: 'published',
      createdAt: message.createdAt,
    })
    for (const reply of message.replies ?? []) {
      rows.push({
        id: reply.id,
        flightLabel,
        author: reply.authorRole || 'OCC',
        text: `↳ ${reply.body}`,
        recipient: recipientFromSnapp(message.recipients),
        priority: message.priority === 'high' ? 'high' : 'medium',
        status: 'published',
        createdAt: reply.createdAt,
      })
    }
  }
  return rows.sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  )
}

export const fetchSnappConversations = async (
  flightId: string,
  flightLabel: string,
): Promise<ChatMessage[]> => {
  const base = resolveSnappApiBase()
  const response = await fetch(
    `${base}/api/snapp/flights/${encodeURIComponent(flightId)}/conversations`,
  )
  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as { error?: string } | null
    throw new Error(payload?.error || `Unable to load SNAPP messages: ${response.status}`)
  }
  const payload = (await response.json()) as { messages?: SnappConversationMessage[] }
  return mapSnappConversationsToChat(flightLabel, payload.messages ?? [])
}

export const sendSnappConversation = async (input: {
  flightId: string
  flightLabel: string
  author: string
  text: string
  recipient: string
  priority: 'low' | 'medium' | 'high'
}): Promise<ChatMessage> => {
  const base = resolveSnappApiBase()
  const response = await fetch(
    `${base}/api/snapp/flights/${encodeURIComponent(input.flightId)}/conversations`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        body: input.text,
        authorRole: input.author,
        authorId: 'airportpay',
        priority: input.priority === 'high' ? 'high' : 'normal',
        recipients: recipientsForAirportPay(input.recipient),
        source: 'airportpay',
      }),
    },
  )
  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as { error?: string } | null
    throw new Error(payload?.error || `Unable to send SNAPP message: ${response.status}`)
  }
  const payload = (await response.json()) as { message?: SnappConversationMessage }
  if (!payload.message) throw new Error('SNAPP returned no message')
  return mapSnappConversationsToChat(input.flightLabel, [payload.message])[0]!
}
