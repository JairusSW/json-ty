// Vec3 parse throughput by approach × access pattern — chart.js grouped bar.
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { createBarChart, generateChart } from "./lib/chart.mjs";
import { bar } from "./lib/palette.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const rows = JSON.parse(readFileSync(join(HERE, "build/logs/parse-bench.json"), "utf-8"));

const data = {};
const labels = {};
for (const r of rows) {
  data[r.approach] = [r["read 1 of 3"], r["read all 3"]];
  labels[r.approach] = r.approach;
}

const config = createBarChart(data, labels, {
  title: "Vec3 parse throughput (Node, 25-byte object)",
  yLabel: "M ops/s",
  xLabel: "approach",
  datasetLabels: ["read 1 of 3", "read all 3"],
  colors: [bar("pacificBlue", 0.9), bar("fadedCopper")],
  valueFormat: (v) => v.toFixed(1),
});

generateChart(config, join(HERE, "parse-bench.png"));
