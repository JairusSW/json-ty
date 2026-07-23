import { classicCorpora, classicSeries } from "../../bench/classic/manifest.mjs";

export function assertCompleteClassicReport(report, label = "classic benchmark report") {
  const minPayloads = new Set(
    report.payloads
      .filter(({ format }) => format === "min")
      .map(({ key }) => key),
  );
  const measurements = new Set(
    report.results
      .filter(({ format, benchmark }) => format === "min" && benchmark === null)
      .map(({ payload, kind, series }) => `${payload}:${kind}:${series}`),
  );
  const missing = [];

  for (const corpus of classicCorpora) {
    if (!minPayloads.has(corpus.key)) missing.push(`${corpus.key}:min payload`);
    for (const kind of ["deserialize", "serialize"]) {
      for (const [series] of classicSeries[kind]) {
        if (!measurements.has(`${corpus.key}:${kind}:${series}`)) {
          missing.push(`${corpus.key}:${kind}:${series}`);
        }
      }
    }
  }

  if (missing.length !== 0) {
    throw new Error(
      `${label} is partial; refusing to publish a misleading chart. Missing:\n- ${missing.join("\n- ")}`,
    );
  }
}

