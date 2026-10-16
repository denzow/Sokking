import { createRoot } from 'react-dom/client'
import App from './App'
import './styles.css'

// StrictMode is intentionally not used: its double-mount in dev would spawn
// and kill each tab's pty twice.
createRoot(document.getElementById('root')!).render(<App />)
