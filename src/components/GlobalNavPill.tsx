import React from 'react'
import { Rocket, BookOpen, Activity } from 'lucide-react'

export const GlobalNavPill: React.FC = () => {
  return (
    <aside
      aria-label="v系列开发者生态矩阵"
      className="fixed bottom-5 left-1/2 -translate-x-1/2 z-50 flex items-center gap-1 rounded-full border border-[var(--pulse-border-hover)] bg-[var(--pulse-card)]/90 px-3 py-1.5 shadow-2xl backdrop-blur-md"
    >
      <a
        href="https://vmaker.xmtlz.dev"
        className="flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs text-[var(--pulse-text-muted)] transition-colors hover:bg-black/5 dark:hover:bg-white/10 hover:text-[var(--pulse-text)]"
        title="访问 vMaker 创意作品集"
      >
        <Rocket className="h-3.5 w-3.5 text-blue-600 dark:text-blue-400" />
        <span>vMaker</span>
      </a>

      <span className="text-[var(--pulse-border)] select-none">|</span>

      <a
        href="https://vblog.xmtlz.dev"
        className="flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs text-[var(--pulse-text-muted)] transition-colors hover:bg-black/5 dark:hover:bg-white/10 hover:text-[var(--pulse-text)]"
        title="访问 vBlog 个人独立博客"
      >
        <BookOpen className="h-3.5 w-3.5 text-purple-600 dark:text-purple-400" />
        <span>vBlog</span>
      </a>

      <span className="text-[var(--pulse-border)] select-none">|</span>

      <span className="flex items-center gap-1.5 rounded-full bg-emerald-500/15 px-2.5 py-1 text-xs font-semibold text-emerald-600 dark:text-emerald-400">
        <Activity className="h-3.5 w-3.5" />
        <span>vPulse</span>
      </span>
    </aside>
  )
}
