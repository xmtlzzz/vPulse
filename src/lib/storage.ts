export function readPreference(key: string): string | null {
  try { return localStorage.getItem(key) } catch { return null }
}
export function savePreference(key: string, value: string) {
  try { localStorage.setItem(key, value) } catch { /* Preferences are optional. */ }
}
export function getLegacyAdminToken(): string {
  try {
    return sessionStorage.getItem('vpulse-admin-token') || localStorage.getItem('vpulse-admin-token') || ''
  } catch { /* Storage can be disabled. */ }
  return ''
}
export function clearLegacyAdminToken() {
  try { sessionStorage.removeItem('vpulse-admin-token') } catch { /* Optional legacy storage. */ }
  try { localStorage.removeItem('vpulse-admin-token') } catch { /* Optional legacy storage. */ }
}
