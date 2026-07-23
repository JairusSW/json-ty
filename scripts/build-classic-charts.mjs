import { existsSync } from "node:fs";
import { generateClassicCharts, generateClassicV8Charts } from "./lib/classic-chart.mjs";

generateClassicCharts();
if (existsSync("build/logs/classic-v8.json")) generateClassicV8Charts();
