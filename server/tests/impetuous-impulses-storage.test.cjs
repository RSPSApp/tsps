// Run after `yarn build`: node --test tests/impetuous-impulses-storage.test.cjs
// Elnock's Equipment Storage (docs/impetuous-impulses.md), against rsprox capture 20261111T231757.
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, test } = require("node:test");

require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager: PM } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { NpcDefinition } = require("../dist/game/definition/NpcDefinition");
const { PlayerSave } = require("../dist/game/entity/impl/player/persistence/PlayerSave");

const Storage = require("../plugins/minigames/impetuousimpulses/Storage.ImpetuousImpulses");

const S = Storage._test;
const MAIN = S.MAIN;
const SIDE = S.SIDE;
const ELNOCK = 5734;
let core;
let I;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  core = PM.getCoreApi();
  I = core.ItemIdentifiers;
  Storage(PM.createApi("ImpetuousImpulsesStorageTest"));
});

function player({ inventory = [], weapon = null } = {}) {
  const p = new Player(null);
  p.getSession = () => ({ sendClientPacket: () => true, write: () => true });
  p.setUsername("elnockstorage");
  for (const [id, amount] of inventory) p.getInventory().add(new core.Item(id, amount), false);
  if (weapon) p.getEquipment().setItem(core.Equipment.WEAPON_SLOT, new core.Item(weapon, 1));
  const sent = { messages: [], subs: [], varbits: [], sounds: [], scripts: [], events: [], prompts: [] };
  const sender = p.getPacketSender();
  const wrap = (name, record) => {
    const original = sender[name].bind(sender);
    sender[name] = (...args) => { record(...args); return original(...args); };
  };
  wrap("sendSubInterface", (uid, id, type) => sent.subs.push([id, type]));
  wrap("sendVarbit", (id, value) => sent.varbits.push([id, value]));
  wrap("sendSound", (id) => sent.sounds.push(id));
  wrap("sendInterfaceScript", (id, args) => sent.scripts.push([id, args]));
  wrap("sendInterfaceFlagsRange", (uid, from, to, flags) => sent.events.push([uid >>> 16, uid & 0xffff, from, to, flags]));
  wrap("sendEnterAmountPrompt", (title) => sent.prompts.push(title));
  p.sendMessage = (message) => sent.messages.push(message);
  return { p, sent };
}

function npcOp(p, option) {
  const definition = NpcDefinition.forId(ELNOCK);
  const clickType = definition.getActions().indexOf(option) + 1;
  assert.ok(clickType > 0, `Elnock has ${option}`);
  return PM.emitNpcInteraction({ player: p, npc: { getId: () => ELNOCK }, npcId: ELNOCK, definition, action: option, clickType, handled: false });
}

function click(p, group, child, action = 1) {
  return PM.emitInterfaceActionClick({ player: p, buttonId: (group << 16) | child, groupId: group, childId: child, action, handled: false });
}

const varbit = (p, id) => p.getPacketSender().getVarbit(id);
const inv = (p, id) => p.getInventory().getAmount(id);

test("Exchange opens the storage as captured: script 917, both modals, quantity events, busy", () => {
  const { p, sent } = player();
  assert.equal(npcOp(p, "Exchange"), true);
  assert.deepEqual(sent.scripts[0], [917, [-1, -1]]);
  assert.deepEqual(sent.subs, [[MAIN, 0], [SIDE, 0]]);
  assert.deepEqual(sent.events.map(([group, child, from, to, flags]) => [group, child, from, to, flags]),
    [8, 9, 10, 11].map((child) => [MAIN, child, -1, -1, 1 << 1]));
  assert.equal(varbit(p, S.BUSY_VARBIT), 1);
  assert.equal(p.getInterfaceId(), MAIN);
  S.closed({ player: p, interfaceId: MAIN });
  assert.equal(varbit(p, S.BUSY_VARBIT), 0);
});

test("with nothing stored each Remove and Withdraw-all say so (captured lines)", () => {
  const { p, sent } = player();
  npcOp(p, "Exchange");
  click(p, MAIN, 3);
  click(p, MAIN, 4);
  click(p, MAIN, 5);
  click(p, MAIN, 6);
  assert.deepEqual(sent.messages, [
    "You haven't got any nets stored in here.",
    "You haven't got any repellent stored in here.",
    "You haven't got any impling jars stored in here.",
    "You have no items that can be withdrawn.",
  ]);
});

test("storing the wielded net empties the weapon slot; Remove puts it in the inventory", () => {
  const { p, sent } = player({ weapon: I.BUTTERFLY_NET });
  npcOp(p, "Exchange");
  assert.equal(click(p, SIDE, 1), true);
  assert.equal(p.getEquipment().getItems()[core.Equipment.WEAPON_SLOT].getId(), -1);
  assert.equal(varbit(p, S.STORED_VARBIT.net), S.NET_VALUE.BUTTERFLY);
  assert.deepEqual(sent.sounds, [2238]);
  assert.deepEqual(sent.messages, []);

  click(p, MAIN, 3);
  assert.equal(varbit(p, S.STORED_VARBIT.net), S.NET_VALUE.NONE);
  assert.equal(inv(p, I.BUTTERFLY_NET), 1);

  click(p, SIDE, 4);
  assert.equal(varbit(p, S.STORED_VARBIT.net), S.NET_VALUE.BUTTERFLY, "Store-all moves it back in");
  assert.equal(inv(p, I.BUTTERFLY_NET), 0);
  assert.deepEqual(sent.messages, []);
});

test("a magic net is stored as 2 and taken before a plain one; only one net fits", () => {
  const { p } = player({ inventory: [[I.BUTTERFLY_NET, 1], [I.MAGIC_BUTTERFLY_NET, 1]] });
  npcOp(p, "Exchange");
  click(p, SIDE, 1);
  assert.equal(varbit(p, S.STORED_VARBIT.net), S.NET_VALUE.MAGIC);
  assert.equal(inv(p, I.MAGIC_BUTTERFLY_NET), 0);
  click(p, SIDE, 1);
  assert.equal(inv(p, I.BUTTERFLY_NET), 1, "the slot is full");
  click(p, MAIN, 3);
  assert.equal(inv(p, I.MAGIC_BUTTERFLY_NET), 1);
  assert.equal(varbit(p, S.STORED_VARBIT.net), S.NET_VALUE.NONE);
});

test("jars follow the selected quantity, count banknotes and stop at 1,000", () => {
  const { p, sent } = player({ inventory: [[I.IMPLING_JAR, 8], [I.IMPLING_JAR_2, 995]] });
  npcOp(p, "Exchange");
  click(p, MAIN, 9);
  assert.equal(varbit(p, S.QUANTITY_VARBIT), 1, "5 selected");
  click(p, SIDE, 3);
  assert.equal(varbit(p, S.STORED_VARBIT.jars), 5);
  assert.equal(inv(p, I.IMPLING_JAR), 3);
  click(p, SIDE, 3, 2);
  assert.equal(varbit(p, S.STORED_VARBIT.jars), 6, "op 2 is Store-1 while 5 is selected");
  click(p, SIDE, 3, 4);
  assert.equal(varbit(p, S.STORED_VARBIT.jars), 1000, "Store-All fills to the cap, notes included");
  assert.equal(inv(p, I.IMPLING_JAR) + inv(p, I.IMPLING_JAR_2), 3);

  click(p, MAIN, 11);
  click(p, MAIN, 5);
  assert.equal(inv(p, I.IMPLING_JAR), 27, "All fills the 27 free slots (the 3 noted jars hold one)");
  assert.equal(varbit(p, S.STORED_VARBIT.jars), 973);
  const left = varbit(p, S.STORED_VARBIT.jars);
  click(p, MAIN, 5);
  assert.equal(sent.messages.at(-1), S.MESSAGE.NO_SPACE);
  assert.equal(varbit(p, S.STORED_VARBIT.jars), left);
});

test("X asks for an amount; the counts and the quantity survive a save", () => {
  const { p, sent } = player({ inventory: [[I.IMPLING_JAR, 10], [I.IMP_REPELLENT, 1]] });
  npcOp(p, "Exchange");
  click(p, MAIN, 10);
  click(p, SIDE, 3);
  assert.deepEqual(sent.prompts, ["Enter amount:"]);
  p.getEnteredAmountAction().execute(7);
  click(p, SIDE, 2);
  assert.equal(inv(p, I.IMP_REPELLENT), 0);
  const saved = PlayerSave.fromPlayer(p).attributes;
  assert.equal(saved[S.STORAGE_ATTRIBUTE.jars], 7);
  assert.equal(saved[S.STORAGE_ATTRIBUTE.repellent], 1);
  assert.equal(saved[S.QUANTITY_ATTRIBUTE], 3, "X stays selected");
  const { p: loaded } = player();
  PlayerSave.fromPlayer(p).applyToPlayer(loaded);
  npcOp(loaded, "Exchange");
  assert.equal(varbit(loaded, S.STORED_VARBIT.jars), 7, "a relog's Exchange sends the saved count");
  assert.equal(varbit(loaded, S.QUANTITY_VARBIT), 3);
});

test("Quick-withdraw takes everything out without opening the storage", () => {
  const { p, sent } = player();
  p.setAttribute(S.STORAGE_ATTRIBUTE.net, S.NET_VALUE.BUTTERFLY);
  p.setAttribute(S.STORAGE_ATTRIBUTE.repellent, 1);
  p.setAttribute(S.STORAGE_ATTRIBUTE.jars, 4);
  assert.equal(npcOp(p, "Quick-withdraw"), true);
  assert.deepEqual(sent.subs, []);
  assert.deepEqual([inv(p, I.BUTTERFLY_NET), inv(p, I.IMP_REPELLENT), inv(p, I.IMPLING_JAR)], [1, 1, 4]);
  assert.deepEqual(KINDS(p), [0, 0, 0]);
  npcOp(p, "Quick-withdraw");
  assert.equal(sent.messages.at(-1), "You have no items that can be withdrawn.");
});

function KINDS(p) {
  return ["net", "repellent", "jars"].map((kind) => S.count(p, kind));
}

test("storage clicks do nothing unless the storage is open", () => {
  const { p } = player({ inventory: [[I.IMPLING_JAR, 2]] });
  assert.equal(click(p, SIDE, 3), false);
  assert.equal(inv(p, I.IMPLING_JAR), 2);
});

test("Examine names the net the panel shows: a butterfly net unless a magic one is there", () => {
  const { p, sent } = player({ inventory: [[I.BUTTERFLY_NET, 1]] });
  npcOp(p, "Exchange");
  click(p, SIDE, 1, 10);
  click(p, MAIN, 3, 10);
  const butterfly = core.ItemDefinition.forId(I.BUTTERFLY_NET).getExamine();
  assert.deepEqual(sent.messages, [butterfly, butterfly]);
});
