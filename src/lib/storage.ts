export function readPreference(key: string): string | null {
  try { return localStorage.getItem(key) } catch { return null }
}
export function savePreference(key: string, value: string) {
  try { localStorage.setItem(key, value) } catch { /* Preferences are optional. */ }
}
export function getAdminToken(): string {
  try {
    const current = sessionStorage.getItem('vpulse-admin-token')
    if (current) return current
    const legacy = localStorage.getItem('vpulse-admin-token')
    if (legacy) {
      sessionStorage.setItem('vpulse-admin-token', legacy)
      localStorage.removeItem('vpulse-admin-token')
      return legacy
    }
  } catch { /* Storage can be disabled. */ }
  return ''
}
export function saveAdminToken(token: string) {
  try {
    if (token.trim()) sessionStorage.setItem('vpulse-admin-token', token.trim())
    else sessionStorage.removeItem('vpulse-admin-token')
    localStorage.removeItem('vpulse-admin-token')
    return true
  } catch { return false }
}
