import {
  validatePublicationCharts,
  validatePublicationReports,
} from "./lib/benchmark-plan.mjs";

validatePublicationReports();
if (process.argv.includes("--charts")) validatePublicationCharts();
console.log(`benchmark publication contract: reports${process.argv.includes("--charts") ? " and charts" : ""} complete`);
