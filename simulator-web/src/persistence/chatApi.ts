import { useEffect, useState } from 'react'
import { createClient } from '@supabase/supabase-js'
import type { Message } from '../domain/types'

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8787'
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string | undefined
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined
const supabase = SUPABASE_URL && SUPABASE_ANON_KEY ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY) : null

export interface ChatMessage extends Message {
  flightLabel: string
}

export const fetchChatMessages = async (flightLabel: string): Promise<ChatMessage[]> => {
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
}): Promise<ChatMessage> => {
  const response = await fetch(`${API_BASE_URL}/api/chat/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
  if (!response.ok) throw new Error(`Unable to send message: ${response.status}`)
  return response.json() as Promise<ChatMessage>
}

export const publishChatMessage = async (id: string): Promise<ChatMessage> => {
  const response = await fetch(`${API_BASE_URL}/api/chat/messages/${encodeURIComponent(id)}/publish`, {
    method: 'PATCH',
  })
  if (!response.ok) throw new Error(`Unable to publish message: ${response.status}`)
  return response.json() as Promise<ChatMessage>
}

export const useLiveChat = (flightLabel: string, enabled = true) => {
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
        const data = await fetchChatMessages(flightLabel)
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

    let channel:
      | ReturnType<NonNullable<typeof supabase>['channel']>
      | undefined

    try {
      channel = supabase
        ?.channel(`chat:${encodeURIComponent(flightLabel)}`)
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'chat_messages', filter: `flight_label=eq.${flightLabel}` },
          () => {
            void load()
          },
        )

      if (channel) {
        void channel.subscribe()
      }
    } catch {
      channel = undefined
    }

    // Keep a lightweight periodic refresh even with realtime,
    // so chat stays synced if websocket silently drops.
    const interval = window.setInterval(() => {
      void load()
    }, 1500)

    return () => {
      cancelled = true
      window.clearInterval(interval)
      if (channel) void supabase?.removeChannel(channel)
    }
  }, [enabled, flightLabel])

  return {
    messages,
    error,
    refresh: async () => {
      try {
        setMessages(await fetchChatMessages(flightLabel))
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to refresh chat.')
      }
    },
  }
}
