import { createServer } from "node:http";
import { existsSync, readFileSync, statSync } from "node:fs";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(fileURLToPath(new URL(".", import.meta.url)), "dist");
const port = Number(process.env.PORT || 5177);

const types = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp"
};

function resolvePath(url) {
  const cleanUrl = decodeURIComponent(url.split("?")[0]);
  const requested = normalize(join(root, cleanUrl));
  if (!requested.startsWith(root)) return join(root, "index.html");
  if (existsSync(requested) && statSync(requested).isFile()) return requested;
  return join(root, "index.html");
}

createServer((req, res) => {
  const file = resolvePath(req.url || "/");
  res.setHeader("Content-Type", types[extname(file)] || "application/octet-stream");
  res.end(readFileSync(file));
}).listen(port, "127.0.0.1", () => {
  console.log(`Retela frontend running at http://127.0.0.1:${port}`);
});
