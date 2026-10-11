import { useState, useEffect, useCallback } from 'react'
import { readPreference, savePreference } from './storage'

export type Theme = 'dark' | 'light'

const STORAGE_KEY = 'vpulse-theme'

export function useTheme() {
  const [theme, setTheme] = useState<Theme>(() => {
    if (typeof window === 'undefined') return 'dark'
    const stored = readPreference(STORAGE_KEY)
    if (stored === 'light' || stored === 'dark') return stored
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  })

  useEffect(() => {
    const root = document.documentElement
    const isDark = theme === 'dark'
    root.classList.toggle('dark', isDark)
    root.classList.toggle('theme-dark', isDark)
    root.classList.toggle('theme-light', !isDark)
    savePreference(STORAGE_KEY, theme)
  }, [theme])

  const toggleTheme = useCallback(() => {
    const nextTheme: Theme = theme === 'dark' ? 'light' : 'dark'

    // Use native GPU compositor view transitions for butter-smooth 60fps crossfade
    if (
      typeof document !== 'undefined' &&
      'startViewTransition' in document &&
      !window.matchMedia('(prefers-reduced-motion: reduce)').matches
    ) {
      document.startViewTransition(() => {
        setTheme(nextTheme)
      })
    } else {
      setTheme(nextTheme)
    }
  }, [theme])

  return { theme, toggleTheme, isDark: theme === 'dark' }
}
