import { copyFileSync, mkdirSync, readdirSync } from "node:fs";

mkdirSync("benchmark/charts", { recursive: true });
for (const file of readdirSync("build/charts")) {
  if (!file.endsWith(".svg")) continue;
  copyFileSync(`build/charts/${file}`, `benchmark/charts/${file}`);
}
console.log("> benchmark/charts/*.svg");
