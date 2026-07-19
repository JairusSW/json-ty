function quantile(sorted, percentile) {
  const position = (sorted.length - 1) * percentile;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  const weight = position - lower;
  return sorted[lower] + (sorted[upper] - sorted[lower]) * weight;
}

export function detectExtremeUpperTail(input) {
  const values = input.filter((value) => Number.isFinite(value) && value > 0).sort((a, b) => a - b);
  if (values.length < 6) return null;

  const q1 = quantile(values, 0.25);
  const median = quantile(values, 0.5);
  const q3 = quantile(values, 0.75);
  const iqr = q3 - q1;
  const deviations = values.map((value) => Math.abs(value - median)).sort((a, b) => a - b);
  const mad = quantile(deviations, 0.5);
  const fences = [];
  if (iqr > 0) fences.push(q3 + 3 * iqr);
  if (mad > 0) fences.push(median + 6 * mad);
  if (fences.length === 0 && median > 0) fences.push(median * 4);
  if (fences.length === 0) return null;

  const firstOutlierIndex = values.findIndex((value) => value > Math.min(...fences));
  if (firstOutlierIndex <= 0) return null;
  const outlierCount = values.length - firstOutlierIndex;
  if (outlierCount / values.length > 0.2) return null;
  const normalMax = values[firstOutlierIndex - 1];
  const firstOutlier = values[firstOutlierIndex];
  // A modestly faster bar is still part of the chart's readable population.
  // Reserve log10 for a genuinely huge, sparse discontinuity.
  if (firstOutlier / normalMax < 4) return null;
  return { firstOutlier, outlierCount };
}

function record(value) {
  return value && typeof value === "object" ? value : {};
}

export function withAdaptiveLogScale(config) {
  if (config.type !== "bar" && config.type !== "line") return config;
  const options = record(config.options);
  const horizontal = config.type === "bar" && options.indexAxis === "y";
  const values = (config.data?.datasets ?? []).flatMap((dataset) =>
    (dataset.data ?? [])
      .map((point) => {
        if (typeof point === "number") return point;
        return point?.[horizontal ? "x" : "y"];
      })
      .filter((value) => Number.isFinite(value) && value > 0),
  );
  if (values.length === 0 || !detectExtremeUpperTail(values)) return config;

  const axisKey = horizontal ? "x" : "y";
  const scales = record(options.scales);
  const axis = record(scales[axisKey]);
  const ticks = record(axis.ticks);
  const title = record(axis.title);
  const logarithmicAxis = {
    ...axis,
    type: "logarithmic",
    beginAtZero: false,
    grace: "10%",
    suggestedMax: Math.max(...values) * (horizontal ? 2 : 1.25),
    title: title.text ? { ...title, text: `${title.text} · log10 scale` } : axis.title,
    ticks: {
      ...ticks,
      callback(value) {
        const numeric = Number(value);
        if (!Number.isFinite(numeric) || numeric <= 0) return "";
        const magnitude = 10 ** Math.floor(Math.log10(numeric));
        const mantissa = numeric / magnitude;
        return [1, 2, 5].some((candidate) => Math.abs(mantissa - candidate) < 1e-8) ? numeric.toLocaleString("en-US") : "";
      },
    },
  };
  delete logarithmicAxis.max;
  delete logarithmicAxis.ticks.stepSize;
  return { ...config, options: { ...options, scales: { ...scales, [axisKey]: logarithmicAxis } } };
}
