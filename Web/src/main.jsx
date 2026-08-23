import { createRoot } from 'react-dom/client'
import { VaultProvider } from './context/VaultContext';
import { ThemeProvider } from './context/ThemeContext';
import { Backdrop } from './components/Backdrop';
import { PixProvider } from './context/PixContext.jsx';
import { DemoBanner } from './components/DemoBanner';
import App from './App.jsx'
import './fonts.css';
import './theme.css';

createRoot(document.getElementById('root')).render(
  <ThemeProvider>
    <VaultProvider>
      <PixProvider>
        <Backdrop />
        {/* Outside App so it covers the pre-auth screens too — those
            render standalone and never mount AppShell. Renders null
            unless VITE_DEMO_MODE is set. */}
        <DemoBanner />
        <App />
      </PixProvider>
    </VaultProvider>
  </ThemeProvider>,
)