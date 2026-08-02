import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";

const target = process.argv[2];
const supported = new Set(["chromium", "chrome", "firefox", "webkit", "edge", "safari"]);
if (!supported.has(target)) {
  throw new Error(`Expected one browser target: ${[...supported].join(", ")}`);
}

const root = resolve(".");
const contentTypes = new Map([
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".mjs", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".wasm", "application/wasm"],
]);
const server = createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
    const path = resolve(root, pathname.replace(/^\/+/, ""));
    if (path !== root && !path.startsWith(`${root}${sep}`)) {
      response.writeHead(403).end("forbidden");
      return;
    }
    const body = await readFile(path);
    response.writeHead(200, {
      "cache-control": "no-store",
      "content-type": contentTypes.get(extname(path)) ?? "application/octet-stream",
    });
    response.end(body);
  } catch (error) {
    response.writeHead(error?.code === "ENOENT" ? 404 : 500).end(String(error));
  }
});

await new Promise((resolveListen, reject) => {
  server.once("error", reject);
  server.listen(0, "127.0.0.1", resolveListen);
});
const { port } = server.address();
const url = `http://127.0.0.1:${port}/src/raw/browser-runtime.test.html`;

try {
  const result = target === "safari" ? await runSafari(url) : await runPlaywright(url, target);
  if (result.status !== "passed") throw new Error(result.message ?? JSON.stringify(result));
  console.log(`${target} browser runtime: all tests passed (${result.details.userAgent})`);
} finally {
  await new Promise((resolveClose) => server.close(resolveClose));
}

async function runPlaywright(url, browserName) {
  const playwright = await import("playwright");
  const configuration = {
    chromium: [playwright.chromium, undefined],
    chrome: [playwright.chromium, "chrome"],
    firefox: [playwright.firefox, undefined],
    webkit: [playwright.webkit, undefined],
    edge: [playwright.chromium, "msedge"],
  }[browserName];
  const [browserType, channel] = configuration;
  const browser = await browserType.launch({ headless: true, ...(channel ? { channel } : {}) });
  try {
    const page = await browser.newPage();
    page.on("console", (message) => console.log(`[browser] ${message.text()}`));
    page.on("pageerror", (error) => console.error(`[browser] ${error.stack ?? error.message}`));
    await page.goto(url, { waitUntil: "load" });
    await page.waitForFunction(() => globalThis.__jsonTyBrowserTest !== undefined && globalThis.__jsonTyBrowserTest.status !== "running", undefined, { timeout: 60_000 });
    return await page.evaluate(() => globalThis.__jsonTyBrowserTest);
  } finally {
    await browser.close();
  }
}

async function runSafari(url) {
  const { Builder } = await import("selenium-webdriver");
  const driver = await new Builder().forBrowser("safari").build();
  try {
    await driver.get(url);
    await driver.wait(async () => driver.executeScript("return globalThis.__jsonTyBrowserTest?.status !== 'running'"), 60_000);
    return driver.executeScript("return globalThis.__jsonTyBrowserTest");
  } finally {
    await driver.quit();
  }
}
