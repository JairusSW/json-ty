import * as ts from "typescript";
import type { TransformerExtras, PluginConfig } from "ts-patch";
import { nodeToString } from "./util";


class Property {
  public name: string = "";
  public node!: ts.ClassElement;
  public alias: string | null = null;
  public omit: boolean = false;
  public omitif: ts.ArrowFunction | null = null;
  public protected: boolean = false;
  public type: PropertyType | null = null;
  public value: ts.Expression | null = null;
  public parent!: Schema;
}

class PropertyType {
  public node!: ts.Type;
  public text!: string;
  public rawText!: string;
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
  public schemas: Schema[] = [];
}

const self = new Options();

export default function (program: ts.Program, pluginConfig: PluginConfig, { ts: t }: TransformerExtras) {
  return (ctx: ts.TransformationContext) => {
    const { factory } = ctx;

    return (sourceFile: ts.SourceFile) => {
      function visit(node: ts.Node): ts.Node {
        if (t.isClassDeclaration(node)) {
          const decorators = t.canHaveDecorators(node) ? t.getDecorators(node) : undefined;
          if (!decorators || decorators.length === 0) return node;

          const hasJsonDecorator = decorators.some((decorator) => {
            const expr = decorator.expression;
            return (t.isIdentifier(expr) && expr.text === "json") || (t.isCallExpression(expr) && t.isIdentifier(expr.expression) && expr.expression.text === "json");
          });

          if (!hasJsonDecorator) return node;

          console.log("Found @json class:", node.name?.text);

          const className = node.name;
          if (!className) return node;

          const schema = new Schema();
          schema.node = node;
          schema.name = className.text;

          self.schemas.push(schema)
          self.schema = schema;

          const properties = node.members.filter(t.isPropertyDeclaration);
          const checker = program.getTypeChecker();

          let newMembers = [...node.members];

          for (const member of properties) {
            const name = member.name?.getText(sourceFile) ?? "<unnamed>";
            const symbol = checker.getSymbolAtLocation(member.name!);
            if (!symbol) continue;

            const prop = new Property();
            prop.node = member;
            prop.name = name;
            prop.value = member.initializer || null;
            prop.parent = schema;

            prop.type = new PropertyType();
            prop.type.node = checker.getTypeOfSymbolAtLocation(symbol, member);
            prop.type.text = checker.typeToString(prop.type.node);

            if (t.isPropertyDeclaration(member) && member.type) {
              prop.type.rawText = member.type.getText(sourceFile).trim();
            } else {
              prop.type.rawText = prop.type.text;
            }

            if (member.modifiers) {
              for (const mod of member.modifiers) {
                if (mod.kind === t.SyntaxKind.PrivateKeyword) {
                  prop.omit = true;
                } else if (mod.kind === t.SyntaxKind.ProtectedKeyword) {
                  prop.protected = true;
                }
              }
            }
            const decorators = t.canHaveDecorators(member) ? t.getDecorators(member) : undefined;
            if (decorators) {
              // Collect all decorators **except** `@alias(...)`
              const newDecorators: ts.Decorator[] = [];

              for (const decorator of decorators) {
                const expr = decorator.expression;

                if (
                  t.isCallExpression(expr) &&
                  t.isIdentifier(expr.expression) &&
                  expr.expression.text === "alias" &&
                  expr.arguments.length === 1 &&
                  t.isStringLiteral(expr.arguments[0])
                ) {
                  prop.alias = expr.arguments[0].text;
                  console.log("  [alias] " + prop.name + " -> " + prop.alias);
                } else if (
                  t.isCallExpression(expr) &&
                  t.isIdentifier(expr.expression) &&
                  expr.expression.text === "omitif" &&
                  expr.arguments.length === 1 &&
                  t.isArrowFunction(expr.arguments[0])
                ) {
                  console.log("  [omitif] " + prop.name);
                  prop.omitif = expr.arguments[0];

                  const param = expr.arguments[0].parameters[0];
                  const paramName = param.name.getText(sourceFile);
                  const paramType = param.type;

                  if (expr.arguments[0].body.kind !== t.SyntaxKind.Block && paramName !== "self") {
                    throw new Error(
                      `@omitif condition for property "${prop.name}" must have first parameter named "self". Got "${paramName}".`
                    );
                  }

                  if (!paramType || !t.isTypeReferenceNode(paramType) || paramType.typeName.getText(sourceFile) !== schema.name) {
                    const found = paramType?.getText(sourceFile) ?? "<missing>";
                    throw new Error(
                      `@omitif condition for property "${prop.name}" must have type "${schema.name}" on its first parameter. Got "${found}".`
                    );
                  }
                } else if (
                  t.isIdentifier(expr) &&
                  expr.text === "omit"
                ) {
                  console.log("  [omit] " + prop.name);
                  prop.omit = true;
                } else {
                  newDecorators.push(decorator);
                }
              }


              newMembers[newMembers.indexOf(member)] = factory.createPropertyDeclaration(
                undefined, // TODO: Users should be able to use their own decorators
                member.name,
                member.questionToken || member.exclamationToken,
                member.type,
                member.initializer
              )
            }

            schema.members.push(prop);
          }

          let serializeExpr: ts.Expression = factory.createStringLiteral("{");
          for (let i = 0; i < schema.members.length; i++) {
            const member = schema.members[i];
            const isFirst = i === 0;
            const isLast = i === schema.members.length - 1;
            const name = member.alias || member.name;

            const typeName = member.type?.text;
            const rawTypeName = member.type?.rawText;

            if (member.omit) continue;

            let chunk: ts.BinaryExpression | ts.ParenthesizedExpression | null = null;
            console.log(name + " -> " + rawTypeName);
            if (typeName == "number" || typeName == "Number") {
              if (rawTypeName == "int") {
                const call = factory.createCallExpression(factory.createPropertyAccessExpression(factory.createIdentifier("__JSON_METHODS"), factory.createIdentifier("serializeInteger")), undefined, [factory.createPropertyAccessExpression(factory.createIdentifier("self"), factory.createIdentifier(member.name))]);
                chunk = factory.createBinaryExpression(factory.createStringLiteral(`${isFirst ? "" : ","}"${name}":`), factory.createToken(t.SyntaxKind.PlusToken), call);
              } else {
                const serializeCall = factory.createCallExpression(factory.createPropertyAccessExpression(factory.createIdentifier("__JSON_METHODS"), factory.createIdentifier("serializeFloat")), undefined, [factory.createPropertyAccessExpression(factory.createIdentifier("self"), factory.createIdentifier(member.name))]);
                chunk = factory.createBinaryExpression(factory.createStringLiteral(`${isFirst ? "" : ","}"${name}":`), factory.createToken(t.SyntaxKind.PlusToken), serializeCall);
              }
            } else if (typeName === "string" || typeName === "String") {
              const call = factory.createCallExpression(factory.createPropertyAccessExpression(factory.createIdentifier("__JSON_METHODS"), factory.createIdentifier("serializeString")), undefined, [factory.createPropertyAccessExpression(factory.createIdentifier("self"), factory.createIdentifier(member.name))]);
              chunk = factory.createBinaryExpression(factory.createStringLiteral(`${isFirst ? "" : ","}"${name}":`), factory.createToken(t.SyntaxKind.PlusToken), call);
            } else if (typeName === "boolean" || typeName === "Boolean") {
              const call = factory.createCallExpression(factory.createPropertyAccessExpression(factory.createIdentifier("__JSON_METHODS"), factory.createIdentifier("serializeBool")), undefined, [factory.createPropertyAccessExpression(factory.createIdentifier("self"), factory.createIdentifier(member.name))]);
              chunk = factory.createBinaryExpression(factory.createStringLiteral(`${isFirst ? "" : ","}"${name}":`), factory.createToken(t.SyntaxKind.PlusToken), call);
            } else if (typeName!.startsWith("Array<") || typeName!.endsWith("[]")) {
              const call = factory.createCallExpression(factory.createPropertyAccessExpression(factory.createIdentifier("__JSON_METHODS"), factory.createIdentifier("serializeArray")), undefined, [factory.createPropertyAccessExpression(factory.createIdentifier("self"), factory.createIdentifier(member.name))]);
              chunk = factory.createBinaryExpression(factory.createStringLiteral(`${isFirst ? "" : ","}"${name}":`), factory.createToken(t.SyntaxKind.PlusToken), call);
            } else if (self.schemas.map((v) => v.name == typeName?.split("<")[0])) {
              const call = factory.createCallExpression(factory.createPropertyAccessExpression(factory.createIdentifier("__JSON_METHODS"), factory.createIdentifier("serializeStruct")), undefined, [factory.createPropertyAccessExpression(factory.createIdentifier("self"), factory.createIdentifier(member.name)), factory.createIdentifier(stripNull(member.type?.text!))]);
              chunk = factory.createBinaryExpression(factory.createStringLiteral(`${isFirst ? "" : ","}"${name}":`), factory.createToken(t.SyntaxKind.PlusToken), call);
            } else {
              const call = factory.createCallExpression(factory.createPropertyAccessExpression(factory.createIdentifier("__JSON"), factory.createIdentifier("stringify")), undefined, [factory.createPropertyAccessExpression(factory.createIdentifier("self"), factory.createIdentifier(member.name))]);
              chunk = factory.createBinaryExpression(factory.createStringLiteral(`${isFirst ? "" : ","}"${name}":`), factory.createToken(t.SyntaxKind.PlusToken), call);
            }
            if (!chunk) continue;

            if (member.omitif) {
              if (member.omitif.body.kind !== t.SyntaxKind.Block) {
                chunk = factory.createParenthesizedExpression(
                  factory.createBinaryExpression(
                    factory.createParenthesizedExpression(
                      factory.createBinaryExpression(
                        factory.createPrefixUnaryExpression(
                          t.SyntaxKind.ExclamationToken,
                          factory.createParenthesizedExpression(
                            member.omitif.body
                          )
                        ),
                        factory.createToken(t.SyntaxKind.AmpersandAmpersandToken),
                        chunk
                      )
                    ),
                    factory.createToken(t.SyntaxKind.BarBarToken),
                    factory.createStringLiteral("", false)
                  )
                )
              } else {
                chunk = factory.createParenthesizedExpression(
                  factory.createBinaryExpression(factory.createParenthesizedExpression(
                    factory.createBinaryExpression(
                      factory.createCallExpression(
                        factory.createParenthesizedExpression(member.omitif),
                        undefined,
                        [factory.createIdentifier("self")]
                      ),
                      factory.createToken(t.SyntaxKind.AmpersandAmpersandToken),
                      chunk
                    )
                  ),
                    factory.createToken(t.SyntaxKind.BarBarToken),
                    factory.createStringLiteral("", false)
                  )
                )
              }
              serializeExpr = factory.createBinaryExpression(serializeExpr, factory.createToken(t.SyntaxKind.PlusToken), chunk);
            } else {
              serializeExpr = factory.createBinaryExpression(serializeExpr, factory.createToken(t.SyntaxKind.PlusToken), chunk);
            }
          }

          serializeExpr = factory.createBinaryExpression(serializeExpr, factory.createToken(t.SyntaxKind.PlusToken), factory.createStringLiteral("}"));

          let instantiateStmts: ts.Statement[] = [];

          const instantiateMethod = factory.createMethodDeclaration(
            [factory.createToken(t.SyntaxKind.StaticKeyword)],
            undefined,
            factory.createIdentifier("__JSON_INSTANTIATE"),
            undefined,
            undefined,
            [],
            factory.createTypeReferenceNode(
              schema.node.name!,
              undefined
            ),
            factory.createBlock(
              [
                factory.createVariableStatement(
                  undefined,
                  factory.createVariableDeclarationList(
                    [factory.createVariableDeclaration(
                      factory.createIdentifier("o"),
                      undefined,
                      undefined,
                      factory.createNewExpression(
                        schema.node.name!,
                        undefined,
                        []
                      )
                    )],
                    t.NodeFlags.Const
                  )
                ),
                factory.createReturnStatement(factory.createIdentifier("o"))
              ],
              true
            )
          )


          const serializeMethod = factory.createMethodDeclaration([factory.createToken(t.SyntaxKind.StaticKeyword)], undefined, factory.createIdentifier("__JSON_SERIALIZE"), undefined, undefined, [factory.createParameterDeclaration(undefined, undefined, factory.createIdentifier("self"), undefined, factory.createTypeReferenceNode(factory.createIdentifier(schema.name), undefined), undefined)], factory.createKeywordTypeNode(t.SyntaxKind.StringKeyword), factory.createBlock([factory.createReturnStatement(schema.members.length === 0 ? factory.createStringLiteral("{}") : serializeExpr)], true));

          const deserializeStatements: ts.Statement[] = [factory.createVariableStatement(undefined, factory.createVariableDeclarationList([factory.createVariableDeclaration(factory.createIdentifier("obj"), undefined, undefined, factory.createCallExpression(factory.createPropertyAccessExpression(factory.createIdentifier("JSON"), factory.createIdentifier("parse")), undefined, [factory.createIdentifier("data")]))], t.NodeFlags.Const)), factory.createVariableStatement(undefined, factory.createVariableDeclarationList([factory.createVariableDeclaration(factory.createIdentifier("instance"), undefined, undefined, factory.createNewExpression(factory.createIdentifier(schema.name), undefined, []))], t.NodeFlags.Const))];

          const deserializeMethod = factory.createMethodDeclaration([factory.createToken(t.SyntaxKind.StaticKeyword)], undefined, factory.createIdentifier("__JSON_DESERIALIZE"), undefined, undefined, [factory.createParameterDeclaration(undefined, undefined, factory.createIdentifier("data"), undefined, factory.createKeywordTypeNode(t.SyntaxKind.StringKeyword), undefined)], factory.createTypeReferenceNode(factory.createIdentifier(schema.name), undefined), factory.createBlock(deserializeStatements, true));

          newMembers = [...newMembers, instantiateMethod, serializeMethod, deserializeMethod];

          const newModifiers = node.modifiers ? factory.createNodeArray(node.modifiers.filter((mod) => !t.isDecorator(mod))) : undefined;

          const updatedClass = factory.updateClassDeclaration(node, newModifiers, node.name, node.typeParameters, node.heritageClauses, factory.createNodeArray(newMembers));
          console.log("Transformed class:\n" + t.createPrinter().printNode(t.EmitHint.Unspecified, updatedClass, sourceFile));

          return t.visitNode(updatedClass, visit);
        }
        // else if (t.isCallExpression(node)) {
        //   if (
        //     t.isPropertyAccessExpression(node.expression) &&
        //     t.isIdentifier(node.expression.expression) &&
        //     node.expression.expression.text === "JSONT" &&
        //     node.expression.name.text === "parse" &&
        //     node.typeArguments &&
        //     node.typeArguments.length === 1
        //   ) {
        //     const typeArg = node.typeArguments[0];

        //     if (t.isTypeReferenceNode(typeArg) && t.isIdentifier(typeArg.typeName)) {
        //       const typeName = typeArg.typeName.text;

        //       if (opt.schema && opt.schema.name === typeName) {
        //         const newCall = factory.updateCallExpression(
        //           node,
        //           node.expression,
        //           undefined,
        //           [
        //             node.arguments[0],
        //             factory.createIdentifier(typeName),
        //           ]
        //         );
        //         console.log("Updated: " + nodeToString(newCall))
        //         // return newCall;
        //       }
        //     }
        //   }
        // }

        return t.visitEachChild(node, visit, ctx);
      }

      let src = t.visitNode(sourceFile, visit) as ts.SourceFile;

      if (self.schema) {
        self.schema = null;
        console.log("Updating source file");
        src = factory.updateSourceFile(sourceFile, [factory.createImportDeclaration(undefined, factory.createImportClause(false, undefined, factory.createNamedImports([factory.createImportSpecifier(false, factory.createIdentifier("JSON"), factory.createIdentifier("__JSON"))])), factory.createStringLiteral("./index.js"), undefined), factory.createImportDeclaration(undefined, factory.createImportClause(false, undefined, factory.createNamespaceImport(factory.createIdentifier("__JSON_METHODS"))), factory.createStringLiteral("./exports.js"), undefined), ...src.statements]);
      }

      return src;
    };
  };
}

console.log("Transformer initiated");

function stripNull(ty: string): string {
  return ty.replaceAll(" | null", "")
}