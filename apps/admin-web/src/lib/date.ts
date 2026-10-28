/** Calendar dates are stored as ISO dates; display independently of browser locale. */
export function formatDate(value: string | Date): string {
  const iso = value instanceof Date ? value.toISOString() : value;
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return match ? `${match[3]}-${match[2]}-${match[1]}` : "—";
}
