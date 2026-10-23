// Run after `yarn build`: node --test tests/herblore.test.cjs
const assert = require("node:assert/strict");
const path = require("path");
const { test, before, beforeEach } = require("node:test");
const { Server } = require("../dist/Server");
Server.installProductionPathResolver();

const { PluginManager } = require("../dist/plugins/PluginManager");
const DATA = require("../plugins/skills/data/herblore.json");
const Herblore = require("../plugins/skills/Herblore.plugin");
const Zahur = require("../plugins/npcs/Zahur.plugin");

let core;
const hooks = { firstAction: [], itemOnItem: [], customEvents: new Map() };
const world = { quests: new Map(), cape: false, diaries: new Set() };

const api = new Proxy({
  onItemFirstAction(handler) { hooks.firstAction.push(handler); },
  onItemOnItem(handler) { hooks.itemOnItem.push(handler); },
  onCustomEvent(name, handler) { hooks.customEvents.set(name, handler); },
  sendMultiChatboxPrompt(who, title, ...pairs) { who.sent.prompt = { title, pick: (label) => pairs[pairs.indexOf(label) + 1]() }; return true; },
  emitCustomEvent(name, request) {
    hooks.customEvents.get(name)?.(request);
    if (name === "quest:is-complete") request.complete = world.quests.get(request.key) ?? true;
    if (name === "quest:is-started") request.started = world.quests.get(`${request.key}:started`) ?? true;
    if (name === "skillcape:has-perk") request.result = world.cape;
    if (name === "diary:is-complete") request.complete = world.diaries.has(`${request.diary}:${request.tier}`);
  },
}, { get: (target, key) => (key === "core" ? core : key in target ? target[key] : () => {}) });

before(async () => {
  const { CachePipeline } = require("../dist/game/cache/CachePipeline");
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  core = PluginManager.getCoreApi();
  Herblore.register(api);
  Zahur.register(api);
});

beforeEach(() => {
  world.quests.clear();
  world.cape = false;
  world.diaries.clear();
});

const obj = (name) => core.CacheDefinitions.getObjId(name);

function inventory(contents) {
  const slots = Array(28).fill(null);
  contents.forEach(([name, amount = 1], index) => { slots[index] = new core.Item(obj(name), amount); });
  const self = {
    getItems: () => slots.map((item) => item ?? new core.Item(-1, 0)),
    getAmount: (id) => slots.filter((item) => item?.getId() === id).reduce((sum, item) => sum + item.getAmount(), 0),
    setItem(slot, item) { slots[slot] = item; return self; },
    refreshItems() { return self; },
    addItem(item) {
      const stack = core.ItemDefinition.forId(item.getId()).isStackable();
      const existing = stack && slots.find((slot) => slot?.getId() === item.getId());
      if (existing) existing.setAmount(existing.getAmount() + item.getAmount());
      else for (let n = 0; n < (stack ? 1 : item.getAmount()); n++) slots[slots.indexOf(null)] = new core.Item(item.getId(), stack ? item.getAmount() : 1);
      return self;
    },
    deleteNumber(id, amount) {
      for (let slot = 0; slot < slots.length && amount > 0; slot++) {
        const item = slots[slot];
        if (item?.getId() !== id) continue;
        const taken = Math.min(amount, item.getAmount());
        amount -= taken;
        if (item.getAmount() === taken) slots[slot] = null; else item.setAmount(item.getAmount() - taken);
      }
      return self;
    },
    adds(id, amount) { return self.addItem(new core.Item(id, amount)); },
    count: (name) => self.getAmount(obj(name)),
  };
  return self;
}

function player(contents, level = 99) {
  const sent = { messages: [], spam: [], sounds: [], animations: [], xp: 0 };
  const inv = inventory(contents);
  const sender = new Proxy({
    sendCreationMenu(menu) { sent.menu = menu; return sender; },
    sendTypedMessage(type, text) { sent.spam.push(text); return sender; },
    sendSound(id) { sent.sounds.push(id); return sender; },
  }, { get: (target, key) => key in target ? target[key] : () => sender });
  return {
    sent, inv,
    getInventory: () => inv,
    getPacketSender: () => sender,
    getSkillManager: () => ({
      getCurrentLevel: () => level,
      addExperiences(skill, xp) { assert.equal(skill, core.Skill.HERBLORE); sent.xp += xp; },
    }),
    sendMessage(text) { sent.messages.push(text); },
    getDialogueManager: () => ({ startDialogues(chain) { sent.dialogue = JSON.stringify(chain, (key, value) => value instanceof Map ? [...value.values()] : value); } }),
    performAnimation(animation) { sent.animations.push(animation.getId()); },
    getIndex: () => 1, isRegistered: () => true, getHitpoints: () => 99,
  };
}

function click(who, name) {
  const itemId = obj(name);
  const slot = who.inv.getItems().findIndex((item) => item.getId() === itemId);
  const event = { player: who, itemId, slot, clickType: 1 };
  return hooks.firstAction.some((handler) => handler(event) !== false);
}

/**
 * Game cycles. A click is handled between cycles, so the first cycle after it is the tick the
 * capture calls 0, the second tick 1, and so on.
 */
function ticks(count) {
  for (let i = 0; i < count; i++) core.TaskManager.process();
}

/** Picks an amount in the open skillmulti menu, as the client's resume_pausebutton does. */
function choose(who, amount) {
  const menu = who.sent.menu;
  who.sent.menu = null;
  menu.execute(menu.getItems()[0], amount);
}

function use(who, used, usedWith) {
  const event = { player: who, usedItemId: obj(used), usedWithItemId: obj(usedWith), handled: false };
  for (const handler of hooks.itemOnItem) handler(event);
  return event.handled;
}

test("every herb and recipe names a cache item", () => {
  for (const herb of DATA.herbs) for (const name of [herb.grimy, herb.clean]) assert.ok(Number.isInteger(obj(name)), name);
  for (const recipe of DATA.recipes) {
    for (const name of [recipe.product, ...recipe.ingredients.map(([n]) => n), ...(recipe.returns ?? []).map(([n]) => n)]) {
      assert.ok(Number.isInteger(obj(name)), `${recipe.product}: ${name}`);
    }
  }
});

/** Herblore in table 213's skill column, which numbers skills as the skill guide does. */
const SKILL_GUIDE_HERBLORE = 9;

test("levels agree with the cache's Herblore skill guide (table 213)", () => {
  const { CacheDefinitions } = core;
  const text = CacheDefinitions.getDbColumn(213, "text");
  const skill = CacheDefinitions.getDbColumn(213, "skill");
  const name = (gameval) => CacheDefinitions.getItem(obj(gameval)).name.replace(/ ?\(\d\)$/, "").replace(/ \(unf\)$/, "").toLowerCase();
  const potions = new Map(DATA.recipes.map((recipe) => [name(recipe.product), recipe.level]));
  const herbs = new Map(DATA.herbs.map((herb) => [name(herb.clean), herb.level]));
  let compared = 0;
  for (const row of CacheDefinitions.getDbTableRows(213)) {
    const [skillId, level, subsection] = row.columns.get(skill) ?? [];
    if (Number(skillId) !== SKILL_GUIDE_HERBLORE || ![1, 2].includes(Number(subsection))) continue;
    const label = String(row.columns.get(text)?.[0] ?? "").split("<br>")[0].toLowerCase();
    const ours = (Number(subsection) === 2 ? herbs : potions).get(label);
    if (ours === undefined) continue;
    assert.equal(ours, Number(level), label);
    compared++;
  }
  assert.ok(compared >= 25, `only ${compared} skill guide rows matched`);
});

test("cleaning swaps the herb in its slot with the captured message, a cleaning sound and XP", () => {
  const who = player([["unidentified_ranarr"], ["unidentified_ranarr"]]);
  assert.equal(click(who, "unidentified_ranarr"), true);
  assert.equal(click(who, "unidentified_ranarr"), true, "a second clean in the same tick");
  assert.equal(who.inv.count("ranarr_weed"), 2);
  assert.equal(who.inv.getItems()[0].getId(), obj("ranarr_weed"));
  assert.deepEqual(who.sent.spam, ["You clean the Grimy ranarr weed.", "You clean the Grimy ranarr weed."]);
  assert.ok(who.sent.sounds.every((id) => id >= 3920 && id <= 3923));
  assert.equal(who.sent.xp, 15);
});

test("cleaning below the level names the herb and the level", () => {
  const who = player([["unidentified_torstol"]], 74);
  click(who, "unidentified_torstol");
  assert.deepEqual(who.sent.messages, ["You need level 75 Herblore to clean the Grimy torstol."]);
  assert.equal(who.inv.count("unidentified_torstol"), 1);
});

test("Herblore needs Druidic Ritual", () => {
  world.quests.set("druidic_ritual", false);
  const who = player([["unidentified_guam"], ["guam_leaf"], ["vial_water"]]);
  click(who, "unidentified_guam");
  assert.equal(use(who, "guam_leaf", "vial_water"), true);
  assert.equal(who.inv.count("unidentified_guam"), 1);
  assert.equal(who.inv.count("guamvial"), 0);
  assert.deepEqual(who.sent.messages, Array(2).fill("You must complete the Druidic Ritual quest to unlock the Herblore skill."));
});

test("a herb in a vial of water makes the unfinished potion, with no XP", () => {
  const who = player([["ranarr_weed"], ["vial_water"]]);
  assert.equal(use(who, "vial_water", "ranarr_weed"), true);
  assert.equal(who.inv.count("ranarrvial"), 1);
  assert.equal(who.sent.xp, 0);
  assert.deepEqual(who.sent.spam, ["You put the Ranarr Weed into the vial of water."]);
  assert.deepEqual(who.sent.sounds, [2608]);
  assert.deepEqual(who.sent.animations, [core.CacheDefinitions.getSeqId("human_herbing_vial")]);
});

test("a secondary finishes the potion at the Wiki's level and XP", () => {
  const low = player([["guamvial"], ["eye_of_newt"]], 2);
  use(low, "eye_of_newt", "guamvial");
  assert.deepEqual(low.sent.messages, ["You need a Herblore level of 3 to combine those."]);
  const who = player([["ranarrvial"], ["snape_grass"]], 38);
  use(who, "snape_grass", "ranarrvial");
  assert.equal(who.inv.count("3doseprayerrestore"), 1);
  assert.equal(who.sent.xp, 87.5);
  assert.deepEqual(who.sent.spam, ["You mix the snape grass into your potion."]);
});

test("items that make nothing are left to other plugins", () => {
  const who = player([["snape_grass"], ["vial_water"]]);
  assert.equal(use(who, "snape_grass", "vial_water"), false);
});

test("the Herblore cape puts a grimy herb straight into the vial", () => {
  world.cape = true;
  const who = player([["unidentified_marentill"], ["vial_water"]]);
  use(who, "unidentified_marentill", "vial_water");
  assert.equal(who.inv.count("marrentillvial"), 1);
  assert.deepEqual(who.sent.spam, ["You clean the Grimy marrentill.", "You put the Marrentill into the vial of water."]);
  assert.equal(who.sent.xp, 3.8);
  world.cape = false;
  const without = player([["unidentified_marentill"], ["vial_water"]]);
  assert.equal(use(without, "unidentified_marentill", "vial_water"), false);
});

test("herblore:unfinished answers Zahur with the herb's unfinished potion", () => {
  const request = { herbId: obj("toadflax"), potion: null };
  hooks.customEvents.get("herblore:unfinished")(request);
  assert.equal(request.potion, obj("toadflaxvial"));
});

test("more than one opens the captured skillmulti menu", () => {
  const who = player([...Array(14).fill(["ranarr_weed"]), ...Array(14).fill(["vial_water"])]);
  use(who, "vial_water", "ranarr_weed");
  const menu = who.sent.menu;
  assert.equal(menu.getTitle(), "How many do you wish to make?");
  assert.deepEqual(menu.getItems(), [obj("ranarrvial")]);
  assert.deepEqual(menu.getOptions(), { mode: 0, maxAmount: 14, lastAmount: 14 });
  assert.equal(who.inv.count("ranarrvial"), 0);
});

test("unfinished potions come a tick after the menu closes, then one a tick", () => {
  const who = player([...Array(14).fill(["ranarr_weed"]), ...Array(14).fill(["vial_water"])]);
  use(who, "vial_water", "ranarr_weed");
  choose(who, 14);
  assert.deepEqual(who.sent.sounds, [2608], "the animation and sound as the menu closes");
  ticks(1);
  assert.equal(who.inv.count("ranarrvial"), 0, "tick 0");
  ticks(1);
  assert.equal(who.inv.count("ranarrvial"), 1, "tick 1");
  ticks(13);
  assert.equal(who.inv.count("ranarrvial"), 14);
  assert.equal(who.sent.spam.length, 14);
  ticks(2);
  assert.equal(who.sent.sounds.length, 15);
});

test("finished potions come every two ticks, and stop at the amount chosen", () => {
  const who = player([...Array(5).fill(["ranarrvial"]), ...Array(5).fill(["snape_grass"])]);
  use(who, "snape_grass", "ranarrvial");
  choose(who, 3);
  ticks(2);
  assert.equal(who.inv.count("3doseprayerrestore"), 1, "tick 1");
  ticks(1);
  assert.equal(who.inv.count("3doseprayerrestore"), 1, "tick 2");
  ticks(1);
  assert.equal(who.inv.count("3doseprayerrestore"), 2, "tick 3");
  ticks(10);
  assert.equal(who.inv.count("3doseprayerrestore"), 3);
  assert.equal(who.inv.count("ranarrvial"), 2);
});

test("the Herblore cape's grimy herbs start at once and go every tick", () => {
  world.cape = true;
  const who = player([...Array(3).fill(["unidentified_marentill"]), ...Array(3).fill(["vial_water"])]);
  use(who, "unidentified_marentill", "vial_water");
  choose(who, 3);
  assert.equal(who.inv.count("marrentillvial"), 1);
  ticks(1);
  assert.equal(who.inv.count("marrentillvial"), 1, "tick 0");
  ticks(1);
  assert.equal(who.inv.count("marrentillvial"), 2, "tick 1");
  ticks(1);
  assert.equal(who.inv.count("marrentillvial"), 3, "tick 2");
  assert.deepEqual(who.sent.animations, []);
});

test("stackable secondaries go in one per dose", () => {
  const who = player([["4dose2energy"], ["amylase", 10]], 77);
  use(who, "amylase", "4dose2energy");
  assert.equal(who.inv.count("4dosestamina"), 1);
  assert.equal(who.inv.count("amylase"), 6);
  assert.equal(who.sent.xp, 102);
  assert.deepEqual(who.sent.spam, ["You mix 4 crystals of amylase into your potion."]);
  const scales = player([["antidote++3"], ["snakeboss_scale", 100]], 87);
  use(scales, "antidote++3", "snakeboss_scale");
  assert.equal(scales.inv.count("antivenom3"), 1);
  assert.equal(scales.inv.count("snakeboss_scale"), 85);
});

test("too few secondaries lists what the potion takes, as captured", () => {
  const who = player([["4dose2energy"], ["amylase", 1]], 77);
  assert.equal(use(who, "amylase", "4dose2energy"), true);
  assert.match(who.sent.dialogue, /You don't have the right ingredients: 1 x Super energy\(4\) 4 x Amylase crystal/);
  assert.equal(who.inv.count("amylase"), 1);
  const venom = player([["antivenom+4"], ["araxyte_venom_sack", 1]], 94);
  use(venom, "araxyte_venom_sack", "antivenom+4");
  assert.match(venom.sent.dialogue, /You don't have the right ingredients: 1 x Anti-venom\+\(4\) 4 x Araxyte venom sac/);
});

test("upgrading a finished potion below the level says so", () => {
  const who = player([["4dose2energy"], ["amylase", 4]], 76);
  use(who, "amylase", "4dose2energy");
  assert.deepEqual(who.sent.messages, ["You need level 77 Herblore to upgrade the potion."]);
});

test("super combat takes the three super potions and torstol, leaving two vials", () => {
  const who = player([["4dose2attack"], ["4dose2strength"], ["4dose2defense"], ["torstol"]], 90);
  use(who, "torstol", "4dose2attack");
  assert.equal(who.inv.count("4dose2combat"), 1);
  assert.equal(who.inv.count("vial_empty"), 2);
  assert.equal(who.inv.count("torstol"), 0);
  assert.deepEqual(who.sent.spam, ["You carefully mix the potions and torstol together."]);
  const missing = player([["4dose2attack"], ["torstol"]], 90);
  use(missing, "torstol", "4dose2attack");
  assert.match(missing.sent.dialogue, /You don't have the right ingredients: 1 x Super attack\(4\) 1 x Super defence\(4\) 1 x Super strength\(4\) 1 x Torstol/);
});

test("super antifire needs Dragon Slayer II", () => {
  world.quests.set("dragon_slayer_ii", false);
  const who = player([["4dose1antidragon"], ["crushed_dragon_bones"]], 92);
  use(who, "crushed_dragon_bones", "4dose1antidragon");
  assert.deepEqual(who.sent.messages, ["You don't know how to make super antifire potions yet. Maybe someone can teach you."]);
  world.quests.set("dragon_slayer_ii", true);
  use(who, "crushed_dragon_bones", "4dose1antidragon");
  assert.equal(who.inv.count("4dose3antidragon"), 1);
  assert.deepEqual(who.sent.spam, ["You mix the crushed superior dragon bones into your antifire potion."]);
});

test("sanfew serum is made in three steps", () => {
  const who = player([["3dose2restore"], ["unicorn_horn_dust"], ["snake_weed"], ["nail_beast_nail"]], 65);
  use(who, "unicorn_horn_dust", "3dose2restore");
  use(who, "snake_weed", "sanfew_salve_step_1_3_dose");
  use(who, "nail_beast_nail", "sanfew_salve_step_2_3_dose");
  assert.equal(who.inv.count("sanfew_salve_3_dose"), 1);
  assert.equal(who.sent.xp, 47.5 + 52.5 + 60);
  assert.deepEqual(who.sent.spam, [
    "You mix the unicorn horn dust into your potion.",
    "You mix the snake weed into your potion.",
    "You mix the nail beast nail into your potion and make a 3-dose Sanfew Serum.",
  ]);
});

test("divine potions take a crystal dust per dose", () => {
  const who = player([["2dose2attack"], ["prif_crystal_shard_crushed", 50]], 70);
  use(who, "prif_crystal_shard_crushed", "2dose2attack");
  assert.equal(who.inv.count("2dosedivineattack"), 1);
  assert.equal(who.inv.count("prif_crystal_shard_crushed"), 48);
  assert.deepEqual(who.sent.spam, ["You mix 2 pieces of crushed crystal into your potion."]);
});

test("a pestle and mortar grinds at once, two ticks later, then every three", () => {
  const who = player([["pestle_and_mortar"], ...Array(4).fill(["unicorn_horn"])]);
  assert.equal(use(who, "pestle_and_mortar", "unicorn_horn"), true);
  assert.equal(who.inv.count("unicorn_horn_dust"), 1);
  assert.deepEqual(who.sent.animations, [core.CacheDefinitions.getSeqId("human_herbing_grind")]);
  assert.deepEqual(who.sent.spam, ["You grind the unicorn horn to dust."]);
  ticks(2);
  assert.equal(who.inv.count("unicorn_horn_dust"), 1, "tick 1");
  ticks(1);
  assert.equal(who.inv.count("unicorn_horn_dust"), 2, "tick 2");
  ticks(2);
  assert.equal(who.inv.count("unicorn_horn_dust"), 2, "tick 4");
  ticks(1);
  assert.equal(who.inv.count("unicorn_horn_dust"), 3, "tick 5");
  ticks(10);
  assert.equal(who.inv.count("unicorn_horn_dust"), 4);
  assert.equal(who.sent.xp, 0);
});

test("lava scales grind into 3 to 6 shards, half as many again with the hard Wilderness Diary", () => {
  const who = player([["pestle_and_mortar"], ["lava_scale"]]);
  use(who, "lava_scale", "pestle_and_mortar");
  const shards = who.inv.count("lava_shard");
  assert.ok(shards >= 3 && shards <= 6);
  assert.deepEqual(who.sent.spam, [`You grind the lava dragon scale into ${shards} shards.`]);
  world.diaries.add("wilderness:hard");
  const diary = player([["pestle_and_mortar"], ["lava_scale"]]);
  use(diary, "lava_scale", "pestle_and_mortar");
  assert.ok([4, 6, 7, 9].includes(diary.inv.count("lava_shard")));
});

test("a stack of crystal shards is crushed at once, ten dust each", () => {
  const who = player([["pestle_and_mortar"], ["prif_crystal_shard", 3]]);
  use(who, "pestle_and_mortar", "prif_crystal_shard");
  assert.equal(who.inv.count("prif_crystal_shard_crushed"), 30);
  assert.equal(who.inv.count("prif_crystal_shard"), 0);
});

test("a pestle and mortar on anything else is left to other plugins", () => {
  const who = player([["pestle_and_mortar"], ["ashes"]]);
  assert.equal(use(who, "pestle_and_mortar", "ashes"), false);
});

test("Zahur cleans every grimy herb for 200 coins each, with no XP", () => {
  const who = player([["unidentified_ranarr"], ["unidentified_ranarr"], ["unidentified_torstol"], ["coins", 500]], 1);
  Zahur._test.cleanHerbs({ player: who, npcId: 4753 });
  assert.equal(who.sent.prompt.title, "Clean all your herbs at 200 coins each?");
  who.sent.prompt.pick("Yes");
  assert.equal(who.inv.count("ranarr_weed"), 2);
  assert.equal(who.inv.count("unidentified_torstol"), 1, "only as many as she is paid for");
  assert.equal(who.inv.count("coins"), 100);
  assert.equal(who.sent.xp, 0);
  assert.match(who.sent.dialogue, /There, all done\./);
  const broke = player([["unidentified_ranarr"], ["coins", 199]]);
  Zahur._test.cleanHerbs({ player: broke, npcId: 4753 });
  assert.match(broke.sent.dialogue, /I'll want 200 coins to clean each herb\./);
  const nothing = player([["coins", 1000]]);
  Zahur._test.cleanAll(nothing, 4753);
  assert.match(nothing.sent.dialogue, /I didn't find anything that I could clean\./);
});
