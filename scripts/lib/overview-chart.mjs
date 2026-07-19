import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { ChartJSNodeCanvas } from "chartjs-node-canvas";
import { INK, OVERVIEW_BARS } from "./palette.mjs";
import { withAdaptiveLogScale } from "./chart-outliers.mjs";

function git(...args) {
  try {
    return execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return "unknown";
  }
}

function subtitle() {
  const packageVersion = JSON.parse(readFileSync("package.json", "utf8")).version;
  return `${new Date().toDateString()} • v${packageVersion} • Node ${process.version} / V8 ${process.versions.v8} • ${git("rev-parse", "--short", "HEAD")} • ${git("rev-parse", "--abbrev-ref", "HEAD")}`;
}

function niceStep(max) {
  const rough = Math.max(1, max / 6);
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const normalized = rough / magnitude;
  const step = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
  return step * magnitude;
}

function createConfig(report, kind, title) {
  const series = report.series[kind];
  const visibleSeries = new Set(series.map(([id]) => id));
  const resultByKey = new Map(report.results.filter((result) => result.kind === kind).map((result) => [`${result.payload}:${result.series}`, result]));
  const max = Math.max(...report.results.filter((result) => result.kind === kind && visibleSeries.has(result.series)).map((result) => result.mbps), 1);
  const yStep = niceStep(max);
  const yMax = Math.ceil((max * 1.18 + yStep) / yStep) * yStep;

  return {
    type: "bar",
    data: {
      labels: report.payloads.map((payload) => payload.label),
      datasets: series.map(([id, label], index) => ({
        label,
        data: report.payloads.map((payload) => resultByKey.get(`${payload.key}:${id}`)?.mbps ?? 0),
        backgroundColor: OVERVIEW_BARS[index].bg,
        borderColor: OVERVIEW_BARS[index].border,
        borderWidth: index === 3 ? 2 : 1,
      })),
    },
    options: {
      responsive: true,
      plugins: {
        title: { display: true, text: title, font: { size: 20, weight: "bold" } },
        legend: { position: "top", labels: { font: { size: 16, weight: "bold" }, padding: 20 } },
        datalabels: {
          anchor: "end",
          align: "end",
          rotation: -90,
          color: INK.label,
          font: { weight: "bold", size: 12 },
          formatter: (value) => (value > 0 ? Math.round(value).toLocaleString("en-US") : ""),
        },
        subtitle: {
          display: true,
          text: subtitle(),
          font: { size: 14, weight: "bold" },
          color: INK.subtitle,
          padding: 16,
          position: "right",
        },
      },
      scales: {
        y: {
          beginAtZero: true,
          max: yMax,
          grid: { color: INK.grid },
          title: { display: true, text: "Throughput (MB/s)", font: { size: 16, weight: "bold" } },
          ticks: { stepSize: yStep, font: { size: 14, weight: "bold" } },
        },
        x: {
          grid: { display: false },
          ticks: { maxRotation: 0, minRotation: 0, font: { size: 14, weight: "bold" } },
        },
      },
    },
  };
}

function render(config, outfile) {
  const isSvg = outfile.endsWith(".svg");
  const canvas = new ChartJSNodeCanvas({
    width: 1000,
    height: 600,
    type: isSvg ? "svg" : "png",
    plugins: { modern: ["chartjs-plugin-datalabels"] },
  });
  const rendered = withAdaptiveLogScale({
    ...config,
    options: { ...config.options, devicePixelRatio: isSvg ? 1 : 3 },
  });
  const buffer = canvas.renderToBufferSync(rendered, isSvg ? "image/svg+xml" : "image/png");
  mkdirSync(dirname(outfile), { recursive: true });
  writeFileSync(outfile, buffer);
  console.log(`> ${outfile}`);
}

export function generateOverviewChart(kind, title, basename) {
  const report = JSON.parse(readFileSync("build/logs/overview.json", "utf8"));
  const config = createConfig(report, kind, title);
  render(config, `build/charts/${basename}.svg`);
  render(config, `build/charts/${basename}.png`);
}
