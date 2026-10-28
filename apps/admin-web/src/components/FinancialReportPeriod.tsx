import { DateInput } from "./DateInput";
import { useTransactionPeriod } from "./TransactionFilters";
import { errMessage } from "../lib/api";
export { useTransactionPeriod as useFinancialReportPeriod } from "./TransactionFilters";
export function FinancialReportPeriod({ period, balanceSheet = false, allYears = true }: { period: ReturnType<typeof useTransactionPeriod>; balanceSheet?: boolean; allYears?: boolean }) {
  return <>
    {period.canRead && <select aria-label="Financial year" value={period.fyCode} onChange={(e) => {
      const code = e.target.value; period.setYear(code);
      const end = period.years.data?.find((year) => year.code === code)?.endDate.slice(0, 10);
      if (end && period.to > end) period.setTo(end);
    }}>{allYears && <option value="">All FY</option>}{period.years.data?.map((year) => <option key={year.id} value={year.code}>{year.code}{year.isActive ? " ●" : ""}</option>)}</select>}
    <DateInput aria-label="From date" value={period.from} readOnly={balanceSheet} onChange={(e) => period.setFrom(e.target.value)} />
    <span>{balanceSheet ? "As on" : "to"}</span>
    <DateInput aria-label={balanceSheet ? "As on date" : "To date"} value={period.to} onChange={(e) => period.setTo(e.target.value)} />
    {period.years.isError && <span className="error">{errMessage(period.years.error)}</span>}
  </>;
}
