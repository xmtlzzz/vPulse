import { useState, useEffect, useCallback, useRef } from 'react'
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
  const transitionTimerRef = useRef<number | null>(null)

  useEffect(() => {
    const root = document.documentElement
    const isDark = theme === 'dark'
    root.classList.toggle('dark', isDark)
    root.classList.toggle('theme-dark', isDark)
    root.classList.toggle('theme-light', !isDark)
    savePreference(STORAGE_KEY, theme)
  }, [theme])

  const toggleTheme = useCallback(() => {
    const root = document.documentElement
    root.classList.add('theme-transitioning')
    setTheme((prev) => (prev === 'dark' ? 'light' : 'dark'))

    if (transitionTimerRef.current) {
      window.clearTimeout(transitionTimerRef.current)
    }
    transitionTimerRef.current = window.setTimeout(() => {
      root.classList.remove('theme-transitioning')
    }, 400)
  }, [])

  useEffect(() => {
    return () => {
      if (transitionTimerRef.current) {
        window.clearTimeout(transitionTimerRef.current)
      }
    }
  }, [])

  return { theme, toggleTheme, isDark: theme === 'dark' }
}
