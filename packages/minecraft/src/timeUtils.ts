/** Convert Minecraft time-of-day ticks to a human-readable phase. */
export function getTimePhase(timeOfDay: number): string {
  if (timeOfDay >= 0 && timeOfDay < 6000) return "morning";
  if (timeOfDay >= 6000 && timeOfDay < 12000) return "afternoon";
  if (timeOfDay >= 12000 && timeOfDay < 13000) return "dusk";
  if (timeOfDay >= 13000 && timeOfDay < 18000) return "night";
  if (timeOfDay >= 18000 && timeOfDay < 23000) return "midnight";
  return "dawn";
}

/** Get the moon phase name (0-7 cycle). */
export function getMoonPhase(dayCount: number): string {
  const phases = [
    "full_moon", "waning_gibbous", "third_quarter", "waning_crescent",
    "new_moon", "waxing_crescent", "first_quarter", "waxing_gibbous",
  ];
  return phases[dayCount % 8];
}
