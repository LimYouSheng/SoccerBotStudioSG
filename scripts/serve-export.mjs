import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { resolve, extname, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { siteBasePath } from "../src/content/site-path.ts";
const types = {
  ".html": "text/html",
  ".js": "application/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".jpg": "image/jpeg",
  ".png": "image/png",
  ".woff2": "font/woff2",
  ".txt": "text/plain",
  ".xml": "application/xml",
};
export function exportServer(directory, basePath) {
  const root = resolve(directory);
  return createServer(async (request, response) => {
    try {
      const pathname = decodeURIComponent(
        new URL(request.url, "http://localhost").pathname,
      );
      if (basePath && pathname === basePath) {
        response.writeHead(308, { location: basePath + "/" });
        response.end();
        return;
      }
      if (!pathname.startsWith(basePath + "/"))
        throw new Error("Outside site mount");
      let file = resolve(root, "." + pathname.slice(basePath.length));
      if (file !== root && !file.startsWith(root + sep))
        throw new Error("Invalid path");
      if ((await stat(file)).isDirectory()) file = resolve(file, "index.html");
      const body = await readFile(file);
      response.writeHead(200, {
        "content-type": types[extname(file)] || "application/octet-stream",
        "cache-control": "no-store",
      });
      response.end(body);
    } catch {
      response.writeHead(404, { "content-type": "text/html" });
      response.end(
        await readFile(resolve(root, "404.html")).catch(() => "Not found"),
      );
    }
  });
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  exportServer("out", siteBasePath).listen(4173, "127.0.0.1", () =>
    console.log(`Static preview: http://127.0.0.1:4173${siteBasePath}/`),
  );
