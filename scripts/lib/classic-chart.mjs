import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { ChartJSNodeCanvas } from "chartjs-node-canvas";
import { INK, OVERVIEW_BARS } from "./palette.mjs";
import { withAdaptiveLogScale } from "./chart-outliers.mjs";

function git(...arguments_) {
  try {
    return execFileSync("git", arguments_, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return "unknown";
  }
}

function subtitle(report) {
  const version = JSON.parse(readFileSync("package.json", "utf8")).version;
  return `${new Date(report.generatedAt).toDateString()} • v${version} • Node ${process.version} / V8 ${process.versions.v8} • ${git("rev-parse", "--short", "HEAD")} • ${git("rev-parse", "--abbrev-ref", "HEAD")}`;
}

function sizeLabel(bytes) {
  return bytes >= 1e6 ? `${(bytes / 1e6).toFixed(1)}MB` : `${Math.round(bytes / 1e3)}KB`;
}

function niceStep(maximum) {
  const rough = Math.max(1, maximum / 6);
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const normalized = rough / magnitude;
  return (normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10) * magnitude;
}

function createConfig(report, kind) {
  const series = report.series[kind];
  const payloads = [...new Map(report.payloads.filter(({ format }) => format === "min").map((payload) => [payload.key, payload])).values()];
  const results = report.results.filter((result) => result.kind === kind && result.format === "min" && result.benchmark === null);
  const byKey = new Map(results.map((result) => [`${result.payload}:${result.series}`, result]));
  const maximum = Math.max(...results.map(({ mbps }) => mbps), 1);
  const step = niceStep(maximum);
  const max = Math.ceil((maximum * 1.18 + step) / step) * step;
  return {
    type: "bar",
    data: {
      labels: payloads.map(({ label, bytes }) => `${label}\n(${sizeLabel(bytes)})`),
      datasets: series.map(([id, label], index) => ({
        label,
        data: payloads.map(({ key }) => byKey.get(`${key}:${id}`)?.mbps ?? 0),
        backgroundColor: OVERVIEW_BARS[index].bg,
        borderColor: OVERVIEW_BARS[index].border,
        borderWidth: 1,
      })),
    },
    options: {
      responsive: true,
      plugins: {
        title: { display: true, text: `${kind === "serialize" ? "Serialization" : "Deserialization"} throughput of classic payloads`, font: { size: 20, weight: "bold" } },
        legend: { position: "top", labels: { font: { size: 15, weight: "bold" }, padding: 18 } },
        datalabels: {
          anchor: "end",
          align: "end",
          rotation: -90,
          color: INK.label,
          font: { weight: "bold", size: 11 },
          formatter: (value) => (value > 0 ? Math.round(value).toLocaleString("en-US") : ""),
        },
        subtitle: { display: true, text: subtitle(report), font: { size: 14, weight: "bold" }, color: INK.subtitle, padding: 16, position: "right" },
      },
      scales: {
        y: {
          beginAtZero: true,
          max,
          grid: { color: INK.grid },
          title: { display: true, text: "Throughput (MB/s)", font: { size: 16, weight: "bold" } },
          ticks: { stepSize: step, font: { size: 13, weight: "bold" } },
        },
        x: { grid: { display: false }, ticks: { maxRotation: 0, minRotation: 0, font: { size: 13, weight: "bold" } } },
      },
    },
  };
}

function render(config, output) {
  const svg = output.endsWith(".svg");
  const canvas = new ChartJSNodeCanvas({ width: 1200, height: 650, type: svg ? "svg" : "png", plugins: { modern: ["chartjs-plugin-datalabels"] } });
  const rendered = withAdaptiveLogScale({ ...config, options: { ...config.options, devicePixelRatio: svg ? 1 : 3 } });
  writeFileSync(output, canvas.renderToBufferSync(rendered, svg ? "image/svg+xml" : "image/png"));
  console.log(`> ${output}`);
}

export function generateClassicCharts() {
  const report = JSON.parse(readFileSync("build/logs/classic.json", "utf8"));
  mkdirSync("build/charts", { recursive: true });
  for (const kind of ["deserialize", "serialize"]) {
    const config = createConfig(report, kind);
    render(config, `build/charts/classic-payload-${kind}.svg`);
    render(config, `build/charts/classic-payload-${kind}.png`);
  }
}
