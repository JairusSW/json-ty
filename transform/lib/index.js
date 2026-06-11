"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = default_1;
const ts = require("typescript");
class Property {
    name = "";
    node;
    alias = null;
    omit = false;
    omitif = null;
    protected = false;
    type = null;
    value = null;
    parent;
}
class PropertyType {
    node;
    text;
    rawText;
}
class Schema {
    name = "";
    node;
    members = [];
    parent = null;
    deps = [];
    eager = false; // @json({ eager: true }) -> flat eager parse
}
class Options {
    schema = null;
    schemas = [];
}
const self = new Options();
function default_1(program, pluginConfig, { ts: t }) {
    return (ctx) => {
        const { factory } = ctx;
        return (sourceFile) => {
            function visit(node) {
                if (t.isClassDeclaration(node)) {
                    const decorators = t.canHaveDecorators(node) ? t.getDecorators(node) : undefined;
                    if (!decorators || decorators.length === 0)
                        return node;
                    const hasJsonDecorator = decorators.some((decorator) => {
                        const expr = decorator.expression;
                        return (t.isIdentifier(expr) && expr.text === "json") || (t.isCallExpression(expr) && t.isIdentifier(expr.expression) && expr.expression.text === "json");
                    });
                    if (!hasJsonDecorator)
                        return node;
                    console.log("Found @json class:", node.name?.text);
                    const className = node.name;
                    if (!className)
                        return node;
                    const schema = new Schema();
                    schema.node = node;
                    schema.name = className.text;
                    // @json({ eager: true }) -> eager flat-table parse for this class
                    schema.eager = decorators.some((d) => {
                        const e = d.expression;
                        return t.isCallExpression(e) && t.isIdentifier(e.expression) && e.expression.text === "json" &&
                            e.arguments.length === 1 && t.isObjectLiteralExpression(e.arguments[0]) &&
                            e.arguments[0].properties.some((pr) => t.isPropertyAssignment(pr) && pr.name.getText(sourceFile) === "eager" && pr.initializer.kind === t.SyntaxKind.TrueKeyword);
                    });
                    self.schemas.push(schema);
                    self.schema = schema;
                    const properties = node.members.filter(t.isPropertyDeclaration);
                    const checker = program.getTypeChecker();
                    let newMembers = [...node.members];
                    for (const member of properties) {
                        const name = member.name?.getText(sourceFile) ?? "<unnamed>";
                        const symbol = checker.getSymbolAtLocation(member.name);
                        if (!symbol)
                            continue;
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
                        }
                        else {
                            prop.type.rawText = prop.type.text;
                        }
                        if (member.modifiers) {
                            for (const mod of member.modifiers) {
                                if (mod.kind === t.SyntaxKind.PrivateKeyword) {
                                    prop.omit = true;
                                }
                                else if (mod.kind === t.SyntaxKind.ProtectedKeyword) {
                                    prop.protected = true;
                                }
                            }
                        }
                        const decorators = t.canHaveDecorators(member) ? t.getDecorators(member) : undefined;
                        if (decorators) {
                            // Collect all decorators **except** `@alias(...)`
                            const newDecorators = [];
                            for (const decorator of decorators) {
                                const expr = decorator.expression;
                                if (t.isCallExpression(expr) &&
                                    t.isIdentifier(expr.expression) &&
                                    expr.expression.text === "alias" &&
                                    expr.arguments.length === 1 &&
                                    t.isStringLiteral(expr.arguments[0])) {
                                    prop.alias = expr.arguments[0].text;
                                    console.log("  [alias] " + prop.name + " -> " + prop.alias);
                                }
                                else if (t.isCallExpression(expr) &&
                                    t.isIdentifier(expr.expression) &&
                                    expr.expression.text === "omitif" &&
                                    expr.arguments.length === 1 &&
                                    t.isArrowFunction(expr.arguments[0])) {
                                    console.log("  [omitif] " + prop.name);
                                    prop.omitif = expr.arguments[0];
                                    const param = expr.arguments[0].parameters[0];
                                    const paramName = param.name.getText(sourceFile);
                                    const paramType = param.type;
                                    if (expr.arguments[0].body.kind !== t.SyntaxKind.Block && paramName !== "self") {
                                        throw new Error(`@omitif condition for property "${prop.name}" must have first parameter named "self". Got "${paramName}".`);
                                    }
                                    if (!paramType || !t.isTypeReferenceNode(paramType) || paramType.typeName.getText(sourceFile) !== schema.name) {
                                        const found = paramType?.getText(sourceFile) ?? "<missing>";
                                        throw new Error(`@omitif condition for property "${prop.name}" must have type "${schema.name}" on its first parameter. Got "${found}".`);
                                    }
                                }
                                else if (t.isIdentifier(expr) &&
                                    expr.text === "omit") {
                                    console.log("  [omit] " + prop.name);
                                    prop.omit = true;
                                }
                                else {
                                    newDecorators.push(decorator);
                                }
                            }
                            newMembers[newMembers.indexOf(member)] = factory.createPropertyDeclaration(undefined, // TODO: Users should be able to use their own decorators
                            member.name, member.questionToken || member.exclamationToken, member.type, member.initializer);
                        }
                        schema.members.push(prop);
                    }
                    let serializeExpr = factory.createStringLiteral("{");
                    for (let i = 0; i < schema.members.length; i++) {
                        const member = schema.members[i];
                        const isFirst = i === 0;
                        const isLast = i === schema.members.length - 1;
                        const name = member.alias || member.name;
                        const typeName = member.type?.text;
                        const rawTypeName = member.type?.rawText;
                        if (member.omit)
                            continue;
                        let chunk = null;
                        console.log(name + " -> " + rawTypeName);
                        if (typeName == "number" || typeName == "Number") {
                            if (rawTypeName == "int") {
                                const call = factory.createCallExpression(factory.createPropertyAccessExpression(factory.createIdentifier("__JSON_METHODS"), factory.createIdentifier("serializeInteger")), undefined, [factory.createPropertyAccessExpression(factory.createIdentifier("self"), factory.createIdentifier(member.name))]);
                                chunk = factory.createBinaryExpression(factory.createStringLiteral(`${isFirst ? "" : ","}"${name}":`), factory.createToken(t.SyntaxKind.PlusToken), call);
                            }
                            else {
                                const serializeCall = factory.createCallExpression(factory.createPropertyAccessExpression(factory.createIdentifier("__JSON_METHODS"), factory.createIdentifier("serializeFloat")), undefined, [factory.createPropertyAccessExpression(factory.createIdentifier("self"), factory.createIdentifier(member.name))]);
                                chunk = factory.createBinaryExpression(factory.createStringLiteral(`${isFirst ? "" : ","}"${name}":`), factory.createToken(t.SyntaxKind.PlusToken), serializeCall);
                            }
                        }
                        else if (typeName === "string" || typeName === "String") {
                            const call = factory.createCallExpression(factory.createPropertyAccessExpression(factory.createIdentifier("__JSON_METHODS"), factory.createIdentifier("serializeString")), undefined, [factory.createPropertyAccessExpression(factory.createIdentifier("self"), factory.createIdentifier(member.name))]);
                            chunk = factory.createBinaryExpression(factory.createStringLiteral(`${isFirst ? "" : ","}"${name}":`), factory.createToken(t.SyntaxKind.PlusToken), call);
                        }
                        else if (typeName === "boolean" || typeName === "Boolean") {
                            const call = factory.createCallExpression(factory.createPropertyAccessExpression(factory.createIdentifier("__JSON_METHODS"), factory.createIdentifier("serializeBool")), undefined, [factory.createPropertyAccessExpression(factory.createIdentifier("self"), factory.createIdentifier(member.name))]);
                            chunk = factory.createBinaryExpression(factory.createStringLiteral(`${isFirst ? "" : ","}"${name}":`), factory.createToken(t.SyntaxKind.PlusToken), call);
                        }
                        else if (typeName.startsWith("Array<") || typeName.endsWith("[]")) {
                            // Specialize on the element type: primitives use typed concat/
                            // native-delegating serializers, struct arrays must go through
                            // each element's __JSON_SERIALIZE (native can't honor @alias/@omit),
                            // and anything else falls back to the native whole-array serializer.
                            const elem = typeName.endsWith("[]")
                                ? typeName.slice(0, -2).trim()
                                : typeName.slice(6, -1).trim();
                            const rawElem = rawTypeName?.endsWith("[]")
                                ? rawTypeName.slice(0, -2).trim()
                                : rawTypeName?.startsWith("Array<")
                                    ? rawTypeName.slice(6, -1).trim()
                                    : elem;
                            let method;
                            const extraArgs = [];
                            if (elem === "number" || elem === "Number") {
                                method = rawElem === "int" ? "serializeIntegerArray" : "serializeFloatArray";
                            }
                            else if (elem === "string" || elem === "String") {
                                method = "serializeStringArray";
                            }
                            else if (elem === "boolean" || elem === "Boolean") {
                                method = "serializeBoolArray";
                            }
                            else if (self.schemas.some((v) => v.name === elem.split("<")[0])) {
                                method = "serializeStructArray";
                                extraArgs.push(factory.createIdentifier(elem));
                            }
                            else {
                                method = "serializeArray";
                            }
                            const call = factory.createCallExpression(factory.createPropertyAccessExpression(factory.createIdentifier("__JSON_METHODS"), factory.createIdentifier(method)), undefined, [factory.createPropertyAccessExpression(factory.createIdentifier("self"), factory.createIdentifier(member.name)), ...extraArgs]);
                            chunk = factory.createBinaryExpression(factory.createStringLiteral(`${isFirst ? "" : ","}"${name}":`), factory.createToken(t.SyntaxKind.PlusToken), call);
                        }
                        else if (self.schemas.some((v) => v.name == typeName?.split("<")[0])) {
                            const call = factory.createCallExpression(factory.createPropertyAccessExpression(factory.createIdentifier("__JSON_METHODS"), factory.createIdentifier("serializeStruct")), undefined, [factory.createPropertyAccessExpression(factory.createIdentifier("self"), factory.createIdentifier(member.name)), factory.createIdentifier(stripNull(member.type?.text))]);
                            chunk = factory.createBinaryExpression(factory.createStringLiteral(`${isFirst ? "" : ","}"${name}":`), factory.createToken(t.SyntaxKind.PlusToken), call);
                        }
                        else {
                            const call = factory.createCallExpression(factory.createPropertyAccessExpression(factory.createIdentifier("__JSON"), factory.createIdentifier("stringify")), undefined, [factory.createPropertyAccessExpression(factory.createIdentifier("self"), factory.createIdentifier(member.name))]);
                            chunk = factory.createBinaryExpression(factory.createStringLiteral(`${isFirst ? "" : ","}"${name}":`), factory.createToken(t.SyntaxKind.PlusToken), call);
                        }
                        if (!chunk)
                            continue;
                        if (member.omitif) {
                            if (member.omitif.body.kind !== t.SyntaxKind.Block) {
                                chunk = factory.createParenthesizedExpression(factory.createBinaryExpression(factory.createParenthesizedExpression(factory.createBinaryExpression(factory.createPrefixUnaryExpression(t.SyntaxKind.ExclamationToken, factory.createParenthesizedExpression(member.omitif.body)), factory.createToken(t.SyntaxKind.AmpersandAmpersandToken), chunk)), factory.createToken(t.SyntaxKind.BarBarToken), factory.createStringLiteral("", false)));
                            }
                            else {
                                chunk = factory.createParenthesizedExpression(factory.createBinaryExpression(factory.createParenthesizedExpression(factory.createBinaryExpression(factory.createCallExpression(factory.createParenthesizedExpression(member.omitif), undefined, [factory.createIdentifier("self")]), factory.createToken(t.SyntaxKind.AmpersandAmpersandToken), chunk)), factory.createToken(t.SyntaxKind.BarBarToken), factory.createStringLiteral("", false)));
                            }
                            serializeExpr = factory.createBinaryExpression(serializeExpr, factory.createToken(t.SyntaxKind.PlusToken), chunk);
                        }
                        else {
                            serializeExpr = factory.createBinaryExpression(serializeExpr, factory.createToken(t.SyntaxKind.PlusToken), chunk);
                        }
                    }
                    serializeExpr = factory.createBinaryExpression(serializeExpr, factory.createToken(t.SyntaxKind.PlusToken), factory.createStringLiteral("}"));
                    let instantiateStmts = [];
                    const instantiateMethod = factory.createMethodDeclaration([factory.createToken(t.SyntaxKind.StaticKeyword)], undefined, factory.createIdentifier("__JSON_INSTANTIATE"), undefined, undefined, [], factory.createTypeReferenceNode(schema.node.name, undefined), factory.createBlock([
                        factory.createVariableStatement(undefined, factory.createVariableDeclarationList([factory.createVariableDeclaration(factory.createIdentifier("o"), undefined, undefined, factory.createNewExpression(schema.node.name, undefined, []))], t.NodeFlags.Const)),
                        factory.createReturnStatement(factory.createIdentifier("o"))
                    ], true));
                    const serializeMethod = factory.createMethodDeclaration([factory.createToken(t.SyntaxKind.StaticKeyword)], undefined, factory.createIdentifier("__JSON_SERIALIZE"), undefined, undefined, [factory.createParameterDeclaration(undefined, undefined, factory.createIdentifier("self"), undefined, factory.createTypeReferenceNode(factory.createIdentifier(schema.name), undefined), undefined)], factory.createKeywordTypeNode(t.SyntaxKind.StringKeyword), factory.createBlock([factory.createReturnStatement(schema.members.length === 0 ? factory.createStringLiteral("{}") : serializeExpr)], true));
                    const deserializeStatements = [factory.createVariableStatement(undefined, factory.createVariableDeclarationList([factory.createVariableDeclaration(factory.createIdentifier("obj"), undefined, undefined, factory.createCallExpression(factory.createPropertyAccessExpression(factory.createIdentifier("JSON"), factory.createIdentifier("parse")), undefined, [factory.createIdentifier("data")]))], t.NodeFlags.Const)), factory.createVariableStatement(undefined, factory.createVariableDeclarationList([factory.createVariableDeclaration(factory.createIdentifier("instance"), undefined, undefined, factory.createNewExpression(factory.createIdentifier(schema.name), undefined, []))], t.NodeFlags.Const))];
                    const deserializeMethod = factory.createMethodDeclaration([factory.createToken(t.SyntaxKind.StaticKeyword)], undefined, factory.createIdentifier("__JSON_DESERIALIZE"), undefined, undefined, [factory.createParameterDeclaration(undefined, undefined, factory.createIdentifier("data"), undefined, factory.createKeywordTypeNode(t.SyntaxKind.StringKeyword), undefined)], factory.createTypeReferenceNode(factory.createIdentifier(schema.name), undefined), factory.createBlock(deserializeStatements, true));
                    newMembers = [...newMembers, instantiateMethod, serializeMethod, deserializeMethod];
                    const newModifiers = node.modifiers ? factory.createNodeArray(node.modifiers.filter((mod) => !t.isDecorator(mod))) : undefined;
                    const updatedClass = factory.updateClassDeclaration(node, newModifiers, node.name, node.typeParameters, node.heritageClauses, factory.createNodeArray(newMembers));
                    console.log("Transformed class:\n" + t.createPrinter().printNode(t.EmitHint.Unspecified, updatedClass, sourceFile));
                    return t.visitNode(updatedClass, visit);
                }
                // Rewrite JSON.parse<T>(x) / JSON.parse<T[]>(x) into a view construction.
                else if (t.isCallExpression(node) &&
                    node.typeArguments && node.typeArguments.length === 1 &&
                    t.isPropertyAccessExpression(node.expression) &&
                    node.expression.name.text === "parse") {
                    const ta = node.typeArguments[0];
                    const arg = node.arguments[0] ?? factory.createIdentifier("undefined");
                    const sid = (tn) => factory.createPropertyAccessExpression(factory.createIdentifier(`__View_${tn}`), factory.createIdentifier("__sid"));
                    const view = (tn) => factory.createIdentifier(`__View_${tn}`);
                    // JSON.parse<T>(x): eager -> parseEager(sid, View, x); lazy -> new View(parse(sid, x))
                    if (t.isTypeReferenceNode(ta) && t.isIdentifier(ta.typeName)) {
                        const tn = ta.typeName.getText(sourceFile);
                        const sch = self.schemas.find((s) => s.name === tn);
                        if (sch && sch.eager)
                            return factory.createCallExpression(factory.createIdentifier("__JSONparseEager"), undefined, [sid(tn), view(tn), arg]);
                        if (sch)
                            return factory.createNewExpression(view(tn), undefined, [factory.createCallExpression(factory.createIdentifier("__JSONparse"), undefined, [sid(tn), arg])]);
                    }
                    // JSON.parse<T[]>(x): eager -> parseEagerArrViews; lazy -> parseStructArray
                    if (t.isArrayTypeNode(ta) && t.isTypeReferenceNode(ta.elementType) && t.isIdentifier(ta.elementType.typeName)) {
                        const tn = ta.elementType.typeName.getText(sourceFile);
                        const sch = self.schemas.find((s) => s.name === tn);
                        if (sch)
                            return factory.createCallExpression(factory.createIdentifier(sch.eager ? "__JSONparseEagerArr" : "__JSONparseArrV"), undefined, [sid(tn), view(tn), arg]);
                    }
                }
                return t.visitEachChild(node, visit, ctx);
            }
            let src = t.visitNode(sourceFile, visit);
            if (self.schema) {
                self.schema = null;
                console.log("Updating source file");
                // Generate the parse-side: runtime import + a lazy View class per schema.
                let runtimeImport = `import { makeView as __JSONmakeView, parse as __JSONparse, parseStructArray as __JSONparseArrV, LEAF as __JSONLEAF, PRIM as __JSONPRIM } from "./wasm/runtime.js";`;
                if (self.schemas.some((s) => s.eager))
                    runtimeImport += `\nimport { makeEagerView as __JSONmakeEagerView, parseEager as __JSONparseEager, parseEagerArrViews as __JSONparseEagerArr } from "./wasm/eager-rt.js";`;
                const views = self.schemas.map((s) => genView(s, self.schemas)).join("\n");
                const genStatements = ts
                    .createSourceFile("__jsonty_gen.ts", runtimeImport + "\n" + views, ts.ScriptTarget.Latest, /*setParentNodes*/ true, ts.ScriptKind.JS)
                    .statements;
                // Mark synthesized (pos/end = -1) so the printer emits them structurally
                // instead of reading text from the (wrong) host-file positions.
                const synthesize = (n) => { n.pos = -1; n.end = -1; ts.forEachChild(n, synthesize); };
                genStatements.forEach(synthesize);
                src = factory.updateSourceFile(sourceFile, [
                    factory.createImportDeclaration(undefined, factory.createImportClause(false, undefined, factory.createNamedImports([factory.createImportSpecifier(false, factory.createIdentifier("JSON"), factory.createIdentifier("__JSON"))])), factory.createStringLiteral("./index.js"), undefined),
                    factory.createImportDeclaration(undefined, factory.createImportClause(false, undefined, factory.createNamespaceImport(factory.createIdentifier("__JSON_METHODS"))), factory.createStringLiteral("./exports.js"), undefined),
                    ...genStatements,
                    ...src.statements,
                ]);
            }
            return src;
        };
    };
}
console.log("Transformer initiated");
function stripNull(ty) {
    return ty.replaceAll(" | null", "");
}
// Generate a data-only makeView() call for one @json class. Emits no methods or
// `this` — the runtime builds the getter class — so the TS checker is happy.
function genView(schema, all) {
    const isSchema = (name) => all.some((s) => s.name === name);
    const keys = [];
    const childSids = [];
    const fields = [];
    let idx = 0;
    for (const m of schema.members) {
        if (m.omit)
            continue;
        const key = m.alias || m.name;
        const ty = (m.type?.text ?? "").trim();
        let kind = "str";
        let child = "__JSONLEAF";
        let childName = "";
        if (ty === "number" || ty === "Number")
            kind = "num";
        else if (ty === "string" || ty === "String")
            kind = "str";
        else if (ty === "boolean" || ty === "Boolean")
            kind = "bool";
        else if (ty.endsWith("[]") || ty.startsWith("Array<")) {
            const elem = (ty.endsWith("[]") ? ty.slice(0, -2) : ty.slice(6, -1)).trim();
            if (elem === "number" || elem === "Number") {
                kind = "numArray";
                child = "__JSONPRIM";
            }
            else if (elem === "string" || elem === "String") {
                kind = "strArray";
                child = "__JSONPRIM";
            }
            else if (isSchema(elem)) {
                kind = "structArray";
                child = `__View_${elem}.__sid`;
                childName = elem;
            }
            else {
                kind = "numArray";
                child = "__JSONPRIM";
            }
        }
        else {
            const base = stripNull(ty).trim();
            if (isSchema(base)) {
                kind = "child";
                child = `__View_${base}.__sid`;
                childName = base;
            }
            else
                kind = "str"; // unknown -> raw string fallback
        }
        keys.push(JSON.stringify(key));
        childSids.push(child);
        const spec = childName ? `["${kind}", ${idx}, ${JSON.stringify(childName)}]` : `["${kind}", ${idx}]`;
        fields.push(`${JSON.stringify(m.name)}: ${spec}`);
        idx++;
    }
    const factory = schema.eager ? "__JSONmakeEagerView" : "__JSONmakeView";
    return `const __View_${schema.name} = ${factory}([${keys.join(", ")}], [${childSids.join(", ")}], {${fields.join(", ")}}, ${JSON.stringify(schema.name)});`;
}
