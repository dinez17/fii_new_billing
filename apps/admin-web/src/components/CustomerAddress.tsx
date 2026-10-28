import { useEffect, useRef, useState } from "react";
import { api, errMessage } from "../lib/api";

export interface AddressValue { address: string; city: string; state: string; stateCode: string; pincode: string }
export function CustomerAddress({ title, value, onChange }: { title: string; value: AddressValue; onChange: (value: AddressValue) => void }) {
  const current = useRef({ value, onChange });
  current.current = { value, onChange };
  const [message, setMessage] = useState("");
  const lastPincode = useRef(value.pincode);
  useEffect(() => {
    if (lastPincode.current === value.pincode) return;
    lastPincode.current = value.pincode;
    if (!/^[1-9][0-9]{5}$/.test(value.pincode)) { setMessage(""); return; }
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setMessage("Looking up PIN…");
      try {
        const { data } = await api.get(`/customers/pincode/${value.pincode}`, { signal: controller.signal });
        if (!controller.signal.aborted && current.current.value.pincode === value.pincode) {
          current.current.onChange({ ...current.current.value, city: data.city, state: data.state, stateCode: data.stateCode });
          setMessage("Postal district filled as city. Adjust the locality if needed.");
        }
      } catch (err) { if (!controller.signal.aborted) setMessage(errMessage(err)); }
    }, 400);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [value.pincode]);
  return <fieldset style={{ border: "1px solid var(--border)", marginTop: 12 }}><legend>{title}</legend>
    <label>Address</label><input aria-label={`${title} address`} value={value.address} onChange={(e) => onChange({ ...value, address: e.target.value })} />
    <label>PIN code</label><input aria-label={`${title} PIN code`} inputMode="numeric" maxLength={6} value={value.pincode} onChange={(e) => onChange({ ...value, pincode: e.target.value.replace(/\D/g, "") })} />
    {message && <small role="status">{message}</small>}
    <div style={{ display: "grid", gridTemplateColumns: "2fr 2fr 1fr", gap: 8 }}>
      <div><label>City</label><input aria-label={`${title} city`} value={value.city} onChange={(e) => onChange({ ...value, city: e.target.value })} /></div>
      <div><label>State</label><input aria-label={`${title} state`} value={value.state} onChange={(e) => onChange({ ...value, state: e.target.value })} /></div>
      <div><label>GST state code</label><input aria-label={`${title} state code`} maxLength={2} value={value.stateCode} onChange={(e) => onChange({ ...value, stateCode: e.target.value })} /></div>
    </div>
  </fieldset>;
}
