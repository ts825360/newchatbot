import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

const read = path => readFileSync(new URL(path, import.meta.url), "utf8");

it("uses the release version for the default Docker image and changelog", () => {
  const { version } = JSON.parse(read("../package.json"));
  expect(read("../compose.yaml")).toContain(`\${CHURCH_IMAGE:-nowchatbot:v${version}}`);
  expect(read("../CHANGELOG.md")).toContain(`## v${version}`);
});
