// Parse scaling: stage-1 index vs native full parse — chart.js grouped bar.
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { createBarChart, generateChart } from "../lib/chart.mjs";
import { bar } from "../lib/palette.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const rows = JSON.parse(readFileSync(join(HERE, "build/logs/scaling.json"), "utf-8"));

const data = {};
const labels = {};
for (const r of rows) {
  data[r.name] = [r.native, r.copyTokenize, r.tokenize];
  const sz = r.bytes >= 1e6 ? `${(r.bytes / 1e6).toFixed(1)} MB` : r.bytes >= 1000 ? `${(r.bytes / 1000).toFixed(1)} KB` : `${r.bytes} B`;
  labels[r.name] = `${r.name} (${sz})`;
}

const config = createBarChart(data, labels, {
  title: "Parse scaling: WASM stage-1 index vs native full parse",
  yLabel: "Throughput (MB/s)",
  xLabel: "",
  datasetLabels: ["native JSON.parse (full)", "WASM stage-1: copy + tokenize", "tokenize only (resident)"],
  colors: [bar("strawberryRed"), bar("pacificBlue", 0.9), bar("jungleGreen")],
});

generateChart(config, join(HERE, "scaling.png"));
