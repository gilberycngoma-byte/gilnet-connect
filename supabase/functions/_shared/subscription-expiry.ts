export function daysUntilLusakaDate(targetDate: string, now: Date): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(targetDate)) return Number.NaN;

  const parts = new Intl.DateTimeFormat("en", {
    timeZone: "Africa/Lusaka",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const dateParts = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  const today = `${dateParts["year"]}-${dateParts["month"]}-${dateParts["day"]}`;
  const todayUtc = Date.parse(`${today}T00:00:00.000Z`);
  const targetUtc = Date.parse(`${targetDate}T00:00:00.000Z`);
  if (!Number.isFinite(todayUtc) || !Number.isFinite(targetUtc)) return Number.NaN;
  return Math.round((targetUtc - todayUtc) / 86_400_000);
}
