import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

export type Theme = 'light' | 'dark' | 'system';

interface ThemeContextValue {
  /** What the user picked. */
  theme: Theme;
  /** What is showing now ('system' resolved through the OS setting). */
  resolvedTheme: 'light' | 'dark';
  setTheme: (theme: Theme) => void;
}

// Keep in sync with the inline script in index.html, which applies the theme before first paint.
const STORAGE_KEY = 'shiftora:theme';
const darkQuery = '(prefers-color-scheme: dark)';

function readTheme(): Theme {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    return value === 'light' || value === 'dark' ? value : 'system';
  } catch {
    return 'system';
  }
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

/** Light, dark or follow the OS. Adds `.dark` to <html>; remembers the choice in localStorage. */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(readTheme);
  const [systemDark, setSystemDark] = useState(() => window.matchMedia(darkQuery).matches);
  const resolvedTheme = theme === 'system' ? (systemDark ? 'dark' : 'light') : theme;

  useEffect(() => {
    const mql = window.matchMedia(darkQuery);
    const onChange = (event: MediaQueryListEvent) => setSystemDark(event.matches);
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle('dark', resolvedTheme === 'dark');
    root.style.colorScheme = resolvedTheme;
  }, [resolvedTheme]);

  function setTheme(next: Theme) {
    setThemeState(next);
    try {
      if (next === 'system') localStorage.removeItem(STORAGE_KEY);
      else localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // the choice still applies for this visit
    }
  }

  return (
    <ThemeContext.Provider value={{ theme, resolvedTheme, setTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  const value = useContext(ThemeContext);
  if (!value) throw new Error('useTheme() used outside ThemeProvider');
  return value;
}
