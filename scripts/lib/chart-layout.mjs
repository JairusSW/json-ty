export const CHART_BOTTOM_PADDING = 24;

export function measuredChartLabel(label) {
  return typeof label === "string" && label.includes("\n")
    ? label.split("\n")
    : label;
}

export function measuredChartLabels(labels) {
  return labels.map(measuredChartLabel);
}
