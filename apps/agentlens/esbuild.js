// Bundles the extension entry point into dist/extension.js.
// `vscode` is provided by the host at runtime, so it is always external.
const esbuild = require("esbuild");

const production = process.argv.includes("--production");

async function main() {
  const ctx = await esbuild.context({
    entryPoints: ["src/extension.ts"],
    bundle: true,
    format: "cjs",
    minify: production,
    sourcemap: !production,
    sourcesContent: false,
    platform: "node",
    target: "node18",
    outfile: "dist/extension.js",
    external: ["vscode"],
    logLevel: "info",
  });
  await ctx.rebuild();
  await ctx.dispose();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
