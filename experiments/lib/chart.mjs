// chart.js charting — ported from json-as scripts/lib/bench-utils.ts (same
// author, MIT), adapted to take raw per-series numbers instead of BenchResult.
import fs from "fs";
import { execSync } from "child_process";
import { ChartJSNodeCanvas } from "chartjs-node-canvas";
import ChartDataLabels from "chartjs-plugin-datalabels";
import { MODE_BARS, INK } from "./palette.mjs";

function sh(cmd) { try { return execSync(cmd).toString().trim(); } catch { return "?"; } }

export function subtitle() {
  const root = new URL("../../package.json", import.meta.url);
  let version = "?";
  try { version = "v" + JSON.parse(fs.readFileSync(root, "utf-8")).version; } catch {}
  const hash = sh("git rev-parse --short HEAD");
  const branch = sh("git rev-parse --abbrev-ref HEAD");
  return `${new Date().toDateString()} • ${version} • node ${process.version} • ${hash} • ${branch}`;
}

/**
 * Grouped bar chart.
 * @param {Record<string, number[]>} data  payload -> per-series values
 * @param {Record<string, string>} payloadLabels  payload -> x-axis label
 * @param {object} options  { title, yLabel, xLabel, datasetLabels, colors,
 *                            yStep, unit, labelAnchor, labelFontSize, valueFormat }
 */
export function createBarChart(data, payloadLabels, options) {
  const payloadKeys = Object.keys(data);
  const labels = payloadKeys.map((k) => payloadLabels[k] ?? k);
  const maxV = Math.max(...Object.values(data).flat());

  const yStep = options.yStep ?? niceStep(maxV);
  const yMax = Math.ceil((maxV + yStep / 2) / yStep) * yStep;

  const datasetNames = options.datasetLabels ?? [];
  const palette = options.colors ?? MODE_BARS;
  const numDatasets = Math.max(...payloadKeys.map((k) => data[k].length));
  const fmt = options.valueFormat ?? ((v) => v.toFixed(0));

  return {
    type: "bar",
    data: {
      labels,
      datasets: Array.from({ length: numDatasets }, (_, i) => ({
        label: datasetNames[i] ?? `Series ${i + 1}`,
        data: payloadKeys.map((k) => data[k][i] ?? 0),
        backgroundColor: palette[i % palette.length].bg,
        borderColor: palette[i % palette.length].border,
        borderWidth: 1,
      })),
    },
    options: {
      responsive: true,
      layout: { padding: { bottom: 22, left: 6, right: 6, top: 4 } },
      plugins: {
        title: { display: !!options.title, text: options.title, font: { size: 20, weight: "bold" } },
        legend: { position: "top", labels: { font: { size: 16, weight: "bold" }, padding: 20 } },
        datalabels: {
          anchor: options.labelAnchor ?? "end",
          align: "end",
          font: { weight: "bold", size: options.labelFontSize ?? 12 },
          color: INK.label,
          formatter: fmt,
        },
        subtitle: {
          display: true, text: subtitle(), font: { size: 14, weight: "bold" },
          color: INK.subtitle, padding: 16, position: "right",
        },
      },
      scales: {
        y: {
          beginAtZero: true, max: yMax,
          title: { display: true, text: options.yLabel ?? "Throughput (MB/s)", font: { size: 16, weight: "bold" } },
          ticks: { stepSize: yStep, font: { size: 14, weight: "bold" } },
          grid: { color: INK.grid },
        },
        x: {
          title: { display: !!options.xLabel, text: options.xLabel ?? "", font: { size: 16, weight: "bold" } },
          ticks: { maxRotation: 0, minRotation: 0, font: { size: 14, weight: "bold" } },
          grid: { color: INK.grid },
        },
      },
    },
    plugins: [ChartDataLabels],
  };
}

function niceStep(maxV) {
  const target = maxV / 6;
  const mag = 10 ** Math.floor(Math.log10(target));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * mag >= target) return m * mag;
  return 10 * mag;
}

/**
 * Multi-series line chart (e.g. throughput vs payload size).
 * @param {string[]} labels  x-axis category labels
 * @param {{label,data:number[],color}[]} series
 * @param {object} options  { title, xLabel, yLabel, logY }
 */
export function createLineChart(labels, series, options) {
  return {
    type: "line",
    data: {
      labels,
      datasets: series.map((s) => ({
        label: s.label,
        data: s.data,
        borderColor: s.color,
        backgroundColor: s.color,
        borderWidth: 3,
        tension: 0.25,
        pointRadius: 4,
      })),
    },
    options: {
      responsive: true,
      layout: { padding: { bottom: 8, left: 6, right: 6, top: 4 } },
      plugins: {
        title: { display: true, text: options.title, font: { size: 20, weight: "bold" } },
        legend: { position: "top", labels: { font: { size: 14, weight: "bold" }, padding: 16 } },
        datalabels: { display: false },
        subtitle: {
          display: true, text: subtitle(), font: { size: 14, weight: "bold" },
          color: INK.subtitle, padding: 16, position: "right",
        },
      },
      scales: {
        x: {
          title: { display: true, text: options.xLabel, font: { size: 16, weight: "bold" } },
          ticks: { font: { size: 13, weight: "bold" } }, grid: { color: INK.grid },
        },
        y: {
          type: options.logY ? "logarithmic" : "linear",
          beginAtZero: !options.logY,
          title: { display: true, text: options.yLabel, font: { size: 16, weight: "bold" } },
          ticks: { font: { size: 13, weight: "bold" } }, grid: { color: INK.grid },
        },
      },
    },
  };
}

export function generateChart(config, outfile) {
  const isSvg = outfile.endsWith(".svg");
  if (!isSvg) config.options = { ...(config.options ?? {}), devicePixelRatio: 3 };
  const canvas = new ChartJSNodeCanvas({
    width: 1000, height: 600, type: isSvg ? "svg" : "png",
    backgroundColour: "#ffffff",
    chartCallback: (ChartJS) => ChartJS.register(ChartDataLabels),
  });
  const buffer = canvas.renderToBufferSync(config, isSvg ? "image/svg+xml" : "image/png");
  fs.writeFileSync(outfile, buffer);
  console.log(`> ${outfile}`);
}
