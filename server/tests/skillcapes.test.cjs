// Run after `yarn build`: node --test tests/skillcapes.test.cjs
const assert = require("node:assert/strict");
const path = require("path");
const { test, before } = require("node:test");
const { Server } = require("../dist/Server");
Server.installProductionPathResolver();

const { PluginManager } = require("../dist/plugins/PluginManager");
const Capes = require("../plugins/items/skillcapes/Common.SkillCapes");
const Sellers = require("../plugins/items/skillcapes/Sellers.SkillCapes");
const Trimming = require("../plugins/items/skillcapes/Trimming.SkillCapes");
const Boost = require("../plugins/items/skillcapes/Boost.SkillCapes");
const Teleports = require("../plugins/items/skillcapes/Teleports.SkillCapes");
const Options = require("../plugins/items/skillcapes/Options.SkillCapes");
const MetalAttraction = require("../plugins/items/skillcapes/MetalAttraction.SkillCapes");
const WornVariants = require("../plugins/items/skillcapes/WornVariants.SkillCapes");
const MaxCape = require("../plugins/items/skillcapes/MaxCape.SkillCapes");

let core;
const events = [];
const prompts = [];
const api = new Proxy({
  emitCustomEvent(name, request) {
    events.push(name);
    if (name === "skillcape:has-perk") Capes.answerPerk(request);
  },
  sendMultiChatboxPrompt(player, title, ...pairs) {
    prompts.push({ title, options: pairs.filter((_, i) => i % 2 === 0), pick: (label) => pairs[pairs.indexOf(label) + 1]() });
    return true;
  },
}, { get: (target, key) => (key === "core" ? core : key in target ? target[key] : () => {}) });

before(async () => {
  const { CachePipeline } = require("../dist/game/cache/CachePipeline");
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  core = PluginManager.getCoreApi();
  Capes.init(api);
  for (const unit of [WornVariants, Sellers, Trimming, Boost, Teleports, Options, MetalAttraction, MaxCape]) unit(api);
});

const obj = (name) => core.CacheDefinitions.getObjId(name);

function item(id, amount = 1) {
  let current = id;
  let count = amount;
  return { getId: () => current, setId(next) { current = next; return this; }, getAmount: () => count, setAmount(n) { count = n; return this; } };
}

function container(ids, size) {
  const items = [...ids.map((id) => item(id)), ...Array(Math.max(0, size - ids.length)).fill(null).map(() => item(-1, 0))];
  return {
    getItems: () => items,
    contains: (id) => items.some((i) => i.getId() === id && i.getAmount() > 0),
    getAmount: (id) => items.filter((i) => i.getId() === id).reduce((sum, i) => sum + i.getAmount(), 0),
    getFreeSlots: () => items.filter((i) => i.getId() <= 0).length,
    deleteNumber(id, amount) {
      for (const i of items) {
        if (amount <= 0) break;
        if (i.getId() !== id) continue;
        const taken = Math.min(amount, i.getAmount());
        i.setAmount(i.getAmount() - taken);
        if (i.getAmount() === 0) i.setId(-1);
        amount -= taken;
      }
    },
    adds(id, amount) {
      const stack = items.find((i) => i.getId() === id && core.ItemDefinition.forId(id)?.isStackable?.());
      if (stack) { stack.setAmount(stack.getAmount() + amount); return; }
      const free = items.find((i) => i.getId() <= 0);
      if (free) free.setId(id).setAmount(amount);
    },
    refreshItems() {},
    full() {},
  };
}

/** A player with the given 99s (skill keys), worn cape, inventory and bank. */
function player({ ninetyNines = [], cape = -1, inventory = [], bank = [], coins = 0, location = { x: 3000, y: 3000, z: 0 } } = {}) {
  const equipment = Array(14).fill(null).map(() => item(-1, 0));
  equipment[core.Equipment.CAPE_SLOT] = item(cape);
  const inv = container(inventory, 28);
  if (coins) inv.adds(core.ItemIdentifiers.COINS, coins);
  const banks = [container(bank, 100)];
  const attributes = new Map();
  const current = new Map();
  const messages = [];
  const varbits = new Map();
  const levelOf = (skill) => (ninetyNines.includes("ALL") || ninetyNines.some((key) => core.Skill[key] === skill) ? 99 : 50);
  return {
    messages, attributes, varbits, location,
    getEquipment: () => ({ ...container([], 0), getItems: () => equipment, contains: (id) => equipment.some((i) => i.getId() === id), refreshItems() {} }),
    getInventory: () => inv,
    getBanks: () => banks,
    getLocation: () => ({ getX: () => location.x, getY: () => location.y, getZ: () => location.z }),
    getAttribute: (key) => attributes.get(key),
    setAttribute: (key, value) => attributes.set(key, value),
    sendMessage: (text) => messages.push(text),
    getDialogueManager: () => ({ startDialogues() {}, getCurrent: () => null }),
    getSkillManager: () => ({
      getMaxLevel: levelOf,
      getCurrentLevel: (skill) => current.get(skill) ?? levelOf(skill),
      setCurrentLevel: (skill, level) => current.set(skill, level),
    }),
    getPacketSender: () => ({ sendVarbit: (id, value) => varbits.set(id, value), getVarbit: (id) => varbits.get(id) ?? 0 }),
  };
}

test("each skill's own cape, trimmed or worn, and the max cape give its perk", () => {
  for (const [skill, cape] of [["COOKING", "skillcape_cooking"], ["COOKING", "skillcape_cooking_trimmed"],
    ["AGILITY", "skillcape_agility_worn"], ["THIEVING", "skillcape_max"], ["THIEVING", "skillcape_max_worn"]]) {
    assert.equal(Capes.hasPerk(player({ cape: obj(cape) }), skill), true, `${cape} -> ${skill}`);
  }
  assert.equal(Capes.hasPerk(player({ cape: obj("skillcape_attack") }), "COOKING"), false);
  assert.equal(Capes.hasPerk(player(), "COOKING"), false);
});

test("combined max capes keep only the Cooking, Crafting, Runecraft and Firemaking perks (Wiki)", () => {
  const infernal = player({ cape: obj("skillcape_max_infernalcape") });
  for (const skill of ["COOKING", "CRAFTING", "RUNECRAFTING", "FIREMAKING"]) assert.equal(Capes.hasPerk(infernal, skill), true, skill);
  for (const skill of ["THIEVING", "SLAYER", "DEFENCE"]) assert.equal(Capes.hasPerk(infernal, skill), false, skill);
});

test("a carried cape counts only when asked for (the Prayer cape's holy wrench)", () => {
  const carried = player({ inventory: [obj("skillcape_prayer")] });
  assert.equal(Capes.hasPerk(carried, "PRAYER"), false);
  assert.equal(Capes.hasPerk(carried, "PRAYER", true), true);
  const request = { player: carried, skill: "PRAYER", inventory: true, result: false };
  Capes.answerPerk(request);
  assert.equal(request.result, true);
});

test("worn submenus read the cache's params in order", () => {
  const max = core.CacheDefinitions.getItem(obj("skillcape_max_worn"));
  assert.deepEqual(Capes.wornSubOptions(max, 3).slice(0, 3), ["Otto's Grotto", "Carnivorous chinchompas", "Black chinchompas"]);
  assert.deepEqual(Capes.wornSubOptions(max, 2).slice(0, 2), ["Crafting Guild", "Farming Guild"]);
  const construction = core.CacheDefinitions.getItem(obj("skillcape_construction"));
  assert.equal(Capes.wornSubOption(construction, 1, 1), "Rimmington");
});

test("Ava's assembler max capes recover 80%, an accumulator max cape and the Ranging cape 72% (80% after Vorkath)", () => {
  const { ammoRecovery } = Options._test;
  const recovery = (p) => {
    const request = { player: p, recovery: null };
    ammoRecovery(request);
    return request.recovery;
  };
  assert.equal(recovery(player({ cape: obj("skillcape_max_assembler") })), 80);
  assert.equal(recovery(player({ cape: obj("skillcape_max_anma") })), 72);
  const max = player({ cape: obj("skillcape_max") });
  assert.equal(recovery(max), 72);
  max.setAttribute(Capes.VORKATH_UPGRADE_ATTRIBUTE, true);
  assert.equal(recovery(max), 80);
  const ranging = player({ cape: obj("skillcape_ranging") });
  assert.equal(recovery(ranging), 72);
  ranging.setAttribute(Capes.VORKATH_UPGRADE_ATTRIBUTE, true);
  assert.equal(recovery(ranging), 80);
  assert.equal(recovery(player({ cape: obj("skillcape_attack") })), null);
});

test("the Ranging cape gathers steel, then mithril after Vorkath's head, only while worn and moving", () => {
  const { process, tableFor } = MetalAttraction._test;
  const p = player({ cape: obj("skillcape_ranging") });
  for (let tick = 0; tick < Capes.DATA.metalAttraction.intervalTicks; tick++) process({ player: p });
  assert.equal(p.getInventory().getFreeSlots(), 28, "no movement, no gathering");

  p.location.x += 3;
  process({ player: p });
  const held = () => p.getInventory().getItems().filter((item) => item.getId() > 0);
  assert.equal(held().length, 1);
  assert.ok(tableFor(p).some((entry) => entry.id === held()[0].getId()), "a steel-table item");

  p.getEquipment().getItems()[core.Equipment.CAPE_SLOT].setId(-1);
  for (let tick = 0; tick < Capes.DATA.metalAttraction.intervalTicks * 2; tick++) process({ player: p });
  assert.equal(held().length, 1, "no cape, no gathering");

  p.getEquipment().getItems()[core.Equipment.CAPE_SLOT].setId(obj("skillcape_ranging"));
  p.setAttribute(Capes.VORKATH_UPGRADE_ATTRIBUTE, true);
  p.location.x += 3;
  for (let tick = 0; tick < Capes.DATA.metalAttraction.intervalTicks; tick++) process({ player: p });
  assert.equal(held().length, 2);
  assert.ok(tableFor(p).some((entry) => entry.id === held()[1].getId()), "a mithril-table item after the upgrade");
});

test("the Sailing cape asks the sailing plugin for its boat teleport and rename options", () => {
  events.length = 0;
  const p = player({ cape: obj("skillcape_sailing") });
  Teleports.goTo(p, "Teleport boat to the Pandemonium");
  assert.ok(events.includes("sailing:cape-teleport"));
  assert.equal(p.messages.at(-1), "That isn't available yet.");
  events.length = 0;
  Teleports.goTo(p, "Rename boat");
  assert.ok(events.includes("sailing:cape-rename-boat"));
  assert.equal(p.messages.at(-1), "That isn't available yet.");
});

test("teleport labels from menus and options map to destinations", () => {
  const { destinationKey } = Teleports._test;
  assert.equal(destinationKey("Warrior's Guild"), "warriors guild");
  assert.equal(destinationKey("Carnivorous chinchompas (Feldip Hills)"), "carnivorous chinchompas");
  assert.equal(destinationKey("Feldip Hills"), "carnivorous chinchompas");
  assert.equal(destinationKey("Teleport to a boat (last one)"), "last-boat");
  assert.equal(destinationKey("The Pandemonium"), "pandemonium");
  assert.equal(destinationKey("Tele to POH"), "home");
});

test("masters sell the cape and hood for 99,000, trimmed with a second 99", () => {
  const { sellerCondition, sellerAction } = Sellers._test;
  const definition = { getName: () => "Gadrin" };
  const one = player({ ninetyNines: ["MINING"], coins: 99000 });
  const ask = (p, text) => sellerCondition({ player: p, definition, text });
  assert.equal(ask(one, "If the player has 99 Mining:"), true);
  assert.equal(ask(one, "If the player has at least 99,000 coins and enough inventory space:"), true);
  assert.equal(ask(one, "If the player does not have at least 99,000 coins:"), false);
  sellerAction({ player: one, definition, text: "a Mining cape and hood", kind: undefined });
  assert.equal(one.getInventory().contains(obj("skillcape_mining")), true);
  assert.equal(one.getInventory().contains(obj("skillcape_mining_hood")), true);
  assert.equal(one.getInventory().getAmount(core.ItemIdentifiers.COINS), 0);

  const two = player({ ninetyNines: ["MINING", "COOKING"], coins: 100000 });
  sellerAction({ player: two, definition, text: "a Mining cape and hood" });
  assert.equal(two.getInventory().contains(obj("skillcape_mining_trimmed")), true);

  const poor = player({ ninetyNines: ["MINING"], coins: 5 });
  assert.equal(ask(poor, "If the player does not have at least 99,000 coins:"), true);
});

test("shop masters get a copy of their shop with the cape, and the hood needs a second slot", () => {
  const { shopCopies, limitCapePurchase, SHOP_MASTERS, SHOP_CAPES } = Sellers._test;
  const copies = shopCopies();
  const hickton = copies.filter((shop) => shop.name === "Hickton's Archery Emporium.");
  assert.equal(hickton.length, 2);
  assert.ok(hickton[0].originalStock.some((row) => row.id === obj("skillcape_fletching") && row.price === 99000));
  assert.ok(hickton[1].originalStock.some((row) => row.id === obj("skillcape_fletching_trimmed")));
  assert.equal(SHOP_MASTERS.size, 5);
  const shopId = hickton[0].id;
  const limit = { player: player({ inventory: Array(27).fill(core.ItemIdentifiers.COINS) }), shopId, itemId: SHOP_CAPES.get(shopId).capeId, limit: 1, message: null };
  limitCapePurchase(limit);
  assert.equal(limit.limit, 0);
  assert.match(limit.message, /free hood/);
});

test("a second 99 trims every skillcape the player owns", () => {
  const p = player({ ninetyNines: ["ATTACK", "STRENGTH"], cape: obj("skillcape_attack"), inventory: [obj("skillcape_agility")], bank: [obj("skillcape_strength")] });
  Trimming._test.trimOnLevelUp({ player: p, oldLevel: 98, newLevel: 99 });
  assert.equal(p.getEquipment().getItems()[core.Equipment.CAPE_SLOT].getId(), obj("skillcape_attack_trimmed"));
  assert.equal(p.getInventory().contains(obj("skillcape_agility_trimmed")), true);
  assert.equal(p.getBanks()[0].contains(obj("skillcape_strength_trimmed")), true);
  const one = player({ ninetyNines: ["ATTACK"], inventory: [obj("skillcape_attack")] });
  Trimming._test.trimOnLevelUp({ player: one, oldLevel: 98, newLevel: 99 });
  assert.equal(one.getInventory().contains(obj("skillcape_attack")), true, "one 99 keeps it untrimmed");
});

test("Boost raises the skill to 100 once until it drops back; Hitpoints waits a minute", () => {
  const { boost, lastBoost } = Boost._test;
  const cape = Capes.CAPE_BY_SKILL.get("MINING");
  const p = player({ ninetyNines: ["MINING", "HITPOINTS"] });
  boost(p, cape);
  assert.equal(p.getSkillManager().getCurrentLevel(core.Skill.MINING), 100);
  boost(p, cape);
  assert.equal(p.getSkillManager().getCurrentLevel(core.Skill.MINING), 100, "no second boost above 99");
  const hp = Capes.CAPE_BY_SKILL.get("HITPOINTS");
  boost(p, hp);
  p.getSkillManager().setCurrentLevel(core.Skill.HITPOINTS, 99);
  boost(p, hp);
  assert.equal(p.messages.at(-1), "Your Skillcape of Hitpoints can only provide a hitpoint boost once per minute.");
  lastBoost.delete(p);
});

test("daily allowances count today's uses and reset on a new day", () => {
  const p = player();
  assert.equal(Capes.dailyUses(p, "spellbook"), 0);
  Capes.useDaily(p, "spellbook");
  Capes.useDaily(p, "spellbook");
  assert.equal(Capes.dailyUses(p, "spellbook"), 2);
  p.setAttribute(Capes.DAILY_ATTRIBUTE, { day: "2000-01-01", counts: { spellbook: 5 } });
  assert.equal(Capes.dailyUses(p, "spellbook"), 0);
});

test("the Magic cape menu leaves out the current spellbook and counts what is left", () => {
  prompts.length = 0;
  const p = player({ ninetyNines: ["MAGIC"] });
  p.getSpellbook = () => core.MagicSpellbook.NORMAL;
  Options.spellbookMenu(p);
  assert.equal(prompts[0].title, "Choose spellbook: (5/5 left)");
  assert.deepEqual(prompts[0].options, ["Ancient", "Lunar", "Arceuus", "Cancel"]);
});

test("the max cape and Agility cape swap to their worn ids and back", () => {
  const { normalise } = WornVariants._test;
  const p = player({ cape: obj("skillcape_max"), inventory: [obj("skillcape_agility_worn")] });
  normalise({ player: p });
  assert.equal(p.getEquipment().getItems()[core.Equipment.CAPE_SLOT].getId(), obj("skillcape_max_worn"));
  assert.equal(p.getInventory().contains(obj("skillcape_agility")), true);
});

test("combining needs the max hood, and makes the combined cape and hood", () => {
  const { combineOnUse } = MaxCape._test;
  prompts.length = 0;
  const noHood = player({ inventory: [obj("skillcape_max"), obj("infernal_cape")] });
  combineOnUse({ player: noHood, usedItemId: obj("infernal_cape"), usedWithItemId: obj("skillcape_max") });
  assert.equal(noHood.messages.at(-1), "You need your max cape hood to be able to combine those.");
  const p = player({ inventory: [obj("skillcape_max"), obj("skillcape_max_hood"), obj("infernal_cape")] });
  combineOnUse({ player: p, usedItemId: obj("infernal_cape"), usedWithItemId: obj("skillcape_max") });
  assert.equal(prompts.at(-1).title, "You will lose your Infernal cape if you proceed!");
  prompts.at(-1).pick("Yes - combine this item with your max cape and lose it.");
  assert.equal(p.getInventory().contains(obj("skillcape_max_infernalcape")), true);
  assert.equal(p.getInventory().contains(obj("skillcape_max_hood_infernalcape")), true);
  assert.equal(p.getInventory().contains(obj("infernal_cape")), false);

  MaxCape._test.disassemble(p, Capes.COMBINED_BY_CAPE.get(obj("skillcape_max_infernalcape")));
  assert.equal(p.getInventory().contains(obj("skillcape_max")), true);
  assert.equal(p.getInventory().contains(obj("infernal_cape")), true);
  assert.equal(p.getInventory().contains(obj("skillcape_max_hood")), true, "a carried hood turns back too");
});

test("Mac sells the max cape only to a player with every 99, and buys it back for 80%", () => {
  const { macCondition, buyMaxCape, sellBack } = MaxCape._test;
  const definition = { getName: () => "Mac" };
  assert.equal(macCondition({ player: player({ ninetyNines: ["ATTACK"] }), definition, text: "If the player has a total level of 2376:" }), false);
  const maxed = player({ ninetyNines: ["ALL"], coins: 2376000 });
  assert.equal(macCondition({ player: maxed, definition, text: "If the player has a total level of 2376:" }), true);
  assert.equal(buyMaxCape(maxed), true);
  assert.equal(maxed.getInventory().contains(obj("skillcape_max")), true);
  sellBack(maxed);
  assert.equal(maxed.getInventory().getAmount(core.ItemIdentifiers.COINS), 1900800);
  assert.equal(maxed.getInventory().contains(obj("skillcape_max_hood")), false);
});
