import { useEffect, useState } from 'react'
import type { Message } from '../domain/types'
import { FIRESTORE_COLLECTIONS, isFirebaseConfigured, subscribeCollection } from './firebaseClient'
import * as firebaseDb from './firebaseDatabase'
import { fetchSnappConversations, sendSnappConversation } from './snappConversationSync'

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8787'

export interface ChatMessage extends Message {
  flightLabel: string
}

export const fetchChatMessages = async (
  flightLabel: string,
  snappFlightId?: string | null,
): Promise<ChatMessage[]> => {
  if (snappFlightId) {
    return fetchSnappConversations(snappFlightId, flightLabel)
  }
  if (isFirebaseConfigured()) return firebaseDb.fetchChatMessages(flightLabel)

  const response = await fetch(`${API_BASE_URL}/api/chat/messages?flightLabel=${encodeURIComponent(flightLabel)}`)
  if (!response.ok) throw new Error(`Unable to load chat: ${response.status}`)
  return response.json() as Promise<ChatMessage[]>
}

export const sendChatMessage = async (input: {
  flightLabel: string
  author: string
  text: string
  recipient: string
  priority: 'low' | 'medium' | 'high'
  snappFlightId?: string | null
}): Promise<ChatMessage> => {
  if (input.snappFlightId) {
    return sendSnappConversation({
      flightId: input.snappFlightId,
      flightLabel: input.flightLabel,
      author: input.author,
      text: input.text,
      recipient: input.recipient,
      priority: input.priority,
    })
  }
  if (isFirebaseConfigured()) return firebaseDb.sendChatMessage(input)

  const response = await fetch(`${API_BASE_URL}/api/chat/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
  if (!response.ok) throw new Error(`Unable to send message: ${response.status}`)
  return response.json() as Promise<ChatMessage>
}

export const publishChatMessage = async (id: string): Promise<ChatMessage> => {
  if (isFirebaseConfigured()) return firebaseDb.publishChatMessage(id)

  const response = await fetch(`${API_BASE_URL}/api/chat/messages/${encodeURIComponent(id)}/publish`, {
    method: 'PATCH',
  })
  if (!response.ok) throw new Error(`Unable to publish message: ${response.status}`)
  return response.json() as Promise<ChatMessage>
}

export const useLiveChat = (
  flightLabel: string,
  enabled = true,
  snappFlightId?: string | null,
) => {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [error, setError] = useState('')

  useEffect(() => {
    if (!enabled || !flightLabel) {
      setMessages([])
      setError('')
      return
    }

    let cancelled = false
    const load = async () => {
      try {
        const data = await fetchChatMessages(flightLabel, snappFlightId)
        if (!cancelled) {
          setMessages(data)
          setError('')
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load chat.')
        }
      }
    }

    void load()

    const unsubscribeFirestore =
      !snappFlightId && isFirebaseConfigured()
        ? subscribeCollection(
            FIRESTORE_COLLECTIONS.chatMessages,
            () => { void load() },
            { field: 'flightLabel', value: flightLabel },
          )
        : undefined

    const interval = window.setInterval(() => {
      void load()
    }, snappFlightId ? 3000 : 1500)

    return () => {
      cancelled = true
      window.clearInterval(interval)
      unsubscribeFirestore?.()
    }
  }, [enabled, flightLabel, snappFlightId])

  return {
    messages,
    error,
    refresh: async () => {
      try {
        setMessages(await fetchChatMessages(flightLabel, snappFlightId))
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to refresh chat.')
      }
    },
  }
}
