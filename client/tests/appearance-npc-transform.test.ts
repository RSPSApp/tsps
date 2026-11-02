import assert from "assert";
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import { PlayerAppearance } from "../rs/config/player/PlayerAppearance";
import { PlayerDesignController } from "../game/widgets/PlayerDesignController";
import { encodePlayerAppearance } from "../../server/src/main/typescript/elvarg/net/protocol/ClientProtocol";
import { decodeAppearanceBinary } from "../game/sync/AppearanceDecoder";

const bytes = new Uint8Array([
    0, 255, 255, 255, 255, 0, 172,
    0, 0, 0, 0, 0,
    3, 40, 3, 55, 3, 51, 3, 52, 3, 53, 3, 54, 3, 56,
    84, 111, 98, 121, 0,
    3, 0, 32, 0, 0, 0, 0, 0, 0, 0,
    0, 0, 0, 0, 255, 255, 255, 255,
]);
const appearance = decodeAppearanceBinary(bytes);
assert.strictEqual(appearance?.npcTransformationId, 172);
assert.strictEqual(appearance?.name, "Toby");

const ringAppearance = decodeAppearanceBinary(new Uint8Array([
    0, 255, 255,
    ...new Array(24).fill(0),
    ...new Array(5).fill(0),
    ...new Array(14).fill(0),
    82, 105, 110, 103, 0,
    3, 0, 32, 0, 0, 0,
    0, 0, 0, 0,
    0, 0, 0, 0,
    255, 255, 255, 255,
    0, 0, 46, 204,
]));
assert.strictEqual(ringAppearance?.equipment[9], 11980);


for (const pronouns of [0, 1, 2]) {
    const payload = bytes.slice();
    // Native tail follows three empty actions, before this fixture's ammo extension.
    payload[40] = pronouns;
    const decoded = decodeAppearanceBinary(payload);
    assert.strictEqual(decoded?.gender, 0);
    assert.strictEqual(decoded?.pronouns, pronouns);
}

console.log("npc-transform and pronoun appearance decode passed");


// Exercise the production receiver without constructing the browser/GPU, as widget-cache-panels does.
const source = ts.createSourceFile("OsrsClient.ts", fs.readFileSync(path.resolve(__dirname, "../game/OsrsClient.ts"), "utf8"), ts.ScriptTarget.Latest, true);
const clientClass = source.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === "OsrsClient") as ts.ClassDeclaration;
const methods = clientClass.members.filter(node => ts.isMethodDeclaration(node) &&
    ["buildPlayerAppearanceFromPayload", "applyBitstreamAppearance"].includes(node.name.getText(source)))
    .map(node => node.getText(source).replace(/^private /, ""));
assert.equal(methods.length, 2);
const receiverCode = ts.transpileModule("class Receiver {" + methods.join("\n") + "} return Receiver;", {
    compilerOptions: { target: ts.ScriptTarget.ES2020 },
}).outputText;
const Receiver = new Function("PlayerAppearance", receiverCode)(PlayerAppearance);
let preview = new PlayerAppearance(0, [0, 0, 0, 0, 0], [0, 1, 2, 3, 4, 5, 6]);
const varbits = new Map<number, number>();
const ecs: any = {
    getIndexForServerId: () => 0, getAppearance: () => preview,
    setAppearance: (_index: number, next: PlayerAppearance) => { preview = next; },
    ensureBaseForIndex() {}, setIsHidden() {}, setHeadIconPrayer() {}, setHeadIconPk() {}, setTeam() {},
};
let mounted = true;
const widgetManager: any = {
    getInterfaceParentContainerUid: () => mounted ? 1 : undefined,
    findWidget: () => undefined, findLoadedWidget: () => undefined,
};
const varManager: any = { setVarbit: (id: number, value: number) => varbits.set(id, value) };
const designer = new PlayerDesignController({
    getIdkTypeLoader: () => ({ getCount: () => 14, load: (id: number) => ({ bodyPartId: id }) }),
    getControlledPlayerServerId: () => 1, playerEcs: ecs, widgetManager, varManager,
} as any);
assert.equal(designer.handleWidgetAction(69), true);
assert.equal(designer.handleWidgetAction(47), true);
const editedKits = [...preview.kits], editedColours = [...preview.colors];
const receiver = new Receiver();
Object.assign(receiver, { playerEcs: ecs, controlledPlayerServerId: 1, playerDesign: designer,
    widgetManager, varManager, syncEquipmentInventory() {}, objTypeLoader: { load: () => ({}) } });
for (const pronouns of [2, 1, 0]) {
    const encoded = encodePlayerAppearance({ gender: 0, pronouns, colors: [0, 0, 0, 0, 0],
        kits: [0, 1, 2, 3, 4, 5, 6], equip: new Array(14).fill(-1) }, "Preview", 3, 32, [808, 823, 819, 820, 821, 822, 824]);
    const decoded = decodeAppearanceBinary(encoded)!;
    const update = { appearance: { ...decoded, equip: decoded.equipment } };
    receiver.applyBitstreamAppearance(1, update);
    assert.equal(preview.gender, 1, "a pronoun update retains the unconfirmed body B");
    assert.equal(varbits.get(14021), 1);
    assert.deepEqual(preview.kits, editedKits);
    assert.deepEqual(preview.colors, editedColours);
    assert.equal(preview.pronouns, pronouns);
    mounted = false;
    receiver.applyBitstreamAppearance(1, update);
    assert.equal(preview.gender, 0, "after closing, the server appearance is authoritative");
    mounted = true;
}
console.log("native pronoun updates preserve active designer edits passed");
