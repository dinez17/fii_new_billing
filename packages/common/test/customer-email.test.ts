import { expect, it } from "vitest";
import { customerMailRecipients } from "../src/customer-email.js";
it("sends billing documents to primary and additional recipients without duplicates", () => {
  expect(customerMailRecipients({ email: "Primary@example.test", additionalEmails: ["accounts@example.test", "primary@example.test"] })).toBe("primary@example.test, accounts@example.test");
  expect(customerMailRecipients({ email: null, additionalEmails: ["accounts@example.test"] })).toBe("accounts@example.test");
  expect(customerMailRecipients({})).toBe("");
});
