import assert from "node:assert/strict";
import ts from "typescript";
import { createProgramFromConfig } from "../../dist/compiler/program-analyzer.js";
import { createJsonTyTransformer } from "../../dist/compiler/call-transformer.js";

const program = createProgramFromConfig("compiler/fixtures/tsconfig.json");
const source = program.getSourceFiles().find((file) => file.fileName.endsWith("analyzer.ts"));
assert.ok(source);
const result = ts.transform(source, [
  createJsonTyTransformer(program, {
    runtimeIdentifier: "__rawJson",
    runtimeModule: "./generated/json-ty.runtime.js",
  }),
]);
const output = ts.createPrinter().printFile(result.transformed[0]);
result.dispose();

assert.match(output, /import \{ __jsonTyRuntime as __rawJson \}/);
assert.match(output, /__rawJson\.parsePlayer\("\{\}", Player\)/);
assert.match(output, /__rawJson\.stringifyPlayer\(player\)/);
assert.match(output, /__rawJson\.parsePlayerArray\("\[\]", Player\)/);
assert.match(output, /__rawJson\.stringifyPlayerArray\(players\)/);
assert.match(output, /__rawJson\.parseNumberJsonArray\("\[1,2\]"\)/i);
assert.match(output, /__rawJson\.parsestringValue\('""'\)/);
assert.match(output, /__rawJson\.stringifystringValue\(""\)/);
assert.match(output, /__rawJson\.parsenumberValue\("42"\)/);
assert.match(output, /__rawJson\.stringifynumberValue\(42\)/);
assert.match(output, /__rawJson\.parsebooleanValue\("true"\)/);
assert.match(output, /__rawJson\.stringifybooleanValue\(true\)/);
assert.match(output, /__rawJson\.parsenullValue\("null"\)/);
assert.match(output, /__rawJson\.stringifynullValue\(null\)/);
assert.match(output, /__rawJson\.parseDynamic\("\{\}"\)/);
assert.match(output, /__rawJson\.stringifyDynamic\(dynamicObject\)/);
assert.match(output, /@observed/);
assert.doesNotMatch(output, /@(json|alias|optional|omitnull|omitif|lazy|eager)\b/);
assert.doesNotMatch(output, /JSON\.schema</);

const directResult = ts.transform(source, [
  createJsonTyTransformer(program, {
    runtimeIdentifier: "__rawJson",
    runtimeModule: "./generated/json-ty.runtime.js",
    schemaBindings: {
      Player: { parse: "p0", stringify: "s0" },
      PlayerArray: { parse: "p1", stringify: "s1" },
      numberJsonArray: { parse: "p2", stringify: "s2" },
    },
  }),
]);
const directOutput = ts.createPrinter().printFile(directResult.transformed[0]);
directResult.dispose();
assert.match(directOutput, /p0 as (__jsonTy_p0(?:_\d+)?)/);
assert.match(directOutput, /s0 as __jsonTy_s0/);
const directParseIdentifier = directOutput.match(/p0 as (__jsonTy_p0(?:_\d+)?)/)?.[1];
assert.ok(directParseIdentifier);
assert.notEqual(directParseIdentifier, "__jsonTy_p0", "direct import must not shadow a user declaration");
assert.match(directOutput, new RegExp(`${directParseIdentifier}\\(\"\\{\\}\", Player\\)`));
assert.match(directOutput, /__jsonTy_s0\(player\)/);
assert.doesNotMatch(directOutput, /__rawJson\.parsePlayer\(/);
assert.match(directOutput, /__rawJson\.parseDynamic\(/);

console.log("typed call transformer: all tests passed");
