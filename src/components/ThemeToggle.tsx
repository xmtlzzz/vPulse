import React from 'react'
import { Sun, Moon } from 'lucide-react'

interface ThemeToggleProps {
  isDark: boolean
  onToggle: () => void
}

export const ThemeToggle: React.FC<ThemeToggleProps> = ({ isDark, onToggle }) => {
  return (
    <button
      onClick={onToggle}
      type="button"
      className="relative inline-flex h-9 w-9 items-center justify-center rounded-full border border-[var(--pulse-border)] bg-[var(--pulse-card)] text-[var(--pulse-text-muted)] transition-all hover:border-[var(--pulse-border-hover)] hover:text-[var(--pulse-text)] focus:outline-none"
      title={isDark ? '切换到浅色模式' : '切换到深色模式'}
      aria-label={isDark ? '切换到浅色模式' : '切换到深色模式'}
    >
      {isDark ? (
        <Sun className="h-4 w-4 transition-transform duration-300 hover:rotate-45" />
      ) : (
        <Moon className="h-4 w-4 transition-transform duration-300 hover:-rotate-12" />
      )}
    </button>
  )
}
