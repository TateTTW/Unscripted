import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { loadEnv, type Plugin } from "vite";
import { defineConfig } from "vitest/config";

const KEY_PATTERN = /(?<![A-Za-z0-9_-])sk-[A-Za-z0-9_-]{20,}/;

function listFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) files.push(...listFiles(full));
    else files.push(full);
  }
  return files;
}

/** Fails the production build if any emitted file contains an API key. */
function keyLeakCheck(devKey: string): Plugin {
  let outDir = "dist";
  return {
    name: "unscripted-key-leak-check",
    apply: "build",
    configResolved(config) {
      outDir = join(config.root, config.build.outDir);
    },
    closeBundle() {
      const problems: string[] = [];
      for (const file of listFiles(outDir)) {
        const content = readFileSync(file, "latin1");
        const name = relative(outDir, file);
        if (devKey && content.includes(devKey)) {
          problems.push(`${name} contains the VITE_OPENAI_API_KEY value`);
        }
        if (KEY_PATTERN.test(content)) {
          problems.push(`${name} contains a string that looks like an OpenAI API key`);
        }
      }
      if (problems.length > 0) {
        throw new Error(`API key leak check failed:\n${problems.join("\n")}`);
      }
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "VITE_");
  const devKey = (env.VITE_OPENAI_API_KEY ?? "").trim();
  return {
    base: "./",
    plugins: [keyLeakCheck(devKey)],
    build: {
      chunkSizeWarningLimit: 1600,
      rollupOptions: {
        output: {
          manualChunks: { phaser: ["phaser"], openai: ["openai", "zod"] },
        },
      },
    },
    test: {
      include: ["tests/**/*.test.ts"],
      environment: "node",
    },
  };
});
