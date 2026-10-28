import { useEffect, useRef, useState, type InputHTMLAttributes } from "react";
import { formatDate } from "../lib/date";

export function DateInput({ value, onChange, ...props }: Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "value" | "onChange"> & { value: string; onChange: (event: { target: { value: string } }) => void }) {
  const picker = useRef<HTMLInputElement>(null);
  const textInput = useRef<HTMLInputElement>(null);
  const [text, setText] = useState(value ? formatDate(value) : "");
  useEffect(() => { setText(value ? formatDate(value) : ""); textInput.current?.setCustomValidity(""); }, [value]);
  return <span style={{ display: "inline-flex", position: "relative", width: 170, minWidth: 150, maxWidth: "100%", flexShrink: 0, ...props.style }}><input {...props} ref={textInput} style={{ width: "100%", paddingRight: props.readOnly ? undefined : 38 }} type="text" placeholder="dd-mm-yyyy" aria-label={props["aria-label"] ?? props.title ?? "Date (dd-mm-yyyy)"} value={text} maxLength={10} onChange={(event) => {
    const next = event.target.value; setText(next);
    if (!next) { event.target.setCustomValidity(""); onChange({ target: { value: "" } }); return; }
    const match = /^(\d{2})-(\d{2})-(\d{4})$/.exec(next);
    const iso = match ? `${match[3]}-${match[2]}-${match[1]}` : "";
    const valid = iso && !Number.isNaN(Date.parse(iso)) && new Date(iso).toISOString().slice(0, 10) === iso;
    event.target.setCustomValidity(valid ? "" : "Enter a valid date as dd-mm-yyyy");
    if (valid) onChange({ target: { value: iso } });
  }} onBlur={(event) => { event.target.reportValidity(); props.onBlur?.(event); }} />
    {!props.readOnly && <>
      <input ref={picker} type="date" data-enter-native aria-label={`${props["aria-label"] ?? "Date"} calendar`} tabIndex={-1} disabled={props.disabled} min={props.min} max={props.max} value={value} style={{ position: "absolute", right: 0, bottom: 0, width: 1, height: 1, opacity: 0 }} onChange={(event) => { const next = event.target.value; setText(next ? formatDate(next) : ""); textInput.current?.setCustomValidity(""); onChange({ target: { value: next } }); }} />
      <button type="button" aria-label={`Open ${props["aria-label"] ?? "date"} picker`} title="Choose date" disabled={props.disabled} style={{ position: "absolute", right: 3, top: 3, bottom: 3, padding: "0 7px", border: 0, background: "transparent" }} onClick={() => { try { picker.current?.showPicker(); } catch { picker.current?.focus(); } }}><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M16 3v4M8 3v4M3 11h18" /></svg></button>
    </>}
  </span>;
}
