import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { Capacitor } from '@capacitor/core'
import { App } from './app/App'
import './styles/index.css'

if (Capacitor.isNativePlatform()) document.documentElement.classList.add('capacitor-native')

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
