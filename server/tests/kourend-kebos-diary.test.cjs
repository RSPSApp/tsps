// Run after `yarn build`: node --test tests/kourend-kebos-diary.test.cjs
const assert = require("node:assert/strict");
const { test } = require("node:test");

const Plugin = require("../plugins/achievements/diaries/KourendKebosDiary.plugin");
const { ItemIdentifiers: I } = require("../dist/util/ItemIdentifiers");
const { NpcIdentifiers: N } = require("../dist/util/NpcIdentifiers");
const { ObjectIdentifiers: O } = require("../dist/util/ObjectIdentifiers");

const tasks = [];
const api = {
  core: { ItemIdentifiers: I, NpcIdentifiers: N, ObjectIdentifiers: O },
  emitCustomEvent: (name, request) => { if (name === "diary:task") tasks.push(request); },
  persistAttribute: () => {},
};
Plugin._test.setApi(api);

function location(x, y, z = 0) {
  return { getX: () => x, getY: () => y, getZ: () => z, x, y, z };
}

function player(x, y, z = 0, attributes = new Map()) {
  return {
    isRegistered: () => true,
    isPlayer: () => true,
    getHitpoints: () => 10,
    isDyingReturn: () => false,
    getPrivateArea: () => null,
    getLocation: () => location(x, y, z),
    getAttribute: (key) => attributes.get(key),
    setAttribute: (key, value) => attributes.set(key, value),
  };
}

function npc(name, x, y, z = 0) {
  const loc = location(x, y, z);
  return { getLocation: () => loc, getCurrentDefinition: () => ({ getName: () => name }) };
}

function fired(p) {
  return tasks.filter((request) => request.player === p).map((request) => request.task);
}

test.beforeEach(() => { tasks.length = 0; });

test("mining iron only counts at the Mount Karuulm mine, and lovakite anywhere it is mined", () => {
  const atMine = player(1279, 3815);
  const elsewhere = player(1171, 3328);
  Plugin._test.mined({ player: atMine, itemId: I.IRON_ORE, location: location(1279, 3814) });
  Plugin._test.mined({ player: elsewhere, itemId: I.IRON_ORE, location: location(1171, 3328) });
  Plugin._test.mined({ player: elsewhere, itemId: I.LOVAKITE_ORE, location: location(1430, 3843) });
  assert.deepEqual(fired(atMine), ["mine-some-iron-at-the-mount-karuulm-mine"]);
  assert.deepEqual(fired(elsewhere), ["mine-some-lovakite"]);
});

test("a Hosidius fruit stall credits, the castle-side stall does not", () => {
  const hosidius = player(1767, 3597);
  const castle = player(1633, 3662);
  Plugin._test.thieved({ player: hosidius, method: "stall", stall: "Fruit Stall", location: location(1767, 3597) });
  Plugin._test.thieved({ player: castle, method: "stall", stall: "Fruit Stall", location: location(1633, 3662) });
  Plugin._test.thieved({ player: hosidius, method: "pickpocket", stall: "Fruit Stall", location: location(1767, 3597) });
  assert.deepEqual(fired(hosidius), ["steal-from-a-hosidius-food-stall"]);
  assert.deepEqual(fired(castle), []);
});

test("shops and herblore use the named shop and the pub's own tile", () => {
  const p = player(1570, 3760);
  Plugin._test.shopOpened({ player: p, shopName: "Warrens General Store" });
  Plugin._test.shopOpened({ player: p, shopName: "Warrens Fish Monger" });
  Plugin._test.herbloreMade({ player: p, itemId: I.STRENGTH_POTION_3_ });
  Plugin._test.herbloreMade({ player: player(1500, 3800), itemId: I.STRENGTH_POTION_3_ });
  assert.deepEqual(fired(p), [
    "browse-the-warrens-general-store",
    "create-a-strength-potion-in-the-lovakengj-pub",
  ]);
});

test("trout is River Molch only, and an anglerfish must be caught before it is cooked in Kourend", () => {
  const river = player(1271, 3707);
  Plugin._test.fished({ player: river, itemId: I.RAW_TROUT });
  Plugin._test.fished({ player: player(1200, 3400), itemId: I.RAW_TROUT });
  assert.deepEqual(fired(river), ["fish-a-trout-from-the-river-molch"]);

  const cook = player(1820, 3600);
  Plugin._test.cooked({ player: cook, itemId: I.ANGLERFISH });
  assert.deepEqual(fired(cook), [], "not caught in Kourend");
  Plugin._test.fished({ player: cook, itemId: I.RAW_ANGLERFISH });
  Plugin._test.cooked({ player: cook, itemId: I.ANGLERFISH });
  Plugin._test.cooked({ player: cook, itemId: I.ANGLERFISH });
  assert.deepEqual(fired(cook), ["catch-an-anglerfish-and-cook-it-whilst-in-great"]);
});

test("woodland chinchompa, Farming Guild mahogany, fairy ring CIR and the Hosidius portal", () => {
  const p = player(1483, 3503);
  Plugin._test.caughtChinchompa({ player: p, npcId: N.CHINCHOMPA });
  Plugin._test.caughtChinchompa({ player: player(2500, 3500), npcId: N.CHINCHOMPA });
  Plugin._test.chopped({ player: player(1235, 3772), logId: I.MAHOGANY_LOGS });
  Plugin._test.chopped({ player: player(2500, 3500), logId: I.MAHOGANY_LOGS });
  Plugin._test.travelledFairyRing({ player: p, code: "CIR" });
  Plugin._test.travelledFairyRing({ player: p, code: "AJR" });
  Plugin._test.enteredHouse({ player: p, location: 8 });
  Plugin._test.enteredHouse({ player: p, location: 1 });
  assert.deepEqual(fired(p), [
    "catch-a-chinchompa-in-the-kourend-woodland",
    "travel-to-the-fairy-ring-south-of-mount-karuulm",
    "enter-your-player-owned-house-from-hosidius",
  ]);
});

test("boulder, Forsaken Tower furnace and dark-essence blood runes credit their exact actions", () => {
  const p = player(1776, 3880);
  Plugin._test.agilityObstacle({ player: p, objectId: 27990 });
  Plugin._test.agilityObstacle({ player: p, objectId: 27988 });
  Plugin._test.smelted({ player: p, itemId: I.ADAMANTITE_BAR, furnaceId: 56366 });
  Plugin._test.smelted({ player: p, itemId: I.ADAMANTITE_BAR, furnaceId: 28565 });
  Plugin._test.craftedRunes({ player: p, runeId: I.BLOOD_RUNE, altarId: O.BLOOD_ALTAR });
  Plugin._test.craftedRunes({ player: p, runeId: I.BLOOD_RUNE, altarId: O.ALTAR_83 });
  assert.deepEqual(fired(p), [
    "use-the-boulder-leap-in-the-arceuus-essence-mine",
    "smelt-an-adamantite-bar-in-the-forsaken-tower",
    "craft-one-or-more-blood-runes-from-dark-essence",
  ]);
});

test("Monster Examine only credits a mountain troll south of Mount Quidamortem", () => {
  const p = player(1240, 3515);
  Plugin._test.monsterExamined({ player: p, npc: npc("Mountain troll", 1240, 3515) });
  Plugin._test.monsterExamined({ player: p, npc: npc("Mountain troll", 2825, 3807) });
  Plugin._test.monsterExamined({ player: p, npc: npc("Troll general", 1240, 3515) });
  assert.deepEqual(fired(p), ["cast-monster-examine-on-a-troll-south-of-mount-q"]);
});

test("kills credit only the named NPC in its own area, and never a dead or private-area killer", () => {
  const p = player(1400, 3710);
  Plugin._test.killed({ killer: p, npc: npc("Lizardman", 1400, 3710) });
  Plugin._test.killed({ killer: p, npc: npc("Lizardman brute", 1400, 3710) });
  Plugin._test.killed({ killer: p, npc: npc("Lizardman shaman", 1424, 3718) });
  Plugin._test.killed({ killer: p, npc: npc("Lizardman shaman", 1290, 10098) });
  Plugin._test.killed({ killer: p, npc: npc("Zombie", 1484, 9973) });
  Plugin._test.killed({ killer: p, npc: npc("Zombie", 1589, 3764) });
  Plugin._test.killed({ killer: p, npc: npc("Wyrm", 1280, 10186) });
  Plugin._test.killed({ killer: p, npc: npc("Hydra", 1303, 10235) });
  Plugin._test.killed({ killer: p, npc: npc("Alchemical Hydra", 0, 0) });
  Plugin._test.killed({ killer: p, npc: npc("Skotizo", 0, 0) });

  const dead = player(1400, 3710);
  dead.getHitpoints = () => 0;
  Plugin._test.killed({ killer: dead, npc: npc("Lizardman", 1400, 3710) });
  const privateArea = player(1400, 3710);
  privateArea.getPrivateArea = () => ({});
  Plugin._test.killed({ killer: privateArea, npc: npc("Lizardman", 1400, 3710) });

  assert.deepEqual(fired(p), [
    "kill-a-lizardman",
    "kill-a-lizardman-shaman-in-the-lizardman-temple",
    "kill-a-zombie-in-the-shayzien-crypts",
    "kill-a-wyrm-in-the-karuulm-slayer-dungeon",
    "kill-a-hydra-in-the-karuulm-slayer-dungeon",
    "kill-a-hydra-in-the-karuulm-slayer-dungeon",
    "defeat-skotizo-in-the-catacombs-of-kourend",
  ]);
  assert.deepEqual(fired(dead), []);
  assert.deepEqual(fired(privateArea), []);
});


test("native house entry and matching boss instances can credit, unrelated private areas cannot", () => {
  const p = player(0, 0);
  const area = {};
  p.getPrivateArea = () => area;
  Plugin._test.enteredHouse({ player: p, location: 8 });
  for (const name of ["Skotizo", "Alchemical Hydra"]) {
    const boss = npc(name, 0, 0);
    boss.getPrivateArea = () => ({});
    Plugin._test.killed({ killer: p, npc: boss });
    boss.getPrivateArea = () => area;
    Plugin._test.killed({ killer: p, npc: boss });
  }
  Plugin._test.mined({ player: p, itemId: I.LOVAKITE_ORE });
  assert.deepEqual(fired(p), [
    "enter-your-player-owned-house-from-hosidius",
    "defeat-skotizo-in-the-catacombs-of-kourend",
    "kill-a-hydra-in-the-karuulm-slayer-dungeon",
  ]);
  p.getHitpoints = () => 0;
  Plugin._test.enteredHouse({ player: p, location: 8 });
  assert.equal(fired(p).length, 3);
});
