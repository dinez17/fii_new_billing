import { expect, it } from "vitest";
import { parsePostalResult } from "../src/services/pincode.service.js";
import { customerBody } from "../src/validators.js";
it("resolves district, state and GST code only for the requested PIN", () => {
  expect(parsePostalResult([{ Status: "Success", PostOffice: [{ Pincode: "600001", District: "Chennai", State: "Tamil Nadu" }] }], "600001")).toEqual({ pincode: "600001", city: "Chennai", state: "Tamil Nadu", stateCode: "33" });
  expect(() => parsePostalResult([{ Status: "Error", PostOffice: null }], "600001")).toThrow();
  expect(() => parsePostalResult([{ Status: "Success", PostOffice: [{ Pincode: "600002", District: "Chennai", State: "Tamil Nadu" }] }], "600001")).toThrow();
});
it("validates billing recipients and separate installation address fields", () => {
  expect(customerBody.safeParse({ name: "Test", additionalEmails: ["bad"] }).success).toBe(false);
  const body = customerBody.parse({ name: "Test", email: "", additionalEmails: ["accounts@example.test"], city: "Chennai", stateCode: "33", pincode: "600001", installationCity: "Bengaluru", installationState: "Karnataka", installationStateCode: "29", installationPincode: "560001" });
  expect(body.email).toBeNull(); expect(body.stateCode).toBe("33"); expect(body.installationStateCode).toBe("29");
});
