#!/usr/bin/env node
import { resolve } from "node:path";
import { buildProject } from "./build.js";

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index < 0 ? undefined : process.argv[index + 1];
}

const configPath = argument("--project") ?? argument("-p") ?? "tsconfig.json";
const generatedDirectory = argument("--generated") ?? ".json-ty";

try {
  const result = await buildProject({
    configPath: resolve(configPath),
    generatedDirectory: resolve(generatedDirectory),
  });
  process.stdout.write(
    `json-tyc: ${result.cacheHit ? "reused" : "built"} ${result.hash.slice(0, 12)} in ${result.generatedDirectory}\n`,
  );
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exitCode = 1;
}
