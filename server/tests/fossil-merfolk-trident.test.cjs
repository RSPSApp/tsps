// Run after `yarn build`: node --test tests/fossil-merfolk-trident.test.cjs
// The merfolk trident (FossilIslandUnderwater's MerfolkTrident unit) against rsprox 231/00715:
// pufferfish charges, Check, Channel underwater and the wield warning.
const assert = require("node:assert/strict");
const { test, before } = require("node:test");
const { Server } = require("../dist/Server");
Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager } = require("../dist/plugins/PluginManager");

const DATA = require("../plugins/areas/data/fossil-island-underwater.json");
const MerfolkTrident = require("../plugins/areas/fossilislandunderwater/MerfolkTrident.FossilIslandUnderwater");

const TRIDENT = 21649;
const PUFFER = 21655;
const CHARGES_VARBIT = 5951; // fossil_merfolk_trident_charges
const hooks = { items: {}, itemOnItem: [], canEquip: [], events: {} };
const equipped = [];
const prompts = [];
let core;

before(async () => {
  await CachePipeline.initialize();
  const real = PluginManager.getCoreApi();
  core = {
    ...real,
    EquipPacketListener: {
      equip: (player, id, slot) => {
        const event = { player, slot, item: { getId: () => id }, allow: null };
        hooks.canEquip.forEach((fn) => fn(event));
        if (event.allow !== false) equipped.push([id, slot]);
      },
    },
  };
  const api = {
    core,
    persistAttribute: () => {},
    onItemOnItem: (used, usedWith, fn, filter) => hooks.itemOnItem.push({ used, usedWith, fn, filter }),
    onItemAction: (name, actions) => { hooks.items[name] = actions; },
    onCanEquip: (fn) => hooks.canEquip.push(fn),
    onCustomEvent: (name, fn) => { hooks.events[name] = fn; },
    sendMultiChatboxPrompt: (player, title, ...options) => prompts.push({ player, title, options }),
  };
  const shared = {
    isDiving: (player) => player.diving,
    breathingGear: (player) => player.gear,
    changeOxygen: (player, change) => { player.oxygen = Math.max(0, Math.min(1000, player.oxygen + change)); },
    later: () => {},
  };
  MerfolkTrident.attach(api, shared, DATA.tears);
});

function createPlayer({ diving = true, gear = false, charges = 0, items = {} } = {}) {
  const held = new Map(Object.entries(items).map(([id, n]) => [Number(id), n]));
  const attributes = new Map([[MerfolkTrident._test.CHARGES_ATTRIBUTE, charges]]);
  const varbits = new Map();
  const state = { messages: [], anims: [], varbits: [], dialogues: [] };
  const player = {
    state, diving, gear, oxygen: 1000, held,
    getAttribute: (key) => attributes.get(key),
    setAttribute: (key, value) => attributes.set(key, value),
    getHitpoints: () => 99,
    sendMessage: (m) => state.messages.push(m),
    performAnimation: (a) => state.anims.push(a.getId()),
    getDialogueManager: () => ({ startDialogues: (chain) => state.dialogues.push(chain) }),
    getInventory: () => ({
      getAmount: (id) => held.get(id) ?? 0,
      delete: (id, n) => held.set(id, (held.get(id) ?? 0) - n),
      getSlotForItemId: (id) => ((held.get(id) ?? 0) > 0 ? 4 : -1),
    }),
    getPacketSender: () => ({
      getVarbit: (id) => varbits.get(id) ?? 0,
      sendVarbit: (id, v) => { varbits.set(id, v); state.varbits.push([id, v]); },
    }),
  };
  return player;
}

function charges(player) {
  return player.getAttribute(MerfolkTrident._test.CHARGES_ATTRIBUTE);
}

function usePufferfish(player) {
  const hook = hooks.itemOnItem.find((entry) => entry.used === "Pufferfish" && entry.usedWith === "Merfolk trident");
  const event = { player, usedItemId: PUFFER, usedWithItemId: TRIDENT, handled: false };
  hook.fn(event);
  return event;
}

/** The dialogues of the chain last started for the player, in order. */
function lastChain(player) {
  return [...player.state.dialogues.at(-1).getDialogues().values()];
}

test("pufferfish charge the trident: every fish that fits goes in at once, silently (231/00715 t4879, t5010, t5207)", () => {
  const player = createPlayer({ items: { [PUFFER]: 1 } });
  assert.equal(usePufferfish(player).handled, true);
  assert.equal(charges(player), 1);
  assert.equal(player.held.get(PUFFER), 0);
  player.held.set(PUFFER, 2);
  usePufferfish(player);
  assert.equal(charges(player), 3);
  player.held.set(PUFFER, 9);
  usePufferfish(player);
  assert.equal(charges(player), 10);
  assert.equal(player.held.get(PUFFER), 2, "seven of nine go in");
  assert.deepEqual(player.state.varbits, [[CHARGES_VARBIT, 1], [CHARGES_VARBIT, 3], [CHARGES_VARBIT, 10]]);
  assert.deepEqual(player.state.messages, []);
  assert.equal(player.state.dialogues.length, 0);
});

test("a full trident takes no more and says so in a messagebox (t5213)", () => {
  const player = createPlayer({ charges: 10, items: { [PUFFER]: 3 } });
  usePufferfish(player);
  assert.equal(charges(player), 10);
  assert.equal(player.held.get(PUFFER), 3);
  assert.equal(lastChain(player)[0].getText(), "Your trident is full.");
  assert.deepEqual(player.state.messages, []);
});

test("Check: 'Your trident has: N charges.' (t4815, t5087, worn t5370)", () => {
  for (const [count, line] of [[0, "Your trident has: 0 charges."], [3, "Your trident has: 3 charges."], [10, "Your trident has: 10 charges."]]) {
    const player = createPlayer({ charges: count });
    assert.equal(hooks.items["Merfolk trident"].Check({ player }), true);
    assert.deepEqual(player.state.messages, [line]);
  }
});

test("Channel underwater: 15% oxygen, a charge, human_inhale_pufferfish and the two lines (t5372, t5612-5613)", () => {
  const player = createPlayer({ charges: 10 });
  player.oxygen = 960;
  assert.equal(hooks.items["Merfolk trident"].Channel({ player }), true);
  assert.equal(player.oxygen, 1000, "capped at the full bar");
  assert.equal(charges(player), 9);
  assert.deepEqual(player.state.varbits, [[CHARGES_VARBIT, 9]]);
  assert.deepEqual(player.state.anims, [7701]);
  assert.deepEqual(player.state.messages, ["You channel the power of your trident, restoring some of your puff.", "You have 9 charges left."]);

  const low = createPlayer({ charges: 2 });
  low.oxygen = 500;
  hooks.items["Merfolk trident"].Channel({ player: low });
  hooks.items["Merfolk trident"].Channel({ player: low });
  assert.equal(low.oxygen, 800);
  assert.deepEqual(low.state.messages.filter((m) => m.startsWith("You have")), ["You have 1 charge left.", "You have 0 charges left."]);
});

test("Channel at 0 charges says it has run out (t5615-5616) and restores nothing", () => {
  const player = createPlayer({ charges: 0 });
  player.oxygen = 500;
  assert.equal(hooks.items["Merfolk trident"].Channel({ player }), true);
  assert.equal(player.oxygen, 500);
  assert.deepEqual(player.state.anims, []);
  assert.deepEqual(player.state.messages, ["Your trident has run out of charges."]);
});

test("Channel with breathing gear on only says the helmet line, even at 0 charges (t4816)", () => {
  const player = createPlayer({ gear: true, charges: 5 });
  assert.equal(hooks.items["Merfolk trident"].Channel({ player }), true);
  assert.equal(charges(player), 5);
  assert.deepEqual(player.state.messages, ["You don't need to do that with your helmet on."]);
});

test("Channel on land falls through, like Puff", () => {
  const player = createPlayer({ diving: false, charges: 5 });
  assert.equal(hooks.items["Merfolk trident"].Channel({ player }), false);
  assert.equal(charges(player), 5);
});

test("wielding it underwater stops for the warning, then asks: 'Play it safe.' or wield anyway (t5302-5316)", () => {
  const player = createPlayer({ items: { [TRIDENT]: 1 } });
  prompts.length = 0;
  equipped.length = 0;
  const event = { player, slot: 3, item: { getId: () => TRIDENT }, allow: null };
  MerfolkTrident._test.warnBeforeWield(event);
  assert.equal(event.allow, false);
  const [warning, ask] = lastChain(player);
  assert.equal(warning.getText(), "<col=ff0000>WARNING!<br>If you have this item equipped you can not swim. Deeper water will kill you.");
  ask.send(player);
  const prompt = prompts.at(-1);
  assert.equal(prompt.title, "Select an option");
  assert.deepEqual([prompt.options[0], prompt.options[2]], ["Play it safe.", "I'll steer clear of deeper water but wield this anyway."]);
  prompt.options[1]();
  assert.deepEqual(equipped, [], "Play it safe leaves it unworn");
  prompt.options[3]();
  assert.deepEqual(equipped, [[TRIDENT, 4]], "wield anyway equips it past the warning");
});

test("on land, or with another item, wielding goes ahead", () => {
  const land = createPlayer({ diving: false });
  const event = { player: land, slot: 3, item: { getId: () => TRIDENT }, allow: null };
  MerfolkTrident._test.warnBeforeWield(event);
  assert.equal(event.allow, null);
  const other = { player: createPlayer(), slot: 3, item: { getId: () => 4151 }, allow: null };
  MerfolkTrident._test.warnBeforeWield(other);
  assert.equal(other.allow, null);
});

test("login sends the saved charges on the cache's varbit", () => {
  const player = createPlayer({ charges: 7 });
  hooks.events["player:bootstrap-complete"]({ player });
  assert.deepEqual(player.state.varbits, [[CHARGES_VARBIT, 7]]);
});
