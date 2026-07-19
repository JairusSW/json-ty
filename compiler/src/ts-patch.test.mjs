import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const temporary = mkdtempSync(join(tmpdir(), "json-ty-ts-patch-"));
const sourcePath = join(temporary, "input.ts");
const declarationsPath = join(temporary, "json-ty.d.ts");
const companionTransformPath = join(temporary, "companion-transform.mjs");
const configPath = join(temporary, "tsconfig.json");
const generatedDirectory = join(temporary, "generated");
const outputDirectory = join(temporary, "dist");
const jsonTyTransformPath = resolve("compiler/lib/ts-patch.js");
const tspcPath = resolve("node_modules/ts-patch/bin/tspc.js");

const resolverModules = join(temporary, "node_modules");
mkdirSync(resolverModules);
symlinkSync(resolve("."), join(resolverModules, "json-ty"), "dir");
assert.equal(
  createRequire(join(temporary, "package-resolver.cjs")).resolve("json-ty/transform"),
  jsonTyTransformPath,
  "the public transform export must be resolvable by ts-patch's CommonJS resolver",
);

writeFileSync(declarationsPath, `
declare module "json-ty" {
  export function json<T extends new (...args: any[]) => any>(value: T): T;
  export namespace JSON {
    function parse<T>(input: string | Uint8Array): T;
    function stringify<T>(value: T): string;
  }
}
`);
writeFileSync(sourcePath, `
import { JSON, json } from "json-ty";

@json
export class Vec3 {
  x = 0;
  y = 0;
  z = 0;
}

export const marker = "companion-before";
export const vector = JSON.parse<Vec3>("{\\"x\\":1,\\"y\\":2,\\"z\\":3}");
export const encoded = JSON.stringify<Vec3>(vector);
`);
writeFileSync(companionTransformPath, `
export default function companionTransform(_program, _config, { ts }) {
  return (context) => {
    const visit = (node) => {
      if (ts.isStringLiteral(node) && node.text === "companion-before") {
        return context.factory.createStringLiteral("companion-after");
      }
      return ts.visitEachChild(node, visit, context);
    };
    return (sourceFile) => ts.visitNode(sourceFile, visit);
  };
}
`);
writeFileSync(configPath, JSON.stringify({
  compilerOptions: {
    target: "ES2022",
    module: "NodeNext",
    moduleResolution: "NodeNext",
    rootDir: temporary,
    outDir: outputDirectory,
    strict: true,
    experimentalDecorators: true,
    plugins: [
      {
        transform: jsonTyTransformPath,
        generatedDirectory,
      },
      {
        transform: companionTransformPath,
      },
    ],
  },
  files: [declarationsPath, sourcePath],
}, null, 2));

function compile() {
  const result = spawnSync(process.execPath, [tspcPath, "-p", configPath], {
    cwd: resolve("."),
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return readFileSync(join(outputDirectory, "input.js"), "utf8");
}

const firstOutput = compile();
assert.match(firstOutput, /companion-after/, "later ts-patch transforms must still run");
assert.doesNotMatch(firstOutput, /companion-before/);
assert.doesNotMatch(firstOutput, /JSON\.parse/);
assert.doesNotMatch(firstOutput, /JSON\.stringify/);
assert.match(firstOutput, /require\([^)]*generated\/runtime\.js[^)]*\)/);
assert.ok(existsSync(join(generatedDirectory, "runtime.wasm")));
assert.ok(existsSync(join(generatedDirectory, "runtime.js")));
const manifest = JSON.parse(readFileSync(join(generatedDirectory, "schema-manifest.json"), "utf8"));
assert.deepEqual(manifest.schemas.map((schema) => schema.name), ["Vec3"]);

const secondOutput = compile();
assert.equal(secondOutput, firstOutput, "cache hits must produce deterministic TypeScript output");

console.log("ts-patch build/composition integration: all tests passed");
