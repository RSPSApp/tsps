import { strict as assert } from "node:assert";
import {
    compareWornGear,
    itemAttackSpeed,
    itemEquipSlot,
    itemEquipSlots,
    readItemStats,
} from "../game/plugins/itemstats/itemStats";
import { FOOD_DEFINITIONS, foodStatsForName, potionStatsForName, runeStatsForName } from "../game/plugins/itemstats/consumableStats";
import {
    fallbackInteractionBounds,
    findInteractionTextBounds,
    findMouseoverTimerBounds,
    positionTooltip,
} from "../game/plugins/itemstats/tooltipPosition";
import { ItemStatsPlugin } from "../game/plugins/itemstats/ItemStatsPlugin";
import { findFoodDefinition, formatPoisonImmunity, formatRestore, readFoodStats } from "../game/plugins/itemstats/foodStats";
import { GameState } from "../runelite/api/GameState";
import { buildCombatStatGroups } from "../game/plugins/itemstats/itemStatsPresentation";
import { BANKMAIN, INVENTORY } from "../runelite/api/gameval/InterfaceID";

async function main(): Promise<void> {
const item = (params: Record<number, number>) => ({ params: { get: (key: number) => params[key] } });

const helm = item({ 1564: 0, 0: 5, 5: 10, 10: 2, 11: 1, 189: 3, 299: 4 });
const betterHelm = item({ 1564: 0, 0: 8, 5: 4, 10: 4 });
const body = item({ 1564: 4, 1: 12, 6: 20 });
const items = new Map([[100, helm], [101, betterHelm], [102, body]]);

assert.deepEqual(readItemStats(helm), {
    attackStab: 5,
    attackSlash: 0,
    attackCrush: 0,
    attackMagic: 0,
    attackRanged: 0,
    defenceStab: 10,
    defenceSlash: 0,
    defenceCrush: 0,
    defenceMagic: 0,
    defenceRanged: 0,
    strength: 2,
    rangedStrength: 3,
    magicDamage: 0.4,
    prayer: 1,
});
assert.deepEqual(readItemStats(undefined).attackStab, 0);
const magicDeltaComparison = compareWornGear(
    item({ 1564: 0, 299: 7 }),
    [{ slot: 0, itemId: 500 }],
    (id) => id === 500 ? item({ 1564: 0, 299: 3 }) : undefined,
);
assert.equal(magicDeltaComparison?.delta.magicDamage, 0.4, "magic damage deltas use tenths without binary float artifacts");
const magicRows = buildCombatStatGroups(readItemStats(item({ 1564: 0, 299: 7 })), magicDeltaComparison?.delta);
assert.deepEqual(magicRows.find(({ title }) => title === "Other bonuses")?.rows.find(({ label }) => label === "Magic damage"), {
    label: "Magic damage", value: "0.7 (+0.4)", delta: 0.4,
});
const floatMagicRows = buildCombatStatGroups({ ...readItemStats(undefined), magicDamage: 0.7 }, {
    ...readItemStats(undefined), magicDamage: 0.39999999999999997,
});
assert.equal(floatMagicRows.find(({ title }) => title === "Other bonuses")?.rows[0].value, "0.7 (+0.4)");
const combatGroups = buildCombatStatGroups(readItemStats(helm), {
    ...readItemStats(undefined),
    attackStab: 2,
    defenceSlash: -1,
});
assert.deepEqual(combatGroups.map(({ title }) => title), ["Attack bonuses", "Defence bonuses", "Other bonuses"]);
assert.deepEqual(combatGroups[0].rows[0], { label: "Stab", value: "5 (+2)", delta: 2 });
assert.deepEqual(combatGroups[1].rows[0], { label: "Stab", value: "10", delta: 0 });
assert.deepEqual(combatGroups[2].rows.map(({ label }) => label), ["Melee strength", "Ranged strength", "Magic damage", "Prayer"]);
assert.equal(itemEquipSlot(body), 4);
assert.equal(itemEquipSlot(item({ 1564: 6 })), undefined, "unknown slot is not compared");
assert.equal(itemEquipSlot({ wearPos: 5 }), 5, "legacy definitions use the wear-position opcode");
assert.equal(itemEquipSlot({ wearPos: 5, params: { get: (key) => key === 1564 ? 3 : undefined } }), 3,
    "cache param 1564 takes precedence over wearPos");
assert.equal(itemEquipSlot({ wearPos: 5, params: { get: (key) => key === 1564 ? 6 : undefined } }), undefined,
    "an unsupported cache param is not replaced by the wearPos opcode");
assert.deepEqual([...itemEquipSlots({ wearPos: 3, wearPos2: 5 })], [3, 5]);
assert.equal(itemAttackSpeed(item({ 14: 4 })), 4);
assert.equal(itemAttackSpeed(item({ 14: 0 })), undefined);

const comparison = compareWornGear(betterHelm, [
    { slot: 0, itemId: 100 },
    { slot: 4, itemId: 102 },
], (id) => items.get(id));
assert.deepEqual(comparison?.delta, {
    attackStab: 3,
    attackSlash: 0,
    attackCrush: 0,
    attackMagic: 0,
    attackRanged: 0,
    defenceStab: -6,
    defenceSlash: 0,
    defenceCrush: 0,
    defenceMagic: 0,
    defenceRanged: 0,
    strength: 2,
    rangedStrength: -3,
    magicDamage: -0.4,
    prayer: -1,
});
assert.equal(comparison?.current.attackSlash, 12, "other worn slots stay in the total");
assert.equal(comparison?.after.defenceSlash, 20);
assert.equal(compareWornGear(body, [], () => undefined)?.after.attackSlash, 12);
assert.equal(compareWornGear(item({}), [], () => undefined), undefined);

const bow = { wearPos: 3, wearPos2: 5, params: { get: (key: number) => key === 4 ? 8 : undefined } };
const shield = { wearPos: 5, params: { get: (key: number) => key === 6 ? 12 : undefined } };
const bowAndShield = new Map([[300, bow], [301, shield]]);
const bowComparison = compareWornGear(bow, [
    { slot: 3, itemId: 102 },
    { slot: 5, itemId: 301 },
], (id) => bowAndShield.get(id) ?? items.get(id));
assert.equal(bowComparison?.after.defenceSlash, 0, "a two-handed bow replaces the shield in slot 5");
assert.equal(bowComparison?.after.attackRanged, 8);
const shieldComparison = compareWornGear(shield, [
    { slot: 3, itemId: 300 },
], (id) => bowAndShield.get(id));
assert.equal(shieldComparison?.after.attackRanged, 0, "a shield replaces a worn two-handed bow via its secondary slot");
assert.equal(shieldComparison?.after.defenceSlash, 12);

assert.equal(foodStatsForName(" bread ")?.heal, 5);
assert.deepEqual(foodStatsForName("Cave eel")?.heal, { min: 8, max: 12 });
assert.equal(foodStatsForName("Anglerfish")?.special, "anglerfish");
assert.equal(foodStatsForName("Smelly kebab")?.heal, 18, "the later area-specific duplicate is the registered record");
assert.equal(foodStatsForName("Smelly kebab")?.area, "vampyrium");
assert.equal(foodStatsForName("Mysterious jerky")?.area, "vampyrium");
assert.equal(foodStatsForName("Rations")?.area, "ghorrock-prison");
assert.equal(foodStatsForName("Scarred scraps")?.area, "the-scar");
assert.equal(foodStatsForName("Blighted manta ray")?.wildernessOnly, true);
const aliasCollisions = [
    { name: "Earlier", bites: ["Shared bite", "Old finish"], heal: 1 },
    { name: "Shared bite", heal: 2 },
    { name: "Later", bites: ["Shared bite", "New finish"], heal: 3 },
];
assert.equal(findFoodDefinition("Shared bite", aliasCollisions)?.name, "Later",
    "later bite aliases replace both earlier aliases and canonical names like repeated Map.set calls");
assert.equal(findFoodDefinition("New finish", aliasCollisions)?.name, "Later");
assert.equal(findFoodDefinition("Old finish", aliasCollisions)?.name, "Earlier",
    "a later record only replaces names it registers");
assert.equal(foodStatsForName("Strange fruit")?.poisonImmunity, 18);
assert.equal(formatPoisonImmunity(foodStatsForName("Strange fruit")!.poisonImmunity!), "18 sec",
    "Food.plugin passes poison immunity to PoisonClock in seconds");
for (const definition of FOOD_DEFINITIONS) {
    if (!Array.isArray(definition.bites)) continue;
    for (const bite of definition.bites) {
        assert.equal(foodStatsForName(bite)?.name, definition.name, `${bite} resolves through ${definition.name}'s bites list`);
    }
}
assert.deepEqual(foodStatsForName("Rations")?.restore?.prayer, { percent: 0.25 });
assert.deepEqual(foodStatsForName("Scarred scraps")?.restore?.prayer, { percent: 0.25 });
assert.equal(formatRestore(foodStatsForName("Rations")!.restore!.prayer!), "25% of base");
assert.equal(formatRestore(3), "+3");
assert.equal(formatRestore({ flat: 2, percent: 0.25 }), "+2 + 25% of base");
assert.equal(formatRestore({ percent: 0.1 }), "10% of base");
assert.deepEqual(readFoodStats({
    name: "Mixed restore",
    restore: { prayer: { flat: 2, percent: 0.25 }, attack: 3, invalid: { percent: "bad" } as any },
})?.restore, { prayer: { flat: 2, percent: 0.25 }, attack: 3 }, "normalize valid mixed restore forms and discard malformed runtime values");
assert.equal(foodStatsForName("unknown food"), undefined);
assert.deepEqual(potionStatsForName("Attack potion(4)")?.skillBoosts?.attack, { flat: 3, percent: 0.1 });
assert.ok(potionStatsForName("Prayer potion(3)")?.unsupportedReason);
assert.deepEqual(potionStatsForName("Energy potion(4)"), { name: "Energy potion(4)", runEnergy: 10 });
assert.deepEqual(potionStatsForName("Super energy(2)"), { name: "Super energy(2)", runEnergy: 20 });
assert.deepEqual(potionStatsForName("Stamina potion(1)"), {
    name: "Stamina potion(1)",
    runEnergy: 20,
    stamina: { durationMs: 120_000, energyPerMovementTick: 0.7 },
});
assert.deepEqual(potionStatsForName("Super ranging (4)")?.skillBoosts?.ranged, { flat: 5, percent: 0.15 });
assert.equal(potionStatsForName("Unknown energy drink"), undefined);
assert.deepEqual(runeStatsForName("Air rune"), {
    name: "Air rune", rune: "air", runeType: "elemental", providesElement: true,
});
assert.equal(runeStatsForName("Blood rune")?.runeType, "catalytic");
assert.equal(runeStatsForName("Rune platebody"), undefined);

// At 1525x945, clamp against the renderer canvas, not the 765x503 widget layout.
// The old layout clamp used 765x503 for this screen-space placement.
const actionBounds = findInteractionTextBounds([{
    text: "<col=ffff00>Wield Bronze axe",
    _absX: 1304,
    _absY: 704,
    _absWidth: 196,
    _absHeight: 20,
}, {
    text: "<col=ffffff>+ options",
    _absX: 1304,
    _absY: 726,
    _absWidth: 72,
    _absHeight: 18,
}], "Wield Bronze axe");
assert.deepEqual(actionBounds, { x: 1304, y: 704, w: 196, h: 40 });
const pointerTooltip = positionTooltip(1325, 665, 1525, 945, 190, 170, actionBounds!);
assert.deepEqual(pointerTooltip, { x: 1230, y: 752 });
assert.ok(pointerTooltip.x <= 1325 && pointerTooltip.x + 190 >= 1325);
assert.ok(pointerTooltip.y >= actionBounds!.y + actionBounds!.h);
assert.deepEqual(positionTooltip(1325, 920, 1525, 945, 190, 170, {
    x: 1304, y: 900, w: 196, h: 20,
}), { x: 1230, y: 722 });
const leftEdgeTooltip = positionTooltip(12, 665, 1525, 945, 190, 170, {
    x: 2, y: 704, w: 180, h: 20,
});
assert.deepEqual(leftEdgeTooltip, { x: 2, y: 732 });
assert.ok(leftEdgeTooltip.x + 190 <= 182 || leftEdgeTooltip.y >= 724);
assert.deepEqual(positionTooltip(50, 50, 200, 120, 80, 60, {
    x: 10, y: 10, w: 80, h: 100,
}), { x: 98, y: 20 }, "use the side when neither vertical slot fits");
assert.deepEqual(positionTooltip(10, 10, 200, 120, 190, 100, {
    x: 0, y: 0, w: 200, h: 120,
}), { x: 2, y: 18 }, "keep the hovered-item panel visible when overlap cannot be avoided");

const timerBounds = findMouseoverTimerBounds([{
    onTimer: [4725],
    _absX: 0, _absY: 0, _absWidth: 0, _absHeight: 0,
    children: [
        { text: "Wield Bronze axe", _absX: 1304, _absY: 96, _absWidth: 178, _absHeight: 20 },
        { text: "+1 option", _absX: 1304, _absY: 127, _absWidth: 74, _absHeight: 20 },
    ],
}],);
assert.deepEqual(timerBounds, { x: 1304, y: 96, w: 178, h: 51 });
const screenshotActionBounds = findMouseoverTimerBounds([{
    uid: 300,
    onTimer: [4725],
}], (uid) => uid === 300 ? [
    { text: "Wield Bronze axe", _absX: 150, _absY: 100, _absWidth: 130, _absHeight: 20 },
    { text2: "+1 option", _absX: 150, _absY: 130, _absWidth: 80, _absHeight: 17 },
] : []);
assert.deepEqual(screenshotActionBounds, { x: 150, y: 100, w: 130, h: 47 });
assert.deepEqual(positionTooltip(140, 90, 765, 503, 190, 170, screenshotActionBounds!), {
    x: 45, y: 155,
}, "screenshot panel moves below action text instead of sitting at (45,55)");
const estimatedActionBounds = fallbackInteractionBounds(174, 68, 765, 503);
assert.deepEqual(estimatedActionBounds, { x: 150, y: 100, w: 240, h: 52 });
assert.deepEqual(positionTooltip(174, 68, 765, 503, 190, 170, estimatedActionBounds), {
    x: 79, y: 160,
}, "without measured bounds, reserve both action lines below the cursor");
const shieldOptionBounds = { x: 118, y: 280, w: 90, h: 18 };
const shieldPanel = positionTooltip(150, 270, 765, 503, 190, 170, shieldOptionBounds);
assert.deepEqual(shieldPanel, { x: 55, y: 306 });
assert.ok(shieldPanel.y >= shieldOptionBounds.y + shieldOptionBounds.h);
for (const [actionRect, pointer, expected] of [
    [{ x: 1304, y: 96, w: 178, h: 51 }, { x: 1370, y: 110 }, { x: 1275, y: 155 }],
    [{ x: 1304, y: 110, w: 178, h: 43 }, { x: 1370, y: 125 }, { x: 1275, y: 161 }],
    [{ x: 1304, y: 260, w: 178, h: 40 }, { x: 1370, y: 270 }, { x: 1275, y: 308 }],
] as const) {
    const panel = positionTooltip(pointer.x, pointer.y, 1525, 945, 190, 170, actionRect);
    assert.deepEqual(panel, expected);
    assert.ok(panel.y >= actionRect.y + actionRect.h || panel.y + 170 <= actionRect.y,
        `panel ${JSON.stringify(panel)} overlaps action text ${JSON.stringify(actionRect)}`);
}

const hitWidget = { groupId: INVENTORY, itemId: 100, x: 1300, y: 650, width: 50, height: 50, _absX: 1300, _absY: 650, _absWidth: 50, _absHeight: 50 };
const labelWidget = {
    text: "<col=ffff00>Wield Bronze axe",
    _absX: 1304, _absY: 704, _absWidth: 196, _absHeight: 40,
};
const optionWidget = {
    text2: "+1 option",
    _absX: 1304, _absY: 726, _absWidth: 72, _absHeight: 18,
};
const mouseoverTimer = {
    uid: 600,
    onTimer: [4725],
};
const testClient: any = {
    equipment: { getSlots: () => [] },
    widgetManager: {
        rootInterface: 161,
        getInputRoots: () => [hitWidget],
        getWidgetsForGroup: () => [hitWidget, labelWidget],
        getActiveTimerWidgets: () => [mouseoverTimer],
        getStaticChildrenByParentUid: (uid: number) => uid === 600 ? [labelWidget, optionWidget] : [],
    },
    inputManager: { mouseX: 1325, mouseY: 665 },
    gameState: GameState.LOGGED_IN,
    menuOpen: false,
    menuActiveSimpleEntries: [{ option: "Wield", target: "Bronze axe" }],
    renderer: { canvas: { __ui: { menu: { open: false } } } },
};
const hitPlugin = new ItemStatsPlugin(testClient);
const itemDefinitions = new Map<number, any>([
    [100, { name: "Bronze axe", params: { get: (key: number) => key === 1564 ? 3 : undefined } }],
    [200, { name: "Bronze axe (noted)", noteTemplate: 1, note: 100 }],
    [201, { name: "Bronze axe (placeholder)", placeholderTemplate: 1, placeholder: 100 }],
]);
testClient.objTypeLoader = { load: (id: number) => itemDefinitions.get(id) };
assert.equal((hitPlugin as any).canonicalItemId(200), 100, "bank notes resolve to the canonical item");
assert.equal((hitPlugin as any).canonicalItemId(201), 100, "bank placeholders resolve to the canonical item");
await hitPlugin.start();
const visibleSignature = hitPlugin.widgetOverlay.signature();
assert.ok(visibleSignature.includes(JSON.stringify({ x: 1304, y: 704, w: 196, h: 40 })));
assert.equal(hitPlugin.widgetOverlay.signature(), visibleSignature);
testClient.equipment.getSlots = () => [{ slot: 0, itemId: 987 }];
const changedWornSignature = hitPlugin.widgetOverlay.signature();
assert.notEqual(changedWornSignature, visibleSignature, "a worn slot or item change invalidates the comparison tooltip");
testClient.equipment.getSlots = () => [];
assert.equal(hitPlugin.widgetOverlay.signature(), visibleSignature, "restoring worn gear restores the prior tooltip signature");
assert.deepEqual((hitPlugin as any).interactionTextBounds(), {
    x: 1304, y: 704, w: 196, h: 40,
});
testClient.widgetManager.getActiveTimerWidgets = () => [];
testClient.widgetManager.getWidgetsForGroup = () => [hitWidget];
testClient.menuActiveSimpleEntries = [];
assert.equal((hitPlugin as any).interactionTextBounds(), undefined, "bounds can be unavailable without losing hover");
const signatureWithoutBounds = hitPlugin.widgetOverlay.signature();
assert.ok(signatureWithoutBounds, "hover remains active without action text bounds");
assert.notEqual(signatureWithoutBounds, visibleSignature, "losing measured bounds changes the redraw signature");
assert.equal(hitPlugin.widgetOverlay.signature(), signatureWithoutBounds,
    "the signature stays stable while pointer and missing bounds stay unchanged");
testClient.widgetManager.getActiveTimerWidgets = () => [mouseoverTimer];
const beforeDeferredBounds = hitPlugin.widgetOverlay.signature();
labelWidget._absY = 740;
optionWidget._absY = 762;
assert.notEqual(hitPlugin.widgetOverlay.signature(), beforeDeferredBounds,
    "a deferred mouseover rebuild changes the overlay signature when its action bounds move");
labelWidget._absY = 704;
optionWidget._absY = 726;
assert.deepEqual(fallbackInteractionBounds(1325, 665, 1525, 945), {
    x: 1285, y: 697, w: 240, h: 52,
});
testClient.menuOpen = true;
assert.equal(hitPlugin.widgetOverlay.signature(), "", "hide while the client context menu is open");
testClient.menuOpen = false;
testClient.renderer.canvas.__ui.menu.open = true;
assert.equal(hitPlugin.widgetOverlay.signature(), visibleSignature,
    "a stale canvas menu mirror does not suppress stats after OsrsClient closes the menu");
testClient.renderer.canvas.__ui.menu.open = false;
assert.equal(hitPlugin.widgetOverlay.signature(), visibleSignature, "show again after both menus close");

// A bank item can overlap the bank header geometrically while sitting outside
// the bank's scroll viewport. Nested container scissoring narrows it again.
const clippedItem = { uid: (BANKMAIN << 16) | 3, groupId: BANKMAIN, parentUid: -1, itemId: 100, x: 0, y: -20, width: 50, height: 60 };
const innerClip = { uid: 2, parentUid: 1, type: 0, x: 10, y: 5, width: 100, height: 30, children: [] };
const bankClip = { uid: 1, parentUid: -1, type: 0, x: 1280, y: 655, width: 140, height: 60, children: [innerClip] };
const mountedRoot = { uid: (BANKMAIN << 16), groupId: BANKMAIN, parentUid: -1, type: 0, x: 0, y: 0, width: 100, height: 30, children: [clippedItem] };
testClient.widgetManager.interfaceParents = new Map([[2, { group: BANKMAIN }]]);
testClient.widgetManager.getAllGroupRoots = (group: number) => group === BANKMAIN ? [mountedRoot] : [];
testClient.widgetManager.getStaticChildrenByParentUid = (uid: number) => uid === 1 ? [innerClip] : [];
testClient.widgetManager.getInputRoots = () => [bankClip];
testClient.widgetManager.getWidgetsForGroup = () => [bankClip];
testClient.inputManager.mouseY = 650;
assert.equal(hitPlugin.widgetOverlay.signature(), "", "a row above the bank viewport cannot show a tooltip over its header");
testClient.inputManager.mouseY = 665;
assert.ok(hitPlugin.widgetOverlay.signature(), "the visible part of a partially clipped row remains hoverable");
testClient.inputManager.mouseY = 695;
assert.equal(hitPlugin.widgetOverlay.signature(), "", "nested container clips also constrain item hover");
testClient.inputManager.mouseY = 665;
testClient.widgetManager.getInputRoots = () => [hitWidget];
testClient.widgetManager.getStaticChildrenByParentUid = () => [];
testClient.widgetManager.interfaceParents.clear();
await hitPlugin.stop();

console.log("item stats read cache bonuses and describe consumables");
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
