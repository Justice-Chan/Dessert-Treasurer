// One local server for both front ends, read straight from disk so edits show on reload:
//   http://localhost:8080/      web dashboard (web/)
//   http://localhost:8080/app/  desktop app UI in the browser (frontend/, without Tauri)
// Tests keep their own server on port 4173 (scripts/test-server.mjs).
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const port = Number(process.env.PORT) || 8080;
const web = fileURLToPath(new URL("../web/", import.meta.url));
const frontend = fileURLToPath(new URL("../frontend/", import.meta.url));
const contentTypes = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png" };

// Same bundle scripts/build-web.mjs writes to dist/app.js, built per request.
async function appBundle() {
  const scripts = JSON.parse(await readFile(resolve(frontend, "scripts.json"), "utf8"));
  return (await Promise.all(scripts.map((path) => readFile(resolve(frontend, path), "utf8")))).join("");
}

function within(root, path) {
  const file = resolve(root, path || "index.html");
  const inside = relative(root, file);
  return inside.startsWith("..") || isAbsolute(inside) ? null : file;
}

createServer(async (request, response) => {
  const pathname = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
  if (pathname === "/app") {
    response.writeHead(301, { location: "/app/" }).end();
    return;
  }
  const isApp = pathname.startsWith("/app/");
  const path = (isApp ? pathname.slice(5) : pathname).replace(/^\/+/, "");
  try {
    if (isApp && path === "app.js") {
      response.writeHead(200, { "content-type": contentTypes[".js"], "cache-control": "no-store" }).end(await appBundle());
      return;
    }
    const file = within(isApp ? frontend : web, path);
    if (!file) {
      response.writeHead(403).end();
      return;
    }
    const content = await readFile(file);
    response.writeHead(200, { "content-type": contentTypes[extname(file)] || "application/octet-stream", "cache-control": "no-store" }).end(content);
  } catch {
    response.writeHead(404).end();
  }
}).listen(port, "127.0.0.1", () => console.log(`Dashboard http://localhost:${port}/  ·  App http://localhost:${port}/app/`));
