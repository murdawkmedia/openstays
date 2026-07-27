import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("Cloudflare Pages public showcase contract", () => {
  it("serves application deep links through the SPA entry point", () => {
    expect(readFileSync("public/_redirects", "utf8").trim()).toBe(
      "/* /index.html 200",
    );
  });

  it("scopes cross-origin isolation to wallet routes", () => {
    const headers = readFileSync("public/_headers", "utf8");

    expect(headers).toContain("/wallet/*");
    expect(headers).toContain("Cross-Origin-Opener-Policy: same-origin");
    expect(headers).toContain("Cross-Origin-Embedder-Policy: require-corp");
    expect(headers).toContain("Cross-Origin-Resource-Policy: same-origin");
  });

  it("documents the fail-closed public showcase build switch", () => {
    expect(readFileSync(".env.example", "utf8")).toContain(
      "VITE_PUBLIC_SHOWCASE=false",
    );
  });

  it("omits the oversized wallet runtime unless the public rail is enabled", () => {
    const viteConfig = readFileSync("vite.config.ts", "utf8");

    expect(viteConfig).toContain("public-showcase-omit-wallet-runtime");
    expect(viteConfig).toContain("process.env.VITE_PUBLIC_SHOWCASE === 'true'");
    expect(viteConfig).toContain("process.env.VITE_PUBLIC_WAVELENGTH === 'true'");
    expect(viteConfig).toContain("if (!includeWavelengthWallet)");
    expect(viteConfig).toContain("resolve('dist', 'wavewalletdk')");
    expect(viteConfig).toContain("request.url?.startsWith('/wallet/')");
    expect(viteConfig).not.toContain("server: {\n    headers:");
  });
});
