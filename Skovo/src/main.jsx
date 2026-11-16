import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import { AuthProvider } from './context/AuthContext.jsx'
import { ThemeProvider } from './context/ThemeContext.jsx'
import './index.css'
import { isAdminHost } from './utils/portalHost.js'

// One bundle serves skovoai.com and skovoai.info, so the favicon cannot be a
// static tag in index.html — it has to follow the hostname the same way the
// landing page does. Admin/super-admin get the dark mark, students and
// achievers the light one.
const favicon = isAdminHost() ? '/skovo-logo-black.jpg' : '/skovo-logo-blue.jpg'
for (const rel of ['icon', 'apple-touch-icon']) {
  const link = document.querySelector(`link[rel="${rel}"]`)
  if (link) link.href = favicon
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ThemeProvider>
      <AuthProvider>
        <App />
      </AuthProvider>
    </ThemeProvider>
  </React.StrictMode>,
)
