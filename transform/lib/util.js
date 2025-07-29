"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.nodeToString = nodeToString;
const ts = require("typescript");
function nodeToString(node) {
    const printer = ts.createPrinter();
    const file = ts.createSourceFile("temp.ts", "", ts.ScriptTarget.Latest, false, ts.ScriptKind.TS);
    return printer.printNode(ts.EmitHint.Unspecified, node, file);
}
