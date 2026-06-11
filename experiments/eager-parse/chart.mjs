// Eager flat-buffer parser vs native vs lazy — chart.js grouped bar.
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { createBarChart, generateChart } from "../lib/chart.mjs";
import { bar } from "../lib/palette.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const rows = JSON.parse(readFileSync(join(HERE, "build/logs/eager.json"), "utf-8"));

const keys = ["native", "lazy", "eager"];
const data = {}, labels = {};
for (const r of rows) { data[r.task] = keys.map((k) => r[k]); labels[r.task] = r.task; }

const config = createBarChart(data, labels, {
  title: "Eager flat-buffer parse — 2000 records (JSON → typed array)",
  yLabel: "MB/s",
  xLabel: "",
  datasetLabels: ["native JSON.parse", "json-ty lazy", "json-ty eager (flat buffer)"],
  colors: [bar("strawberryRed"), bar("pacificBlue", 0.9), bar("sandDune")],
});

generateChart(config, join(HERE, "eager.png"));
