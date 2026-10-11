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
      className="relative inline-flex h-9 w-9 items-center justify-center rounded-full border border-[var(--pulse-border)] bg-[var(--pulse-card)] text-[var(--pulse-text-muted)] transition-all hover:border-[var(--pulse-border-hover)] hover:text-[var(--pulse-text)] focus:outline-none cursor-pointer overflow-hidden shadow-xs"
      title={isDark ? '切换到日间模式' : '切换到夜间模式'}
      aria-label={isDark ? '切换到日间模式' : '切换到夜间模式'}
    >
      <span className="relative flex h-4 w-4 items-center justify-center">
        <Sun
          className={`absolute h-4 w-4 transition-all duration-360 ease-out text-amber-400 ${
            isDark ? 'rotate-0 scale-100 opacity-100' : 'rotate-90 scale-0 opacity-0'
          }`}
        />
        <Moon
          className={`absolute h-4 w-4 transition-all duration-360 ease-out text-slate-700 dark:text-slate-300 ${
            isDark ? '-rotate-90 scale-0 opacity-0' : 'rotate-0 scale-100 opacity-100'
          }`}
        />
      </span>
    </button>
  )
}
