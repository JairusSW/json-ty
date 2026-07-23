import { readFileSync } from "node:fs";
import { assertCompleteClassicReport } from "./lib/classic-report.mjs";

const path = process.env.JSON_TY_CLASSIC_REPORT ?? "build/logs/classic.json";
const report = JSON.parse(readFileSync(path, "utf8"));
assertCompleteClassicReport(report, path);
console.log(`PASS ${path} contains the complete classic corpus and series matrix`);
