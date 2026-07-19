import assert from "node:assert/strict";
import { detectExtremeUpperTail } from "./chart-outliers.mjs";

assert.equal(detectExtremeUpperTail([100, 110, 120, 130, 140, 180]), null);
assert.equal(detectExtremeUpperTail([100, 100, 105, 110, 115, 399]), null);
assert.deepEqual(detectExtremeUpperTail([100, 100, 105, 110, 115, 500]), {
  firstOutlier: 500,
  outlierCount: 1,
});
assert.equal(detectExtremeUpperTail([100, 100, 100, 10_000, 11_000, 12_000]), null);

console.log("chart outlier detection: all tests passed");
