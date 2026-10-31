import { expect, it } from "vitest";
import { companyMailCc, customerMailRecipients } from "../src/customer-email.js";
it("sends billing documents to primary and additional recipients without duplicates", () => {
  expect(customerMailRecipients({ email: "Primary@example.test", additionalEmails: ["accounts@example.test", "primary@example.test"] })).toBe("primary@example.test, accounts@example.test");
  expect(customerMailRecipients({ email: null, additionalEmails: ["accounts@example.test"] })).toBe("accounts@example.test");
  expect(customerMailRecipients({})).toBe("");
});

it("copies the company without duplicating customer addresses or accepting invalid headers",()=>{
 expect(companyMailCc(" Company@example.test ","customer@example.test, accounts@example.test")).toBe("company@example.test");
 expect(companyMailCc("COMPANY@example.test","customer@example.test, company@example.test")).toBeUndefined();
 expect(companyMailCc(null,"customer@example.test")).toBeUndefined();
 expect(companyMailCc("invalid","customer@example.test")).toBeUndefined();
 expect(companyMailCc("company@example.test\r\nBcc: other@example.test","customer@example.test")).toBeUndefined();
});
