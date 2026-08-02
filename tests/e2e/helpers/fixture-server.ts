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
    "/article.html": readFileSync(join(FIXTURE_DIR, "article-jsonld.html"), "utf8"),
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
