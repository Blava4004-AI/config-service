// Remote entry point for Mosaic Module Federation
// Injects CSS inline to avoid MF CSS path injection bug
import App from './App.jsx'

// Inject styles directly when loaded as a remote module
const styleId = 'config-service-styles'
if (!document.getElementById(styleId)) {
  fetch(new URL('./styles.css', import.meta.url))
    .then(r => r.text())
    .then(css => {
      const style = document.createElement('style')
      style.id = styleId
      style.textContent = css
      document.head.appendChild(style)
    })
    .catch(() => {}) // fail silently if CSS can't load
}

export default App
