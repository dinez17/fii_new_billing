/** Fixed April–March financial-year periods. Initial partial periods are billed manually. */
export function billingCycleSpan(
  cycleType: "PREPAID" | "POSTPAID",
  serviceStart: Date,
  cycleMonths: number,
  periodStart: Date,
  periodEnd: Date,
): { spanStart: Date; spanEnd: Date } | null {
  const n = cycleMonths;
  if (![1, 3, 6, 12].includes(n)) throw new Error("Unsupported billing frequency");
  const month = periodStart.getUTCMonth();
  const fiscalMonth = (month + 9) % 12; // April = 0
  const prepaid = cycleType === "PREPAID";
  if (prepaid ? fiscalMonth % n !== 0 : (fiscalMonth + 1) % n !== 0) return null;
  const spanStart = new Date(Date.UTC(periodStart.getUTCFullYear(), month - (prepaid ? 0 : n - 1), 1));
  const spanEnd = prepaid
    ? new Date(Date.UTC(periodStart.getUTCFullYear(), month + n, 0))
    : periodEnd;
  // Keep monthly behavior; longer periods must start after service commencement.
  const eligibleStart = n === 1
    ? new Date(Date.UTC(serviceStart.getUTCFullYear(), serviceStart.getUTCMonth(), 1))
    : serviceStart;
  if (eligibleStart > spanStart) return null;
  return { spanStart, spanEnd };
}
