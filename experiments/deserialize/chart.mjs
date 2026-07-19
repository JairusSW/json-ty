// Deserialization chart: native vs json-ty (full read) vs json-ty (3 fields).
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { createBarChart, generateChart } from "../lib/chart.mjs";
import { bar } from "../lib/palette.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const rows = JSON.parse(readFileSync(join(HERE, "build/logs/deserialize.json"), "utf-8"));

const keys = ["native", "json-ty lazy (full)", "json-ty lazy (3 fields)", "json-ty eager"];
const data = {}, labels = {};
for (const r of rows) {
  data[r.name] = keys.map((k) => r[k]);
  labels[r.name] = `${r.name} (${r.bytes}B)`;
}

const config = createBarChart(data, labels, {
  title: "Deserialization throughput — native vs json-ty (lazy & eager)",
  yLabel: "MB/s",
  xLabel: "",
  datasetLabels: ["native JSON.parse", "lazy: read ALL", "lazy: read 3 fields", "eager: read ALL"],
  colors: [bar("strawberryRed"), bar("fadedCopper"), bar("pacificBlue", 0.9), bar("sandDune")],
});

generateChart(config, join(HERE, "deserialize.png"));
