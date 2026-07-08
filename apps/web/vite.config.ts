import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

function normalizeBasePath(basePath: string | undefined): string {
  if (!basePath || basePath === ".") {
    return "./";
  }
  if (basePath === "/") {
    return "/";
  }
  return `/${basePath.replace(/^\/+|\/+$/g, "")}/`;
}

export default defineConfig({
  base: normalizeBasePath(process.env.JAMIO_BASE_PATH ?? "/jamio/"),
  plugins: [react()],
  server: {
    port: 5173
  }
});
