import type { ButtonHTMLAttributes } from "react";

export type ActionName = "edit" | "view" | "download" | "mail" | "return" | "pay" | "delete" | "lock" | "unlock" | "ledger" | "more" | "check" | "close" | "key" | "warning" | "print" | "convert";
const paths: Record<ActionName, string> = {
  print: "M6 9V2h12v7M6 18H3V9h18v9h-3M6 14h12v8H6zM17 12h1",
  convert: "M3 7h16m-5-5 5 5-5 5M21 17H5m5-5-5 5 5 5",
  edit: "m16 3 5 5M4 20l4-1L21 6l-5-5L3 14l-1 8z",
  view: "M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Zm10-3a3 3 0 1 0 0 6 3 3 0 0 0 0-6",
  download: "M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5",
  mail: "M3 5h18v14H3zM3 5l9 8 9-8",
  return: "M9 5 3 11l6 6M3 11h12a6 6 0 0 1 6 6v3",
  pay: "M2 5h20v14H2zM2 9h20M6 15h4",
  delete: "M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7",
  lock: "M5 10h14v11H5zM8 10V6a4 4 0 0 1 8 0v4",
  unlock: "M5 10h14v11H5zM8 10V6a4 4 0 0 1 8 0",
  ledger: "M4 3h16v18H4zM8 7h8M8 12h8M8 17h5",
  more: "M5 11h1v2H5zM11 11h1v2h-1zM17 11h1v2h-1z",
  check: "m4 12 5 5L20 6", close: "m5 5 14 14M19 5 5 19",
  key: "M14 4a5 5 0 1 0 0 10 5 5 0 0 0 0-10M10 12l-8 8m3-3 3 3m0-6 3 3",
  warning: "m12 2 10 19H2L12 2Zm0 6v6m0 3v1",
};
export function ActionIcon({ name }: { name: ActionName }) {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name]} /></svg>;
}
export function IconButton({ label, icon, className = "", children, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { label: string; icon: ActionName }) {
  return <button {...props} className={`icon-button ${className}`} title={props.title ?? label} aria-label={label}><ActionIcon name={icon} /><span className="sr-only">{children ?? label}</span></button>;
}
