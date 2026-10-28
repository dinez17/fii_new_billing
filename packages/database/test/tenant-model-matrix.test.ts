import { describe, expect, it } from "vitest";
import { Prisma } from "@prisma/client";
import { TENANT_SCOPED_MODELS } from "../src/tenant-extension.js";

describe("tenant model coverage", () => {
  it("registers every model with a required tenantId", () => {
    const requiredTenantModels = Prisma.dmmf.datamodel.models
      .filter((model) => model.fields.some((field) => field.name === "tenantId" && field.isRequired))
      .map((model) => model.name)
      .sort();
    expect([...TENANT_SCOPED_MODELS].sort()).toEqual(requiredTenantModels);
  });

  it("does not accidentally scope global or nullable-tenant models", () => {
    const invalid = Prisma.dmmf.datamodel.models
      .filter((model) => TENANT_SCOPED_MODELS.has(model.name))
      .filter((model) => !model.fields.some((field) => field.name === "tenantId" && field.isRequired));
    expect(invalid.map((model) => model.name)).toEqual([]);
  });
});
