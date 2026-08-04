import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { VaultProvider } from './context/VaultContext';
import { ThemeProvider } from './context/ThemeContext';
import App from './App.jsx'
import './index.css'
import './theme.css';

createRoot(document.getElementById('root')).render(
  <ThemeProvider>
    <VaultProvider>
      <App />
    </VaultProvider>
  </ThemeProvider>,
)
