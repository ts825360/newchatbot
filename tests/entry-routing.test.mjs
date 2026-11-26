import { expect, it } from "vitest";
import nextConfig from "../next.config.mjs";

it("redirects the root to login before rendering a page", async () => {
  expect(await nextConfig.redirects?.() ?? []).toContainEqual({ source: "/", destination: "/login", permanent: false });
});
