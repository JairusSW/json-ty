import * as ts from "typescript";
import type { TransformerExtras, PluginConfig } from "ts-patch";

class Property {
  public name: string = "";
  public node!: ts.ClassElement;
  public alias: string | null = null;
  public type: string | null = null;
  public value: ts.Expression | null = null;
  public parent!: Schema;
}

class Schema {
  public name: string = "";
  public node!: ts.ClassDeclaration;
  public members: Property[] = [];
  public parent: Schema | null = null;
  public deps: Schema[] = [];
}

class Options {
  public schema: Schema | null = null;
}

const opt = new Options();

export default function (program: ts.Program, pluginConfig: PluginConfig, { ts: t }: TransformerExtras) {
  return (ctx: ts.TransformationContext) => {
    const { factory } = ctx;

    return (sourceFile: ts.SourceFile) => {
      function visit(node: ts.Node): ts.Node {
        if (t.isClassDeclaration(node)) {
          const decorators = t.canHaveDecorators(node) ? t.getDecorators(node) : undefined;
          if (!decorators || decorators.length === 0) return node;

          const hasJsonDecorator = decorators.some(decorator => {
            const expr = decorator.expression;
            return (
              t.isIdentifier(expr) && expr.text === "json" ||
              (t.isCallExpression(expr) && t.isIdentifier(expr.expression) && expr.expression.text === "json")
            );
          });

          if (!hasJsonDecorator) return node;

          console.log("Found @json class:", node.name?.text);

          const newModifiers = node.modifiers
            ? factory.createNodeArray(node.modifiers.filter(mod => !t.isDecorator(mod)))
            : undefined;

          const className = node.name;
          if (!className) return node;

          const schema = new Schema();
          schema.node = node;
          schema.name = className.text;

          opt.schema = schema;

          const properties = node.members.filter(t.isPropertyDeclaration);
          const typeChecker = program.getTypeChecker();

          for (const member of properties) {
            const name = member.name?.getText(sourceFile) ?? "<unnamed>";
            const symbol = typeChecker.getSymbolAtLocation(member.name!);
            if (!symbol) continue;

            const type = typeChecker.getTypeOfSymbolAtLocation(symbol, member);
            const typeStr = typeChecker.typeToString(type);
            console.log(`  ${name} -> ${typeStr}`);
            const prop = new Property();
            prop.node = member;
            prop.name = name;
            prop.value = member.initializer || null;
            prop.parent = schema;
            prop.type = typeStr;
            schema.members.push(prop);
          }

          let serializeExpr: ts.Expression = factory.createStringLiteral("{");
          for (let i = 0; i < schema.members.length; i++) {
            const member = schema.members[i];
            const isFirst = i === 0;
            const isLast = i === schema.members.length - 1;
            const name = member.alias || member.name;

            if (member.type === "number" || member.type === "Number") {
              const serializeCall = factory.createCallExpression(
                factory.createPropertyAccessExpression(
                  factory.createIdentifier("__JSON_METHODS"),
                  factory.createIdentifier("serializeFloat"),
                ),
                undefined,
                [
                  factory.createPropertyAccessExpression(
                    factory.createIdentifier("self"),
                    factory.createIdentifier(member.name)
                  ),
                ]
              );
              const keyValue = factory.createBinaryExpression(
                factory.createStringLiteral(`${isFirst ? "" : ","}"${name}":`),
                factory.createToken(ts.SyntaxKind.PlusToken),
                serializeCall
              );
              serializeExpr = factory.createBinaryExpression(
                serializeExpr,
                factory.createToken(ts.SyntaxKind.PlusToken),
                keyValue
              );
            } else if (member.type === "string" || member.type === "String") {
              const serializeCall = factory.createCallExpression(
                factory.createPropertyAccessExpression(
                  factory.createIdentifier("__JSON_METHODS"),
                  factory.createIdentifier("serializeString"),
                ),
                undefined,
                [
                  factory.createPropertyAccessExpression(
                    factory.createIdentifier("self"),
                    factory.createIdentifier(member.name)
                  ),
                ]
              );
              const keyValue = factory.createBinaryExpression(
                factory.createStringLiteral(`${isFirst ? "" : ","}"${name}":`),
                factory.createToken(ts.SyntaxKind.PlusToken),
                serializeCall
              );
              serializeExpr = factory.createBinaryExpression(
                serializeExpr,
                factory.createToken(ts.SyntaxKind.PlusToken),
                keyValue
              );
            } else if (member.type === "boolean" || member.type === "Boolean") {
              const serializeCall = factory.createCallExpression(
                factory.createPropertyAccessExpression(
                  factory.createIdentifier("__JSON_METHODS"),
                  factory.createIdentifier("serializeBool"),
                ),
                undefined,
                [
                  factory.createPropertyAccessExpression(
                    factory.createIdentifier("self"),
                    factory.createIdentifier(member.name)
                  ),
                ]
              );
              const keyValue = factory.createBinaryExpression(
                factory.createStringLiteral(`${isFirst ? "" : ","}"${name}":`),
                factory.createToken(ts.SyntaxKind.PlusToken),
                serializeCall
              );
              serializeExpr = factory.createBinaryExpression(
                serializeExpr,
                factory.createToken(ts.SyntaxKind.PlusToken),
                keyValue
              );
            }
          };

          serializeExpr = factory.createBinaryExpression(
            serializeExpr,
            factory.createToken(ts.SyntaxKind.PlusToken),
            factory.createStringLiteral("}")
          );

          const serializeMethod = factory.createMethodDeclaration(
            [factory.createToken(ts.SyntaxKind.StaticKeyword)],
            undefined,
            factory.createIdentifier("__JSON_SERIALIZE"),
            undefined,
            undefined,
            [
              factory.createParameterDeclaration(
                undefined,
                undefined,
                factory.createIdentifier("self"),
                undefined,
                factory.createTypeReferenceNode(factory.createIdentifier(schema.name), undefined),
                undefined
              ),
            ],
            factory.createKeywordTypeNode(ts.SyntaxKind.StringKeyword),
            factory.createBlock(
              [
                factory.createReturnStatement(
                  schema.members.length === 0 ? factory.createStringLiteral("{}") : serializeExpr
                ),
              ],
              true
            )
          );

          const deserializeStatements: ts.Statement[] = [
            factory.createVariableStatement(
              undefined,
              factory.createVariableDeclarationList(
                [
                  factory.createVariableDeclaration(
                    factory.createIdentifier("obj"),
                    undefined,
                    undefined,
                    factory.createCallExpression(
                      factory.createPropertyAccessExpression(
                        factory.createIdentifier("JSON"),
                        factory.createIdentifier("parse")
                      ),
                      undefined,
                      [factory.createIdentifier("data")]
                    )
                  ),
                ],
                ts.NodeFlags.Const
              )
            ),
            factory.createVariableStatement(
              undefined,
              factory.createVariableDeclarationList(
                [
                  factory.createVariableDeclaration(
                    factory.createIdentifier("instance"),
                    undefined,
                    undefined,
                    factory.createNewExpression(
                      factory.createIdentifier(schema.name),
                      undefined,
                      []
                    )
                  ),
                ],
                ts.NodeFlags.Const
              )
            ),
          ];

          const deserializeMethod = factory.createMethodDeclaration(
            [factory.createToken(ts.SyntaxKind.StaticKeyword)],
            undefined,
            factory.createIdentifier("__JSON_DESERIALIZE"),
            undefined,
            undefined,
            [
              factory.createParameterDeclaration(
                undefined,
                undefined,
                factory.createIdentifier("data"),
                undefined,
                factory.createKeywordTypeNode(ts.SyntaxKind.StringKeyword),
                undefined
              ),
            ],
            factory.createTypeReferenceNode(factory.createIdentifier(schema.name), undefined),
            factory.createBlock(deserializeStatements, true)
          );

          const newMembers = factory.createNodeArray([...node.members, serializeMethod]);

          const updatedClass = factory.updateClassDeclaration(
            node,
            newModifiers,
            node.name,
            node.typeParameters,
            node.heritageClauses,
            newMembers
          );
          console.log("Transformed class:\n" + t.createPrinter().printNode(ts.EmitHint.Unspecified, updatedClass, sourceFile));

          return updatedClass;
        }

        return t.visitEachChild(node, visit, ctx);
      }

      let src = t.visitNode(sourceFile, visit) as ts.SourceFile;

      if (opt.schema) {
        opt.schema = null;
        console.log("Updating source file")
        src = factory.updateSourceFile(sourceFile, [
          factory.createImportDeclaration(
            undefined,
            factory.createImportClause(
              false,
              undefined,
              factory.createNamedImports([factory.createImportSpecifier(
                false,
                factory.createIdentifier("JSON"),
                factory.createIdentifier("__JSON")
              )])
            ),
            factory.createStringLiteral("./index.js"),
            undefined
          ),
          factory.createImportDeclaration(
            undefined,
            factory.createImportClause(
              false,
              undefined,
              factory.createNamespaceImport(factory.createIdentifier("__JSON_METHODS"))
            ),
            factory.createStringLiteral("./exports.js"),
            undefined
          ),
          ...src.statements
        ]);
      }

      return src;
    };
  };
}

console.log("Transformer initiated");