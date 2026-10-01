import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../dist/", import.meta.url));
const contentTypes = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png" };

const server = createServer(async (request, response) => {
  const path = new URL(request.url, "http://127.0.0.1").pathname.replace(/^[/\\]+/, "") || "index.html";
  const file = resolve(root, path);
  const withinRoot = relative(root, file);
  if (withinRoot.startsWith("..") || isAbsolute(withinRoot)) {
    response.writeHead(403).end();
    return;
  }
  try {
    const content = await readFile(file);
    response.writeHead(200, { "content-type": contentTypes[extname(file)] || "application/octet-stream" }).end(content);
  } catch {
    response.writeHead(404).end();
  }
});

server.listen(4173, "127.0.0.1");
process.on("SIGTERM", () => server.close());
process.on("SIGINT", () => server.close());
