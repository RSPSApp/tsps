import { strict as assert } from "node:assert";
import {
    compareWornGear,
    compareAttackSpeed,
    compareItemWeight,
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
import { buildCombatStatGroups, formatItemStatsRow, shouldShowSpeedRow, shouldShowWeightRow } from "../game/plugins/itemstats/itemStatsPresentation";
import { BANKMAIN, INVENTORY } from "../runelite/api/gameval/InterfaceID";

async function main(): Promise<void> {
assert.equal(ItemStatsPlugin.descriptor.enabledByDefault, false, "Item Stats stays off until enabled");
const scaledPosition = positionTooltip(800, 600, 1600, 1200, 360, 240,
    { x: 760, y: 700, w: 160, h: 40 }, 2);
assert.ok(scaledPosition.x >= 4 && scaledPosition.y >= 4);
assert.ok(scaledPosition.x + 360 <= 1596 && scaledPosition.y + 240 <= 1196);
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
assert.deepEqual(magicRows.find(({ title }) => title === "")?.rows.find(({ label }) => label === "Magic Dmg"), {
    label: "Magic Dmg", value: "+0.4%", delta: 0.4,
});
const floatMagicRows = buildCombatStatGroups({ ...readItemStats(undefined), magicDamage: 0.7 }, {
    ...readItemStats(undefined), magicDamage: 0.39999999999999997,
});
assert.equal(floatMagicRows.find(({ title }) => title === "")?.rows[0].value, "+0.4%");
const baseMagicRow = buildCombatStatGroups({ ...readItemStats(undefined), magicDamage: 0.7 }, {
    ...readItemStats(undefined), magicDamage: 0.4,
}, true).find(({ title }) => title === "")?.rows[0];
assert.equal(baseMagicRow?.value, "0.7% (+0.4%)", "base magic damage includes its percent sign");
assert.equal(formatItemStatsRow(baseMagicRow!, (text) => text),
    "<col=ffffff>Magic Dmg: 0.7% (</col><col=33ee33>+0.4%</col><col=ffffff>)</col>");
const combatGroups = buildCombatStatGroups(readItemStats(helm), {
    ...readItemStats(undefined),
    attackStab: 2,
    defenceSlash: -1,
});
assert.deepEqual(combatGroups.map(({ title }) => title), ["Attack Bonus", "Defence Bonus"]);
assert.deepEqual(combatGroups[0].rows[0], { label: "Stab", value: "+2", delta: 2 });
assert.equal(combatGroups[1].rows[0].value, "-1", "negative comparison values keep their sign");
assert.equal(formatItemStatsRow(combatGroups[0].rows[0], (text) => text),
    "<col=ffffff>Stab: </col><col=33ee33>+2</col>", "default comparisons keep labels white and tint only the delta");
assert.equal(formatItemStatsRow(combatGroups[1].rows[0], (text) => text),
    "<col=ffffff>Slash: </col><col=ee3333>-1</col>", "negative deltas use RuneLite's worse color");
assert.equal(formatItemStatsRow(combatGroups[0].rows[0], (text) => text.slice(0, 7)),
    "<col=ffffff>Stab: </col><col=33ee33>+</col>", "truncation preserves the label and value colors");
const absoluteRows = buildCombatStatGroups(readItemStats(helm));
assert.equal(absoluteRows[1].rows[0].value, "5", "without a comparison the tooltip shows the item's absolute stat");
assert.equal(absoluteRows[0].rows.find(({ label }) => label === "Magic Dmg")?.value, "0.4%");
const unchangedStats = readItemStats(helm);
const unchangedDelta = readItemStats(undefined);
assert.equal(buildCombatStatGroups(unchangedStats, unchangedDelta).length, 0,
    "default comparison hides unchanged stats");
assert.equal(buildCombatStatGroups(unchangedStats, unchangedDelta, true).find(({ title }) => title === "Attack Bonus")?.rows.length, 1,
    "base mode retains nonzero base stats when the delta is zero");
assert.equal(combatGroups[1].rows.length, 1, "unchanged rows are hidden while comparing gear");
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
const abyssalWhip = { ...item({ 1564: 3, 14: 4 }), weight: 453 };
assert.equal(compareItemWeight(abyssalWhip, [], () => undefined), 0.453, "453 cache grams display as 0.453 kg");
assert.equal(compareItemWeight({ ...abyssalWhip, weight: 0 }, [], () => undefined), 0,
    "zero-weight equipment has no weight change");
assert.equal(compareItemWeight(abyssalWhip, [{ slot: 3, itemId: 1 }], () => ({ ...abyssalWhip, weight: 700 })), -0.247,
    "replacement weight subtracts the worn item");
assert.equal(shouldShowWeightRow(0, -0.7, false), false, "default weight mode hides a zero-weight candidate");
assert.equal(shouldShowWeightRow(0, -0.7, true), true, "base mode can show a zero base with its replacement delta");
assert.equal(compareAttackSpeed(abyssalWhip, [], () => undefined), 0,
    "weapon speed compares against unarmed speed of four ticks");
assert.equal(compareAttackSpeed({ ...item({ 1564: 3, 14: 5 }), weight: 453 }, [{ slot: 3, itemId: 1 }],
    () => ({ attackSpeed: 4 })), 1, "slower replacement has a positive speed delta");
assert.equal(compareAttackSpeed({ params: { get: (key: number) => key === 1564 ? 5 : undefined } }, [{ slot: 3, itemId: 1 }],
    () => ({ params: { get: (key: number) => key === 14 ? 5 : key === 1564 ? 3 : undefined }, wearPos2: 5 })), -1,
    "equipping a shield that displaces a two-handed weapon returns speed to unarmed");
assert.equal(shouldShowSpeedRow(undefined, -1, true), true, "base mode shows a shield's two-handed weapon speed change");
assert.equal(shouldShowSpeedRow(undefined, 0, true), false, "a missing shield speed is normalized to zero");

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
assert.deepEqual(fallbackInteractionBounds(500, 500, 2000, 1200, { x: 1.5, y: 2 }), {
    x: 464, y: 564, w: 360, h: 104,
}, "fallback reserve scales by axis");
assert.deepEqual(findInteractionTextBounds([{
    text: "Wield item", _absX: 100, _absY: 100, _absWidth: 180, _absHeight: 30,
}, {
    text: "+ options", _absX: 500, _absY: 250, _absWidth: 90, _absHeight: 20,
}], "Wield item", { x: 1.5, y: 2 }), {
    x: 100, y: 100, w: 490, h: 170,
}, "option grouping thresholds scale on each axis");
assert.deepEqual(findMouseoverTimerBounds([{
    onTimer: [4725], children: [{ text: "Long touch hint", _absX: 0, _absY: 0, _absWidth: 900, _absHeight: 120 }],
}], undefined, { x: 1.5, y: 2 }), { x: 0, y: 0, w: 900, h: 120 },
"timer text size limits scale on each axis");
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
    [100, { name: "Bronze axe", weight: 453, params: { get: (key: number) => ({ 1564: 3, 0: 5, 14: 4 })[key] } }],
    [200, { name: "Bronze axe (noted)", noteTemplate: 1, note: 100 }],
    [201, { name: "Bronze axe (placeholder)", placeholderTemplate: 1, placeholder: 100 }],
]);
testClient.objTypeLoader = { load: (id: number) => itemDefinitions.get(id) };
assert.equal((hitPlugin as any).canonicalItemId(200), 100, "bank notes resolve to the canonical item");
assert.equal((hitPlugin as any).canonicalItemId(201), 100, "bank placeholders resolve to the canonical item");
await hitPlugin.start();
const drawRects: number[][] = [];
const drawContext = {
    renderer: { canvas: { width: 1525, height: 945 }, drawRect: (...args: number[]) => drawRects.push(args) } as any,
    fontLoader: () => undefined,
    sprite: () => undefined,
    place: () => undefined,
    overlayTextScale: () => ({ x: 1, y: 1 }),
    inputScale: () => ({ x: 1, y: 1 }),
};
const compactRects = hitPlugin.widgetOverlay.draw(drawContext);
assert.equal(compactRects.length, 1, "item stats draw a tooltip");
assert.ok(compactRects[0].w < 176, "the tooltip width follows its content instead of a wide fixed minimum");
assert.ok(compactRects[0].h < 100, "compact inline rows keep the tooltip short");
const scaledRects = hitPlugin.widgetOverlay.draw({
    ...drawContext,
    overlayTextScale: () => ({ x: 2, y: 1.5 }),
    inputScale: () => ({ x: 2, y: 1.5 }),
});
assert.equal(scaledRects.length, 1, "scaled item stats draw a tooltip");
assert.equal(scaledRects[0].w, compactRects[0].w * 2, "tooltip width follows the horizontal UI text scale");
assert.equal(scaledRects[0].h, compactRects[0].h * 1.5, "tooltip height follows the vertical UI text scale");
assert.equal(drawRects[5][2], scaledRects[0].w, "background bounds match the scaled tooltip rect");
assert.equal(drawRects[5][3], scaledRects[0].h, "background height matches the scaled tooltip rect");
assert.deepEqual(drawRects[5][4], [70 / 255, 61 / 255, 50 / 255, 156 / 255],
    "tooltip uses RuneLite's translucent brown-gray surface");
assert.deepEqual(drawRects.slice(6, 10).map(([x, y, w, h]) => [x, y, w, h]), [
    [scaledRects[0].x, scaledRects[0].y, scaledRects[0].w, 1.5],
    [scaledRects[0].x, scaledRects[0].y + scaledRects[0].h - 1.5, scaledRects[0].w, 1.5],
    [scaledRects[0].x, scaledRects[0].y + 1.5, 2, scaledRects[0].h - 3],
    [scaledRects[0].x + scaledRects[0].w - 2, scaledRects[0].y + 1.5, 2, scaledRects[0].h - 3],
], "tooltip has a one-logical-pixel border scaled with the UI");
assert.ok(drawRects.slice(6, 10).every(([, , , , color]) => color?.[3] === 1),
    "tooltip border is opaque dark gray");
assert.ok(drawRects.slice(6, 10).every(([, , , , color]) => color?.[0] === 55 / 255 && color?.[1] === 51 / 255 && color?.[2] === 47 / 255),
    "tooltip border uses a warm dark gray-brown outline");
// Touch displays cap their backing store below the device pixel ratio, so the overlay canvas is
// larger than the input buffer. The pointer and the hit rect arrive in input pixels; the widget
// tree (mouseover text included) renders at the overlay's scale, so its measured bounds are
// already overlay pixels. Convert only the input side and keep the tooltip beside the text.
const touchHitWidget = {
    groupId: INVENTORY, itemId: 100, x: 0, y: 0, width: 32, height: 32,
    _absX: 0, _absY: 0, _absWidth: 32, _absHeight: 32,
};
const touchLabelWidget = {
    text: "<col=ffff00>Wield Bronze axe", x: 0, y: 36, width: 150, height: 20,
    _absX: 0, _absY: 72, _absWidth: 300, _absHeight: 40,
};
const touchMouseoverTimer = { uid: 700, onTimer: [4725] };
const touchClient: any = {
    equipment: { getSlots: () => [] },
    widgetManager: {
        rootInterface: 161,
        getInputRoots: () => [touchHitWidget],
        getWidgetsForGroup: () => [touchHitWidget],
        getActiveTimerWidgets: () => [touchMouseoverTimer],
        getStaticChildrenByParentUid: (uid: number) => uid === 700 ? [touchLabelWidget] : [],
    },
    inputManager: { mouseX: 16, mouseY: 16 },
    gameState: GameState.LOGGED_IN,
    menuOpen: false,
    menuActiveSimpleEntries: [{ option: "Wield", target: "Bronze axe" }],
};
touchClient.objTypeLoader = { load: (id: number) => itemDefinitions.get(id) };
const touchStats = new ItemStatsPlugin(touchClient);
await touchStats.start();
const touchOverlayCanvas = { width: 1530, height: 1006 };
const touchDrawContext = {
    renderer: { canvas: touchOverlayCanvas, drawRect: () => {} } as any,
    fontLoader: () => undefined,
    sprite: () => undefined,
    place: () => undefined,
    overlayTextScale: () => ({ x: 1, y: 1 }),
    inputScale: () => ({ x: 2, y: 2 }),
};
const [touchStatsRect] = touchStats.widgetOverlay.draw(touchDrawContext);
const drawnTouchAction = { x: 0, y: 72, w: 300, h: 40 };
assert.ok(touchStatsRect && !overlaps(touchStatsRect, drawnTouchAction),
    "the scaled overlay clears the action text at its drawn position");
assert.equal(touchStatsRect.y, 120,
    "measured interaction bounds are not scaled a second time");
assert.ok(touchStatsRect.x >= 0 && touchStatsRect.y >= 0 &&
    touchStatsRect.x + touchStatsRect.w <= 1530 && touchStatsRect.y + touchStatsRect.h <= 1006,
    "the scaled overlay tooltip stays inside the larger overlay canvas");
const [desktopStatsRect] = touchStats.widgetOverlay.draw({
    ...touchDrawContext,
    renderer: { canvas: { width: 765, height: 503 }, drawRect: () => {} } as any,
    inputScale: () => ({ x: 1, y: 1 }),
});
assert.equal(desktopStatsRect.y, 120,
    "an unscaled overlay keeps the same input and drawing space");
await touchStats.stop();
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

// HUD scale changes tooltip dimensions without scaling the pointer or measured action bounds.
const scaleRects: { x: number; y: number; w: number; h: number }[] = [];
let canvasHeight = 1000;
let hudScale = 1;
const scaleDrawContext: any = {
    renderer: { canvas: { width: 1800, get height() { return canvasHeight; } }, drawRect: (x: number, y: number, w: number, h: number) => scaleRects.push({ x, y, w, h }) },
    fontLoader: () => undefined,
    overlayTextScale: () => ({ x: hudScale, y: hudScale }),
    inputScale: () => ({ x: 1, y: 1 }),
};
testClient.inputManager.mouseX = 900;
testClient.inputManager.mouseY = 500;
hitWidget._absX = 880; hitWidget._absY = 480; hitWidget._absWidth = 40; hitWidget._absHeight = 40;
hitWidget.x = 880; hitWidget.y = 480; hitWidget.width = 40; hitWidget.height = 40;
labelWidget._absX = 860; labelWidget._absY = 540; labelWidget._absWidth = 140; labelWidget._absHeight = 32;
optionWidget._absX = 860; optionWidget._absY = 560;
for (const scale of [1, 1.25, 2]) {
    hudScale = scale;
    scaleRects.length = 0;
    const panel = hitPlugin.widgetOverlay.draw(scaleDrawContext)[0];
    assert.ok(panel, `panel draws at ${scale}x`);
    assert.ok(panel.x < 900 && panel.x + panel.w > 900, "tooltip stays centered near the device-pixel pointer");
    assert.ok(panel.y >= 572 || panel.y + panel.h <= 532, "tooltip avoids the interaction text bounds");
    assert.ok(panel.x >= 2 && panel.y >= 2 && panel.x + panel.w <= 1798 && panel.y + panel.h <= canvasHeight - 2,
        "tooltip remains inside the device-pixel viewport");
}
testClient.inputManager.mouseX = 1325;
testClient.inputManager.mouseY = 665;
hitWidget._absX = 1300; hitWidget._absY = 650; hitWidget._absWidth = 50; hitWidget._absHeight = 50;
hitWidget.x = 1300; hitWidget.y = 650; hitWidget.width = 50; hitWidget.height = 50;
labelWidget._absX = 1304; labelWidget._absY = 704; labelWidget._absWidth = 196; labelWidget._absHeight = 40;
optionWidget._absX = 1304; optionWidget._absY = 726;

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

function overlaps(a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }): boolean {
    return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
