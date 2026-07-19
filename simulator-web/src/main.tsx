import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import './index.css'
import App from './App.tsx'
import { readLocalWorkspaceSnapshot } from './persistence/sessionApi'
import { registerServiceWorker } from './pwa/registerServiceWorker.ts'
import { useSimulatorStore } from './store/useSimulatorStore'

const bootstrapWorkspace = readLocalWorkspaceSnapshot()
if (bootstrapWorkspace?.openFlights.length) {
  useSimulatorStore.getState().hydrateSession(bootstrapWorkspace)
}

registerServiceWorker()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
)
