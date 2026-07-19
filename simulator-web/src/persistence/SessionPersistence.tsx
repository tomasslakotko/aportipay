import { useEffect, useRef } from 'react'
import type { SimulatorSnapshot } from '../store/useSimulatorStore'
import { createSimulatorSnapshot, useSimulatorStore } from '../store/useSimulatorStore'
import { subscribeWorkspaceSession } from './firebaseClient'
import {
  fetchWorkspaceSession,
  getWorkspaceSessionId,
  readLocalWorkspaceSnapshot,
  readLocalWorkspaceUpdatedAt,
  saveWorkspaceSession,
  writeLocalWorkspaceSnapshot,
} from './sessionApi'

const AUTOSAVE_DELAY_MS = 700
const AUTOREFRESH_INTERVAL_MS = 1500
const BACKUP_AUTOSAVE_INTERVAL_MS = 2500
export const SESSION_SAVE_EVENT = 'simulator-session-saving'

const applySnapshot = (snapshot: SimulatorSnapshot | null) => {
  if (!snapshot) return false
  if (snapshot.openFlights.length === 0) return false
  useSimulatorStore.getState().hydrateSession(snapshot)
  return true
}

export function SessionPersistence() {
  const autosaveTimer = useRef<number | undefined>(undefined)
  const refreshTimer = useRef<number | undefined>(undefined)
  const backupSaveTimer = useRef<number | undefined>(undefined)
  const applyingRemoteUpdate = useRef(false)
  const latestSavedAtMs = useRef<number>(0)
  const hasUnsavedChanges = useRef(false)
  const lastSnapshotHash = useRef('')
  const workspaceSessionId = getWorkspaceSessionId()

  useEffect(() => {
    let cancelled = false
    let unsubscribe: (() => void) | undefined

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
        void saveWorkspaceSession(snapshot)
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

    const restoreFromRemote = async () => {
      const latest = await fetchWorkspaceSession()
      if (!latest?.snapshot) return
      const remoteUpdatedAtMs = Date.parse(latest.updatedAt) || 0
      if (remoteUpdatedAtMs <= latestSavedAtMs.current) return
      applyingRemoteUpdate.current = true
      applySnapshot(latest.snapshot)
      latestSavedAtMs.current = remoteUpdatedAtMs
      lastSnapshotHash.current = JSON.stringify(latest.snapshot)
      window.setTimeout(() => {
        applyingRemoteUpdate.current = false
      }, 0)
    }

    const startPersistence = async () => {
      const localSnapshot = readLocalWorkspaceSnapshot()
      const localUpdatedAtMs = readLocalWorkspaceUpdatedAt()
      if (!cancelled && localSnapshot && applySnapshot(localSnapshot)) {
        latestSavedAtMs.current = localUpdatedAtMs
        lastSnapshotHash.current = JSON.stringify(localSnapshot)
        hasUnsavedChanges.current = false
      }

      try {
        if (!cancelled) await restoreFromRemote()
      } catch (error) {
        console.warn('Simulator session restore failed', error)
      }

      if (cancelled) return

      unsubscribe = useSimulatorStore.subscribe(scheduleSave)
      const unsubscribeFirestore = subscribeWorkspaceSession(workspaceSessionId, () => {
        void restoreFromRemote()
      })

      refreshTimer.current = window.setInterval(() => {
        void restoreFromRemote()
      }, AUTOREFRESH_INTERVAL_MS)
      backupSaveTimer.current = window.setInterval(() => {
        if (applyingRemoteUpdate.current || !hasUnsavedChanges.current) return
        const snapshot = createSimulatorSnapshot(useSimulatorStore.getState())
        const snapshotHash = JSON.stringify(snapshot)
        if (snapshotHash === lastSnapshotHash.current) {
          hasUnsavedChanges.current = false
          return
        }
        void saveWorkspaceSession(snapshot)
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
        const snapshot = createSimulatorSnapshot(useSimulatorStore.getState())
        const snapshotHash = JSON.stringify(snapshot)
        writeLocalWorkspaceSnapshot(snapshot)
        if (snapshotHash !== lastSnapshotHash.current) {
          void saveWorkspaceSession(snapshot).catch(() => {})
        }
      }
      window.addEventListener('visibilitychange', flushOnExit)
      window.addEventListener('pagehide', flushOnExit)

      const existingUnsubscribe = unsubscribe
      unsubscribe = () => {
        existingUnsubscribe?.()
        unsubscribeFirestore?.()
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
  }, [workspaceSessionId])

  return null
}
