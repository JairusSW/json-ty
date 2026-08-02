import { RawBrowserBinding, createSchemaRegistry, instantiateRawBrowserBinding } from "./browser-binding.js";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

export async function runBrowserRuntimeTest() {
  const [wasmResponse, layoutsResponse] = await Promise.all([fetch("/build/raw/runtime.wasm"), fetch("/build/raw/schema-layouts.json")]);
  assert(wasmResponse.ok, `Wasm fetch failed with HTTP ${wasmResponse.status}`);
  assert(layoutsResponse.ok, `layout fetch failed with HTTP ${layoutsResponse.status}`);

  const schemas = createSchemaRegistry(await layoutsResponse.json());
  const options = { scratchCapacity: 1 << 20, heapReserve: 1 << 20 };
  const binding = await instantiateRawBrowserBinding(wasmResponse, options);
  assert(binding instanceof RawBrowserBinding, "browser factory returned the wrong binding type");
  assert(binding.buffer === null, "browser binding unexpectedly selected the Node Buffer codec");
  assert(binding.echo("browser café 世界 😀") === "browser café 世界 😀", "UTF-8 echo failed");

  const metricSchema = schemas.get("Metric");
  const metric = binding.parse(metricSchema, '{"id":7,"value":2.5,"label":"web 世界","ok":true}');
  assert(metric.id === 7 && metric.value === 2.5, "numeric fields did not round-trip");
  assert(metric.label === "web 世界" && metric.ok === true, "string/boolean fields did not round-trip");
  metric.label = "changed 😀";
  assert(binding.stringify(metricSchema, metric) === '{"id":7,"value":2.5,"label":"changed 😀","ok":true}', "mutated browser view did not serialize canonically");
  metric.dispose();

  const wasmBytes = new Uint8Array(await (await fetch("/build/raw/runtime.wasm")).arrayBuffer());
  const byteBinding = await instantiateRawBrowserBinding(wasmBytes, options);
  assert(byteBinding.echo("byte source") === "byte source", "byte-source instantiation failed");

  let rejectedMalformedUtf8 = false;
  try {
    byteBinding.parse(metricSchema, new Uint8Array([0x7b, 0x22, 0x80, 0x22, 0x7d]));
  } catch {
    rejectedMalformedUtf8 = true;
  }
  assert(rejectedMalformedUtf8, "browser byte ingress accepted malformed UTF-8");

  return {
    userAgent: navigator.userAgent,
    wasmSimd: WebAssembly.validate(new Uint8Array([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00, 0x01, 0x05, 0x01, 0x60, 0x00, 0x01, 0x7b, 0x03, 0x02, 0x01, 0x00, 0x0a, 0x16, 0x01, 0x14, 0x00, 0xfd, 0x0c, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x0b])),
  };
}
