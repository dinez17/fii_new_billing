import assert from "node:assert/strict";
import { lookupPincode } from "../services/crm-service/src/services/pincode.service.js";

// Route only the provider origin to the local Postman simulation. All request,
// timeout, parsing and error-handling code still runs over real HTTP.
const networkFetch = globalThis.fetch;
let unavailable = false;
globalThis.fetch = (input, init) => {
  const target = new URL(String(input));
  assert.equal(target.origin, "https://api.postalpincode.in");
  return networkFetch(`http://127.0.0.1:14990/postal${target.pathname}`, {
    ...init, headers: unavailable ? { "x-mock-response-code": "503" } : {},
  });
};
async function main() {
try {
  assert.deepEqual(await lookupPincode("600001"), { pincode: "600001", city: "Chennai", state: "Tamil Nadu", stateCode: "33" });
  unavailable = true;
  await assert.rejects(lookupPincode("600001"), /enter city, state and state code manually/);
  await assert.rejects(lookupPincode("invalid"), /6-digit PIN/);
  console.log("PASS: real lookup code against Postman simulation: success, provider 503, invalid PIN");
} finally { globalThis.fetch = networkFetch; }
}
void main().catch((err) => { console.error(err); process.exitCode = 1; });
