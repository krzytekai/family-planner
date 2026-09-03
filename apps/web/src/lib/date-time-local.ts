/** Input wall-clock value in the device timezone, never a sliced UTC timestamp. */
export function formatDateTimeLocal(date: Date): string {
  if (Number.isNaN(date.getTime())) return ''
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${String(date.getFullYear()).padStart(4, '0')}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

/** Parse an HTML local datetime; serialize to UTC only at the API boundary.
 * Native Date uses the device's timezone/DST rules (no fixed offset).
 * Date-only and timezone-qualified strings are deliberately not accepted here.
 */
export function parseDateTimeLocal(value: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?$/.test(value)) return new Date(NaN)
  return new Date(value)
}
