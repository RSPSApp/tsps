const assert = require("node:assert/strict");
const path = require("node:path");
const { before, test } = require("node:test");
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager } = require("../dist/plugins/PluginManager");

let core;
let plugin;
let Progress;
let diary;
let dispatch;

const UNSUPPORTED = new Set([
  "find-out-what-your-family-crest-is-from-sir-reni",
  "place-a-scarecrow-in-the-falador-farming-patch",
  "grapple-up-and-then-jump-off-the-north-falador-w",
  "crack-a-wall-safe-within-rogues-den",
  "find-at-least-3-magic-roots-at-once-when-digging",
  "purchase-a-white-2h-sword-from-sir-vyvin",
  "change-your-family-crest-to-the-saradomin-symbol",
]);
// Tasks credited by this plugin or already wired elsewhere (crystal chest, rooftop lap).
const IMPLEMENTED = new Set([
  ...Object.values(require("../plugins/achievements/diaries/FaladorDiary.plugin")._test.TASK),
  "unlock-the-crystal-chest-in-taverley",
  "complete-a-lap-of-the-falador-rooftop-agility-co",
]);

function player({ x = 2965, y = 3378, z = 0, items = ~0, equipment = {}, attributes = {}, bank = [] } = {}) {
  const attrs = new Map(Object.entries(attributes));
  const sender = new Proxy({}, { get: () => () => sender });
  const inventoryItems = new Map();
  const inventory = {
    contains: (id) => items === ~0 || inventoryItems.has(id),
    addItem: (item) => { inventoryItems.set(item.getId(), (inventoryItems.get(item.getId()) ?? 0) + (item.getAmount?.() ?? 1)); },
    getAmount: (id) => inventoryItems.get(id) ?? 0,
  };
  return {
    _attrs: attrs,
    _inventory: inventoryItems,
    isPlayer: () => true,
    isRegistered: () => true,
    getHitpoints: () => 10,
    getLocation: () => new core.Location(x, y, z),
    getAttribute: (key) => attrs.get(key),
    setAttribute: (key, value) => attrs.set(key, value),
    sendMessage() {},
    getPacketSender: () => sender,
    getSkillManager: () => ({ getCurrentLevel: () => 99, getMaxLevel: () => 99 }),
    getInventory: () => inventory,
    getEquipment: () => ({ get: (slot) => equipment[slot] ?? null }),
    getBanks: () => bank,
  };
}

function npc(name, x, y, z = 0) {
  return {
    isNpc: () => true,
    getCurrentDefinition: () => ({ getName: () => name }),
    getDefinition: () => ({ getName: () => name }),
    getLocation: () => new core.Location(x, y, z),
  };
}

function run(name, payload) {
  const events = [];
  const realDispatch = dispatch;
  dispatch = (eventName, event) => {
    if (eventName === "diary:task") events.push(event.task);
    return realDispatch(eventName, event);
  };
  try {
    const handlers = hookHandlers.get(name) ?? [];
    for (const handler of handlers) handler(payload);
  } finally {
    dispatch = realDispatch;
  }
  return events;
}

const hookHandlers = new Map();

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  core = PluginManager.getCoreApi();
  dispatch = (name, event) => {
    for (const handler of hookHandlers.get(`custom:${name}`) ?? []) handler(event);
  };
  const api = new Proxy({
    core,
    persistAttribute() {},
    onCustomEvent(name, handler) {
      const key = `custom:${name}`;
      const list = hookHandlers.get(key) ?? [];
      list.push(handler);
      hookHandlers.set(key, list);
    },
    onNpcDeath(handler) { hookHandlers.set("death", [handler]); },
    onZoneEnter(zone, handler) {
      const list = hookHandlers.get("zone") ?? [];
      list.push({ zone, handler });
      hookHandlers.set("zone", list);
    },
    onNpcDialogueCondition(handler) { hookHandlers.set("condition", [handler]); },
    emitCustomEvent: (name, event) => dispatch(name, event),
  }, { get: (target, key) => key in target ? target[key] : () => {} });

  Progress = require("../plugins/achievements/diaries/Progress.AchievementDiaries");
  diary = require("../plugins/achievements/diaries/Data.AchievementDiaries").BY_KEY.get("falador");
  api.onCustomEvent("diary:task", require("../plugins/achievements/AchievementDiaries.plugin")._test.onTask);
  Progress(api);
  plugin = require("../plugins/achievements/diaries/FaladorDiary.plugin");
  plugin.register(api);
});

function zoneEnter(playerRef, x, y, z = 0) {
  const events = [];
  for (const { zone, handler } of hookHandlers.get("zone") ?? []) {
    if (x >= zone.minX && x <= zone.maxX && y >= zone.minY && y <= zone.maxY && (!zone.levels || zone.levels.includes(z))) {
      const before = dispatch;
      dispatch = (name, event) => {
        if (name === "diary:task") events.push(event.task);
        return before(name, event);
      };
      try { handler({ player: playerRef, zone }); } finally { dispatch = before; }
    }
  }
  return events;
}

test("the catalogue has 42 Falador tasks and every one is implemented or explicitly unsupported", () => {
  const tasks = Object.values(diary.tiers).flatMap((tier) => tier.tasks.map((task) => task.key));
  assert.equal(tasks.length, 42);
  const missing = tasks.filter((key) => !IMPLEMENTED.has(key) && !UNSUPPORTED.has(key));
  assert.deepEqual(missing, []);
  for (const key of UNSUPPORTED) {
    assert.ok(tasks.includes(key), key);
    assert.equal(IMPLEMENTED.has(key), false, key);
  }
});

test("shop, pump, tiara, lantern, strut and Entrana credit only their own successful actions", () => {
  const p = player();
  assert.deepEqual(run("custom:shop:opened", { player: p, shopId: 1309 }), ["browse-sarah-s-farm-shop"]);
  assert.deepEqual(run("custom:shop:opened", { player: p, shopId: 1 }), []);
  assert.deepEqual(run("custom:water-source:filled", { player: player({ x: 2947, y: 3382 }), objectId: 24004, name: "Waterpump", itemId: core.ItemIdentifiers.BUCKET }), ["fill-a-bucket-from-the-pump-north-of-falador-wes"]);
  assert.deepEqual(run("custom:water-source:filled", { player: player({ x: 2900, y: 3300 }), objectId: 24004 }), []);
  assert.deepEqual(run("custom:runecrafting:tiara", { player: p, tiaraId: 5529 }), ["make-a-mind-tiara"]);
  assert.deepEqual(run("custom:runecrafting:tiara", { player: p, tiaraId: 5527 }), []);
  assert.deepEqual(run("custom:oil-lights:lit", { player: player({ x: 2934, y: 3210 }), itemId: 4550 }), ["light-a-bullseye-lantern-at-the-chemist-s-in-rim"]);
  assert.deepEqual(run("custom:oil-lights:lit", { player: player(), itemId: 4550 }), []);
  assert.deepEqual(run("custom:motherlode:strut-repaired", { player: p }), ["repair-a-broken-strut-in-the-motherlode-mine"]);
  assert.deepEqual(run("custom:entrana:boarded", { player: p }), ["take-the-boat-to-entrana"]);
});

test("NPC deaths credit only the right NPC in its own area and only for a player killer", () => {
  const p = player();
  assert.deepEqual(run("death", { killer: p, npc: npc("Duck", 2990, 3380) }), ["kill-a-duck-in-falador-park"]);
  assert.deepEqual(run("death", { killer: p, npc: npc("Duck", 2900, 3300) }), []);
  assert.deepEqual(run("death", { killer: { isPlayer: () => false }, npc: npc("Duck", 2990, 3380) }), []);
  assert.deepEqual(run("death", { killer: p, npc: npc("Mogre", 2982, 3113) }), ["kill-a-mogre-at-mudskipper-point"]);
  assert.deepEqual(run("death", { killer: p, npc: npc("Skeletal Wyvern", 3025, 9543) }), ["kill-a-skeletal-wyvern-in-the-asgarnia-ice-dunge"]);
  assert.deepEqual(run("death", { killer: p, npc: npc("Blue dragon", 2903, 9780) }), ["kill-the-blue-dragon-under-the-heroes-guild"]);
  assert.deepEqual(run("death", { killer: p, npc: npc("Giant Mole", 1759, 5189) }), ["kill-the-giant-mole-beneath-falador-park"]);
  assert.deepEqual(run("death", { killer: p, npc: npc("Giant Mole", 2990, 3380) }), []);
});

test("skilling credit requires the right produced item and location", () => {
  const p = player();
  assert.deepEqual(run("custom:mining:success", { player: player({ x: 2933, y: 3288 }), itemId: 444 }), ["mine-some-gold-ore-at-the-crafting-guild"]);
  assert.deepEqual(run("custom:mining:success", { player: player({ x: 2900, y: 3300 }), itemId: 444 }), []);
  assert.deepEqual(run("custom:mining:success", { player: player({ x: 2933, y: 3288 }), itemId: 453 }), []);
  assert.deepEqual(run("custom:smithing:success", { player: player({ x: 2950, y: 3451 }), itemId: 9422 }), ["smith-some-blurite-limbs-on-doric-s-anvil"]);
  assert.deepEqual(run("custom:smithing:success", { player: p, itemId: 9422 }), []);
  assert.deepEqual(run("custom:herblore:made", { player: player({ x: 3012, y: 3355 }), itemId: 6685 }), ["mix-a-saradomin-brew-in-falador-east-bank"]);
  assert.deepEqual(run("custom:herblore:made", { player: p, itemId: 6685 }), []);
  assert.deepEqual(run("custom:skills:produced", { player: player({ x: 3039, y: 3287 }), itemId: 5376, kind: "weaving" }), ["craft-a-fruit-basket-on-the-falador-farm-loom"]);
  assert.deepEqual(run("custom:skills:produced", { player: p, itemId: 5376, kind: "weaving" }), []);
});

test("runecrafting needs the simultaneous threshold, not any craft", () => {
  const p = player();
  assert.deepEqual(run("custom:runecrafting:success", { player: p, runeId: 558, rolls: 70, amountPerEssence: 2 }), ["craft-140-mind-runes-simultaneously-from-essence"]);
  assert.deepEqual(run("custom:runecrafting:success", { player: p, runeId: 558, rolls: 69, amountPerEssence: 2 }), []);
  assert.deepEqual(run("custom:runecrafting:success", { player: p, runeId: 556, rolls: 28, amountPerEssence: 9 }), ["craft-252-air-runes-simultaneously-from-essence"]);
  assert.deepEqual(run("custom:runecrafting:success", { player: p, runeId: 556, rolls: 28, amountPerEssence: 8 }), []);
});

test("willow needs both a chop and a burn in Taverley", () => {
  const p = player({ x: 2930, y: 3430 });
  assert.deepEqual(run("custom:firemaking:success", { player: p, itemId: 1519 }), []);
  assert.deepEqual(run("custom:woodcutting:success", { player: p, logId: 1519 }), []);
  assert.deepEqual(run("custom:firemaking:success", { player: p, itemId: 1519 }), ["chop-and-burn-some-willow-logs-in-taverley"]);
  const elsewhere = player({ x: 2965, y: 3378 });
  assert.deepEqual(run("custom:woodcutting:success", { player: elsewhere, logId: 1519 }), []);
  assert.deepEqual(run("custom:firemaking:success", { player: elsewhere, itemId: 1519 }), []);
});

test("teleports, telegrab, thieving and agility credit their real success event", () => {
  assert.deepEqual(run("custom:spell:teleport-arrival", { player: player({ x: 2966, y: 3379 }), name: "Falador Teleport" }), ["teleport-to-falador"]);
  assert.deepEqual(run("custom:spell:teleport-arrival", { player: player({ x: 3213, y: 3424 }), name: "Varrock Teleport" }), []);
  assert.deepEqual(run("custom:magic:telekinetic-grab", { player: player(), itemId: 245, position: new core.Location(2930, 3515, 0) }), ["telegrab-some-wine-of-zamorak-at-the-chaos-templ"]);
  assert.deepEqual(run("custom:magic:telekinetic-grab", { player: player(), itemId: 245, position: new core.Location(3000, 3400, 0) }), []);
  assert.deepEqual(run("custom:thieving:done", { player: player(), kind: "pickpocket", succeeded: true, npc: npc("Guard", 2965, 3380) }), ["pickpocket-a-falador-guard"]);
  assert.deepEqual(run("custom:thieving:done", { player: player(), kind: "pickpocket", succeeded: false, npc: npc("Guard", 2965, 3380) }), []);
  assert.deepEqual(run("custom:thieving:done", { player: player(), kind: "pickpocket", succeeded: true, npc: npc("Guard", 3019, 3185) }), []);
  assert.deepEqual(run("custom:agility:obstacle", { player: player(), objectId: 24222 }), ["climb-over-the-western-falador-wall"]);
  assert.deepEqual(run("custom:agility:obstacle", { player: player({ y: 9806 }), objectId: 16543 }), ["squeeze-through-the-crevice-in-the-dwarven-mines"]);
  assert.deepEqual(run("custom:agility:obstacle", { player: player({ y: 9813 }), objectId: 16510 }), ["jump-over-the-strange-floor-in-taverley-dungeon"]);
});

test("altar, helmet and cape-emote credit require the full equipment and the right tile", () => {
  const initiate = {
    [core.Equipment.HEAD_SLOT]: { getId: () => 5574 },
    [core.Equipment.BODY_SLOT]: { getId: () => 5575 },
    [core.Equipment.LEG_SLOT]: { getId: () => 5576 },
  };
  const proselyte = {
    [core.Equipment.HEAD_SLOT]: { getId: () => 9672 },
    [core.Equipment.BODY_SLOT]: { getId: () => 9674 },
    [core.Equipment.LEG_SLOT]: { getId: () => 9678 },
  };
  const guthix = new core.Location(2925, 3483, 0);
  assert.deepEqual(run("custom:altar:prayed", { player: player({ x: 2925, y: 3483, equipment: initiate }), objectId: 410, location: guthix }), ["pray-at-the-altar-of-guthix-in-taverley-whilst-w"]);
  const partial = { ...initiate };
  delete partial[core.Equipment.LEG_SLOT];
  assert.deepEqual(run("custom:altar:prayed", { player: player({ x: 2925, y: 3483, equipment: partial }), objectId: 410, location: guthix }), []);
  const church = new core.Location(2995, 3177, 0);
  assert.deepEqual(run("custom:altar:prayed", { player: player({ x: 2995, y: 3177, equipment: proselyte }), objectId: 409, location: church }), ["recharge-your-prayer-in-the-port-sarim-church-wh"]);
  const miner = player({ x: 3046, y: 9755, equipment: { [core.Equipment.HEAD_SLOT]: { getId: () => 11200 } } });
  assert.deepEqual(run("custom:equipment:changed", { player: miner }), ["equip-a-dwarven-helmet-within-the-dwarven-mines"]);
  assert.deepEqual(run("custom:equipment:changed", { player: player({ x: 2965, y: 3378, equipment: { [core.Equipment.HEAD_SLOT]: { getId: () => 11200 } } }) }), []);
  assert.deepEqual(run("custom:player:emote", { player: player({ x: 2970, y: 3340, z: 3 }), slot: 43 }), ["perform-a-skillcape-or-quest-cape-emote-at-the-t"]);
  assert.deepEqual(run("custom:player:emote", { player: player({ x: 2970, y: 3340, z: 2 }), slot: 43 }), []);
  assert.deepEqual(run("custom:player:emote", { player: player({ x: 2970, y: 3340, z: 3 }), slot: 1 }), []);
});

test("zone entry tasks check the guild helmet and credit the rat pits", () => {
  const helmet = { [core.Equipment.HEAD_SLOT]: { getId: () => 12013 } };
  assert.deepEqual(zoneEnter(player({ equipment: helmet }), 3048, 9755), ["enter-the-mining-guild-wearing-a-prospector-helm"]);
  assert.deepEqual(zoneEnter(player(), 3048, 9755), []);
  assert.deepEqual(zoneEnter(player(), 2860, 3546), ["enter-the-warriors-guild"]);
  assert.deepEqual(zoneEnter(player(), 3018, 3232), ["visit-the-port-sarim-rat-pits"]);
});

test("the security guard's own hand-out condition gives one book and credits the task", () => {
  const p = player({ items: null });
  assert.equal(plugin._test.onDialogueCondition({ player: p, npcId: 5442, text: "If the player does not already have a security book:" }), true);
  run("custom:npc-dialogue:action", { player: p, npcId: 5442, stepId: "Uj1iZS" });
  assert.equal(p.getInventory().getAmount(9003), 1);
  const q = player({ items: null });
  run("custom:npc-dialogue:action", { player: q, npcId: 5442, stepId: "ujI56T", action: "receive", text: "security book" });
  assert.equal(q.getInventory().getAmount(9003), 1);
  assert.equal(plugin._test.onDialogueCondition({ player: p, npcId: 5442, text: "If the player already has a security book:" }), true);
  run("custom:npc-dialogue:action", { player: p, npcId: 5442, stepId: "Uj1iZS" });
  assert.equal(p.getInventory().getAmount(9003), 1);
});

test("an actual award reaches diary progress, not just the plugin's event", () => {
  const p = player();
  run("death", { killer: p, npc: npc("Duck", 2990, 3380) });
  assert.ok(Progress.doneTasks(p, diary).has("kill-a-duck-in-falador-park"));
  assert.equal(Progress.tierCount(p, diary, "easy"), 1);
});

test("the pump needs a bucket and the wine must be from the Falador temple", () => {
  const p = player({ x: 2947, y: 3382 });
  assert.deepEqual(run("custom:water-source:filled", { player: p, objectId: 24004, name: "Waterpump", itemId: core.ItemIdentifiers.VIAL }), []);
  assert.deepEqual(run("custom:magic:telekinetic-grab", { player: p, itemId: 245, position: new core.Location(2950, 3824, 0) }), []);
});

test("a full inventory cannot claim security-book progress", () => {
  const p = player({ items: null });
  const inventory = p.getInventory();
  inventory.addItem = () => inventory;
  assert.deepEqual(run("custom:npc-dialogue:action", { player: p, npcId: 5442, stepId: "Uj1iZS" }), []);
  assert.equal(inventory.getAmount(9003), 0);
});


test("outside guild doors cannot award entry tasks", () => {
  const helmet = { [core.Equipment.HEAD_SLOT]: { getId: () => 12013 } };
  assert.deepEqual(zoneEnter(player({ equipment: helmet }), 3046, 9757), []);
  assert.deepEqual(zoneEnter(player(), 2877, 3546), []);
  assert.deepEqual(zoneEnter(player({ equipment: helmet }), 3046, 9756), [plugin._test.TASK.miningGuild]);
  assert.deepEqual(zoneEnter(player(), 2876, 3546), [plugin._test.TASK.warriorsGuild]);
  for (const [x, y] of [[3019, 9732], [3043, 9729]]) {
    assert.deepEqual(zoneEnter(player({ equipment: helmet }), x, y + 1), []);
    assert.deepEqual(zoneEnter(player({ equipment: helmet }), x, y), [plugin._test.TASK.miningGuild]);
  }
});

test("the ordinary herblore recipe's three-dose brew credits the east bank", () => {
  const recipe = require("../plugins/skills/data/herblore.json").recipes.find((r) => r.product === "3dosepotionofsaradomin");
  assert.ok(recipe);
  const productId = core.CacheDefinitions.getObjId(recipe.product);
  assert.equal(productId, 6687);
  assert.deepEqual(run("custom:herblore:made", { player: player({ x: 3012, y: 3355 }), itemId: productId }), [plugin._test.TASK.saradominBrew]);
  assert.deepEqual(run("custom:herblore:made", { player: player(), itemId: productId }), []);
});
