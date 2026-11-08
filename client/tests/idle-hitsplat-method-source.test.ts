import { strict as assert } from "node:assert";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";

// The optional external manifest binds each reviewed revision. Without it the normal client
// test runner reads the current sources, but still rejects unknown AST and receiver dependencies.
type Manifest = {
    idleSourceSha256: string; hitBodySha256: string; constantSha256: string;
    pluginSourceSha256: string; getterBodySha256: string; dependencies: string[];
};
const manifestPath = process.env.IDLE_HITSPLAT_SOURCE_MANIFEST;
const manifest = manifestPath ? JSON.parse(readFileSync(manifestPath, "utf8")) as Manifest : undefined;
const sha = (data: string | Buffer) => createHash("sha256").update(data).digest("hex");
const expectedDependencies = ["HIGHEST_MONSTER_ATTACK_SPEED", "event.targetId", "event.targetType", "this.isStarted", "this.lastCombatCountdown", "this.osrsClient", "this.osrsClient?.controlledPlayerServerId", "this.started"];
if (manifest) {
    assert.deepEqual(Object.keys(manifest).sort(), ["constantSha256", "dependencies", "getterBodySha256", "hitBodySha256", "idleSourceSha256", "pluginSourceSha256"].sort());
    for (const key of ["idleSourceSha256", "hitBodySha256", "constantSha256", "pluginSourceSha256", "getterBodySha256"] as const) assert.match(manifest[key], /^[0-9a-f]{64}$/);
    assert.deepEqual([...manifest.dependencies].sort(), manifest.dependencies);
    assert.equal(new Set(manifest.dependencies).size, manifest.dependencies.length);
    assert.ok(manifest.dependencies.every(dependency => expectedDependencies.includes(dependency)));
}
function source(path: string, expected?: string): ts.SourceFile {
    const bytes = readFileSync(path);
    if (expected) assert.equal(sha(bytes), expected, `source identity: ${path}`);
    const text = bytes.toString("utf8");
    assert.deepEqual(Buffer.from(text, "utf8"), bytes);
    const file = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    assert.equal((file as ts.SourceFile & { parseDiagnostics: readonly ts.Diagnostic[] }).parseDiagnostics.length, 0);
    return file;
}
const idle = source("game/plugins/idlenotifier/IdleNotifierPlugin.ts", manifest?.idleSourceSha256);
const base = source("runelite/client/plugins/Plugin.ts", manifest?.pluginSourceSha256);
function method(file: ts.SourceFile, className: string, name: string, paramType: string | null, result: string): ts.MethodDeclaration {
    const classes = file.statements.filter((n): n is ts.ClassDeclaration => ts.isClassDeclaration(n) && n.name?.text === className);
    assert.equal(classes.length, 1);
    const methods = classes[0].members.filter((n): n is ts.MethodDeclaration => ts.isMethodDeclaration(n) && ts.isIdentifier(n.name) && n.name.text === name);
    assert.equal(methods.length, 1);
    const m = methods[0];
    assert.ok(m.body && !m.asteriskToken && !m.questionToken && !m.typeParameters && !m.modifiers?.length);
    assert.equal(m.parameters.length, paramType ? 1 : 0);
    if (paramType) {
        const p = m.parameters[0];
        assert.ok(ts.isIdentifier(p.name) && p.name.text === "event" && p.type && ts.isTypeReferenceNode(p.type) && ts.isIdentifier(p.type.typeName) && p.type.typeName.text === paramType);
        assert.ok(!p.modifiers?.length && !p.dotDotDotToken && !p.questionToken && !p.initializer && !p.type.typeArguments);
    }
    assert.equal(m.type?.getText(file), result);
    return m;
}
const hit = method(idle, "IdleNotifierPlugin", "onHitsplat", "HitsplatEventPayload", "void");
const getter = method(base, "Plugin", "isStarted", null, "boolean");
const declarations = idle.statements.filter((n): n is ts.VariableStatement => ts.isVariableStatement(n) && n.declarationList.declarations.some(d => ts.isIdentifier(d.name) && d.name.text === "HIGHEST_MONSTER_ATTACK_SPEED"));
assert.equal(declarations.length, 1);
const declaration = declarations[0];
assert.equal(declaration.declarationList.flags & ts.NodeFlags.Const, ts.NodeFlags.Const);
assert.equal(declaration.declarationList.declarations.length, 1);
const d = declaration.declarationList.declarations[0];
assert.ok(!declaration.modifiers?.length && !d.type && d.initializer && ts.isNumericLiteral(d.initializer) && d.initializer.text === "8");
const hitBody = hit.body!.getText(idle), getterBody = getter.body!.getText(base), constant = declaration.getText(idle);
if (manifest) {
    assert.equal(sha(hitBody), manifest.hitBodySha256);
    assert.equal(sha(getterBody), manifest.getterBodySha256);
    assert.equal(sha(constant), manifest.constantSha256);
}
const K = ts.SyntaxKind;
const hitKinds = new Set([K.Block, K.FirstStatement, K.VariableDeclarationList, K.VariableDeclaration, K.Identifier, K.PropertyAccessExpression, K.QuestionDotToken, K.ThisKeyword, K.IfStatement, K.BinaryExpression, K.AmpersandAmpersandToken, K.EqualsEqualsEqualsToken, K.ExclamationEqualsEqualsToken, K.StringLiteral, K.ExpressionStatement, K.EqualsToken, K.ReturnStatement, K.PrefixUnaryExpression, K.ExclamationToken, K.CallExpression]);
const hitNames = new Set(["event", "local", "osrsClient", "controlledPlayerServerId", "targetType", "undefined", "targetId", "lastCombatCountdown", "HIGHEST_MONSTER_ATTACK_SPEED", "isStarted"]);
const hitAccesses = new Set(["this.osrsClient?.controlledPlayerServerId", "this.osrsClient", "event.targetType", "event.targetId", "this.lastCombatCountdown", "this.isStarted"]);
const actualDependencies = new Set(["HIGHEST_MONSTER_ATTACK_SPEED"]);
function inspect(node: ts.Node, kinds: Set<ts.SyntaxKind>, names: Set<string>, accesses: Set<string>): void {
    assert.ok(kinds.has(node.kind), `unreviewed AST node ${ts.SyntaxKind[node.kind]}`);
    if (ts.isIdentifier(node)) assert.ok(names.has(node.text), `unreviewed identifier ${node.text}`);
    if (ts.isPropertyAccessExpression(node)) {
        const property = node.getText();
        assert.ok(accesses.has(property), `unreviewed property ${property}`);
        actualDependencies.add(property);
    }
    if (ts.isCallExpression(node)) assert.ok(node.expression.getText() === "this.isStarted" && node.arguments.length === 0 && !node.typeArguments && !node.questionDotToken, "only the exact getter call is permitted");
    if (node.kind === K.ThisKeyword) assert.ok(ts.isPropertyAccessExpression(node.parent) && node.parent.expression === node, "receiver may only use named properties");
    ts.forEachChild(node, child => inspect(child, kinds, names, accesses));
}
inspect(hit.body!, hitKinds, hitNames, hitAccesses);
inspect(getter.body!, new Set([K.Block, K.ReturnStatement, K.PropertyAccessExpression, K.ThisKeyword, K.Identifier]), new Set(["started"]), new Set(["this.started"]));
if (manifest) assert.deepEqual([...actualDependencies].sort(), manifest.dependencies);
// Compile only the reviewed bodies and exact constant; bound both definition and invocation.
const compiled = ts.transpileModule(`${constant}\nmodule.exports = { hit: function(event) ${hitBody}, getter: function() ${getterBody} };`, {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS }, reportDiagnostics: true,
});
assert.equal((compiled.diagnostics ?? []).filter(diagnostic => diagnostic.category === ts.DiagnosticCategory.Error).length, 0);
const box: { exports?: { hit: (event: unknown) => void; getter: () => boolean } } = {};
runInNewContext(compiled.outputText, { module: box }, { timeout: 1000 });
assert.ok(box.exports);
const methods = box.exports;
function invoke(started: boolean, countdown: number, targetId: number): { getter: boolean; countdown: number } {
    const receiver = { started, osrsClient: { controlledPlayerServerId: 3 }, lastCombatCountdown: countdown, isStarted: methods!.getter };
    const context = { receiver, methods, event: { targetType: "player", targetId, damage: 1 } };
    return runInNewContext("({ getter: methods.getter.call(receiver), countdown: (methods.hit.call(receiver, event), receiver.lastCombatCountdown) })", context, { timeout: 1000 }) as { getter: boolean; countdown: number };
}
const running = invoke(true, 0, 3);
assert.equal(running.getter, true);
assert.equal(running.countdown, 8, "running local hit");
assert.equal(invoke(true, 2, 4).countdown, 2, "running other-player hit");
for (const prior of [0, 3]) {
    const stopped = invoke(false, prior, 3);
    assert.equal(stopped.getter, false);
    assert.equal(stopped.countdown, prior, "stopped local hit preserves countdown");
}
