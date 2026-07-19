// Grouped-bar SVG chart generator for json-ty benchmarks.
//
// Adapted from json-as's bench/lib/chart.ts to read a single results array
// (as written by dump() in bench.js) instead of one file per library/payload.
//
//   bun ./bench/lib/chart.ts ./build/logs/serialize.json -o ./benchmark/results
//
// Emits two SVGs per metric: ops/s and throughput (MB/s).
import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";

type Result = {
  library: string;
  payload: string;
  opsPerSec: number;
  mbps: number;
  bytes: number;
};

const colors = [
  "#94a3b8", // native — slate (the baseline)
  "#3b82f6", // json-ty — blue
  "#10b981", // json-ty (direct) — green
  "#f59e0b",
  "#ef4444",
  "#8b5cf6",
];

const PAYLOAD_ORDER = ["abc", "vec3", "player", "nums", "nums64", "vecs"];

function comparePayloads(a: string, b: string): number {
  const ai = PAYLOAD_ORDER.indexOf(a);
  const bi = PAYLOAD_ORDER.indexOf(b);
  if (ai !== -1 && bi !== -1) return ai - bi;
  if (ai !== -1) return -1;
  if (bi !== -1) return 1;
  return a.localeCompare(b);
}

function main() {
  const args = process.argv.slice(2);
  let outDir = "./benchmark/results";
  const inputs: string[] = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "-o") outDir = args[++i];
    else inputs.push(args[i]);
  }
  if (!inputs.length) {
    console.error("Usage: bun ./bench/lib/chart.ts <results.json> [-o outDir]");
    process.exit(1);
  }

  const results: Result[] = [];
  for (const f of inputs) results.push(...(JSON.parse(readFileSync(f, "utf-8")) as Result[]));

  mkdirSync(outDir, { recursive: true });

  const opsSvg = renderChart(results, {
    title: "Serialize throughput — operations / second",
    unit: "M ops/s",
    value: (r) => r.opsPerSec / 1e6,
    decimals: 2,
  });
  writeFileSync(join(outDir, "serialize.ops.svg"), opsSvg);

  const mbpsSvg = renderChart(results, {
    title: "Serialize throughput — MB / second",
    unit: "MB/s",
    value: (r) => r.mbps,
    decimals: 0,
  });
  writeFileSync(join(outDir, "serialize.throughput.svg"), mbpsSvg);

  console.log(`✅ wrote serialize.ops.svg + serialize.throughput.svg to ${outDir}`);
}

function renderChart(
  results: Result[],
  opts: { title: string; unit: string; value: (r: Result) => number; decimals: number },
): string {
  const payloads = [...new Set(results.map((r) => r.payload))].sort(comparePayloads);
  const libraries = [...new Set(results.map((r) => r.library))];

  const width = 960;
  const height = 560;
  const padding = { top: 90, right: 210, bottom: 90, left: 90 };
  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;

  const groupWidth = chartWidth / payloads.length;
  const barWidth = (groupWidth / libraries.length) * 0.82;

  const values = results.map(opts.value);
  const yMax = Math.max(...values, 0.01) * 1.12;
  const yScale = (v: number) => padding.top + chartHeight - (v / yMax) * chartHeight;

  // baseline (native) per payload, for speedup labels
  const baselineFor = (payload: string) => {
    const n = results.find((r) => r.payload === payload && r.library === "native");
    return n ? opts.value(n) : 0;
  };

  let svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
<defs><style>
  .title { font: bold 22px -apple-system, system-ui, sans-serif; fill: #0f172a; }
  .axis-label { font: 13px system-ui, sans-serif; fill: #475569; }
  .tick { font: 12px system-ui, sans-serif; fill: #94a3b8; }
  .payload { font: bold 13px system-ui, sans-serif; fill: #334155; }
  .grid { stroke: #e2e8f0; stroke-width: 1; }
  .axis { stroke: #cbd5e1; stroke-width: 1.5; }
  .bar-val { font: bold 11px system-ui, sans-serif; fill: #0f172a; text-anchor: middle; }
  .speedup { font: 10px system-ui, sans-serif; fill: #16a34a; text-anchor: middle; }
  .legend { font: 13px system-ui, sans-serif; fill: #334155; }
</style></defs>
<rect width="${width}" height="${height}" fill="#ffffff"/>
<text x="${width / 2}" y="44" text-anchor="middle" class="title">${escapeXml(opts.title)}</text>
`;

  for (let i = 0; i <= 8; i++) {
    const v = (yMax / 8) * i;
    const y = yScale(v);
    svg += `<line x1="${padding.left}" y1="${y}" x2="${width - padding.right}" y2="${y}" class="grid"/>`;
    svg += `<text x="${padding.left - 10}" y="${y + 4}" text-anchor="end" class="tick">${v.toFixed(opts.decimals)}</text>`;
  }

  svg += `<line x1="${padding.left}" y1="${padding.top}" x2="${padding.left}" y2="${height - padding.bottom}" class="axis"/>`;
  svg += `<line x1="${padding.left}" y1="${height - padding.bottom}" x2="${width - padding.right}" y2="${height - padding.bottom}" class="axis"/>`;
  svg += `<text x="-${height / 2}" y="24" transform="rotate(-90)" text-anchor="middle" class="axis-label">${escapeXml(opts.unit)}</text>`;

  payloads.forEach((payload, pi) => {
    const groupX = padding.left + groupWidth * pi;
    const base = baselineFor(payload);
    svg += `<text x="${groupX + groupWidth / 2}" y="${height - padding.bottom + 28}" text-anchor="middle" class="payload">${escapeXml(payload.toUpperCase())}</text>`;

    libraries.forEach((lib, li) => {
      const r = results.find((x) => x.payload === payload && x.library === lib);
      if (!r) return;
      const v = opts.value(r);
      const x = groupX + groupWidth * 0.09 + li * (groupWidth / libraries.length);
      const y = yScale(v);
      const barHeight = padding.top + chartHeight - y;
      svg += `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barWidth.toFixed(1)}" height="${barHeight.toFixed(1)}" fill="${colors[li % colors.length]}" rx="3"/>`;
      svg += `<text x="${(x + barWidth / 2).toFixed(1)}" y="${(y - 14).toFixed(1)}" class="bar-val">${v.toFixed(opts.decimals)}</text>`;
      if (lib !== "native" && base > 0) {
        svg += `<text x="${(x + barWidth / 2).toFixed(1)}" y="${(y - 3).toFixed(1)}" class="speedup">${(v / base).toFixed(2)}×</text>`;
      }
    });
  });

  libraries.forEach((lib, i) => {
    const y = padding.top + i * 28;
    svg += `<rect x="${width - padding.right + 24}" y="${y - 11}" width="16" height="16" fill="${colors[i % colors.length]}" rx="3"/>`;
    svg += `<text x="${width - padding.right + 48}" y="${y + 2}" class="legend">${escapeXml(lib)}</text>`;
  });

  return svg + "</svg>\n";
}

function escapeXml(s: string): string {
  return s.replace(/[<>&]/g, (c) => (c === "<" ? "&lt;" : c === ">" ? "&gt;" : "&amp;"));
}

main();
