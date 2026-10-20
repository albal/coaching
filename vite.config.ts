import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const page = (name: string) => fileURLToPath(new URL(`src/web/${name}.html`, import.meta.url));

// The commit the build came from, shown in the page footer (%VITE_COMMIT%).
function commit(): string {
  try {
    return execSync("git rev-parse --short HEAD", { encoding: "utf8" }).trim();
  } catch {
    return "dev";
  }
}
process.env.VITE_COMMIT ??= commit();

export default defineConfig({
  root: "src/web",
  publicDir: "../../public",
  build: {
    outDir: "../../dist",
    emptyOutDir: true,
    rollupOptions: { input: { main: page("index"), privacy: page("privacy") } },
  },
});
