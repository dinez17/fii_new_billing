import { describe, expect, it } from "vitest";
import { customerBody } from "../src/validators.js";
describe("customer contact data during legacy migration", () => {
  it("allows absent phones without fabricating a number", () => {
    expect(customerBody.parse({ name: "Legacy Customer" }).phone).toBeNull();
    expect(customerBody.parse({ name: "Legacy Customer", phone: "" }).phone).toBeNull();
    expect(customerBody.parse({ name: "Legacy Customer", phone: null }).phone).toBeNull();
  });
  it("validates a supplied phone and does not clear it when an update omits the field", () => {
    expect(customerBody.parse({ name: "Customer", phone: "9000000001" }).phone).toBe("9000000001");
    expect(customerBody.safeParse({ name: "Customer", phone: "fake" }).success).toBe(false);
    expect(customerBody.partial().parse({ name: "Renamed" })).not.toHaveProperty("phone");
  });
});
