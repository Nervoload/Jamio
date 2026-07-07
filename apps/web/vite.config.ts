import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  base: "/jamio/",
  plugins: [react()],
  server: {
    port: 5173
  }
});
