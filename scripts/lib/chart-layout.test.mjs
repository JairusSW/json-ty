import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import { createCanvas, loadImage } from "canvas";
import { measuredChartLabel } from "./chart-layout.mjs";

assert.deepEqual(measuredChartLabel("Small Payload\n(108b)"), ["Small Payload", "(108b)"]);
assert.equal(measuredChartLabel("Small Payload"), "Small Payload");

const chartDirectory = process.argv[2] ?? "build/charts";
const minimumCssMargin = 12;
const devicePixelRatio = 3;
const failures = [];

for (const name of readdirSync(chartDirectory).filter((entry) => entry.endsWith(".png")).sort()) {
  const image = await loadImage(`${chartDirectory}/${name}`);
  const canvas = createCanvas(image.width, image.height);
  const context = canvas.getContext("2d");
  context.drawImage(image, 0, 0);
  const pixels = context.getImageData(0, 0, image.width, image.height).data;
  let lastInkRow = -1;

  outer:
  for (let y = image.height - 1; y >= 0; y--) {
    for (let x = 0; x < image.width; x++) {
      const offset = (y * image.width + x) * 4;
      if (
        pixels[offset] < 245 ||
        pixels[offset + 1] < 245 ||
        pixels[offset + 2] < 245
      ) {
        lastInkRow = y;
        break outer;
      }
    }
  }

  const cssMargin = (image.height - 1 - lastInkRow) / devicePixelRatio;
  if (cssMargin < minimumCssMargin) {
    failures.push(`${name}: ${cssMargin.toFixed(1)}px`);
  }
}

assert.deepEqual(
  failures,
  [],
  `charts need at least ${minimumCssMargin}px of bottom whitespace; found ${failures.join(", ")}`,
);

console.log(`chart layout: all PNG charts retain at least ${minimumCssMargin}px of bottom whitespace`);
