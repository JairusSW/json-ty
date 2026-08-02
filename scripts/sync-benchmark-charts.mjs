import { copyFileSync, mkdirSync, readdirSync } from "node:fs";

mkdirSync("bench/charts", { recursive: true });
for (const file of readdirSync("build/charts")) {
  if (!file.endsWith(".svg")) continue;
  copyFileSync(`build/charts/${file}`, `bench/charts/${file}`);
}
console.log("> bench/charts/*.svg");
