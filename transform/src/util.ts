import * as ts from "typescript";

export function nodeToString(node: ts.Node): string {
  const printer = ts.createPrinter();
  const file = ts.createSourceFile("temp.ts", "", ts.ScriptTarget.Latest, false, ts.ScriptKind.TS);

  return printer.printNode(ts.EmitHint.Unspecified, node, file);
}
