// Eager flat-table parser (full deserialize) vs native — chart.js grouped bar.
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { createBarChart, generateChart } from "../lib/chart.mjs";
import { bar } from "../lib/palette.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const rows = JSON.parse(readFileSync(join(HERE, "build/logs/eager.json"), "utf-8"));

const data = {}, labels = {};
for (const r of rows) { data[r.task] = [r.native, r.eager]; labels[r.task] = r.task; }

const config = createBarChart(data, labels, {
  title: "Eager flat-table parse vs native (full deserialize, JSON → typed array)",
  yLabel: "MB/s",
  xLabel: "",
  datasetLabels: ["native JSON.parse", "json-ty eager (flat tables)"],
  colors: [bar("strawberryRed"), bar("sandDune")],
});

generateChart(config, join(HERE, "eager.png"));
