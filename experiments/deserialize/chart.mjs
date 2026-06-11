// Deserialization chart: native vs json-ty (full read) vs json-ty (3 fields).
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { createBarChart, generateChart } from "../lib/chart.mjs";
import { bar } from "../lib/palette.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const rows = JSON.parse(readFileSync(join(HERE, "build/logs/deserialize.json"), "utf-8"));

const keys = ["native", "json-ty (full)", "json-ty (3 fields)"];
const data = {}, labels = {};
for (const r of rows) {
  data[r.name] = keys.map((k) => r[k]);
  labels[r.name] = `${r.name} (${r.bytes}B)`;
}

const config = createBarChart(data, labels, {
  title: "Deserialization throughput — json-ty (lazy) vs native JSON.parse",
  yLabel: "MB/s",
  xLabel: "",
  datasetLabels: ["native JSON.parse", "json-ty: parse + read ALL", "json-ty: parse + read 3 fields"],
  colors: [bar("strawberryRed"), bar("fadedCopper"), bar("pacificBlue", 0.9)],
});

generateChart(config, join(HERE, "deserialize.png"));
