"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = default_1;
const util_1 = require("./util");
function default_1(program, pluginConfig, { ts: t }) {
  return (ctx) => {
    const { factory } = ctx;
    return (sourceFile) => {
      function visit(node) {
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
            console.log("  Decorator:", (0, util_1.nodeToString)(decorator));
          }
        }
        return t.visitEachChild(node, visit, ctx);
      }
      return t.visitNode(sourceFile, visit);
    };
  };
}
console.log("Transformer initiated");
