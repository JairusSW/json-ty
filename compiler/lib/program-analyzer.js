import ts from "typescript";
import { dirname, resolve } from "node:path";
import { createSchemaManifest } from "./schema-ir.js";
const JSON_TY_MODULES = new Set(["json-ty", "@jairussw/json-ty"]);
const KNOWN_DECORATORS = new Set(["json", "serializable", "alias", "omit", "omitnull", "omitif", "optional", "lazy", "eager", "raw"]);
function schemaDeclarationOf(type) {
    const symbol = type.aliasSymbol ?? type.getSymbol();
    return symbol?.valueDeclaration ?? symbol?.declarations?.[0];
}
function moduleSpecifierOf(node) {
    let current = node;
    while (current && !ts.isImportDeclaration(current))
        current = current.parent;
    return current && ts.isStringLiteral(current.moduleSpecifier) ? current.moduleSpecifier.text : undefined;
}
function jsonTyImports(sourceFile) {
    const imports = new Map();
    for (const statement of sourceFile.statements) {
        if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier))
            continue;
        if (!JSON_TY_MODULES.has(statement.moduleSpecifier.text))
            continue;
        const clause = statement.importClause;
        const bindings = clause?.namedBindings;
        if (!bindings || !ts.isNamedImports(bindings))
            continue;
        for (const element of bindings.elements) {
            imports.set(element.name.text, element.propertyName?.text ?? element.name.text);
        }
    }
    return imports;
}
function isDynamicFacadeTypeNode(node, imports) {
    return ts.isTypeReferenceNode(node) && ts.isQualifiedName(node.typeName) && ts.isIdentifier(node.typeName.left) && imports.get(node.typeName.left.text) === "JSON" && (node.typeName.right.text === "Value" || node.typeName.right.text === "Obj" || node.typeName.right.text === "Arr");
}
function isSchemaMarkerCall(node, imports) {
    if (node.typeArguments?.length !== 1 || node.arguments.length !== 0)
        return false;
    const expression = node.expression;
    return (ts.isPropertyAccessExpression(expression) &&
        expression.name.text === "schema" &&
        ts.isIdentifier(expression.expression) &&
        imports.get(expression.expression.text) === "JSON");
}
function decoratorInfo(node, imports) {
    if (!ts.canHaveDecorators(node))
        return [];
    const decorators = ts.getDecorators(node) ?? [];
    const result = [];
    for (const decorator of decorators) {
        const expression = decorator.expression;
        const target = ts.isCallExpression(expression) ? expression.expression : expression;
        if (!ts.isIdentifier(target))
            continue;
        const imported = imports.get(target.text);
        if (!imported || !KNOWN_DECORATORS.has(imported))
            continue;
        result.push({ name: imported, call: ts.isCallExpression(expression) ? expression : undefined });
    }
    return result;
}
function literalValue(node, checker) {
    if (!node)
        return undefined;
    if (ts.isStringLiteralLike(node))
        return node.text;
    if (ts.isNumericLiteral(node)) {
        const value = Number(node.text);
        return Number.isFinite(value) ? value : undefined;
    }
    if (node.kind === ts.SyntaxKind.TrueKeyword)
        return true;
    if (node.kind === ts.SyntaxKind.FalseKeyword)
        return false;
    if (node.kind === ts.SyntaxKind.NullKeyword)
        return null;
    if (ts.isPrefixUnaryExpression(node) && ts.isNumericLiteral(node.operand)) {
        const value = Number(node.operand.text);
        if (!Number.isFinite(value))
            return undefined;
        if (node.operator === ts.SyntaxKind.MinusToken)
            return -value;
        if (node.operator === ts.SyntaxKind.PlusToken)
            return value;
    }
    if (ts.isArrayLiteralExpression(node)) {
        const values = [];
        for (const element of node.elements) {
            if (ts.isOmittedExpression(element) || ts.isSpreadElement(element))
                return undefined;
            const value = literalValue(element, checker);
            if (value === undefined)
                return undefined;
            values.push(value);
        }
        return values;
    }
    if (ts.isObjectLiteralExpression(node)) {
        const result = {};
        for (const property of node.properties) {
            if (!ts.isPropertyAssignment(property))
                return undefined;
            const name = property.name;
            if (!ts.isIdentifier(name) &&
                !ts.isStringLiteralLike(name) &&
                !ts.isNumericLiteral(name)) {
                return undefined;
            }
            const value = literalValue(property.initializer, checker);
            if (value === undefined)
                return undefined;
            result[name.text] = value;
        }
        return result;
    }
    if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) {
        const value = checker.getConstantValue(node);
        if (typeof value === "string" || (typeof value === "number" && Number.isFinite(value)))
            return value;
        const type = checker.getTypeAtLocation(node);
        if (type.flags & ts.TypeFlags.StringLiteral)
            return type.value;
        if (type.flags & ts.TypeFlags.NumberLiteral) {
            const literal = type.value;
            return Number.isFinite(literal) ? literal : undefined;
        }
    }
    return undefined;
}
function lazyModeValue(node) {
    if (!node)
        return undefined;
    if (ts.isStringLiteralLike(node) && (node.text === "none" || node.text === "auto" || node.text === "all"))
        return node.text;
    if (!ts.isObjectLiteralExpression(node))
        return undefined;
    for (const property of node.properties) {
        if (ts.isShorthandPropertyAssignment(property) && (property.name.text === "none" || property.name.text === "auto" || property.name.text === "all"))
            return property.name.text;
        if (!ts.isPropertyAssignment(property))
            continue;
        const name = ts.isIdentifier(property.name) || ts.isStringLiteralLike(property.name) ? property.name.text : "";
        if (name === "lazy" || name === "mode") {
            const mode = lazyModeValue(property.initializer);
            if (mode)
                return mode;
        }
        if ((name === "none" || name === "auto" || name === "all") && property.initializer.kind === ts.SyntaxKind.TrueKeyword)
            return name;
    }
    return undefined;
}
function classLazyMode(declaration, imports) {
    for (const decorator of decoratorInfo(declaration, imports)) {
        if (decorator.name === "json" || decorator.name === "serializable") {
            const argument = decorator.call?.arguments[0];
            if (!argument)
                continue;
            const mode = lazyModeValue(argument);
            if (!mode && ts.isObjectLiteralExpression(argument) && argument.properties.some((property) => (ts.isPropertyAssignment(property) || ts.isShorthandPropertyAssignment(property)) && property.name.getText() === "lazy")) {
                throw new Error('@json lazy must be "none", "auto", or "all"');
            }
            if (mode)
                return mode;
        }
        // Convenience spelling in addition to json-as compatibility:
        // @lazy("auto"), @lazy({ auto: true }), or @lazy({ mode: "auto" }).
        if (decorator.name === "lazy" && decorator.call) {
            const mode = lazyModeValue(decorator.call.arguments[0]);
            if (!mode)
                throw new Error('@lazy class mode must be "none", "auto", or "all"');
            return mode;
        }
    }
    return "none";
}
function lazyAutoCost(type, schemas) {
    if (type.kind === "number" || type.kind === "boolean")
        return 1;
    if (type.kind === "string")
        return 10;
    if (type.kind === "array" || type.kind === "union")
        return 20;
    if (type.kind !== "object")
        return 20;
    const nested = schemas.get(type.typeName);
    if (!nested)
        return 20;
    let score = 0;
    for (const field of nested.fields) {
        if (field.decorators?.omit)
            continue;
        const direct = field.type ?? { kind: field.kind };
        score += direct.kind === "number" || direct.kind === "boolean" ? 1 : direct.kind === "string" ? 10 : 20;
        if (score >= 10)
            break;
    }
    return score;
}
function fieldDecoratorMetadata(member, imports, sourceFile) {
    const result = {};
    for (const decorator of decoratorInfo(member, imports)) {
        const argument = decorator.call?.arguments[0];
        switch (decorator.name) {
            case "alias":
                if (argument && ts.isStringLiteralLike(argument))
                    result.alias = argument.text;
                break;
            case "omit":
                result.omit = true;
                break;
            case "omitnull":
                result.omitNull = true;
                break;
            case "omitif":
                if (argument && ts.isStringLiteralLike(argument)) {
                    result.omitIf = argument.text.replace(/\bthis\./g, "self.");
                    result.omitIfParameter = "self";
                }
                else if (argument && (ts.isArrowFunction(argument) || ts.isFunctionExpression(argument))) {
                    const parameter = argument.parameters[0]?.name;
                    if (!parameter || !ts.isIdentifier(parameter)) {
                        throw new Error("@omitif requires one identifier parameter");
                    }
                    const body = ts.isBlock(argument.body) ? (argument.body.statements.length === 1 && ts.isReturnStatement(argument.body.statements[0]) ? argument.body.statements[0].expression : undefined) : argument.body;
                    if (!body)
                        throw new Error("@omitif must be a single pure expression");
                    const validate = (node) => {
                        if (ts.isCallExpression(node) || ts.isNewExpression(node) || ts.isAwaitExpression(node) || (ts.isBinaryExpression(node) && node.operatorToken.kind >= ts.SyntaxKind.FirstAssignment && node.operatorToken.kind <= ts.SyntaxKind.LastAssignment))
                            throw new Error("@omitif expressions cannot call or mutate values");
                        ts.forEachChild(node, validate);
                    };
                    validate(body);
                    result.omitIf = body.getText(sourceFile);
                    result.omitIfParameter = parameter.text;
                }
                else if (argument) {
                    throw new Error("@omitif requires an inline arrow or function expression");
                }
                break;
            case "optional":
                result.optional = true;
                break;
            case "lazy":
                result.lazy = true;
                break;
            case "eager":
                result.eager = true;
                break;
            case "raw":
                result.raw = true;
                break;
            case "codec":
                if (argument)
                    result.codec = argument.getText(sourceFile);
                break;
        }
    }
    return result;
}
const OMIT_BINARY_OPERATORS = new Map([
    [ts.SyntaxKind.PlusToken, "+"],
    [ts.SyntaxKind.MinusToken, "-"],
    [ts.SyntaxKind.AsteriskToken, "*"],
    [ts.SyntaxKind.SlashToken, "/"],
    [ts.SyntaxKind.PercentToken, "%"],
    [ts.SyntaxKind.LessThanToken, "<"],
    [ts.SyntaxKind.LessThanEqualsToken, "<="],
    [ts.SyntaxKind.GreaterThanToken, ">"],
    [ts.SyntaxKind.GreaterThanEqualsToken, ">="],
    [ts.SyntaxKind.EqualsEqualsToken, "=="],
    [ts.SyntaxKind.EqualsEqualsEqualsToken, "=="],
    [ts.SyntaxKind.ExclamationEqualsToken, "!="],
    [ts.SyntaxKind.ExclamationEqualsEqualsToken, "!="],
    [ts.SyntaxKind.AmpersandAmpersandToken, "&&"],
    [ts.SyntaxKind.BarBarToken, "||"],
]);
function compileOmitIfPlan(text, parameter, fields, location) {
    const source = ts.createSourceFile("json-ty-omitif.ts", `const __jsonTyPredicate = (${text});`, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    const statement = source.statements[0];
    if (!statement || !ts.isVariableStatement(statement))
        throw new Error(`${location} has an invalid @omitif expression`);
    const initializer = statement.declarationList.declarations[0]?.initializer;
    if (!initializer)
        throw new Error(`${location} has an invalid @omitif expression`);
    const visit = (node) => {
        if (ts.isParenthesizedExpression(node))
            return visit(node.expression);
        if (ts.isNumericLiteral(node))
            return { kind: "literal", value: Number(node.text) };
        if (node.kind === ts.SyntaxKind.TrueKeyword)
            return { kind: "literal", value: true };
        if (node.kind === ts.SyntaxKind.FalseKeyword)
            return { kind: "literal", value: false };
        if (ts.isPropertyAccessExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === parameter) {
            const field = fields.find((candidate) => candidate.name === node.name.text);
            if (!field)
                throw new Error(`${location} references unknown field ${node.name.text}`);
            if ((field.kind !== "number" && field.kind !== "boolean") ||
                field.nullable ||
                field.hostManaged ||
                (typeof field.defaultValue !== "number" && typeof field.defaultValue !== "boolean")) {
                throw new Error(`${location} can compile @omitif field reads only for non-nullable number/boolean fields with primitive defaults; ${node.name.text} is not eligible`);
            }
            return { kind: "field", name: node.name.text };
        }
        if (ts.isPrefixUnaryExpression(node)) {
            const operator = node.operator === ts.SyntaxKind.ExclamationToken
                ? "!"
                : node.operator === ts.SyntaxKind.PlusToken
                    ? "+"
                    : node.operator === ts.SyntaxKind.MinusToken
                        ? "-"
                        : undefined;
            if (!operator)
                throw new Error(`${location} uses an unsupported @omitif unary operator`);
            return { kind: "unary", operator, operand: visit(node.operand) };
        }
        if (ts.isBinaryExpression(node)) {
            const operator = OMIT_BINARY_OPERATORS.get(node.operatorToken.kind);
            if (!operator)
                throw new Error(`${location} uses an unsupported @omitif binary operator`);
            return { kind: "binary", operator, left: visit(node.left), right: visit(node.right) };
        }
        throw new Error(`${location} uses unsupported @omitif syntax: ${node.getText(source)}`);
    };
    return visit(initializer);
}
function hasLazyTypeWrapper(member, imports) {
    const visit = (node) => {
        if (!node)
            return false;
        if (ts.isParenthesizedTypeNode(node))
            return visit(node.type);
        // JSON.Lazy<T> is transparent to TypeScript, so preserve the marker from
        // syntax even when null/undefined is wrapped around it.
        if (ts.isUnionTypeNode(node))
            return node.types.some(visit);
        if (!ts.isTypeReferenceNode(node) || node.typeArguments?.length !== 1)
            return false;
        if (ts.isIdentifier(node.typeName))
            return imports.get(node.typeName.text) === "Lazy";
        if (!ts.isQualifiedName(node.typeName) || node.typeName.right.text !== "Lazy")
            return false;
        const left = node.typeName.left;
        return ts.isIdentifier(left) && imports.get(left.text) === "JSON";
    };
    return visit(member.type);
}
function unwrapNullable(type) {
    if (!type.isUnion())
        return { type, nullable: false, optional: false };
    let nullable = false;
    let optional = false;
    const values = type.types.filter((part) => {
        if (part.flags & ts.TypeFlags.Null) {
            nullable = true;
            return false;
        }
        if (part.flags & ts.TypeFlags.Undefined) {
            optional = true;
            return false;
        }
        return true;
    });
    if (values.length > 1 && values.every((value) => value.flags & ts.TypeFlags.BooleanLiteral)) {
        return { type: values[0], nullable, optional };
    }
    if (values.length > 1 && values.every((value) => value.flags & ts.TypeFlags.StringLike)) {
        return { type: values[0], nullable, optional };
    }
    if (values.length > 1 && values.every((value) => value.flags & ts.TypeFlags.NumberLike)) {
        return { type: values[0], nullable, optional };
    }
    if (values.length !== 1) {
        throw new Error(`Unsupported untagged union: ${type.flags}`);
    }
    return { type: values[0], nullable, optional };
}
export function schemaNameForType(checker, type) {
    const alias = type.aliasSymbol;
    if (alias)
        return alias.getName();
    const symbol = type.getSymbol();
    if (!symbol)
        throw new Error(`Anonymous object type ${checker.typeToString(type)} requires a named alias`);
    if (type.flags & ts.TypeFlags.Object) {
        const arguments_ = checker.getTypeArguments(type);
        if (arguments_.length !== 0) {
            const suffix = arguments_
                .map((argument) => checker
                .typeToString(argument)
                .replace(/[^$0-9A-Z_a-z]+/g, "_")
                .replace(/^_+|_+$/g, ""))
                .join("__");
            return `${symbol.getName()}__${suffix}`;
        }
    }
    return symbol.getName();
}
export function jsonArrayElementType(checker, type) {
    if (!(type.flags & ts.TypeFlags.Object))
        return undefined;
    const symbol = type.aliasSymbol ?? type.getSymbol();
    const declaredInJsonNamespace = symbol?.getName() === "Array" &&
        symbol.declarations?.some((declaration) => {
            let parent = declaration.parent;
            while (parent && !ts.isModuleDeclaration(parent))
                parent = parent.parent;
            return parent && ts.isIdentifier(parent.name) && parent.name.text === "JSON";
        });
    if (!declaredInJsonNamespace)
        return undefined;
    return checker.getTypeArguments(type)[0];
}
export function schemaNameForRootArray(checker, element, facade = "array") {
    const base = element.flags & ts.TypeFlags.Object
        ? schemaNameForType(checker, element)
        : checker
            .typeToString(element)
            .replace(/[^$0-9A-Z_a-z]+/g, "_")
            .replace(/^_+|_+$/g, "");
    if (!base)
        throw new Error(`json-ty cannot name array element type ${checker.typeToString(element)}`);
    return `${base}${facade === "json-array" ? "JsonArray" : "Array"}`;
}
export function analyzeProgram(program, options = {}) {
    const checker = program.getTypeChecker();
    const schemas = new Map();
    const rootArrays = new Map();
    const reachableTypes = new Map();
    const schemaNameOwners = new Map();
    const queued = [];
    const explicitSchemaDeclarations = new Set();
    const explicitSchemaTypes = [];
    // Discovery is deliberately separate from graph construction. A schema is
    // eligible only when its declaration has @json/@serializable or its type is
    // named by JSON.schema<T>(); references never opt a class in accidentally.
    for (const sourceFile of program.getSourceFiles()) {
        if (sourceFile.isDeclarationFile)
            continue;
        const imports = jsonTyImports(sourceFile);
        const discover = (node) => {
            if ((ts.isClassDeclaration(node) || ts.isInterfaceDeclaration(node)) &&
                node.name &&
                decoratorInfo(node, imports).some((item) => item.name === "json" || item.name === "serializable")) {
                explicitSchemaDeclarations.add(node);
                // Generic declarations become concrete schemas when a marked root or
                // dependency supplies type arguments (for example Box<number>).
                if (!node.typeParameters?.length)
                    explicitSchemaTypes.push({ type: checker.getTypeAtLocation(node), declaration: node });
            }
            if (ts.isCallExpression(node) && isSchemaMarkerCall(node, imports)) {
                const type = checker.getTypeFromTypeNode(node.typeArguments[0]);
                const declaration = schemaDeclarationOf(type);
                if (!declaration)
                    throw new Error(`JSON.schema requires a named class, interface, or type alias`);
                explicitSchemaDeclarations.add(declaration);
                explicitSchemaTypes.push({ type, declaration });
            }
            ts.forEachChild(node, discover);
        };
        discover(sourceFile);
    }
    const enqueue = (type, declaration) => {
        const symbol = type.aliasSymbol ?? type.getSymbol();
        const name = symbol ? schemaNameForType(checker, type) : undefined;
        const selected = declaration ?? symbol?.valueDeclaration ?? symbol?.declarations?.[0];
        if (!name || !selected)
            throw new Error(`Anonymous object types require a named declaration`);
        const identity = checker.typeToString(type, selected, ts.TypeFormatFlags.UseFullyQualifiedType | ts.TypeFormatFlags.NoTruncation);
        const owner = schemaNameOwners.get(name);
        if (owner && (owner.declaration !== selected || owner.identity !== identity)) {
            throw new Error(`Schema name collision for ${name}: ${owner.identity} and ${identity}. ` +
                `json-ty requires unambiguous generated schema names; rename one declaration or expose it through a distinct named alias.`);
        }
        schemaNameOwners.set(name, { identity, declaration: selected });
        if (!explicitSchemaDeclarations.has(selected)) {
            throw new Error(`Structured JSON type ${checker.typeToString(type)} is not an explicit schema; add @json to its class or JSON.schema<${checker.typeToString(type)}>() for an interface/type alias`);
        }
        if (!reachableTypes.has(type)) {
            reachableTypes.set(type, name);
            queued.push({ type, declaration: selected });
        }
        return name;
    };
    const toTypeRef = (input) => {
        if (input.isUnion()) {
            let nullable = false;
            let optional = false;
            const variants = input.types.filter((part) => {
                if (part.flags & ts.TypeFlags.Null) {
                    nullable = true;
                    return false;
                }
                if (part.flags & ts.TypeFlags.Undefined) {
                    optional = true;
                    return false;
                }
                return true;
            });
            if (variants.length > 1 && variants.every((variant) => variant.flags & ts.TypeFlags.Object)) {
                const firstProperties = checker.getPropertiesOfType(variants[0]);
                for (const candidate of firstProperties) {
                    const discriminatorValues = [];
                    let valid = true;
                    for (const variant of variants) {
                        const property = checker.getPropertyOfType(variant, candidate.getName());
                        const declaration = property?.valueDeclaration ?? property?.declarations?.[0];
                        if (!property || !declaration) {
                            valid = false;
                            break;
                        }
                        const propertyType = checker.getTypeOfSymbolAtLocation(property, declaration);
                        if (propertyType.flags & ts.TypeFlags.StringLiteral) {
                            discriminatorValues.push(propertyType.value);
                        }
                        else if (propertyType.flags & ts.TypeFlags.NumberLiteral) {
                            discriminatorValues.push(propertyType.value);
                        }
                        else if (propertyType.flags & ts.TypeFlags.BooleanLiteral) {
                            discriminatorValues.push(checker.typeToString(propertyType) === "true");
                        }
                        else {
                            valid = false;
                            break;
                        }
                    }
                    if (valid && new Set(discriminatorValues).size === variants.length) {
                        return {
                            ref: {
                                kind: "union",
                                discriminator: candidate.getName(),
                                variants: variants.map((variant, index) => ({
                                    typeName: enqueue(variant),
                                    discriminatorValue: discriminatorValues[index],
                                })),
                            },
                            nullable,
                            optional,
                        };
                    }
                }
                throw new Error(`Object union ${checker.typeToString(input)} requires a shared literal discriminator`);
            }
        }
        const unwrapped = unwrapNullable(input);
        const type = unwrapped.type;
        const jsonArrayElement = jsonArrayElementType(checker, type);
        if (jsonArrayElement) {
            return {
                ref: { kind: "array", element: toTypeRef(jsonArrayElement).ref, facade: "json-array" },
                nullable: unwrapped.nullable,
                optional: unwrapped.optional,
            };
        }
        if (type.flags & ts.TypeFlags.NumberLike) {
            return { ref: { kind: "number" }, nullable: unwrapped.nullable, optional: unwrapped.optional };
        }
        if (type.flags & ts.TypeFlags.BooleanLike) {
            return { ref: { kind: "boolean" }, nullable: unwrapped.nullable, optional: unwrapped.optional };
        }
        if (type.flags & ts.TypeFlags.StringLike) {
            return { ref: { kind: "string" }, nullable: unwrapped.nullable, optional: unwrapped.optional };
        }
        if (checker.isArrayType(type) || checker.isTupleType(type)) {
            const arguments_ = checker.getTypeArguments(type);
            const element = arguments_[0];
            if (!element)
                throw new Error("Unable to resolve array element type");
            const elements = checker.isTupleType(type) ? arguments_.map((argument) => toTypeRef(argument).ref) : undefined;
            return {
                ref: {
                    kind: "array",
                    element: toTypeRef(element).ref,
                    ...(elements ? { elements } : {}),
                    facade: "array",
                },
                nullable: unwrapped.nullable,
                optional: unwrapped.optional,
            };
        }
        if (type.flags & ts.TypeFlags.Object) {
            return {
                ref: { kind: "object", typeName: enqueue(type) },
                nullable: unwrapped.nullable,
                optional: unwrapped.optional,
            };
        }
        throw new Error(`Unsupported JSON type ${checker.typeToString(type)}`);
    };
    if (options.includeDecorated ?? true) {
        for (const schema of explicitSchemaTypes)
            enqueue(schema.type, schema.declaration);
    }
    for (const sourceFile of program.getSourceFiles()) {
        if (sourceFile.isDeclarationFile)
            continue;
        const imports = jsonTyImports(sourceFile);
        const visit = (node) => {
            if (ts.isCallExpression(node) && node.typeArguments?.length === 1) {
                const expression = node.expression;
                if (ts.isPropertyAccessExpression(expression) && ts.isIdentifier(expression.expression) && imports.get(expression.expression.text) === "JSON" && (expression.name.text === "parse" || expression.name.text === "stringify")) {
                    if (isDynamicFacadeTypeNode(node.typeArguments[0], imports)) {
                        ts.forEachChild(node, visit);
                        return;
                    }
                    const type = checker.getTypeFromTypeNode(node.typeArguments[0]);
                    const normalized = unwrapNullable(type).type;
                    const jsonArrayElement = jsonArrayElementType(checker, normalized);
                    if (checker.isArrayType(normalized) || jsonArrayElement) {
                        const facade = jsonArrayElement ? "json-array" : "array";
                        const element = jsonArrayElement ?? checker.getTypeArguments(normalized)[0];
                        if (element) {
                            const elementRef = toTypeRef(element).ref;
                            const rootName = schemaNameForRootArray(checker, element, facade);
                            const existing = rootArrays.get(rootName);
                            if (existing && JSON.stringify(existing) !== JSON.stringify({ element: elementRef, facade })) {
                                throw new Error(`Root array schema name collision for ${rootName}`);
                            }
                            rootArrays.set(rootName, { element: elementRef, facade });
                        }
                    }
                    else if (normalized.flags & ts.TypeFlags.Object)
                        enqueue(normalized);
                }
            }
            ts.forEachChild(node, visit);
        };
        visit(sourceFile);
    }
    for (const [name, array] of rootArrays) {
        if (schemas.has(name))
            throw new Error(`Root array schema name collides with ${name}`);
        schemas.set(name, {
            name,
            root: array.facade,
            declarationKind: "type",
            fields: [
                {
                    name: "value",
                    kind: "array",
                    type: { kind: "array", element: array.element, facade: array.facade },
                },
            ],
        });
    }
    while (queued.length !== 0) {
        const { type, declaration } = queued.shift();
        const name = reachableTypes.get(type);
        if (schemas.has(name))
            continue;
        const sourceFile = declaration.getSourceFile();
        const imports = jsonTyImports(sourceFile);
        const fields = [];
        for (const property of checker.getPropertiesOfType(type)) {
            const member = property.valueDeclaration ?? property.declarations?.[0];
            if (!member || (!ts.isPropertyDeclaration(member) && !ts.isPropertySignature(member)))
                continue;
            if (!member.name || (!ts.isIdentifier(member.name) && !ts.isStringLiteral(member.name)))
                continue;
            const modifiers = ts.canHaveModifiers(member) ? ts.getModifiers(member) : undefined;
            if (modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.PrivateKeyword || modifier.kind === ts.SyntaxKind.ProtectedKeyword))
                continue;
            const decorators = fieldDecoratorMetadata(member, imports, sourceFile);
            if (hasLazyTypeWrapper(member, imports))
                decorators.lazy = true;
            const allDecorators = ts.canHaveDecorators(member) ? (ts.getDecorators(member) ?? []) : [];
            const knownDecoratorCount = decoratorInfo(member, imports).length;
            const fieldType = toTypeRef(checker.getTypeOfSymbolAtLocation(property, member));
            const optional = Boolean(member.questionToken) || fieldType.optional || decorators.optional;
            const fieldName = property.getName();
            fields.push({
                name: fieldName,
                jsonName: decorators.alias ?? fieldName,
                kind: fieldType.ref.kind,
                type: fieldType.ref,
                nullable: fieldType.nullable,
                optional,
                defaultValue: ts.isPropertyDeclaration(member) ? literalValue(member.initializer, checker) : undefined,
                decorators,
                hostManaged: allDecorators.length > knownDecoratorCount || undefined,
            });
        }
        for (const field of fields) {
            const decorators = field.decorators;
            if (decorators?.omitIf) {
                decorators.omitIfPlan = compileOmitIfPlan(decorators.omitIf, decorators.omitIfParameter ?? "self", fields, `${name}.${field.name}`);
            }
        }
        const classDecorators = decoratorInfo(declaration, imports);
        const lazyMode = classLazyMode(declaration, imports);
        schemas.set(name, {
            name,
            fields,
            sourceFile: sourceFile.fileName,
            declarationKind: ts.isClassDeclaration(declaration) ? "class" : "interface",
            decorators: {
                json: explicitSchemaDeclarations.has(declaration) || classDecorators.some((item) => item.name === "json" || item.name === "serializable"),
                lazyMode,
            },
        });
    }
    // Resolve class policy after the reachable graph is complete so auto mode
    // can distinguish tiny scalar structs from expensive nested shapes.
    for (const schema of schemas.values()) {
        const mode = schema.decorators?.lazyMode ?? "none";
        for (const field of schema.fields) {
            const decorators = (field.decorators ??= {});
            if (decorators.lazy && decorators.eager)
                throw new Error(`${schema.name}.${field.name} cannot be both @lazy and @eager`);
            if (decorators.eager || decorators.omit || decorators.raw || decorators.codec || field.hostManaged) {
                decorators.lazy = false;
                continue;
            }
            if (decorators.lazy)
                continue;
            const type = field.type ?? { kind: field.kind };
            decorators.lazy = mode === "all" || (mode === "auto" && lazyAutoCost(type, schemas) >= 10);
        }
    }
    return { manifest: createSchemaManifest([...schemas.values()]), reachableTypes };
}
export function createProgramFromConfig(configPath) {
    const absoluteConfig = resolve(configPath);
    const config = ts.readConfigFile(absoluteConfig, ts.sys.readFile);
    if (config.error)
        throw new Error(ts.flattenDiagnosticMessageText(config.error.messageText, "\n"));
    const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, dirname(absoluteConfig));
    if (parsed.errors.length) {
        throw new Error(parsed.errors.map((error) => ts.flattenDiagnosticMessageText(error.messageText, "\n")).join("\n"));
    }
    return ts.createProgram({ rootNames: parsed.fileNames, options: parsed.options });
}
