import {describe,it,expect} from "vitest";
import {subscriptionStartDefault} from "../../../apps/admin-web/src/lib/date";
describe("subscriber starting date",()=>{
 it("uses one calendar month earlier in India",()=>{expect(subscriptionStartDefault(new Date("2026-11-01T10:00:00Z"))).toBe("2026-10-01");});
 it("clamps month ends and handles year boundaries",()=>{expect(subscriptionStartDefault(new Date("2026-03-31T10:00:00Z"))).toBe("2026-02-28");expect(subscriptionStartDefault(new Date("2024-03-31T10:00:00Z"))).toBe("2024-02-29");expect(subscriptionStartDefault(new Date("2026-01-05T10:00:00Z"))).toBe("2025-12-05");});
});
