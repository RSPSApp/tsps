import { strict as assert } from "node:assert";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { XpState, type XpSave } from "../game/plugins/xptracker/xpState";
import { SKILL_IDS, SkillId } from "../rs/skill/skills";

// An external review binds each revision's complete plugin bytes and extracted body;
// the same fixture can then exercise either revision without pinning the old body here.
const manifestPath = process.env.XP_TRACKER_SOURCE_MANIFEST;
const manifest = manifestPath ? JSON.parse(readFileSync(manifestPath, "utf8")) as {
    sourcePath: string; sourceSha256: string; bodySha256: string;
} : undefined;
const sha = (bytes: string | Buffer) => createHash("sha256").update(bytes).digest("hex");
if (manifest) {
    assert.match(manifest.sourceSha256, /^[0-9a-f]{64}$/);
    assert.match(manifest.bodySha256, /^[0-9a-f]{64}$/);
}
const sourceBytes = readFileSync(manifest?.sourcePath ?? "game/plugins/xptracker/XpTrackerPlugin.ts");
if (manifest) assert.equal(sha(sourceBytes), manifest.sourceSha256, "reviewed plugin source identity");
const source = ts.createSourceFile("XpTrackerPlugin.ts", sourceBytes.toString("utf8"), ts.ScriptTarget.Latest, true);
const classes = source.statements.filter((node): node is ts.ClassDeclaration =>
    ts.isClassDeclaration(node) && node.name?.text === "XpTrackerPlugin");
assert.equal(classes.length, 1, "one production plugin class");
const methods = classes[0].members.filter((node): node is ts.MethodDeclaration =>
    ts.isMethodDeclaration(node) && node.name.getText(source) === "initializeAfterLogin");
assert.equal(methods.length, 1, "one production restore method");
const method = methods[0];
assert.equal(method.parameters.length, 0);
assert.ok(method.body);
const body = method.body.getText(source);
if (manifest) assert.equal(sha(body), manifest.bodySha256, "reviewed complete method-body identity");

// Reject new receiver dependencies rather than silently supplying invented behavior.
const allowedReceiverProperties = new Set([
    "account", "lastAccount", "saveState", "resetState", "xpState", "config", "loadSave",
    "experience", "goals", "clearSave", "overallExperience", "now", "emit",
]);
function inspect(node: ts.Node): void {
    if (node.kind === ts.SyntaxKind.ThisKeyword) {
        assert.ok(ts.isPropertyAccessExpression(node.parent) && node.parent.expression === node,
            "only named receiver properties are permitted");
        assert.ok(allowedReceiverProperties.has(node.parent.name.text),
            `unexpected receiver dependency: ${node.parent.name.text}`);
    }
    if (ts.isIdentifier(node) && !(ts.isPropertyAccessExpression(node.parent) && node.parent.name === node)) {
        assert.ok(new Set(["account", "save", "shouldRestore", "skill", "xp", "state", "overall", "total", "SKILL_IDS", "undefined"]).has(node.text),
            `unexpected identifier: ${node.text}`);
    }
    ts.forEachChild(node, inspect);
}
inspect(method.body);
const compiled = ts.transpileModule(`module.exports = function() ${body}`, {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
    reportDiagnostics: true,
});
assert.equal((compiled.diagnostics ?? []).filter(d => d.category === ts.DiagnosticCategory.Error).length, 0);
const moduleBox: { exports?: (this: unknown) => void } = {};
runInNewContext(compiled.outputText, { module: moduleBox, SKILL_IDS }, { timeout: 1000 });
assert.equal(typeof moduleBox.exports, "function");
const initializeAfterLogin = moduleBox.exports!;

function makeSave(): XpSave {
    const state = new XpState();
    state.initializeOverall(SKILL_IDS.length * 1000);
    state.updateSkill(SkillId.Cooking, 1000, -1, -1, 1000, false);
    state.updateSkill(SkillId.Cooking, 1100, -1, -1, 1000, false);
    state.updateOverall(SKILL_IDS.length * 1000 + 100, 1000);
    const save = state.save();
    assert.ok(save);
    assert.equal(save.skills.COOKING.ar, 100);
    return save;
}

function restore(currentXp: number, goals: [number, number]) {
    const xpState = new XpState();
    const experience = new Map(SKILL_IDS.map(skill => [skill, skill === SkillId.Cooking ? currentXp : 1000]));
    const save = makeSave();
    let emitted: ReturnType<NonNullable<ReturnType<XpState["get"]>>["snapshot"]> | undefined;
    const receiver = {
        xpState, experience, lastAccount: "synthetic",
        account: () => "synthetic", config: { saveState: () => true },
        loadSave: () => save, goals: () => goals, now: () => 2000,
        overallExperience: () => [...experience.values()].reduce((sum, xp) => sum + xp, 0),
        saveState: () => { throw new Error("unexpected account change"); },
        resetState: () => { throw new Error("unexpected reset"); },
        clearSave: () => { throw new Error("unexpected save clear"); },
        emit: () => { emitted = xpState.get(SkillId.Cooking)?.snapshot(); },
    };
    runInNewContext("initializeAfterLogin.call(receiver)", { initializeAfterLogin, receiver }, { timeout: 1000 });
    const cooking = xpState.get(SkillId.Cooking);
    assert.ok(cooking && emitted, "restored skill is present at emission");
    assert.equal(cooking.currentXp, currentXp);
    assert.equal(emitted.xpGainedInSession, 100, "offline XP is excluded from session gain");
    return { xpState, cooking, emitted };
}

// Both controls precede the boundary-crossing assertion.
const withinLevel = restore(1120, [-1, -1]);
assert.deepEqual([withinLevel.emitted.startGoalXp, withinLevel.emitted.endGoalXp], [969, 1154]);
const validGoal = restore(1500, [1000, 2000]);
assert.deepEqual([validGoal.emitted.startGoalXp, validGoal.emitted.endGoalXp], [1000, 2000]);

// A same-XP update does not refresh goals; a subsequent gain does.
const recovery = restore(1500, [-1, -1]);
const beforeNoChange = [recovery.cooking.startLevelExp, recovery.cooking.endLevelExp];
assert.equal(recovery.xpState.updateSkill(SkillId.Cooking, 1500, -1, -1, 3000, false), "NO_CHANGE");
assert.deepEqual([recovery.cooking.startLevelExp, recovery.cooking.endLevelExp], beforeNoChange);
assert.equal(recovery.xpState.updateSkill(SkillId.Cooking, 1510, -1, -1, 4000, false), "UPDATED");
assert.deepEqual([recovery.cooking.startLevelExp, recovery.cooking.endLevelExp], [1358, 1584]);
assert.equal(recovery.cooking.totalXpGained, 110);

const crossed = restore(1500, [-1, -1]);
assert.deepEqual([crossed.emitted.startGoalXp, crossed.emitted.endGoalXp, crossed.emitted.xpRemainingToGoal],
    [1358, 1584, 84], "restored goal follows current XP after an offline level crossing");

console.log("xp tracker restore goal method tests passed");
