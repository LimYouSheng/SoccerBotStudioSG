// Opt-in loopback fixture only. No remote bindings, credentials, or provider I/O.
import { build } from "esbuild";
import { Miniflare, convertV4MiniflareOptions, Log, LogLevel } from "miniflare";
import { readFileSync, readdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import ts from "typescript";
import { seedFoundation } from "../worker/tests/foundation-fixture.mjs";
export async function createExperimentPreview() {
  const config = ts.parseConfigFileTextToJson(
    "wrangler.jsonc",
    readFileSync("wrangler.jsonc", "utf8"),
  ).config;
  const script = (
    await build({
      entryPoints: ["worker/tests/experiment-harness.ts"],
      bundle: true,
      write: false,
      format: "esm",
      platform: "browser",
      external: ["cloudflare:workers", "node:async_hooks"],
    })
  ).outputFiles[0].text;
  const dir = mkdtempSync(path.join(tmpdir(), "soccerbot-experiment-"));
  const origin = "https://soccerbot.test";
  const mf = new Miniflare({
    ...convertV4MiniflareOptions({
      name: "soccerbot-experiment",
      modules: true,
      script,
      cf: false,
      compatibilityDate: config.compatibility_date,
      compatibilityFlags: config.compatibility_flags,
      bindings: { ...config.vars, APP_ORIGIN: origin },
      d1Databases: { STATE: "synthetic-state" },
      durableObjects: {
        COORDINATOR: {
          className: "SoccerBotAccountCoordinator",
          useSQLite: true,
        },
      },
      outboundService: () => {
        throw new Error("Synthetic fixture forbids outbound requests");
      },
      serviceBindings: { ASSETS: () => new Response(null, { status: 404 }) },
    }),
    log: new Log(LogLevel.ERROR),
    resourcePersistencePath: dir,
    isolatedResourcePersistencePath: dir,
  });
  await mf.ready;
  const db = await mf.getD1Database("STATE");
  for (const name of readdirSync("migrations")
    .sort()
    .filter((n) => !n.startsWith("0005")))
    await db.exec(
      readFileSync(`migrations/${name}`, "utf8")
        .replace(/^--.*$/gm, "")
        .replace(/\n/g, " "),
    );
  await seedFoundation(mf, db);
  return {
    mf,
    db,
    async close() {
      await mf.dispose();
      rmSync(dir, { recursive: true, force: true });
    },
    async handle(request, response) {
      const url = new URL(request.url, "http://127.0.0.1:4173");
      if (
        !url.pathname.startsWith("/api/") &&
        !url.pathname.startsWith("/__experiment/")
      )
        return false;
      if (
        !["127.0.0.1:4173", "localhost:4173"].includes(request.headers.host)
      ) {
        response.writeHead(403);
        response.end();
        return true;
      }
      const headers = new Headers();
      for (const key of ["content-type", "accept", "origin", "cookie"])
        if (request.headers[key])
          headers.set(key, String(request.headers[key]));
      const localOrigin = `http://${request.headers.host}`;
      if (headers.get("origin") === localOrigin) headers.set("origin", origin);
      const cookie = headers.get("cookie") || "";
      headers.set(
        "cookie",
        cookie
          .split(";")
          .filter((v) => v.trim().startsWith("soccerbot-experiment-access="))
          .map((v) =>
            v
              .trim()
              .replace(
                "soccerbot-experiment-access=",
                "__Host-soccerbot-access=",
              ),
          )
          .join("; "),
      );
      const chunks = [];
      let bytes = 0;
      for await (const chunk of request) {
        bytes += chunk.length;
        if (bytes > 4096) {
          response.writeHead(413);
          response.end();
          return true;
        }
        chunks.push(chunk);
      }
      const res = await mf.dispatchFetch(origin + url.pathname + url.search, {
        method: request.method,
        headers,
        body: chunks.length ? Buffer.concat(chunks) : undefined,
      });
      const responseHeaders = Object.fromEntries(res.headers);
      if (responseHeaders["set-cookie"])
        responseHeaders["set-cookie"] = responseHeaders["set-cookie"]
          .replace("__Host-soccerbot-access=", "soccerbot-experiment-access=")
          .replace("; Secure", "");
      response.writeHead(res.status, responseHeaders);
      response.end(Buffer.from(await res.arrayBuffer()));
      return true;
    },
  };
}
