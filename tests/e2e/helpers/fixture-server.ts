/**
 * Local HTTP fixture server for Playwright extraction tests.
 * Bound to 127.0.0.1 only — never hits live LLM sites.
 */

import { createServer, type Server } from "node:http";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const FIXTURE_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "fixtures",
  "html",
);

export type FixtureServer = {
  port: number;
  origin: string;
  url: (path: string) => string;
  close: () => Promise<void>;
};

export async function startFixtureServer(): Promise<FixtureServer> {
  const htmlByPath: Record<string, string> = {
    "/": readFileSync(join(FIXTURE_DIR, "homepage-thin.html"), "utf8"),
    "/article.html": readFileSync(join(FIXTURE_DIR, "article-jsonld.html"), "utf8"),
    "/product.html": readFileSync(
      join(FIXTURE_DIR, "product-jsonld.html"),
      "utf8",
    ),
    "/category/laptops": readFileSync(
      join(FIXTURE_DIR, "product-list.html"),
      "utf8",
    ),
  };

  const server: Server = createServer((req, res) => {
    const pathName = req.url?.split("?")[0] ?? "/";
    const body = htmlByPath[pathName];
    if (!body) {
      res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      res.end("Not found");
      return;
    }
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(body);
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Fixture server failed to bind");
  }

  const port = address.port;
  const origin = `http://127.0.0.1:${port}`;

  // Readiness probe — fail fast if listen succeeded but HTTP is not serving.
  await waitForFixtureReady(origin);

  return {
    port,
    origin,
    url: (path) => `${origin}${path.startsWith("/") ? path : `/${path}`}`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}

async function waitForFixtureReady(origin: string): Promise<void> {
  const deadline = Date.now() + 5_000;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${origin}/`);
      if (response.ok) {
        return;
      }
      lastError = new Error(`Fixture server HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw lastError instanceof Error
    ? lastError
    : new Error("Fixture server never became ready");
}
