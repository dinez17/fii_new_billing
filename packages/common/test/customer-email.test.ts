import { expect, it } from "vitest";
import { companyMailCc, customerMailRecipients } from "../src/customer-email.js";
it("accepts legacy comma and semicolon recipient lists while rejecting header injection",()=>{
 expect(customerMailRecipients({email:"Buyer@example.test, Accounts@example.test",additionalEmails:["accounts@example.test; finance@example.test"]},"company@example.test")).toBe("buyer@example.test, accounts@example.test, finance@example.test");
 expect(customerMailRecipients({email:"buyer@example.test,\r\nBcc: attacker@example.test"},"company@example.test")).toBe("company@example.test");
});
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

it("uses only the supplied tenant company address when customer recipients are missing or invalid",()=>{
 expect(customerMailRecipients({email:null},"first@example.test")).toBe("first@example.test");
 expect(customerMailRecipients({email:"invalid",additionalEmails:["-",""]},"sky@example.test")).toBe("sky@example.test");
 expect(customerMailRecipients({email:"customer@example.test"},"sky@example.test")).toBe("customer@example.test");
 expect(customerMailRecipients({email:null,additionalEmails:["accounts@example.test"]},"sky@example.test")).toBe("accounts@example.test");
 expect(customerMailRecipients({},"invalid")).toBe("");
 expect(customerMailRecipients({email:"a@example.test\r\nBcc: attacker@example.test"},"sky@example.test")).toBe("sky@example.test");
 expect(companyMailCc("sky@example.test",customerMailRecipients({},"sky@example.test"))).toBeUndefined();
});
