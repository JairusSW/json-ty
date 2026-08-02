import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { ChartJSNodeCanvas } from "chartjs-node-canvas";
import { BASE, INK, OVERVIEW_BARS } from "./lib/palette.mjs";
import { withAdaptiveLogScale } from "./lib/chart-outliers.mjs";
import { CHART_BOTTOM_PADDING, measuredChartLabels } from "./lib/chart-layout.mjs";

const TIER_COLORS = [
  { bg: "rgba(252,171,16,0.85)", border: BASE.orange },
  { bg: "rgba(68,175,105,0.85)", border: BASE.jungleGreen },
  { bg: "rgba(43,158,179,0.9)", border: BASE.pacificBlue },
];
const BASELINE = { bg: "rgba(107,114,128,0.8)", border: "#6b7280" };
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

function read(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function git(...arguments_) {
  try {
    return execFileSync("git", arguments_, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return "unknown";
  }
}

function subtitle(report) {
  const version = read("package.json").version;
  const tier = report?.tierMetadata?.kernelTier;
  return `${new Date(report?.generatedAt ?? Date.now()).toDateString()} • v${version} • Node ${process.version} / V8 ${process.versions.v8}${tier ? ` • ${tier.toUpperCase()}` : ""} • ${git("rev-parse", "--short", "HEAD")}`;
}

function niceStep(maximum) {
  const rough = Math.max(0.01, maximum / 6);
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const normalized = rough / magnitude;
  return (normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10) * magnitude;
}

function groupedConfig({ labels, datasets, title, axisTitle, report, horizontal = false, stacked = false, ratio = false, logarithmic = false }) {
  const values = datasets.flatMap(({ data }) => data).filter((value) => Number.isFinite(value) && value > 0);
  const maximum = Math.max(...values, 1);
  const step = niceStep(maximum);
  const valueAxis = {
    type: logarithmic ? "logarithmic" : "linear",
    beginAtZero: !logarithmic,
    grid: { color: INK.grid },
    stacked,
    title: { display: true, text: axisTitle, font: { size: 16, weight: "bold" } },
    ticks: {
      ...(logarithmic ? {} : { stepSize: step }),
      font: { size: 13, weight: "bold" },
      callback: ratio
        ? (value) => `${Number(value).toFixed(1)}×`
        : logarithmic
          ? (value) => [1, 2, 5].includes(Number(value) / (10 ** Math.floor(Math.log10(Number(value)))))
            ? Number(value).toLocaleString("en-US")
            : ""
          : undefined,
    },
  };
  const categoryAxis = {
    grid: { display: false },
    stacked,
    ticks: { maxRotation: horizontal ? 0 : 0, minRotation: 0, font: { size: horizontal ? 12 : 13, weight: "bold" } },
  };
  return {
    type: "bar",
    data: {
      labels: measuredChartLabels(labels),
      datasets: datasets.map((dataset, index) => ({
        ...dataset,
        backgroundColor: dataset.color?.bg ?? OVERVIEW_BARS[index % OVERVIEW_BARS.length].bg,
        borderColor: dataset.color?.border ?? OVERVIEW_BARS[index % OVERVIEW_BARS.length].border,
        borderWidth: 1,
      })),
    },
    options: {
      responsive: true,
      indexAxis: horizontal ? "y" : "x",
      layout: { padding: { bottom: CHART_BOTTOM_PADDING, right: horizontal ? 90 : 0 } },
      plugins: {
        title: { display: true, text: title, font: { size: 20, weight: "bold" } },
        legend: { position: "top", labels: { font: { size: 14, weight: "bold" }, padding: 16 } },
        subtitle: {
          display: true,
          text: subtitle(report),
          font: { size: 13, weight: "bold" },
          color: INK.subtitle,
          padding: 14,
          position: "right",
        },
        datalabels: {
          anchor: stacked ? "center" : "end",
          align: stacked ? "center" : horizontal ? "left" : "end",
          color: INK.label,
          rotation: horizontal || stacked ? 0 : -90,
          font: { weight: "bold", size: horizontal ? 10 : 11 },
          formatter(value) {
            if (!(value > 0)) return "";
            if (ratio) return `${value.toFixed(2)}×`;
            return value >= 1000
              ? Math.round(value).toLocaleString("en-US")
              : value >= 10
                ? Math.round(value).toLocaleString("en-US")
                : value.toFixed(2);
          },
        },
      },
      scales: horizontal ? { x: valueAxis, y: categoryAxis } : { y: valueAxis, x: categoryAxis },
    },
  };
}

function render(config, name, { width = 1200, height = 650, adaptive = true } = {}) {
  mkdirSync("build/charts", { recursive: true });
  for (const format of ["svg", "png"]) {
    const vector = format === "svg";
    const canvas = new ChartJSNodeCanvas({
      width,
      height,
      type: vector ? "svg" : "png",
      plugins: { modern: ["chartjs-plugin-datalabels"] },
    });
    const configured = adaptive ? withAdaptiveLogScale(config) : config;
    configured.plugins = [...(configured.plugins ?? []).filter(({ id }) => id !== WHITE_BACKGROUND.id), WHITE_BACKGROUND];
    configured.options.devicePixelRatio = vector ? 1 : 3;
    const output = `build/charts/${name}.${format}`;
    writeFileSync(output, canvas.renderToBufferSync(configured, vector ? "image/svg+xml" : "image/png"));
    console.log(`> ${output}`);
  }
}

function chartLazy() {
  const report = read("build/logs/lazy.json");
  const payloads = ["small", "medium", "large"];
  const access = [
    ["none", "parse only"],
    ["one", "read one field"],
    ["all", "read all fields"],
  ];
  const modes = [
    ["native", "Built-in JSON", BASELINE],
    ["eager", "json-ty eager", TIER_COLORS[1]],
    ["lazy", "json-ty lazy", TIER_COLORS[2]],
  ];
  const byKey = new Map(report.rows.map((row) => [`${row.payload}:${row.mode}`, row.mbps]));
  const labels = payloads.flatMap((payload) => access.map(([, label]) => `${payload[0].toUpperCase()}${payload.slice(1)}\n${label}`));
  const datasets = modes.map(([mode, label, color]) => ({
    label,
    color,
    data: payloads.flatMap((payload) => access.map(([level]) => byKey.get(`${payload}:${mode}-${level}`) ?? 0)),
  }));
  render(groupedConfig({
    labels,
    datasets,
    title: "Lazy access patterns: parse and deferred-field reads",
    axisTitle: "Throughput (MB/s, higher is better)",
    report,
  }), "lazy-access-pattern", { width: 1400, height: 700 });
}

function chartParity() {
  const report = read("build/logs/json-as-parity.json");
  const payloads = ["vec3", "small", "medium", "large", "canada", "poet"];
  const labels = payloads.map((value) => value === "vec3" ? "Vec3" : value[0].toUpperCase() + value.slice(1));
  for (const kind of ["parse", "serialize"]) {
    const rows = new Map(report.rows.filter((row) => row.kind === kind).map((row) => [row.payload, row]));
    const datasets = kind === "parse"
      ? [
          { label: "json-as", color: BASELINE, data: payloads.map((payload) => rows.get(payload)?.jsonAsMbps ?? 0) },
          { label: "json-ty resident kernel", color: TIER_COLORS[2], data: payloads.map((payload) => rows.get(payload)?.jsonTyMbps ?? 0) },
          { label: "json-ty owning lifecycle", color: TIER_COLORS[1], data: payloads.map((payload) => rows.get(payload)?.ownedMbps ?? 0) },
          { label: "json-ty host call", color: TIER_COLORS[0], data: payloads.map((payload) => rows.get(payload)?.hostMbps ?? 0) },
        ]
      : [
          { label: "json-as", color: BASELINE, data: payloads.map((payload) => rows.get(payload)?.jsonAsMbps ?? 0) },
          { label: "json-ty resident kernel", color: TIER_COLORS[2], data: payloads.map((payload) => rows.get(payload)?.jsonTyMbps ?? 0) },
          { label: "json-ty host call", color: TIER_COLORS[1], data: payloads.map((payload) => rows.get(payload)?.hostMbps ?? 0) },
        ];
    const config = groupedConfig({
      labels,
      datasets,
      title: `json-ty vs json-as: ${kind === "parse" ? "deserialization" : "serialization"} throughput`,
      axisTitle: `Throughput (MB/s, higher is better)${kind === "serialize" ? " · log10 scale" : ""}`,
      report,
      logarithmic: kind === "serialize",
    });
    render(config, `json-as-parity-${kind}`, { adaptive: kind !== "serialize" });
  }
}

function chartRaw() {
  const report = read("build/logs/raw.json");
  const byName = new Map(report.rows.map((row) => [row.name, row.mbps]));
  const groups = {
    "raw-deserialize": [
      "native parse + read all",
      "raw parse + view + read all",
      "native Buffer parse + read",
      "raw Buffer parse + read",
      "raw parse + view only",
      "raw parse + numeric reads",
      "raw parse + string read",
      "raw retained view + read all",
      "raw kernel + release",
      "raw Vec3 resident + release",
      "raw Vec3 kernel + release",
    ],
    "raw-serialize": [
      "native stringify",
      "raw stringify retained",
      "generated JS stringify",
      "plain via Wasm stringify",
      "native parse + stringify",
      "raw parse + stringify",
    ],
  };
  for (const [name, names] of Object.entries(groups)) {
    render(groupedConfig({
      labels: names,
      datasets: [{ label: report.tierMetadata.kernelTier.toUpperCase(), color: TIER_COLORS[2], data: names.map((label) => byName.get(label) ?? 0) }],
      title: name === "raw-deserialize" ? "Raw API deserialization paths" : "Raw API serialization paths",
      axisTitle: "Throughput (MB/s, higher is better)",
      report,
      horizontal: true,
      logarithmic: name === "raw-serialize",
    }), name, { width: 1200, height: name === "raw-deserialize" ? 800 : 600 });
  }
}

function rowKey(workload, row) {
  if (workload === "raw") return row.name;
  if (workload === "overview") return `${row.payload}:${row.kind}:${row.series}`;
  if (workload === "classic") return `${row.payload}:${row.format}:${row.kind}:${row.series}:${row.benchmark ?? ""}`;
  if (workload === "lazy") return `${row.payload}:${row.mode}`;
  return `${row.payload}:${row.kind}`;
}

function rowValue(workload, row) {
  return workload === "parity" ? row.jsonTyMbps : row.mbps;
}

function geometricMean(values) {
  return Math.exp(values.reduce((sum, value) => sum + Math.log(value), 0) / values.length);
}

function chartTiers() {
  const report = read("bench/results/kernel-tier-full.json");
  const variants = report.variants.filter(({ label }) => label !== "current");
  const artifacts = ["rfc", "raw", "overview", "classic", "parity"];
  const artifactLabels = ["RFC oracle", "Raw", "Overview", "Classic", "Parity"];
  for (const [metric, title, axisTitle, divisor] of [
    ["compileMs", "Compilation time by kernel tier", "Compile time (seconds, lower is better)", 1000],
    ["wasmBytes", "Optimized Wasm size by kernel tier", "Wasm size (KiB, lower is better)", 1024],
  ]) {
    const datasets = variants.map((variant, index) => ({
      label: variant.label.toUpperCase(),
      color: TIER_COLORS[index],
      data: artifacts.map((artifact) => variant.compileAndSize[artifact][metric] / divisor),
    }));
    render(groupedConfig({ labels: artifactLabels, datasets, title, axisTitle, report }), `tier-${metric === "compileMs" ? "compile-time" : "wasm-size"}`, { adaptive: false });
  }

  const baseline = report.variants.find(({ label }) => label === "current");
  const workloads = ["raw", "overview", "classic", "lazy", "parity"];
  const datasets = variants.map((variant, index) => ({
    label: variant.label.toUpperCase(),
    color: TIER_COLORS[index],
    data: workloads.map((workload) => {
      const baselineRows = baseline.execution[workload].rows ?? baseline.execution[workload].results;
      const variantRows = variant.execution[workload].rows ?? variant.execution[workload].results;
      const baselineByKey = new Map(baselineRows.map((row) => [rowKey(workload, row), rowValue(workload, row)]));
      const ratios = variantRows
        .map((row) => rowValue(workload, row) / baselineByKey.get(rowKey(workload, row)))
        .filter((ratio) => Number.isFinite(ratio) && ratio > 0);
      return geometricMean(ratios);
    }),
  }));
  render(groupedConfig({
    labels: ["Raw API", "Overview", "Classic", "Lazy", "json-as parity"],
    datasets,
    title: "Execution throughput by kernel tier",
    axisTitle: "Geometric mean relative throughput (current SIMD = 1.0×)",
    report,
    ratio: true,
  }), "tier-execution", { adaptive: false });

  const counts = variants[0].correctness.counts;
  if (counts) {
    render(groupedConfig({
      labels: variants.map(({ label }) => label.toUpperCase()),
      datasets: [
        { label: "Must accept", color: TIER_COLORS[1], data: variants.map(({ correctness }) => correctness.counts.valid) },
        { label: "Must reject", color: { bg: "rgba(248,51,60,0.82)", border: BASE.strawberryRed }, data: variants.map(({ correctness }) => correctness.counts.invalid) },
        { label: "Implementation-defined", color: TIER_COLORS[0], data: variants.map(({ correctness }) => correctness.counts.implementationDefined) },
      ],
      title: "RFC / JSONTestSuite coverage by parser tier",
      axisTitle: "Fixtures passed",
      report,
      stacked: true,
    }), "rfc-coverage", { adaptive: false });
  }
}

chartLazy();
chartParity();
chartRaw();
chartTiers();
