import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, errMessage } from "../lib/api";
import { useAuth } from "../stores/auth";

interface FinancialYear { id: string; code: string; isActive: boolean; startDate: string; endDate: string }
export function useTransactionPeriod(resetPage: () => void, defaultRange: "financial-year" | "today" = "financial-year") {
  const canRead = useAuth((state) => state.hasPerm("financial_year:read"));
  const [selection, select] = useState<string | null>(null);
  const [today] = useState(() => {
    const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
    return ["year", "month", "day"].map((type) => parts.find((part) => part.type === type)!.value).join("-");
  });
  const [fromSelection, setFrom] = useState<string | null>(defaultRange === "today" ? today : null);
  const [to, setTo] = useState(today);
  const years = useQuery({ queryKey: ["financial-years"], queryFn: async () => (await api.get("/financial-years")).data as FinancialYear[], enabled: canRead });
  const fyCode = selection ?? years.data?.find((fy) => fy.isActive)?.code ?? "";
  const from = fromSelection ?? years.data?.find((fy) => fy.code === fyCode)?.startDate.slice(0, 10) ?? "";
  return { years, canRead, fyCode, from, to, ready: !canRead || years.isSuccess,
    params: { fyCode: fyCode || undefined, from: from || undefined, to: to || undefined },
    setYear: (code: string) => { select(code); setFrom(years.data?.find((fy) => fy.code === code)?.startDate.slice(0, 10) ?? ""); resetPage(); },
    setFrom: (date: string) => { setFrom(date); resetPage(); },
    setTo: (date: string) => { setTo(date); resetPage(); },
  };
}
export function TransactionFilters({ period }: { period: ReturnType<typeof useTransactionPeriod> }) {
  return <>
    {period.canRead && <select aria-label="Financial year" value={period.fyCode} onChange={(e) => period.setYear(e.target.value)}>
      <option value="">All FY</option>{period.years.data?.map((fy) => <option key={fy.id} value={fy.code}>{fy.code}{fy.isActive ? " ●" : ""}</option>)}
    </select>}
    <input type="date" aria-label="From date" title="From date" value={period.from} onChange={(e) => period.setFrom(e.target.value)} />
    <span>–</span><input type="date" aria-label="To date" title="To date" value={period.to} onChange={(e) => period.setTo(e.target.value)} />
    {period.years.isError && <span className="error">{errMessage(period.years.error)}</span>}
  </>;
}
