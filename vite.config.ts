import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const page = (name: string) => fileURLToPath(new URL(`src/web/${name}.html`, import.meta.url));

export default defineConfig({
  root: "src/web",
  publicDir: "../../public",
  build: {
    outDir: "../../dist",
    emptyOutDir: true,
    rollupOptions: { input: { main: page("index"), privacy: page("privacy") } },
  },
});
