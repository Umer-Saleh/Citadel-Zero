import { createRoot } from 'react-dom/client'
import { VaultProvider } from './context/VaultContext';
import { ThemeProvider } from './context/ThemeContext';
import { Backdrop } from './components/Backdrop';
import App from './App.jsx'
import './index.css'
import './theme.css';

createRoot(document.getElementById('root')).render(
  <ThemeProvider>
    <VaultProvider>
      <Backdrop />
      <App />
    </VaultProvider>
  </ThemeProvider>,
)
