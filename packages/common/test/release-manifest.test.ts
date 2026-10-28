import { describe, expect, it } from "vitest";
import { validateRelease, components } from "../../../scripts/cicd/release-manifest.mjs";
const expected = { sha: "a".repeat(40), repository: "dinez17/fii_new_billing", runId: "12345" };
const release = () => ({ version: 1, ...expected, images: Object.fromEntries(components.map((c: string) => [c, `ghcr.io/${expected.repository}-${c}@sha256:${"b".repeat(64)}`])) });
describe("CI/CD release identity validation", () => {
  it("accepts the four exact repository images by digest", () => { expect(validateRelease(release(), expected).sha).toBe(expected.sha); });
  it("rejects another commit or CI run", () => {
    expect(() => validateRelease({ ...release(), sha: "c".repeat(40) }, expected)).toThrow("match");
    expect(() => validateRelease({ ...release(), runId: "98765" }, expected)).toThrow("match");
  });
  it("rejects mutable tags, foreign images and injected env values", () => {
    for (const value of ["ghcr.io/dinez17/fii_new_billing-backend:latest", `ghcr.io/other/private-backend@sha256:${"b".repeat(64)}`, `ghcr.io/${expected.repository}-backend@sha256:${"b".repeat(64)}\nDATABASE_URL=bad`]) {
      const r = release(); r.images.backend = value; expect(() => validateRelease(r, expected)).toThrow("immutable");
    }
  });
  it("rejects missing, extra and incorrectly named components", () => {
    const missing = release(); delete missing.images.portal; expect(() => validateRelease(missing, expected)).toThrow("Four images");
    const extra = release(); extra.images.extra = "bad"; expect(() => validateRelease(extra, expected)).toThrow("Four images");
    const wrong = release(); wrong.images.tenant = wrong.images.platform; expect(() => validateRelease(wrong, expected)).toThrow("immutable tenant");
  });
});
