import { copyFile, mkdir } from "node:fs/promises";
import { build } from "esbuild";

await mkdir("dist/.openai", {recursive:true});
await copyFile(".openai/hosting.json", "dist/.openai/hosting.json");
await build({entryPoints:["worker.mjs"], outfile:"dist/server/index.js", bundle:true, format:"esm", platform:"browser", target:"es2022"});
