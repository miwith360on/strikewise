import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import 'leaflet/dist/leaflet.css'
import './index.css'
import App from './App.tsx'

window.addEventListener('vite:preloadError', (event) => {
  // Recover from stale service-worker/asset cache after a new deploy.
  event.preventDefault()
  const reloadKey = 'strikewise:preload-reload'
  if (sessionStorage.getItem(reloadKey)) {
    return
  }
  sessionStorage.setItem(reloadKey, '1')
  window.location.reload()
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
