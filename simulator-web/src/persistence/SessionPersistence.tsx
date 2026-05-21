import { useEffect, useRef } from 'react'
import { createClient } from '@supabase/supabase-js'
import { createSimulatorSnapshot, useSimulatorStore } from '../store/useSimulatorStore'
import { fetchLatestSession, getRampSessionId, saveCurrentSession } from './sessionApi'

const AUTOSAVE_DELAY_MS = 700
const AUTOREFRESH_INTERVAL_MS = 1500
const BACKUP_AUTOSAVE_INTERVAL_MS = 2500
export const SESSION_SAVE_EVENT = 'simulator-session-saving'
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string | undefined
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined
const supabase = SUPABASE_URL && SUPABASE_ANON_KEY ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY) : null

export function SessionPersistence() {
  const activeFlightLabel = useSimulatorStore((store) => {
    if (store.openFlights.length === 0) return ''
    const index = Math.max(0, Math.min(store.activeFlightIndex, store.openFlights.length - 1))
    return store.openFlights[index] ?? ''
  })
  const autosaveTimer = useRef<number | undefined>(undefined)
  const refreshTimer = useRef<number | undefined>(undefined)
  const backupSaveTimer = useRef<number | undefined>(undefined)
  const applyingRemoteUpdate = useRef(false)
  const latestSavedAtMs = useRef<number>(0)
  const hasUnsavedChanges = useRef(false)
  const lastSnapshotHash = useRef('')

  useEffect(() => {
    let cancelled = false
    let unsubscribe: (() => void) | undefined
    const sessionId = getRampSessionId()

    const scheduleSave = () => {
      if (applyingRemoteUpdate.current) return
      hasUnsavedChanges.current = true
      window.dispatchEvent(new CustomEvent(SESSION_SAVE_EVENT, {
        detail: { message: 'Updating information...' },
      }))
      window.clearTimeout(autosaveTimer.current)
      autosaveTimer.current = window.setTimeout(() => {
        const snapshot = createSimulatorSnapshot(useSimulatorStore.getState())
        const snapshotHash = JSON.stringify(snapshot)
        if (snapshotHash === lastSnapshotHash.current) {
          hasUnsavedChanges.current = false
          return
        }
        void saveCurrentSession(snapshot, sessionId)
          .then((record) => {
            latestSavedAtMs.current = Date.parse(record.updatedAt) || Date.now()
            lastSnapshotHash.current = snapshotHash
            hasUnsavedChanges.current = false
          })
          .catch((error) => {
            console.warn('Simulator session autosave failed', error)
          })
      }, AUTOSAVE_DELAY_MS)
    }

    const silentRefresh = async () => {
      try {
        const latest = await fetchLatestSession(sessionId)
        if (!latest?.snapshot) return
        const remoteUpdatedAtMs = Date.parse(latest.updatedAt)
        if (!remoteUpdatedAtMs || remoteUpdatedAtMs <= latestSavedAtMs.current) return
        applyingRemoteUpdate.current = true
        useSimulatorStore.getState().hydrateSession(latest.snapshot)
        latestSavedAtMs.current = remoteUpdatedAtMs
        window.setTimeout(() => {
          applyingRemoteUpdate.current = false
        }, 0)
      } catch (error) {
        console.warn('Simulator session autorefresh failed', error)
      }
    }

    const startPersistence = async () => {
      try {
        const latest = await fetchLatestSession(sessionId)
        if (!cancelled && latest?.snapshot) {
          applyingRemoteUpdate.current = true
          useSimulatorStore.getState().hydrateSession(latest.snapshot)
          latestSavedAtMs.current = Date.parse(latest.updatedAt) || Date.now()
          lastSnapshotHash.current = JSON.stringify(latest.snapshot)
          hasUnsavedChanges.current = false
          window.setTimeout(() => {
            applyingRemoteUpdate.current = false
          }, 0)
        }
      } catch (error) {
        console.warn('Simulator session restore failed', error)
      }

      if (cancelled) return

      unsubscribe = useSimulatorStore.subscribe(scheduleSave)
      let channel:
        | ReturnType<NonNullable<typeof supabase>['channel']>
        | undefined
      try {
        channel = supabase
          ?.channel(`sessions:${encodeURIComponent(sessionId)}`)
          .on(
            'postgres_changes',
            { event: '*', schema: 'public', table: 'sessions', filter: `id=eq.${sessionId}` },
            () => {
              void silentRefresh()
            },
          )
        if (channel) void channel.subscribe()
      } catch {
        channel = undefined
      }
      refreshTimer.current = window.setInterval(() => {
        void silentRefresh()
      }, AUTOREFRESH_INTERVAL_MS)
      backupSaveTimer.current = window.setInterval(() => {
        if (applyingRemoteUpdate.current || !hasUnsavedChanges.current) return
        const snapshot = createSimulatorSnapshot(useSimulatorStore.getState())
        const snapshotHash = JSON.stringify(snapshot)
        if (snapshotHash === lastSnapshotHash.current) {
          hasUnsavedChanges.current = false
          return
        }
        void saveCurrentSession(snapshot, sessionId)
          .then((record) => {
            latestSavedAtMs.current = Date.parse(record.updatedAt) || Date.now()
            lastSnapshotHash.current = snapshotHash
            hasUnsavedChanges.current = false
          })
          .catch((error) => {
            console.warn('Simulator backup autosave failed', error)
          })
      }, BACKUP_AUTOSAVE_INTERVAL_MS)

      const flushOnExit = () => {
        if (applyingRemoteUpdate.current || !hasUnsavedChanges.current) return
        const snapshot = createSimulatorSnapshot(useSimulatorStore.getState())
        const snapshotHash = JSON.stringify(snapshot)
        if (snapshotHash === lastSnapshotHash.current) return
        void saveCurrentSession(snapshot, sessionId)
          .then((record) => {
            latestSavedAtMs.current = Date.parse(record.updatedAt) || Date.now()
            lastSnapshotHash.current = snapshotHash
            hasUnsavedChanges.current = false
          })
          .catch(() => {})
      }
      window.addEventListener('visibilitychange', flushOnExit)
      window.addEventListener('pagehide', flushOnExit)

      const cleanupRealtime = () => {
        if (channel) void supabase?.removeChannel(channel)
      }
      const existingUnsubscribe = unsubscribe
      unsubscribe = () => {
        existingUnsubscribe?.()
        cleanupRealtime()
        window.removeEventListener('visibilitychange', flushOnExit)
        window.removeEventListener('pagehide', flushOnExit)
      }
    }

    void startPersistence()

    return () => {
      cancelled = true
      window.clearTimeout(autosaveTimer.current)
      window.clearInterval(refreshTimer.current)
      window.clearInterval(backupSaveTimer.current)
      unsubscribe?.()
    }
  }, [activeFlightLabel])

  return null
}
