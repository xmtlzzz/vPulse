import React, { useEffect, useState, useRef } from 'react'
import { AlertTriangle, CheckCircle2, Info, X } from 'lucide-react'

interface FloatingNotificationProps {
  message: string
  isError?: boolean
  onDismiss: () => void
}

export const FloatingNotification: React.FC<FloatingNotificationProps> = ({
  message,
  isError = false,
  onDismiss,
}) => {
  const [visible, setVisible] = useState(false)
  const [displayMessage, setDisplayMessage] = useState('')
  const [displayError, setDisplayError] = useState(false)
  const timerRef = useRef<number | null>(null)
  const dismissTimerRef = useRef<number | null>(null)

  useEffect(() => {
    if (message) {
      setDisplayMessage(message)
      setDisplayError(isError)
      setVisible(true)

      if (timerRef.current) window.clearTimeout(timerRef.current)
      if (dismissTimerRef.current) window.clearTimeout(dismissTimerRef.current)

      // Auto dismiss after 2800ms (3600ms for errors)
      const duration = isError ? 3600 : 2800
      timerRef.current = window.setTimeout(() => {
        setVisible(false) // Trigger fade-out animation
        dismissTimerRef.current = window.setTimeout(() => {
          setDisplayMessage('')
          onDismiss()
        }, 320)
      }, duration)
    } else {
      setVisible(false)
      dismissTimerRef.current = window.setTimeout(() => {
        setDisplayMessage('')
      }, 320)
    }

    return () => {
      if (timerRef.current) window.clearTimeout(timerRef.current)
      if (dismissTimerRef.current) window.clearTimeout(dismissTimerRef.current)
    }
  }, [message, isError, onDismiss])

  const handleManualClose = () => {
    if (timerRef.current) window.clearTimeout(timerRef.current)
    if (dismissTimerRef.current) window.clearTimeout(dismissTimerRef.current)
    setVisible(false)
    dismissTimerRef.current = window.setTimeout(() => {
      setDisplayMessage('')
      onDismiss()
    }, 320)
  }

  if (!displayMessage) return null

  const isErrorMessage =
    displayError ||
    displayMessage.includes('失败') ||
    displayMessage.includes('未授权') ||
    displayMessage.includes('错误') ||
    displayMessage.includes('密钥') ||
    displayMessage.includes('token')

  const isSuccessMessage =
    !isErrorMessage &&
    (displayMessage.includes('完成') ||
      displayMessage.includes('已接入') ||
      displayMessage.includes('已删除'))

  const IconComponent = isErrorMessage
    ? AlertTriangle
    : isSuccessMessage
    ? CheckCircle2
    : Info

  return (
    <div
      role={isErrorMessage ? 'alert' : 'status'}
      aria-live="polite"
      className={`fixed top-18 sm:top-20 left-1/2 -translate-x-1/2 z-50 pointer-events-auto flex items-center gap-3 max-w-[92vw] sm:max-w-xl px-4 py-3 rounded-xl border backdrop-blur-md transition-all duration-300 ease-out select-none shadow-xl ${
        visible
          ? 'opacity-100 translate-y-0 scale-100'
          : 'opacity-0 -translate-y-3 scale-95 pointer-events-none'
      } ${
        'border-[var(--pulse-toast-border)] bg-[var(--pulse-toast-bg)] text-[var(--pulse-toast-text)] shadow-[0_12px_36px_rgba(0,0,0,0.4),0_0_20px_rgba(245,158,11,0.12)]'
      }`}
    >
      {/* Indicator icon badge */}
      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-[var(--pulse-toast-icon-bg)] text-[var(--pulse-toast-icon)]">
        <IconComponent className="h-4 w-4" />
      </div>

      {/* Message content */}
      <div className="min-w-0 flex-1">
        <p className="text-xs sm:text-sm font-medium leading-relaxed break-words">
          {displayMessage}
        </p>
      </div>

      {/* Manual close button */}
      <button
        type="button"
        onClick={handleManualClose}
        aria-label="关闭提示"
        className="shrink-0 rounded-lg p-1 text-[var(--pulse-toast-text)] opacity-60 hover:opacity-100 hover:bg-black/5 dark:hover:bg-white/10 transition-all cursor-pointer"
        title="关闭提示"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  )
}
