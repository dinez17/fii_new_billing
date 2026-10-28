import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
export const components = ["backend", "tenant", "platform", "portal"];
export function validateRelease(release, expected) {
  if (!release || release.version !== 1 || !/^[a-f0-9]{40}$/.test(release.sha) || !/^\d+$/.test(String(release.runId))) throw new Error("Invalid release identity");
  if (release.sha !== expected.sha || release.repository !== expected.repository.toLowerCase() || String(release.runId) !== String(expected.runId)) throw new Error("Release does not match the successful CI run");
  if (!release.images || Object.keys(release.images).length !== components.length) throw new Error("Four images required");
  for (const component of components) {
    const prefix = `ghcr.io/${expected.repository.toLowerCase()}-${component}@sha256:`;
    const ref = release.images[component];
    if (typeof ref !== "string" || !ref.startsWith(prefix) || !/^[a-f0-9]{64}$/.test(ref.slice(prefix.length))) throw new Error(`Invalid immutable ${component} image`);
  }
  return release;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [mode, input, output] = process.argv.slice(2);
  const expected = { sha: process.env.RELEASE_SHA, repository: process.env.RELEASE_REPOSITORY, runId: process.env.RELEASE_RUN_ID };
  if (!expected.repository) throw new Error("RELEASE_REPOSITORY required");
  if (mode === "create") {
    const images = Object.fromEntries(components.map((component) => {
      const entry = JSON.parse(readFileSync(join(input, `${component}.json`), "utf8"));
      if (entry.component !== component) throw new Error("Image component mismatch");
      return [component, entry.image];
    }));
    const release = validateRelease({ version: 1, sha: expected.sha, repository: expected.repository.toLowerCase(), runId: expected.runId, images }, expected);
    writeFileSync(output, JSON.stringify(release, null, 2) + "\n");
  } else if (mode === "validate") {
    const release = validateRelease(JSON.parse(readFileSync(input, "utf8")), expected);
    if (output) writeFileSync(output, components.map((component) => `FII_${component.toUpperCase()}_IMAGE=${release.images[component]}`).join("\n") + "\n");
    console.log(`Verified release ${release.sha}`);
  } else throw new Error("Use create <refs-dir> <manifest> or validate <manifest> [image-env]");
}
