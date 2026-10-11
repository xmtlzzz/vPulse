// Keep this cadence in sync with wrangler.toml (*/3 * * * *).
const CRON_SECONDS = 180

export function nextScheduledCheck(lastChecked: number, intervalMin: number): number {
  // Anchor to the Cron slot, so network completion seconds cannot skip a round.
  return (Math.floor(lastChecked / CRON_SECONDS) + Math.ceil(intervalMin * 60 / CRON_SECONDS)) * CRON_SECONDS
}
