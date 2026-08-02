import ts from "typescript";
import { jsonArrayElementType, schemaNameForRootArray, schemaNameForRootValue, schemaNameForType } from "./program-analyzer.js";

const JSON_TY_MODULES = new Set(["json-ty", "@jairussw/json-ty"]);
const JSON_TY_DECORATORS = new Set(["json", "serializable", "alias", "omit", "omitnull", "omitif", "optional", "lazy", "eager", "raw", "serializer", "deserializer"]);
const HOST_ROOT_TYPES = new Set([
  "Date", "Map", "Set", "ArrayBuffer", "Int8Array", "Uint8Array",
  "Uint8ClampedArray", "Int16Array", "Uint16Array", "Int32Array",
  "Uint32Array", "BigInt64Array", "BigUint64Array", "Float32Array",
  "Float64Array", "Raw", "Box",
]);

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
  return node.arguments.length === 0 && node.typeArguments?.length === 1 && ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === "schema" && ts.isIdentifier(node.expression.expression) && jsonIdentifiers.has(node.expression.expression.text);
}

function isDynamicFacadeTypeNode(node: ts.TypeNode, identifiers: ReadonlySet<string>): boolean {
  return ts.isTypeReferenceNode(node) && ts.isQualifiedName(node.typeName) && ts.isIdentifier(node.typeName.left) && identifiers.has(node.typeName.left.text) && (node.typeName.right.text === "Value" || node.typeName.right.text === "Obj" || node.typeName.right.text === "Arr");
}

function jsonCallName(expression: ts.Expression, identifiers: ReadonlySet<string>): "parse" | "stringify" | undefined {
  if (!ts.isPropertyAccessExpression(expression) || (expression.name.text !== "parse" && expression.name.text !== "stringify")) return undefined;
  if (ts.isIdentifier(expression.expression) && identifiers.has(expression.expression.text)) return expression.name.text;
  const owner = expression.expression;
  return ts.isPropertyAccessExpression(owner) && owner.name.text === "internal" && ts.isIdentifier(owner.expression) && identifiers.has(owner.expression.text)
    ? expression.name.text
    : undefined;
}

function schemaNameForResolvedType(checker: ts.TypeChecker, resolved: ts.Type): string {
  let type = resolved;
  let nullable = false;
  if (type.isUnion()) {
    nullable = type.types.some((part) => !!(part.flags & (ts.TypeFlags.Null | ts.TypeFlags.Undefined)));
    const values = type.types.filter((part) => !(part.flags & ts.TypeFlags.Null) && !(part.flags & ts.TypeFlags.Undefined));
    if (values.length === 1) type = values[0]!;
  }
  const jsonArrayElement = jsonArrayElementType(checker, type);
  if (checker.isArrayType(type) || jsonArrayElement) {
    const element = jsonArrayElement ?? checker.getTypeArguments(type as ts.TypeReference)[0];
    if (!element) throw new Error(`json-ty cannot name array element type ${checker.typeToString(type)}`);
    return schemaNameForRootArray(checker, element, jsonArrayElement ? "json-array" : "array");
  }
  if (!(type.flags & ts.TypeFlags.Object)) return schemaNameForRootValue(checker, resolved);
  if (nullable) return schemaNameForRootValue(checker, resolved);
  const symbol = type.aliasSymbol ?? type.getSymbol();
  if (symbol && HOST_ROOT_TYPES.has(symbol.getName())) return schemaNameForRootValue(checker, resolved);
  return schemaNameForType(checker, type);
}

function schemaName(checker: ts.TypeChecker, node: ts.TypeNode): string {
  return schemaNameForResolvedType(checker, checker.getTypeFromTypeNode(node));
}

function entityNameExpression(factory: ts.NodeFactory, name: ts.EntityName): ts.Expression {
  // Preserve the original identifier's symbol so TypeScript's import elision
  // sees the constructor as a value use introduced by this transform.
  if (ts.isIdentifier(name)) return ts.setOriginalNode(factory.createIdentifier(name.text), name);
  return factory.createPropertyAccessExpression(entityNameExpression(factory, name.left), name.right.text);
}

function runtimeConstructor(checker: ts.TypeChecker, factory: ts.NodeFactory, node: ts.TypeNode): ts.Expression | undefined {
  if (ts.isArrayTypeNode(node) && ts.isTypeReferenceNode(node.elementType)) {
    const type = checker.getTypeFromTypeNode(node.elementType);
    const symbol = type.aliasSymbol ?? type.getSymbol();
    const declaration = symbol?.valueDeclaration ?? symbol?.declarations?.[0];
    return declaration && ts.isClassDeclaration(declaration) ? entityNameExpression(factory, node.elementType.typeName) : undefined;
  }
  if (ts.isTypeReferenceNode(node) && node.typeArguments?.length === 1 && ts.isTypeReferenceNode(node.typeArguments[0]!)) {
    const rootType = checker.getTypeFromTypeNode(node);
    const nativeArray = ts.isIdentifier(node.typeName) && (node.typeName.text === "Array" || node.typeName.text === "ReadonlyArray");
    if (!nativeArray && !jsonArrayElementType(checker, rootType)) return undefined;
    const elementNode = node.typeArguments[0]!;
    const type = checker.getTypeFromTypeNode(elementNode);
    const symbol = type.aliasSymbol ?? type.getSymbol();
    const declaration = symbol?.valueDeclaration ?? symbol?.declarations?.[0];
    return declaration && ts.isClassDeclaration(declaration) ? entityNameExpression(factory, elementNode.typeName) : undefined;
  }
  if (!ts.isTypeReferenceNode(node)) return undefined;
  const type = checker.getTypeFromTypeNode(node);
  const symbol = type.aliasSymbol ?? type.getSymbol();
  const declaration = symbol?.valueDeclaration ?? symbol?.declarations?.[0];
  return declaration && ts.isClassDeclaration(declaration) ? entityNameExpression(factory, node.typeName) : undefined;
}

export function createJsonTyTransformer(program: ts.Program, options: JsonTyTransformerOptions = {}): ts.TransformerFactory<ts.SourceFile> {
  const checker = program.getTypeChecker();
  const runtimeName = options.runtimeIdentifier ?? "__jsonTy";
  return (context) => {
    const factory = context.factory;
    return (sourceFile) => {
      const runtimeModule = typeof options.runtimeModule === "function" ? options.runtimeModule(sourceFile) : options.runtimeModule;
      const jsonIdentifiers = importedJsonIdentifiers(sourceFile);
      const jsonTyBindings = importedJsonTyBindings(sourceFile);
      let changed = false;
      let needsRuntime = false;
      const directImports = new Map<string, ts.Identifier>();
      const importedValues = new Map<string, { module: string; imported: string }>();
      for (const statement of sourceFile.statements) {
        if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
        const bindings = statement.importClause?.namedBindings;
        if (!bindings || !ts.isNamedImports(bindings)) continue;
        for (const element of bindings.elements) {
          importedValues.set(element.name.text, {
            module: statement.moduleSpecifier.text,
            imported: element.propertyName?.text ?? element.name.text,
          });
        }
      }
      const constructorImports = new Map<string, { module: string; imported: string; local: ts.Identifier }>();
      const retainConstructor = (constructor: ts.Expression): ts.Expression => {
        if (!ts.isIdentifier(constructor)) return constructor;
        const imported = importedValues.get(constructor.text);
        if (!imported) return constructor;
        const key = `${imported.module}\0${imported.imported}`;
        let retained = constructorImports.get(key);
        if (!retained) {
          retained = { ...imported, local: factory.createUniqueName(`__jsonTyClass_${constructor.text}`, ts.GeneratedIdentifierFlags.Optimistic) };
          constructorImports.set(key, retained);
        }
        return retained.local;
      };
      const directIdentifier = (exportName: string): ts.Identifier => {
        let identifier = directImports.get(exportName);
        if (!identifier) {
          identifier = factory.createUniqueName(`__jsonTy_${exportName}`, ts.GeneratedIdentifierFlags.Optimistic);
          directImports.set(exportName, identifier);
        }
        return identifier;
      };
      const customClasses = new Map<string, string>();
      for (const statement of sourceFile.statements) {
        if (!ts.isClassDeclaration(statement) || !statement.name) continue;
        const custom = statement.members.some((member) =>
          ts.canHaveDecorators(member) && (ts.getDecorators(member) ?? []).some((decorator) => {
            const name = jsonTyDecoratorName(decorator, jsonTyBindings);
            return name === "serializer" || name === "deserializer";
          }),
        );
        if (custom) customClasses.set(statement.name.text, schemaNameForType(checker, checker.getTypeAtLocation(statement)));
      }
      const registerIdentifier = customClasses.size !== 0 && runtimeModule ? directIdentifier("registerSchemaClass") : undefined;
      const visit: ts.Visitor = (node: ts.Node): ts.VisitResult<ts.Node | undefined> => {
        if (ts.isDecorator(node) && jsonTyDecoratorName(node, jsonTyBindings)) {
          changed = true;
          return undefined;
        }
        if (ts.isExpressionStatement(node) && ts.isCallExpression(node.expression) && isSchemaMarkerCall(node.expression, jsonIdentifiers)) {
          changed = true;
          return undefined;
        }
        const callName = ts.isCallExpression(node) ? jsonCallName(node.expression, jsonIdentifiers) : undefined;
        if (ts.isCallExpression(node) && callName && (node.typeArguments?.length === 1 || (callName === "stringify" && !node.typeArguments?.length && node.arguments.length === 1))) {
          changed = true;
          const inferredType = node.typeArguments?.[0] ? undefined : checker.getTypeAtLocation(node.arguments[0]!);
          const typeNode = node.typeArguments?.[0] ?? checker.typeToTypeNode(
            inferredType!,
            sourceFile,
            ts.NodeBuilderFlags.NoTruncation,
          );
          if (!typeNode) throw new Error("json-ty cannot infer the JSON.stringify argument type");
          const dynamic = isDynamicFacadeTypeNode(typeNode, jsonIdentifiers);
          if (dynamic) {
            needsRuntime = true;
            return factory.createCallExpression(
              factory.createPropertyAccessExpression(factory.createIdentifier(runtimeName), callName === "parse" ? "parseDynamic" : "stringifyDynamic"),
              undefined,
              node.arguments.map((argument) => ts.visitNode(argument, visit) as ts.Expression),
            );
          }
          const name = inferredType ? schemaNameForResolvedType(checker, inferredType) : schemaName(checker, typeNode);
          const arguments_ = [...node.arguments.map((argument) => ts.visitNode(argument, visit) as ts.Expression)];
          if (callName === "parse") {
            const constructor = runtimeConstructor(checker, factory, typeNode);
            if (constructor) arguments_.push(retainConstructor(constructor));
          }
          const direct = runtimeModule ? options.schemaBindings?.[name] : undefined;
          if (direct) {
            const exportName = callName === "parse" ? direct.parse : direct.stringify;
            return factory.createCallExpression(directIdentifier(exportName), undefined, arguments_);
          }
          needsRuntime = true;
          const method = `${callName}${name}`;
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
      const registeredStatements = prunedStatements.flatMap((statement): ts.Statement[] => {
        if (!registerIdentifier || !ts.isClassDeclaration(statement) || !statement.name) return [statement];
        const name = customClasses.get(statement.name.text);
        if (!name) return [statement];
        return [statement, factory.createExpressionStatement(factory.createCallExpression(registerIdentifier, undefined, [factory.createStringLiteral(name), statement.name]))];
      });
      const pruned = factory.updateSourceFile(transformed, registeredStatements);
      if (!changed || (!needsRuntime && directImports.size === 0 && constructorImports.size === 0) || !runtimeModule) return pruned;
      const runtimeSpecifiers: ts.ImportSpecifier[] = [];
      if (needsRuntime) {
        runtimeSpecifiers.push(factory.createImportSpecifier(false, runtimeName !== "__jsonTyRuntime" ? factory.createIdentifier("__jsonTyRuntime") : undefined, factory.createIdentifier(runtimeName)));
      }
      for (const [exportName, localIdentifier] of directImports) {
        runtimeSpecifiers.push(factory.createImportSpecifier(false, factory.createIdentifier(exportName), localIdentifier));
      }
      const runtimeImport = factory.createImportDeclaration(undefined, factory.createImportClause(false, undefined, factory.createNamedImports(runtimeSpecifiers)), factory.createStringLiteral(runtimeModule));
      const retainedImports = new Map<string, ts.ImportSpecifier[]>();
      for (const retained of constructorImports.values()) {
        let specifiers = retainedImports.get(retained.module);
        if (!specifiers) retainedImports.set(retained.module, (specifiers = []));
        specifiers.push(factory.createImportSpecifier(false, factory.createIdentifier(retained.imported), retained.local));
      }
      const constructorImportDeclarations = [...retainedImports].map(([module, specifiers]) =>
        factory.createImportDeclaration(undefined, factory.createImportClause(false, undefined, factory.createNamedImports(specifiers)), factory.createStringLiteral(module)),
      );
      return factory.updateSourceFile(pruned, [runtimeImport, ...constructorImportDeclarations, ...pruned.statements]);
    };
  };
}
