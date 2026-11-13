// Run after `yarn build`: node --test tests/slayer-helmet.test.cjs
const assert = require("node:assert/strict");
const { test } = require("node:test");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();

const { Skill } = require("../dist/game/model/Skill");
const { ItemIdentifiers } = require("../dist/util/ItemIdentifiers");

const NAMES = new Map([
  [ItemIdentifiers.SLAYER_HELMET, "Slayer helmet"],
  [ItemIdentifiers.SLAYER_HELMET_I_, "Slayer helmet (i)"],
  [ItemIdentifiers.BLACK_MASK, "Black mask"],
  [ItemIdentifiers.BLACK_MASK_7_, "Black mask (7)"],
  [ItemIdentifiers.BLACK_MASK_7_I_, "Black mask (7) (i)"],
  [ItemIdentifiers.BLACK_MASK_I_, "Black mask (i)"],
  [ItemIdentifiers.EARMUFFS, "Earmuffs"],
  [ItemIdentifiers.KBD_HEADS, "Kbd heads"],
  [ItemIdentifiers.BLACK_SLAYER_HELMET, "Black slayer helmet"],
  [ItemIdentifiers.BLACK_SLAYER_HELMET_I_, "Black slayer helmet (i)"],
  [ItemIdentifiers.BLACK_SLAYER_HELMET_I__3, "Black slayer helmet (i)"],
  [ItemIdentifiers.SLAYER_HELMET_I__3, "Slayer helmet (i)"],
  [ItemIdentifiers.BLACK_MASK_I__3, "Black mask (i)"],
]);

/** The gamevals the plugin looks up, as the cache names them. */
const OBJS = new Map([
  ["slayer_helm", ItemIdentifiers.SLAYER_HELMET],
  ["slayer_helm_i", ItemIdentifiers.SLAYER_HELMET_I_],
  ["sw_slayer_helm_i", ItemIdentifiers.SLAYER_HELMET_I__3],
  ["nzone_black_mask", ItemIdentifiers.BLACK_MASK_I_],
  ["sw_black_mask", ItemIdentifiers.BLACK_MASK_I__3],
  ["slayer_helm_black", ItemIdentifiers.BLACK_SLAYER_HELMET],
  ["slayer_helm_i_black", ItemIdentifiers.BLACK_SLAYER_HELMET_I_],
  ["sw_slayer_helm_i_black", ItemIdentifiers.BLACK_SLAYER_HELMET_I__3],
  ["slayer_helm_jad", ItemIdentifiers.TZTOK_SLAYER_HELMET],
  ["league_6_slayer_helm2", ItemIdentifiers.RADIANT_SLAYER_HELMET],
  ["poh_trophydrop_kbd", ItemIdentifiers.KBD_HEADS],
]);
const OBJ_NAMES = new Map([...OBJS].map(([name, id]) => [id, name]));

const HELM_UNLOCKED_VARBIT = 3202;
const BLACK_UNLOCKED_VARBIT = 5080;
const VARBITS = new Map([["slayer_helm_unlocked", HELM_UNLOCKED_VARBIT], ["slayer_unlock_helm_black", BLACK_UNLOCKED_VARBIT]]);
const prompts = [];
const events = [];
const modifiers = {};
let onTask = true;
const SlayerHelmet = require("../plugins/items/SlayerHelmet.plugin");
SlayerHelmet.register({
  core: {
    hitTargetOf: require("../dist/game/content/combat/EquipmentEffects").hitTargetOf,
    ItemIdentifiers,
    Skill,
    Equipment: { HEAD_SLOT: 0 },
    ItemDefinition: { forId: (id) => ({ getName: () => NAMES.get(id) ?? "" }) },
    CacheDefinitions: {
      getVarbitId: (name) => VARBITS.get(name) ?? null,
      getObjId: (name) => OBJS.get(name) ?? null,
      getObjNames: () => OBJ_NAMES,
    },
    ChatType: { SPAM: "spam", MESBOX: "mesbox" },
    DialogueChainBuilder: class { add(dialogue) { this.dialogue = dialogue; return this; } },
    StatementDialogue: class { constructor(index, text) { this.text = text; } },
  },
  sendMultiChatboxPrompt: (player, title, ...options) => prompts.push({ player, title, options }),
  emitCustomEvent: (name, request) => {
    events.push([name, request]);
    if (name === "slayer:on-task") request.onTask = onTask;
  },
  registerMeleeAttackAccuracyModifier: (fn) => { modifiers.meleeAccuracy = fn; },
  registerMeleeHitModifier: (fn) => { modifiers.meleeHit = fn; },
  registerRangedAttackAccuracyModifier: (fn) => { modifiers.rangedAccuracy = fn; },
  registerRangedHitModifier: (fn) => { modifiers.rangedHit = fn; },
  registerMagicAttackAccuracyModifier: (fn) => { modifiers.magicAccuracy = fn; },
  registerMagicHitModifier: (fn) => { modifiers.magicHit = fn; },
  onItemOnItem() {},
  onItemAction() {},
  onCustomEvent() {},
});

const { assemble, imbue, recolour, disassemble, HELMET_NAMES } = SlayerHelmet._test;

const EquipmentStats = require("../plugins/interface/EquipmentStats.plugin");
EquipmentStats.register({
  getBonusManager: () => ({}),
  onInterfaceActionButton() {},
  onPlayerProcess() {},
  emitCustomEvent: (name, request) => { if (name === "slayer:on-task") request.onTask = onTask; },
});
const { formatTargetBonus, getTargetBonuses } = EquipmentStats._test;

function item(id) {
  return {
    id,
    getId() { return this.id; },
    setId(next) { this.id = next; },
    getDefinition: () => ({ getName: () => NAMES.get(id) ?? "" }),
  };
}

function createPlayer({ head = -1, crafting = 99, inventory = [], helmUnlocked = true, blackUnlocked = true } = {}) {
  const items = inventory.map(item);
  const messages = [];
  const typed = [];
  const sounds = [];
  const dialogues = [];
  const unlocked = new Set([helmUnlocked && HELM_UNLOCKED_VARBIT, blackUnlocked && BLACK_UNLOCKED_VARBIT]);
  const target = { isNpc: () => true, getAsNpc: () => ({}) };
  const player = {
    messages,
    typed,
    sounds,
    dialogues,
    items,
    getDialogueManager: () => ({ startDialogues: (chain) => dialogues.push(chain.dialogue.text) }),
    isPlayer: () => true,
    getAsPlayer: () => player,
    getEquipment: () => ({ getItems: () => [head > 0 ? item(head) : null] }),
    getCombat: () => ({ getTarget: () => target }),
    getSkillManager: () => ({ getCurrentLevel: () => crafting }),
    sendMessage: (message) => messages.push(message),
    getPacketSender: () => ({
      getVarbit: (id) => (unlocked.has(id) ? 1 : 0),
      sendTypedMessage: (type, text) => typed.push([type, text]),
      sendSoundEffect: (id) => sounds.push(id),
    }),
    getInventory: () => ({
      getItems: () => items,
      contains: (id) => items.some((entry) => entry.getId() === id),
      deleteAtSlot: (slot) => { if (items[slot]?.getId() > 0) items[slot].setId(-1); },
      deleteNumber: (id) => {
        const entry = items.find((entry) => entry.getId() === id);
        if (entry) entry.setId(-1);
      },
      adds: (id) => {
        const slot = items.findIndex((entry) => entry.getId() < 0);
        if (slot < 0) items.push(item(id));
        else items[slot] = item(id);
      },
      getFreeSlots: () => 28 - items.filter((entry) => entry.getId() > 0).length,
      refreshItems() {},
    }),
  };
  return player;
}

test("the fake inventory preserves slots and reuses the first empty slot", () => {
  const player = createPlayer({ inventory: [ItemIdentifiers.BLACK_MASK, ItemIdentifiers.EARMUFFS, ItemIdentifiers.BLACK_MASK_I_] });
  const inventory = player.getInventory();
  const last = player.items[2];
  inventory.deleteAtSlot(1, 1);
  assert.deepEqual(player.items.map((entry) => entry.getId()), [ItemIdentifiers.BLACK_MASK, -1, ItemIdentifiers.BLACK_MASK_I_]);
  assert.equal(player.items[2], last);
  assert.equal(inventory.getFreeSlots(), 26);
  inventory.adds(ItemIdentifiers.FACEMASK, 1);
  assert.deepEqual(player.items.map((entry) => entry.getId()), [ItemIdentifiers.BLACK_MASK, ItemIdentifiers.FACEMASK, ItemIdentifiers.BLACK_MASK_I_]);
  assert.equal(player.items[2], last);
  assert.equal(inventory.getFreeSlots(), 25);
});

test("a slayer helmet adds a sixth to melee accuracy and damage on task only", () => {
  const player = createPlayer({ head: ItemIdentifiers.SLAYER_HELMET });
  onTask = true;
  assert.equal(modifiers.meleeAccuracy(player, 600), 700);
  assert.equal(modifiers.meleeHit(player, 42), 49);
  assert.equal(modifiers.rangedHit(player, 40), 40);
  onTask = false;
  assert.equal(modifiers.meleeHit(player, 42), 42);
});

test("an imbued black mask also boosts Ranged and Magic by 15%", () => {
  const player = createPlayer({ head: ItemIdentifiers.BLACK_MASK_I_ });
  onTask = true;
  assert.equal(modifiers.rangedAccuracy(player, 1000), 1150);
  assert.equal(modifiers.magicHit(player, 40), 46);
  assert.equal(modifiers.meleeHit(player, 42), 49);
});

const PARTS = ["EARMUFFS", "FACEMASK", "NOSE_PEG", "SPINY_HELMET", "ENCHANTED_GEM"].map((name) => ItemIdentifiers[name]);

test("any component on another assembles the helmet, and a charged mask loses its charges", () => {
  const player = createPlayer({ inventory: [ItemIdentifiers.BLACK_MASK_7_, ...PARTS] });
  const event = { player, usedItem: player.items[1], usedItemId: ItemIdentifiers.EARMUFFS, usedItemSlot: 1,
    usedWithItem: player.items[0], usedWithItemId: ItemIdentifiers.BLACK_MASK_7_, usedWithItemSlot: 0, handled: false };
  assemble(event);
  assert.equal(event.handled, true);
  assert.deepEqual(player.items.map((entry) => entry.getId()), [ItemIdentifiers.SLAYER_HELMET, ...Array(5).fill(-1)]);
  assert.deepEqual(events.filter(([name]) => name === "league:complete-task"), [["league:complete-task", { player, id: "assemble-a-slayer-helm" }]]);
});

test("mask-on-mask retains the existing first-owned fallback", () => {
  const player = createPlayer({ inventory: [ItemIdentifiers.BLACK_MASK, ItemIdentifiers.BLACK_MASK_I_, ...PARTS] });
  assemble({ player, usedItem: player.items[1], usedItemId: ItemIdentifiers.BLACK_MASK_I_, usedItemSlot: 1,
    usedWithItem: player.items[0], usedWithItemId: ItemIdentifiers.BLACK_MASK, usedWithItemSlot: 0, handled: false });
  assert.deepEqual(player.items.map((entry) => entry.getId()), [ItemIdentifiers.SLAYER_HELMET, ItemIdentifiers.BLACK_MASK_I_, ...Array(5).fill(-1)]);
});

test("scroll on an already imbued mask retains the existing first-owned fallback", () => {
  const player = createPlayer({ inventory: [ItemIdentifiers.BLACK_MASK, ItemIdentifiers.BLACK_MASK_I_, ...PARTS, ItemIdentifiers.SCROLL_OF_IMBUING] });
  assemble({ player, usedItem: player.items[7], usedItemId: ItemIdentifiers.SCROLL_OF_IMBUING, usedItemSlot: 7,
    usedWithItem: player.items[1], usedWithItemId: ItemIdentifiers.BLACK_MASK_I_, usedWithItemSlot: 1, handled: false });
  assert.deepEqual(player.items.map((entry) => entry.getId()), [ItemIdentifiers.SLAYER_HELMET_I_, ItemIdentifiers.BLACK_MASK_I_, ...Array(6).fill(-1)]);
});

test("assembly needs 55 Crafting and every component", () => {
  const low = createPlayer({ crafting: 54, inventory: [ItemIdentifiers.BLACK_MASK_I_, ...PARTS] });
  assemble({ player: low, usedItemId: ItemIdentifiers.EARMUFFS, usedWithItemId: ItemIdentifiers.FACEMASK, handled: false });
  assert.deepEqual(low.items.map((entry) => entry.getId()), [ItemIdentifiers.BLACK_MASK_I_, ...PARTS]);
  assert.match(low.messages[0], /Crafting level of 55/);

  const missing = createPlayer({ inventory: [ItemIdentifiers.BLACK_MASK_I_, ...PARTS.slice(1)] });
  const event = { player: missing, usedItemId: ItemIdentifiers.FACEMASK, usedWithItemId: ItemIdentifiers.NOSE_PEG, handled: false };
  assemble(event);
  assert.equal(event.handled, false);
  assert.deepEqual(missing.items.map((entry) => entry.getId()), [ItemIdentifiers.BLACK_MASK_I_, ...PARTS.slice(1)]);
});

test("assembly needs the Malevolent masquerade unlock", () => {
  const player = createPlayer({ helmUnlocked: false, inventory: [ItemIdentifiers.BLACK_MASK_7_, ...PARTS] });
  const event = { player, usedItemId: ItemIdentifiers.EARMUFFS, usedWithItemId: ItemIdentifiers.BLACK_MASK_7_, handled: false };
  const awarded = events.filter(([name]) => name === "league:complete-task").length;
  assemble(event);
  assert.equal(event.handled, true);
  assert.deepEqual(player.items.map((entry) => entry.getId()), [ItemIdentifiers.BLACK_MASK_7_, ...PARTS]);
  assert.deepEqual(player.messages, ["You have not unlocked the ability to combine these items."]);
  assert.equal(events.filter(([name]) => name === "league:complete-task").length, awarded, "a refused assembly awards nothing");
});

test("a scroll of imbuing turns a black mask into its imbued form, keeping its charges", () => {
  const player = createPlayer({ inventory: [ItemIdentifiers.SCROLL_OF_IMBUING, ItemIdentifiers.BLACK_MASK_7_] });
  const mask = player.items[1];
  const event = {
    player,
    usedItem: player.items[0],
    usedWithItem: mask,
    usedItemId: ItemIdentifiers.SCROLL_OF_IMBUING,
    usedWithItemId: ItemIdentifiers.BLACK_MASK_7_,
    handled: false,
  };
  imbue(event);
  assert.equal(event.handled, true);
  assert.equal(mask.getId(), ItemIdentifiers.BLACK_MASK_7_I_);
  assert.deepEqual(player.items.map((entry) => entry.getId()), [-1, ItemIdentifiers.BLACK_MASK_7_I_]);
  assert.match(player.messages.at(-1), /black mask/);

  const helmet = createPlayer({ inventory: [ItemIdentifiers.SLAYER_HELMET, ItemIdentifiers.SCROLL_OF_IMBUING_2] });
  imbue({
    player: helmet,
    usedItem: helmet.items[0],
    usedWithItem: helmet.items[1],
    usedItemId: ItemIdentifiers.SLAYER_HELMET,
    usedWithItemId: ItemIdentifiers.SCROLL_OF_IMBUING_2,
    handled: false,
  });
  assert.deepEqual(helmet.items.map((entry) => entry.getId()), [ItemIdentifiers.SLAYER_HELMET_I_, -1]);
});

test("a scroll on a component makes the imbued helmet directly", () => {
  const player = createPlayer({
    inventory: [ItemIdentifiers.BLACK_MASK, ...PARTS, ItemIdentifiers.SCROLL_OF_IMBUING],
  });
  const event = {
    player,
    usedItemId: ItemIdentifiers.SCROLL_OF_IMBUING,
    usedWithItemId: ItemIdentifiers.EARMUFFS,
    handled: false,
  };
  assemble(event);
  assert.equal(event.handled, true);
  assert.deepEqual(player.items.map((entry) => entry.getId()), [ItemIdentifiers.SLAYER_HELMET_I_, ...Array(6).fill(-1)]);
});

test("a scroll with no mask or helmet is left alone", () => {
  const player = createPlayer({ inventory: [ItemIdentifiers.SCROLL_OF_IMBUING, ItemIdentifiers.EARMUFFS] });
  const event = {
    player,
    usedItemId: ItemIdentifiers.SCROLL_OF_IMBUING,
    usedWithItemId: ItemIdentifiers.EARMUFFS,
    handled: false,
  };
  imbue(event);
  assert.equal(event.handled, false);
  assert.deepEqual(player.items.map((entry) => entry.getId()), [ItemIdentifiers.SCROLL_OF_IMBUING, ItemIdentifiers.EARMUFFS]);
});

test("a boosted hit does not spam chat; the stats row carries the on-task state", () => {
  const player = createPlayer({ head: ItemIdentifiers.SLAYER_HELMET });
  onTask = true;
  modifiers.meleeHit(player, 42);
  modifiers.meleeHit(player, 42);
  assert.deepEqual(player.messages, []);
  assert.equal(getTargetBonuses(player).slayer.active, true);
  onTask = false;
});

test("equipment stats shows the imbued percentages and whether the target is on task", () => {
  const player = createPlayer({ head: ItemIdentifiers.SLAYER_HELMET_I_ });
  onTask = true;
  const active = getTargetBonuses(player).slayer;
  assert.equal(active.imbued, true);
  assert.equal(active.active, true);
  assert.match(formatTargetBonus(active), /\+16\.7% melee, \+15% ranged\/magic, on task/);

  onTask = false;
  const inactive = getTargetBonuses(player).slayer;
  assert.equal(inactive.active, false);
  assert.match(formatTargetBonus(inactive), /off task/);
  onTask = true;
});

test("assembling says it made a Slayer helm, as a spam line with the combine sound", () => {
  const player = createPlayer({ inventory: [ItemIdentifiers.BLACK_MASK, ...PARTS] });
  assemble({ player, usedItemId: ItemIdentifiers.EARMUFFS, usedWithItemId: ItemIdentifiers.BLACK_MASK, handled: false });
  assert.deepEqual(player.typed, [["spam", "You combine the items into a Slayer helm."]]);
  assert.deepEqual(player.sounds, [2241]);
});

test("a Soul Wars imbued mask makes the Soul Wars imbued helmet", () => {
  const player = createPlayer({ inventory: [ItemIdentifiers.BLACK_MASK_I__3, ...PARTS] });
  assemble({ player, usedItemId: ItemIdentifiers.EARMUFFS, usedWithItemId: ItemIdentifiers.BLACK_MASK_I__3, handled: false });
  assert.equal(player.items[0].getId(), ItemIdentifiers.SLAYER_HELMET_I__3);
});

function headOn(player, helmSlot, headSlot, headFirst = true) {
  const helm = { item: player.items[helmSlot], id: player.items[helmSlot].getId(), slot: helmSlot };
  const head = { item: player.items[headSlot], id: player.items[headSlot].getId(), slot: headSlot };
  const [used, usedWith] = headFirst ? [head, helm] : [helm, head];
  const event = { player, usedItem: used.item, usedItemId: used.id, usedItemSlot: used.slot,
    usedWithItem: usedWith.item, usedWithItemId: usedWith.id, usedWithItemSlot: usedWith.slot, handled: false };
  recolour(event);
  return event;
}

test("Kbd heads on an imbued helmet ask first, then make the black imbued helmet", () => {
  for (const headFirst of [true, false]) {
    prompts.length = 0;
    const player = createPlayer({ inventory: [ItemIdentifiers.SLAYER_HELMET_I_, ItemIdentifiers.KBD_HEADS] });
    const event = headOn(player, 0, 1, headFirst);
    assert.equal(event.handled, true);
    assert.equal(prompts.length, 1);
    assert.equal(prompts[0].title, "Combine the Kbd heads with your helm?");
    assert.deepEqual(prompts[0].options.filter((entry) => typeof entry === "string"), ["Yes", "No"]);
    assert.deepEqual(player.items.map((entry) => entry.getId()), [ItemIdentifiers.SLAYER_HELMET_I_, ItemIdentifiers.KBD_HEADS], "nothing changes before Yes");
    prompts[0].options[1]();
    assert.deepEqual(player.items.map((entry) => entry.getId()), [ItemIdentifiers.BLACK_SLAYER_HELMET_I_, -1]);
    assert.deepEqual(player.typed, [["spam", "You combine the items into a Black slayer helmet (i)."]]);
    assert.deepEqual(player.sounds, [2241]);
  }
});

test("No, or a head that's gone by Yes, leaves the helmet as it was", () => {
  prompts.length = 0;
  const player = createPlayer({ inventory: [ItemIdentifiers.SLAYER_HELMET, ItemIdentifiers.KBD_HEADS] });
  headOn(player, 0, 1);
  prompts[0].options[3]();
  assert.deepEqual(player.items.map((entry) => entry.getId()), [ItemIdentifiers.SLAYER_HELMET, ItemIdentifiers.KBD_HEADS]);
  player.items[1].setId(-1);
  prompts[0].options[1]();
  assert.deepEqual(player.items.map((entry) => entry.getId()), [ItemIdentifiers.SLAYER_HELMET, -1]);
  assert.deepEqual(player.typed, []);
});

test("a helmet imbued while the question is up isn't turned into the plain colour", () => {
  prompts.length = 0;
  const player = createPlayer({ inventory: [ItemIdentifiers.SLAYER_HELMET, ItemIdentifiers.KBD_HEADS] });
  headOn(player, 0, 1);
  player.items[0].setId(ItemIdentifiers.SLAYER_HELMET_I_);
  prompts[0].options[1]();
  assert.deepEqual(player.items.map((entry) => entry.getId()), [ItemIdentifiers.SLAYER_HELMET_I_, ItemIdentifiers.KBD_HEADS]);
});

test("the Soul Wars imbued helmet turns into its own black copy", () => {
  prompts.length = 0;
  const player = createPlayer({ inventory: [ItemIdentifiers.SLAYER_HELMET_I__3, ItemIdentifiers.KBD_HEADS] });
  headOn(player, 0, 1);
  prompts[0].options[1]();
  assert.equal(player.items[0].getId(), ItemIdentifiers.BLACK_SLAYER_HELMET_I__3);
});

test("without the recolour's unlock the player is sent to a Slayer master", () => {
  prompts.length = 0;
  const player = createPlayer({ blackUnlocked: false, inventory: [ItemIdentifiers.SLAYER_HELMET, ItemIdentifiers.KBD_HEADS] });
  const event = headOn(player, 0, 1);
  assert.equal(event.handled, true);
  assert.equal(prompts.length, 0);
  const line = "You must first learn how to do this from a Slayer Master.";
  assert.deepEqual(player.typed, [["mesbox", line]]);
  assert.deepEqual(player.dialogues, [line]);
  assert.deepEqual(player.items.map((entry) => entry.getId()), [ItemIdentifiers.SLAYER_HELMET, ItemIdentifiers.KBD_HEADS]);
});

test("a recoloured helmet takes no second head", () => {
  prompts.length = 0;
  const player = createPlayer({ inventory: [ItemIdentifiers.BLACK_SLAYER_HELMET, ItemIdentifiers.KBD_HEADS] });
  assert.equal(headOn(player, 0, 1).handled, false);
  assert.equal(prompts.length, 0);
});

test("a scroll of imbuing on a recoloured helmet keeps its colour", () => {
  const player = createPlayer({ inventory: [ItemIdentifiers.BLACK_SLAYER_HELMET, ItemIdentifiers.SCROLL_OF_IMBUING] });
  imbue({ player, usedItem: player.items[1], usedWithItem: player.items[0], usedItemId: ItemIdentifiers.SCROLL_OF_IMBUING,
    usedWithItemId: ItemIdentifiers.BLACK_SLAYER_HELMET, handled: false });
  assert.deepEqual(player.items.map((entry) => entry.getId()), [ItemIdentifiers.BLACK_SLAYER_HELMET_I_, -1]);
  assert.equal(player.messages.at(-1), "You imbue the Slayer helmet with the scroll.");
});

test("Disassemble gives back the helmet's own mask, the components and the head", () => {
  const cases = [
    [ItemIdentifiers.BLACK_SLAYER_HELMET_I_, ItemIdentifiers.BLACK_MASK_I_, [ItemIdentifiers.KBD_HEADS]],
    [ItemIdentifiers.BLACK_SLAYER_HELMET_I__3, ItemIdentifiers.BLACK_MASK_I__3, [ItemIdentifiers.KBD_HEADS]],
    [ItemIdentifiers.SLAYER_HELMET_I__3, ItemIdentifiers.BLACK_MASK_I__3, []],
    [ItemIdentifiers.SLAYER_HELMET, ItemIdentifiers.BLACK_MASK, []],
    [ItemIdentifiers.TZTOK_SLAYER_HELMET, ItemIdentifiers.BLACK_MASK, []],
  ];
  for (const [helmet, mask, head] of cases) {
    const player = createPlayer({ inventory: [helmet] });
    disassemble({ player, item: player.items[0] });
    assert.deepEqual(player.items.map((entry) => entry.getId()), [mask, ...PARTS, ...head], `helmet ${helmet}`);
    assert.deepEqual(player.typed, [["spam", "You disassemble your Slayer helm."]]);
    assert.deepEqual(player.sounds, [2241]);
  }
});

test("Disassemble needs room for the head too; a Radiant helmet isn't taken apart", () => {
  const full = createPlayer({ inventory: [ItemIdentifiers.BLACK_SLAYER_HELMET, ...Array(22).fill(ItemIdentifiers.EARMUFFS)] });
  disassemble({ player: full, item: full.items[0] });
  assert.equal(full.items[0].getId(), ItemIdentifiers.BLACK_SLAYER_HELMET);
  assert.match(full.messages[0], /enough inventory space/);
  const radiant = createPlayer({ inventory: [ItemIdentifiers.RADIANT_SLAYER_HELMET] });
  disassemble({ player: radiant, item: radiant.items[0] });
  assert.deepEqual(radiant.items.map((entry) => entry.getId()), [ItemIdentifiers.RADIANT_SLAYER_HELMET]);
});

test("every colour's plain and imbued helmet has the helmet's options", () => {
  for (const name of ["Slayer helmet", "Slayer helmet (i)", "Black slayer helmet (i)", "Tzkal slayer helmet",
    "Araxyte slayer helmet (i)", "Hooded slayer helmet", "Oathplate slayer helmet (i)", "Radiant slayer helmet"]) {
    assert.ok(HELMET_NAMES.includes(name), name);
  }
  assert.equal(HELMET_NAMES.length, 30);
});

test("a worn Slayer helmet's Check is its worn option, not the inventory's Disassemble", () => {
  const { PluginManager } = require("../dist/plugins/PluginManager");
  const { Equipment } = require("../dist/game/model/container/impl/Equipment");
  const helmet = {
    inventoryActions: [null, "Wear", "Check", "Disassemble", "Drop"],
    params: new Map([[453, "Check"], [454, "Partner"], [455, "Log"]]),
  };
  const option = (interfaceId, clickType) => PluginManager.itemActionOption(helmet, { interfaceId, clickType });
  assert.equal(option(Equipment.INVENTORY_INTERFACE_ID, 4), "Check");
  assert.equal(option(Equipment.INVENTORY_INTERFACE_ID, 1), null, "Remove");
  assert.equal(option(149, 4), "Disassemble");
  assert.equal(option(149, 3), "Check");
});

// Native selected-mask contract: decoded input, real inventory, full registered plugin order.
test("native explicit mask selection preserves an unrelated normal/imbued mask", async t => {
  process.env.DISABLE_PLAYER_BOTS = "1";
  const path = require("node:path");
  const { CachePipeline, parseCacheTarget } = require("../dist/game/cache/CachePipeline");
  const target = require("node:fs").readFileSync(path.resolve(__dirname, "../target.txt"), "utf8").trim();
  const { PluginManager } = require("../dist/plugins/PluginManager");
  const { Player } = require("../dist/game/entity/impl/player/Player");
  const { PlayerSession } = require("../dist/net/PlayerSession");
  const { ClientConnection } = require("../dist/net/NetworkBuilder");
  const { isMembersWorld } = require("../dist/game/definition/WorldDefinition");
  await CachePipeline.initialize();
  assert.equal(CachePipeline.getActive().name, target);
  assert.equal(CachePipeline.getActive().revision, parseCacheTarget(target).revision);
  assert.equal(isMembersWorld(), true);
  PluginManager.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  const core = PluginManager.getCoreApi(), I = core.ItemIdentifiers;
  core.RegionManager.init(); core.RegionManager.loadMapFiles(3226, 3218);
  t.after(() => PluginManager.emitServerShutdown({}));
  PluginManager.emitServerStartup({});
  // The old prefix uses private fake APIs only; native registration replaces module API state.
  const slayerHooks = PluginManager.itemOnItemHooks.filter(h => h.pluginName === "SlayerHelmet");
  assert.equal(slayerHooks.length, 3, "real imbue, assembly and recolour registrations must be loaded");
  assert.deepEqual(slayerHooks.map(h => h.handlerName), ["imbue", "assemble", "recolour"]);
  const porcine = require("../plugins/quests/QuestRuntime").questNamed("A Porcine of Interest");
  assert.ok(porcine, "real quest registered");
  const parts = [I.EARMUFFS, I.FACEMASK, I.NOSE_PEG, I.SPINY_HELMET, I.ENCHANTED_GEM];
  const variants = [
    { charge: 7, plain: I.BLACK_MASK_7_, imbued: I.BLACK_MASK_7_I_ },
    { charge: 0, plain: I.BLACK_MASK, imbued: I.BLACK_MASK_I_ },
  ];
  const unlock = core.CacheDefinitions.getVarbitId("slayer_helm_unlocked");
  const points = core.CacheDefinitions.getVarbitId("slayer_points");
  assert.ok(Number.isInteger(unlock) && Number.isInteger(points));
  for (const id of [...variants.flatMap(v => [v.plain, v.imbued]), ...parts,
    I.SCROLL_OF_IMBUING, I.SLAYER_HELMET, I.SLAYER_HELMET_I_]) {
    assert.equal(core.CacheDefinitions.hasDefinition("item", id), true);
    const definition = core.ItemDefinition.forId(id), active = core.CacheDefinitions.getItem(id);
    assert.equal(definition.getName().toLowerCase(), active.name.toLowerCase());
    assert.equal(definition.isNoted(), false);
    assert.ok(definition.getName().length > 0);
    console.log("SLAYER_MASK_DEFINITION " + JSON.stringify({ id, name: definition.getName(), noted: definition.isNoted() }));
  }
  const cases = [];
  for (const variant of variants) for (const selectedImbued of [false, true])
    for (const reverse of [false, true]) {
      cases.push({ variant, selectedImbued, reverse, order: "single", mode: "assemble" });
      for (const order of ["selected-first", "other-first"]) {
        cases.push({ variant, selectedImbued, reverse, order, mode: "assemble" });
        cases.push({ variant, selectedImbued, reverse, order, mode: "assemble", sameForm: true });
      }
    }
  for (const mode of ["locked", "low-level"])
    cases.push({ variant: variants[0], selectedImbued: true, reverse: false, order: "other-first", mode });
  let index = 1880;
  for (const spec of cases) await t.test(JSON.stringify(spec), async t => {
    const { variant, selectedImbued, reverse, order, mode, sameForm = false } = spec;
    const channel = { kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true,
      send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
    const p = new Player(new PlayerSession(channel));
    p.setIndex(index++); p.setUsername("maskselect" + index); p.setRegistered(true);
    p.setLocation(new core.Location(3226, 3218, 0)); p.needsPlacement = false;
    const c = new ClientConnection(channel); c.player = p;
    t.after(() => {
      PluginManager.emitPlayerDisconnect({ player: p, username: p.getUsername() });
      PluginManager.emitPlayerLogout({ player: p, username: p.getUsername() });
      p.setRegistered(false); core.TaskManager.cancelTasks(p.getIndex()); core.TaskManager.cancelTasks(p);
    });
    const skills = p.getSkillManager();
    skills.setMaxLevels(core.Skill.CRAFTING, 55, false);
    skills.setCurrentLevel(core.Skill.CRAFTING, mode === "low-level" ? 54 : 55, false);
    const sender = p.getPacketSender();
    assert.equal(porcine.getStage(p), 0, "pre-completion account does not require reinforced goggles");
    assert.equal(porcine.isComplete(p), false);
    assert.equal(sender.getVarbit(unlock), 0);
    if (mode !== "locked") {
      sender.sendVarbit(points, 400);
      PluginManager.emitCustomEvent("slayer:open-rewards", { player: p, master: 1 });
      assert.equal(p.getInterfaceId(), 426);
      await c.dispatch([{ type: "widget_action", widgetId: (426 << 16) | 11,
        groupId: 426, childId: 11, buttonNum: 1, opId: 1, slot: 5, itemId: -1 }]);
      c.processTurnPackets();
      assert.equal(sender.getVarbit(unlock), 1, "real rewards purchase unlocks assembly");
      assert.equal(sender.getVarbit(points), 0, "real unlock spends 400 points");
      sender.sendInterfaceRemoval();
    }
    const inv = p.getInventory(), items = () => inv.getItems();
    const add = id => { inv.add(new core.Item(id, 1), false); return items()[inv.getSlotForItemId(id)]; };
    add(variant.plain);
    if (order !== "single") inv.add(new core.Item(variant.plain, 1), false);
    const masks = items().filter(item => item && item.getId() === variant.plain);
    const selected = masks[order === "other-first" ? 1 : 0];
    const other = order === "single" ? null : masks.find(item => item !== selected);
    const use = async (a, b) => {
      const slot = items().indexOf(a), targetSlot = items().indexOf(b);
      assert.ok(slot >= 0 && targetSlot >= 0 && slot !== targetSlot);
      await c.dispatch([{ type: "inventory_use_on", itemId: a.getId(), slot,
        target: { kind: "inventory", id: b.getId(), slot: targetSlot } }]);
      c.processTurnPackets();
    };
    const toImbue = sameForm ? (selectedImbued ? [selected, other] : []) : [selectedImbued ? selected : other].filter(Boolean);
    for (const maskToImbue of toImbue) {
      const beforeSlot = items().indexOf(maskToImbue);
      const scroll = add(I.SCROLL_OF_IMBUING);
      await use(scroll, maskToImbue);
      assert.equal(items()[beforeSlot], maskToImbue, "native imbue preserves selected object and slot");
      assert.equal(maskToImbue.getId(), variant.imbued, "native imbue preserves charge count in its mapped id");
      assert.equal(inv.getAmount(I.SCROLL_OF_IMBUING), 0);
    }
    for (const id of parts) add(id);
    const component = items()[inv.getSlotForItemId(I.EARMUFFS)];
    const selectedId = selectedImbued ? variant.imbued : variant.plain;
    assert.equal(selected.getId(), selectedId);
    if (other) assert.equal(other.getId(), sameForm ? selectedId : selectedImbued ? variant.plain : variant.imbued);
    const state = item => ({ id: item.getId(), amount: item.getAmount(), meta: item.getMeta() });
    const snapshot = () => items().map(item => item && state(item));
    const before = snapshot(), beforeRefs = [...items()], otherState = other && state(other);
    const selectedSlot = items().indexOf(selected), componentSlot = items().indexOf(component);
    assert.ok(!other || (order === "other-first") === (items().indexOf(other) < selectedSlot));
    for (const id of parts) assert.equal(inv.getAmount(id), 1);
    assert.equal(inv.getAmount(I.SLAYER_HELMET) + inv.getAmount(I.SLAYER_HELMET_I_), 0);
    assert.equal(sender.getVarbit(unlock), mode === "locked" ? 0 : 1);
    assert.equal(skills.getCurrentLevel(core.Skill.CRAFTING), mode === "low-level" ? 54 : 55);
    for (const id of [selectedId, I.EARMUFFS]) assert.notEqual(PluginManager.emitCanUseItem(p, id, "use"), false);
    console.log("SLAYER_MASK_PRECONDITION " + JSON.stringify({ spec, before, selectedSlot, componentSlot,
      unlock: sender.getVarbit(unlock), crafting: skills.getCurrentLevel(core.Skill.CRAFTING), active: CachePipeline.getActive() }));
    const events = [], hookTrace = [], emit = PluginManager.emitItemOnItem.bind(PluginManager);
    const executeHook = PluginManager.executeHook.bind(PluginManager);
    t.mock.method(PluginManager, "executeHook", (hook, event, ...args) => {
      const row = event?.player === p && args[0] === "item_on_item"
        ? { plugin: hook.pluginName, handler: hook.handlerName, beforeHandled: event.handled } : null;
      const result = executeHook(hook, event, ...args);
      if (row) { row.afterHandled = event.handled; hookTrace.push(row); }
      return result;
    });
    t.mock.method(PluginManager, "emitItemOnItem", event => {
      if (event.player === p) events.push({ event, used: event.usedItem, target: event.usedWithItem,
        usedId: event.usedItemId, targetId: event.usedWithItemId,
        usedSlot: event.usedItemSlot, targetSlot: event.usedWithItemSlot });
      return emit(event);
    });
    await use(reverse ? component : selected, reverse ? selected : component);
    assert.equal(events.length, 1, "decoded dispatch emits one real inventory event");
    const e = events[0];
    assert.equal(e.used, reverse ? component : selected); assert.equal(e.target, reverse ? selected : component);
    assert.equal(e.usedSlot, reverse ? componentSlot : selectedSlot); assert.equal(e.targetSlot, reverse ? selectedSlot : componentSlot);
    assert.equal(reverse ? e.targetId : e.usedId, selectedId);
    console.log("SLAYER_MASK_OBSERVATION " + JSON.stringify({ spec, after: snapshot(), handled: e.event.handled,
      hookTrace, selectedStillOwned: items().includes(selected), otherStillOwned: other && items().includes(other) }));
    const slayerTrace = hookTrace.filter(row => row.plugin === "SlayerHelmet");
    assert.deepEqual(slayerTrace.map(row => row.handler).slice(0, 2), ["imbue", "assemble"]);
    assert.equal(slayerTrace[0].beforeHandled, false, "earlier full-manager hook did not suppress target");
    assert.equal(slayerTrace[0].afterHandled, false, "imbue declines mask/component interaction");
    assert.equal(slayerTrace[1].beforeHandled, false, "assembly really receives the unhandled event");
    if (mode !== "assemble") {
      assert.equal(e.event.handled, true, "real requirement refusal reached");
      assert.deepEqual(snapshot(), before);
      for (let n = 0; n < beforeRefs.length; n++) assert.equal(items()[n], beforeRefs[n]);
      return;
    }
    // A conservative refusal with two masks is allowed; stationary single-mask controls must assemble.
    const outputs = inv.getAmount(I.SLAYER_HELMET) + inv.getAmount(I.SLAYER_HELMET_I_);
    if (other && outputs === 0) {
      assert.deepEqual(snapshot(), before);
      for (let n = 0; n < beforeRefs.length; n++) assert.equal(items()[n], beforeRefs[n]);
      return;
    }
    assert.equal(e.event.handled, true);
    if (other) {
      assert.equal(items().includes(other), true, "target: never consume the unselected mask");
      assert.deepEqual(state(other), otherState, "unselected charge/imbue/meta/amount preserved");
    }
    assert.equal(items().includes(selected), false, "the selected mask object is consumed");
    for (const id of parts) assert.equal(inv.getAmount(id), 0);
    assert.equal(inv.getAmount(selectedId), other && sameForm ? 1 : 0);
    assert.equal(outputs, 1);
    assert.equal(inv.getAmount(selectedImbued ? I.SLAYER_HELMET_I_ : I.SLAYER_HELMET), 1);
    assert.equal(items().filter(item => item && item.getId() > 0).length, other ? 2 : 1);
  });
});

// The recolour table against the real cache: every helmet, mask, head and unlock it names exists.
test("native cache has every recolour, form, head and unlock the plugin names", async () => {
  process.env.DISABLE_PLAYER_BOTS = "1";
  const { CachePipeline } = require("../dist/game/cache/CachePipeline");
  await CachePipeline.initialize();
  const { CacheDefinitions } = require("../dist/game/cache/CacheDefinitions");
  const { FORMS, RECOLOURS } = SlayerHelmet._test;
  const names = new Set();
  const nameOf = (gameval) => {
    const id = CacheDefinitions.getObjId(gameval);
    assert.ok(Number.isInteger(id), gameval);
    return CacheDefinitions.getItem(id).name;
  };
  for (const form of FORMS) {
    if (form.mask) assert.equal(nameOf(form.mask), "Black mask (i)");
    names.add(nameOf(form.helm));
    for (const recolour of RECOLOURS) {
      const name = nameOf(recolour.item(form.helm));
      assert.equal(name, `${recolour.name} slayer helmet${form.helm === "slayer_helm" ? "" : " (i)"}`);
      names.add(name);
    }
  }
  for (const recolour of RECOLOURS.filter((entry) => entry.head)) {
    nameOf(recolour.head);
    assert.ok(Number.isInteger(CacheDefinitions.getVarbitId(recolour.unlock)), recolour.unlock);
  }
  assert.deepEqual([...names].sort(), [...SlayerHelmet._test.HELMET_NAMES].sort());
});
