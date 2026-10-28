import http from "k6/http";
import { check, sleep } from "k6";

const BASE = __ENV.BASE_URL || "http://localhost:8080";
const EMAIL = __ENV.EMAIL || "admin@demo.local";
const PASSWORD = __ENV.PASSWORD || "ChangeMe@123";

export const options = {
  stages: [
    { duration: "30s", target: 50 },
    { duration: "1m", target: 200 },
    { duration: "1m", target: 200 },
    { duration: "30s", target: 0 },
  ],
  thresholds: {
    http_req_failed: ["rate<0.01"],
    http_req_duration: ["p(95)<800"],
  },
};

export function setup() {
  const res = http.post(`${BASE}/api/v1/auth/login`, JSON.stringify({ email: EMAIL, password: PASSWORD }), {
    headers: { "Content-Type": "application/json" },
  });
  check(res, { "login 200": (r) => r.status === 200 });
  return { token: res.json("accessToken") };
}

export default function (data) {
  const headers = { Authorization: `Bearer ${data.token}` };
  const invoices = http.get(`${BASE}/api/v1/invoices?limit=20&status=UNPAID`, { headers });
  check(invoices, { "invoices 200": (r) => r.status === 200 });

  const dashboard = http.get(`${BASE}/api/v1/reports/dashboard`, { headers });
  check(dashboard, { "dashboard 200/403": (r) => r.status === 200 || r.status === 403 });

  sleep(1);
}
