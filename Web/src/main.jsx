import { createRoot } from 'react-dom/client'
import { VaultProvider } from './context/VaultContext';
import { ThemeProvider } from './context/ThemeContext';
import { Backdrop } from './components/Backdrop';
import { PixProvider } from './context/PixContext.jsx';
import App from './App.jsx'
import './theme.css';

createRoot(document.getElementById('root')).render(
  <ThemeProvider>
    <VaultProvider>
      <PixProvider>
        <Backdrop />
        <App />
      </PixProvider>
    </VaultProvider>
  </ThemeProvider>,
)