import { createReadStream, existsSync, statSync } from "node:fs";
import { extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

const SCENES_DIR = fileURLToPath(new URL("../../scenes", import.meta.url));

const CONTENT_TYPES: Record<string, string> = {
  ".json": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".bin": "application/octet-stream",
  ".spz": "application/octet-stream",
};

// Serves the repo's scenes/ folder at /scenes/<id>/<file>, the same URLs the
// backend uses, so the app works with or without VITE_BACKEND_URL set.
function serveLocalScenes(): Plugin {
  return {
    name: "serve-local-scenes",
    configureServer(server) {
      server.middlewares.use("/scenes", (req, res, next) => {
        const urlPath = decodeURIComponent((req.url ?? "").split("?")[0]);
        const filePath = resolve(SCENES_DIR, "." + urlPath);
        if (!filePath.startsWith(SCENES_DIR + sep) || !existsSync(filePath) || !statSync(filePath).isFile()) {
          return next();
        }
        res.setHeader("Content-Type", CONTENT_TYPES[extname(filePath)] ?? "application/octet-stream");
        createReadStream(filePath).pipe(res);
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), serveLocalScenes()],
});
