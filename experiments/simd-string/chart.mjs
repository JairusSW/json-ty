// 1 MiB string serialize by escape density — chart.js grouped bar.
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { createBarChart, generateChart } from "../lib/chart.mjs";
import { bar } from "../lib/palette.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const rows = JSON.parse(readFileSync(join(HERE, "build/logs/escape-density.json"), "utf-8"));

const keys = ["native", "json-ty", "fast-json-stringify", "wasm-simd"];
const data = {};
const labels = {};
for (const r of rows) {
  const id = r.density;
  data[id] = keys.map((k) => r[k]);
  labels[id] = r.density; // escape counts are in the README table
}

const config = createBarChart(data, labels, {
  title: "1 MiB string serialize — throughput by escape density",
  yLabel: "Throughput (MB/s)",
  xLabel: "",
  datasetLabels: ["native JSON.stringify", "json-ty (scalar JS)", "fast-json-stringify", "wasm SIMD (Node)"],
  colors: [bar("strawberryRed"), bar("orange"), bar("mutedTeal"), bar("pacificBlue", 0.9)],
});

generateChart(config, join(HERE, "escape-density.png"));
