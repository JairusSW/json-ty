import ts from "typescript";
import { jsonArrayElementType, schemaNameForRootArray, schemaNameForType } from "./program-analyzer.js";

const JSON_TY_MODULES = new Set(["json-ty", "@jairussw/json-ty"]);
const JSON_TY_DECORATORS = new Set(["json", "serializable", "alias", "omit", "omitnull", "omitif", "optional", "lazy", "eager", "raw"]);

export interface JsonTyTransformerOptions {
  runtimeIdentifier?: string;
  runtimeModule?: string | ((sourceFile: ts.SourceFile) => string);
  /** Direct generated host exports keyed by canonical schema name. */
  schemaBindings?: Readonly<Record<string, { parse: string; stringify: string }>>;
}

function importedJsonIdentifiers(sourceFile: ts.SourceFile): Set<string> {
  const result = new Set<string>();
  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
    if (!JSON_TY_MODULES.has(statement.moduleSpecifier.text)) continue;
    const bindings = statement.importClause?.namedBindings;
    if (!bindings || !ts.isNamedImports(bindings)) continue;
    for (const element of bindings.elements) {
      if ((element.propertyName?.text ?? element.name.text) === "JSON") result.add(element.name.text);
    }
  }
  return result;
}

function importedJsonTyBindings(sourceFile: ts.SourceFile): Map<string, string> {
  const result = new Map<string, string>();
  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier) || !JSON_TY_MODULES.has(statement.moduleSpecifier.text)) continue;
    const bindings = statement.importClause?.namedBindings;
    if (!bindings || !ts.isNamedImports(bindings)) continue;
    for (const element of bindings.elements) result.set(element.name.text, element.propertyName?.text ?? element.name.text);
  }
  return result;
}

function jsonTyDecoratorName(node: ts.Decorator, bindings: ReadonlyMap<string, string>): string | undefined {
  const expression = ts.isCallExpression(node.expression) ? node.expression.expression : node.expression;
  if (!ts.isIdentifier(expression)) return undefined;
  const imported = bindings.get(expression.text);
  return imported && JSON_TY_DECORATORS.has(imported) ? imported : undefined;
}

function isSchemaMarkerCall(node: ts.CallExpression, jsonIdentifiers: ReadonlySet<string>): boolean {
  return (
    node.arguments.length === 0 &&
    node.typeArguments?.length === 1 &&
    ts.isPropertyAccessExpression(node.expression) &&
    node.expression.name.text === "schema" &&
    ts.isIdentifier(node.expression.expression) &&
    jsonIdentifiers.has(node.expression.expression.text)
  );
}

function isDynamicFacadeTypeNode(node: ts.TypeNode, identifiers: ReadonlySet<string>): boolean {
  return ts.isTypeReferenceNode(node) && ts.isQualifiedName(node.typeName) && ts.isIdentifier(node.typeName.left) && identifiers.has(node.typeName.left.text) && (node.typeName.right.text === "Value" || node.typeName.right.text === "Obj" || node.typeName.right.text === "Arr");
}

function schemaName(checker: ts.TypeChecker, node: ts.TypeNode): string {
  let type = checker.getTypeFromTypeNode(node);
  if (type.isUnion()) {
    const values = type.types.filter((part) => !(part.flags & ts.TypeFlags.Null) && !(part.flags & ts.TypeFlags.Undefined));
    if (values.length === 1) type = values[0]!;
  }
  const jsonArrayElement = jsonArrayElementType(checker, type);
  if (checker.isArrayType(type) || jsonArrayElement) {
    const element = jsonArrayElement ?? checker.getTypeArguments(type as ts.TypeReference)[0];
    if (!element) throw new Error(`json-ty cannot name array element type ${checker.typeToString(type)}`);
    return schemaNameForRootArray(checker, element, jsonArrayElement ? "json-array" : "array");
  }
  return schemaNameForType(checker, type);
}

function runtimeConstructor(checker: ts.TypeChecker, node: ts.TypeNode): ts.EntityName | undefined {
  if (ts.isArrayTypeNode(node) && ts.isTypeReferenceNode(node.elementType)) {
    const type = checker.getTypeFromTypeNode(node.elementType);
    const symbol = type.aliasSymbol ?? type.getSymbol();
    const declaration = symbol?.valueDeclaration ?? symbol?.declarations?.[0];
    return declaration && ts.isClassDeclaration(declaration) ? node.elementType.typeName : undefined;
  }
  if (ts.isTypeReferenceNode(node) && node.typeArguments?.length === 1 && ts.isTypeReferenceNode(node.typeArguments[0]!)) {
    const rootType = checker.getTypeFromTypeNode(node);
    const nativeArray = ts.isIdentifier(node.typeName) && (node.typeName.text === "Array" || node.typeName.text === "ReadonlyArray");
    if (!nativeArray && !jsonArrayElementType(checker, rootType)) return undefined;
    const elementNode = node.typeArguments[0]!;
    const type = checker.getTypeFromTypeNode(elementNode);
    const symbol = type.aliasSymbol ?? type.getSymbol();
    const declaration = symbol?.valueDeclaration ?? symbol?.declarations?.[0];
    return declaration && ts.isClassDeclaration(declaration) ? elementNode.typeName : undefined;
  }
  if (!ts.isTypeReferenceNode(node)) return undefined;
  const type = checker.getTypeFromTypeNode(node);
  const symbol = type.aliasSymbol ?? type.getSymbol();
  const declaration = symbol?.valueDeclaration ?? symbol?.declarations?.[0];
  return declaration && ts.isClassDeclaration(declaration) ? node.typeName : undefined;
}

export function createJsonTyTransformer(program: ts.Program, options: JsonTyTransformerOptions = {}): ts.TransformerFactory<ts.SourceFile> {
  const checker = program.getTypeChecker();
  const runtimeName = options.runtimeIdentifier ?? "__jsonTy";
  return (context) => {
    const factory = context.factory;
    return (sourceFile) => {
      const runtimeModule = typeof options.runtimeModule === "function"
        ? options.runtimeModule(sourceFile)
        : options.runtimeModule;
      const jsonIdentifiers = importedJsonIdentifiers(sourceFile);
      const jsonTyBindings = importedJsonTyBindings(sourceFile);
      let changed = false;
      let needsRuntime = false;
      const directImports = new Map<string, ts.Identifier>();
      const directIdentifier = (exportName: string): ts.Identifier => {
        let identifier = directImports.get(exportName);
        if (!identifier) {
          identifier = factory.createUniqueName(`__jsonTy_${exportName}`, ts.GeneratedIdentifierFlags.Optimistic);
          directImports.set(exportName, identifier);
        }
        return identifier;
      };
      const visit: ts.Visitor = (node: ts.Node): ts.VisitResult<ts.Node | undefined> => {
        if (ts.isDecorator(node) && jsonTyDecoratorName(node, jsonTyBindings)) {
          changed = true;
          return undefined;
        }
        if (ts.isExpressionStatement(node) && ts.isCallExpression(node.expression) && isSchemaMarkerCall(node.expression, jsonIdentifiers)) {
          changed = true;
          return undefined;
        }
        if (ts.isCallExpression(node) && node.typeArguments?.length === 1 && ts.isPropertyAccessExpression(node.expression) && ts.isIdentifier(node.expression.expression) && jsonIdentifiers.has(node.expression.expression.text) && (node.expression.name.text === "parse" || node.expression.name.text === "stringify")) {
          changed = true;
          const dynamic = isDynamicFacadeTypeNode(node.typeArguments[0]!, jsonIdentifiers);
          if (dynamic) {
            needsRuntime = true;
            return factory.createCallExpression(
              factory.createPropertyAccessExpression(factory.createIdentifier(runtimeName), node.expression.name.text === "parse" ? "parseDynamic" : "stringifyDynamic"),
              undefined,
              node.arguments.map((argument) => ts.visitNode(argument, visit) as ts.Expression),
            );
          }
          const name = schemaName(checker, node.typeArguments[0]!);
          const arguments_ = [...node.arguments.map((argument) => ts.visitNode(argument, visit) as ts.Expression)];
          if (node.expression.name.text === "parse") {
            const constructor = runtimeConstructor(checker, node.typeArguments[0]!);
            if (constructor) arguments_.push(constructor as ts.Expression);
          }
          const direct = runtimeModule ? options.schemaBindings?.[name] : undefined;
          if (direct) {
            const exportName = node.expression.name.text === "parse" ? direct.parse : direct.stringify;
            return factory.createCallExpression(directIdentifier(exportName), undefined, arguments_);
          }
          needsRuntime = true;
          const method = `${node.expression.name.text}${name}`;
          return factory.createCallExpression(factory.createPropertyAccessExpression(factory.createIdentifier(runtimeName), method), undefined, arguments_);
        }
        return ts.visitEachChild(node, visit, context);
      };
      const transformed = ts.visitNode(sourceFile, visit) as ts.SourceFile;
      const usedIdentifiers = new Set<string>();
      const collectUsed = (node: ts.Node): void => {
        if (ts.isImportDeclaration(node)) return;
        if (ts.isIdentifier(node)) usedIdentifiers.add(node.text);
        ts.forEachChild(node, collectUsed);
      };
      collectUsed(transformed);
      const prunedStatements = transformed.statements.flatMap((statement): ts.Statement[] => {
        if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier) || !JSON_TY_MODULES.has(statement.moduleSpecifier.text)) return [statement];
        const clause = statement.importClause;
        const bindings = clause?.namedBindings;
        if (!clause || !bindings || !ts.isNamedImports(bindings)) return [statement];
        const elements = bindings.elements.filter((element) => {
          const imported = element.propertyName?.text ?? element.name.text;
          return !JSON_TY_DECORATORS.has(imported) || usedIdentifiers.has(element.name.text);
        });
        if (elements.length === 0 && clause.name === undefined) return [];
        return [factory.updateImportDeclaration(statement, statement.modifiers, factory.updateImportClause(clause, clause.isTypeOnly, clause.name, factory.updateNamedImports(bindings, elements)), statement.moduleSpecifier, statement.attributes)];
      });
      const pruned = factory.updateSourceFile(transformed, prunedStatements);
      if (!changed || (!needsRuntime && directImports.size === 0) || !runtimeModule) return pruned;
      const runtimeSpecifiers: ts.ImportSpecifier[] = [];
      if (needsRuntime) {
        runtimeSpecifiers.push(factory.createImportSpecifier(false, runtimeName !== "__jsonTyRuntime" ? factory.createIdentifier("__jsonTyRuntime") : undefined, factory.createIdentifier(runtimeName)));
      }
      for (const [exportName, localIdentifier] of directImports) {
        runtimeSpecifiers.push(factory.createImportSpecifier(false, factory.createIdentifier(exportName), localIdentifier));
      }
      const runtimeImport = factory.createImportDeclaration(undefined, factory.createImportClause(false, undefined, factory.createNamedImports(runtimeSpecifiers)), factory.createStringLiteral(runtimeModule));
      return factory.updateSourceFile(pruned, [runtimeImport, ...pruned.statements]);
    };
  };
}
