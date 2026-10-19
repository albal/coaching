import { defineConfig } from "vite";

export default defineConfig({
  root: "src/web",
  publicDir: "../../public",
  build: { outDir: "../../dist", emptyOutDir: true },
});
