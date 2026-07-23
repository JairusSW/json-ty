import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { ChartJSNodeCanvas } from "chartjs-node-canvas";
import { INK, OVERVIEW_BARS } from "./palette.mjs";
import { withAdaptiveLogScale } from "./chart-outliers.mjs";
import { assertCompleteClassicReport } from "./classic-report.mjs";
import { CHART_BOTTOM_PADDING, measuredChartLabels } from "./chart-layout.mjs";

const WHITE_BACKGROUND = {
  id: "whiteBackground",
  beforeDraw(chart) {
    const { ctx, width, height } = chart;
    ctx.save();
    ctx.globalCompositeOperation = "destination-over";
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, width, height);
    ctx.restore();
  },
};

function git(...arguments_) {
  try {
    return execFileSync("git", arguments_, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return "unknown";
  }
}

function subtitle(report) {
  const version = JSON.parse(readFileSync("package.json", "utf8")).version;
  if (report.engine === "v8") {
    return `${new Date(report.generatedAt).toDateString()} • v${version} • ${report.engineVersion || "V8 shell"} ${report.flags.join(" ")} • ${git("rev-parse", "--short", "HEAD")} • ${git("rev-parse", "--abbrev-ref", "HEAD")}`;
  }
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
      labels: measuredChartLabels(payloads.map(({ label, bytes }) => `${label}\n(${sizeLabel(bytes)})`)),
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
      layout: { padding: { bottom: CHART_BOTTOM_PADDING } },
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

function render(config, output, { width = 1200, height = 650 } = {}) {
  const svg = output.endsWith(".svg");
  const canvas = new ChartJSNodeCanvas({ width, height, type: svg ? "svg" : "png", plugins: { modern: ["chartjs-plugin-datalabels"] } });
  const rendered = withAdaptiveLogScale({ ...config, plugins: [...(config.plugins ?? []), WHITE_BACKGROUND], options: { ...config.options, devicePixelRatio: svg ? 1 : 3 } });
  writeFileSync(output, canvas.renderToBufferSync(rendered, svg ? "image/svg+xml" : "image/png"));
  console.log(`> ${output}`);
}

export function generateClassicCharts() {
  const report = JSON.parse(readFileSync("build/logs/classic.json", "utf8"));
  assertCompleteClassicReport(report, "build/logs/classic.json");
  mkdirSync("build/charts", { recursive: true });
  for (const kind of ["deserialize", "serialize"]) {
    const config = createConfig(report, kind);
    render(config, `build/charts/classic-payload-${kind}.svg`);
    render(config, `build/charts/classic-payload-${kind}.png`);
  }
}

export function generateClassicV8Charts() {
  const report = JSON.parse(readFileSync("build/logs/classic-v8.json", "utf8"));
  const labels = report.corpora.map(({ corpus, results }) => {
    const bytes = results[0]?.bytes ?? 0;
    return `${corpus.replaceAll("_", " ")}\n(${sizeLabel(bytes)})`;
  });
  const ratio = (corpus, name) => {
    const native = corpus.results.find((result) => result.name === "native");
    const result = corpus.results.find((candidate) => candidate.name === name);
    return native && result ? result.mbps / native.mbps : null;
  };
  const bestRatio = (corpus, names) => {
    const values = names.map((name) => ratio(corpus, name)).filter((value) => value !== null);
    return values.length === 0 ? null : Math.max(...values);
  };
  const datasets = [
    { label: "Built-in JSON.parse", color: OVERVIEW_BARS[0], values: (corpus) => 1 },
    { label: "json-ty validated lazy JSON.Obj", color: OVERVIEW_BARS[1], values: (corpus) => ratio(corpus, "json-ty-dynamic") },
    { label: "json-ty typed / lazy caller-owned", color: OVERVIEW_BARS[2], values: (corpus) => bestRatio(corpus, ["json-ty-into", "json-ty-lazy-into"]) },
    { label: "json-ty verified raw projection", color: OVERVIEW_BARS[3], values: (corpus) => ratio(corpus, "json-ty-projected") },
  ].map(({ label, color, values }) => ({
    label,
    data: report.corpora.map(values),
    backgroundColor: color.bg,
    borderColor: color.border,
    borderWidth: 1,
  }));
  const values = datasets.flatMap(({ data }) => data).filter((value) => Number.isFinite(value));
  const maximum = Math.max(...values, 1);
  const step = niceStep(maximum);
  const config = {
    type: "bar",
    data: { labels: measuredChartLabels(labels), datasets },
    options: {
      responsive: true,
      layout: { padding: { bottom: CHART_BOTTOM_PADDING } },
      plugins: {
        title: {
          display: true,
          text: [
            "Classic resident V8 throughput relative to JSON.parse",
            "Queryable JSON.Obj, typed-lazy, and exact verified-projection paths",
          ],
          font: { size: 20, weight: "bold" },
        },
        legend: { position: "top", labels: { font: { size: 14, weight: "bold" }, padding: 16 } },
        datalabels: {
          anchor: "end",
          align: "end",
          rotation: -90,
          color: INK.label,
          font: { weight: "bold", size: 10 },
          formatter: (value) => value > 0 ? `${value.toFixed(2)}×` : "",
        },
        subtitle: {
          display: true,
          text: subtitle(report),
          font: { size: 13, weight: "bold" },
          color: INK.subtitle,
          padding: 14,
          position: "right",
        },
      },
      scales: {
        y: {
          beginAtZero: true,
          max: Math.ceil((maximum * 1.18 + step) / step) * step,
          grid: { color: INK.grid },
          title: { display: true, text: "Throughput relative to JSON.parse (higher is better)", font: { size: 15, weight: "bold" } },
          ticks: {
            stepSize: step,
            font: { size: 12, weight: "bold" },
            callback: (value) => `${Number(value).toFixed(1)}×`,
          },
        },
        x: { grid: { display: false }, ticks: { maxRotation: 0, minRotation: 0, font: { size: 12, weight: "bold" } } },
      },
    },
  };
  render(config, "build/charts/classic-v8-deserialize.svg", { height: 750 });
  render(config, "build/charts/classic-v8-deserialize.png", { height: 750 });

  const serializeRatio = (corpus) => {
    const native = corpus.results.find((result) => result.name === "native-serialize");
    const jsonTy = corpus.results.find((result) => result.name === "json-ty-serialize");
    return native && jsonTy ? jsonTy.mbps / native.mbps : null;
  };
  const serializeValues = report.corpora.map(serializeRatio);
  const serializeMaximum = Math.max(...serializeValues.filter((value) => value !== null), 1);
  const serializeStep = niceStep(serializeMaximum);
  const serializeConfig = {
    type: "bar",
    data: {
      labels: measuredChartLabels(labels),
      datasets: [
        {
          label: "Built-in JSON.stringify",
          data: report.corpora.map(() => 1),
          backgroundColor: OVERVIEW_BARS[0].bg,
          borderColor: OVERVIEW_BARS[0].border,
          borderWidth: 1,
        },
        {
          label: "json-ty verified retained source",
          data: serializeValues,
          backgroundColor: OVERVIEW_BARS[3].bg,
          borderColor: OVERVIEW_BARS[3].border,
          borderWidth: 1,
        },
      ],
    },
    options: {
      responsive: true,
      layout: { padding: { bottom: CHART_BOTTOM_PADDING } },
      plugins: {
        title: {
          display: true,
          text: "Classic resident V8 serialization relative to JSON.stringify",
          font: { size: 20, weight: "bold" },
        },
        legend: { position: "top", labels: { font: { size: 14, weight: "bold" }, padding: 16 } },
        datalabels: {
          anchor: "end",
          align: "end",
          rotation: -90,
          color: INK.label,
          font: { weight: "bold", size: 10 },
          formatter: (value) => value > 0 ? `${value.toFixed(2)}×` : "",
        },
        subtitle: {
          display: true,
          text: subtitle(report),
          font: { size: 13, weight: "bold" },
          color: INK.subtitle,
          padding: 14,
          position: "right",
        },
      },
      scales: {
        y: {
          beginAtZero: true,
          max: Math.ceil((serializeMaximum * 1.18 + serializeStep) / serializeStep) * serializeStep,
          grid: { color: INK.grid },
          title: { display: true, text: "Throughput relative to JSON.stringify (higher is better)", font: { size: 15, weight: "bold" } },
          ticks: {
            stepSize: serializeStep,
            font: { size: 12, weight: "bold" },
            callback: (value) => `${Number(value).toFixed(0)}×`,
          },
        },
        x: { grid: { display: false }, ticks: { maxRotation: 0, minRotation: 0, font: { size: 12, weight: "bold" } } },
      },
    },
  };
  render(serializeConfig, "build/charts/classic-v8-serialize.svg", { height: 750 });
  render(serializeConfig, "build/charts/classic-v8-serialize.png", { height: 750 });
}
