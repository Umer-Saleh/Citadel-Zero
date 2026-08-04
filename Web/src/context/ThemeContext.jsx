import { createContext, useContext, useState, useEffect, useCallback } from 'react';

const ThemeContext = createContext(null);

export function useTheme() {
  return useContext(ThemeContext);
}

export function ThemeProvider({ children }) {
  // Theme preference is not a secret, so localStorage is fine here —
  // unlike the DEK, which must never be persisted.
  const [theme, setTheme] = useState(() => localStorage.getItem('vk-theme') || 'dark');

  useEffect(() => {
    document.body.classList.toggle('light', theme === 'light');
    localStorage.setItem('vk-theme', theme);
  }, [theme]);

  const toggle = useCallback(() => {
    setTheme(t => (t === 'dark' ? 'light' : 'dark'));
  }, []);

  return (
    <ThemeContext.Provider value={{ theme, toggle }}>
      {children}
    </ThemeContext.Provider>
  );
}