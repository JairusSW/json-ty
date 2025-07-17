import type * as ts from "typescript";
import type { TransformerExtras, PluginConfig } from "ts-patch";
import { nodeToString } from "./util";

export default function (program: ts.Program, pluginConfig: PluginConfig, { ts: t }: TransformerExtras) {
  return (ctx: ts.TransformationContext) => {
    const { factory } = ctx;

    return (sourceFile: ts.SourceFile) => {
      function visit(node: ts.Node): ts.Node {
        if (t.isClassDeclaration(node)) {
          if (!t.canHaveDecorators(node)) return node;

          const decorators = t.getDecorators(node);
          if (!decorators) return node;

          const hasJsonDecorator = decorators.some((decorator) => {
            const expr = decorator.expression;
            return (t.isIdentifier(expr) && expr.text === "json") || (t.isCallExpression(expr) && t.isIdentifier(expr.expression) && expr.expression.text === "json");
          });

          if (!hasJsonDecorator) return node;

          console.log("Found @json class:", node.name?.text);
          for (const decorator of decorators) {
            console.log("  Decorator:", nodeToString(decorator));
          }
        }

        return t.visitEachChild(node, visit, ctx);
      }

      return t.visitNode(sourceFile, visit);
    };
  };
}

console.log("Transformer initiated");
