// JS<->WASM string-boundary throughput vs payload size — chart.js line (log Y).
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { createLineChart, generateChart } from "../lib/chart.mjs";
import { BASE } from "../lib/palette.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const rows = JSON.parse(readFileSync(join(HERE, "build/logs/string-bridge.json"), "utf-8"))
  .filter((r) => !r.payload.includes("uni")); // ASCII sweep only

const labels = rows.map((r) => r.payload);
const series = [
  { label: "send: raw copy (boundary memcpy)", key: "sendCopy", color: BASE.sandDune },
  { label: "send: copy + SIMD validate", key: "sendValidate", color: BASE.mutedTeal },
  { label: "send: copy + decode → AS string", key: "sendIngest", color: BASE.pacificBlue },
  { label: "recv: encode → JS string", key: "recvRead", color: BASE.jungleGreen },
  { label: "baseline: JS TextEncoder", key: "jsEncode", color: BASE.atomicTangerine },
].map((s) => ({ label: s.label, data: rows.map((r) => r[s.key]), color: s.color }));

const config = createLineChart(labels, series, {
  title: "JS ↔ WASM string throughput vs payload size",
  xLabel: "payload size (UTF-8 bytes)",
  yLabel: "MB/s (log)",
  logY: true,
});

generateChart(config, join(HERE, "string-bridge.png"));
