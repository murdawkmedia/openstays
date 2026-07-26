import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("Cloudflare Pages public showcase contract", () => {
  it("serves application deep links through the SPA entry point", () => {
    expect(readFileSync("public/_redirects", "utf8").trim()).toBe(
      "/* /index.html 200",
    );
  });

  it("keeps the cross-origin isolation required by the wallet runtime", () => {
    const headers = readFileSync("public/_headers", "utf8");

    expect(headers).toContain("Cross-Origin-Opener-Policy: same-origin");
    expect(headers).toContain("Cross-Origin-Embedder-Policy: require-corp");
  });

  it("documents the fail-closed public showcase build switch", () => {
    expect(readFileSync(".env.example", "utf8")).toContain(
      "VITE_PUBLIC_SHOWCASE=false",
    );
  });
});
