// Run after `yarn build`: node --test tests/hopespears-will.test.cjs
// Hopespear's Will (rsprox capture 1702, rev 226; OSRS Wiki reward table): every plugin loaded, a real Player.
// Burying a high priest's bone in Yu'biusk digs, then a tick later thanks that priest, sets its varbit and pays its
// Prayer XP; the fifth bone completes the miniquest (varbit 13619 -> 2) with no scroll. The bone is withheld from a
// priest's drop unless the miniquest is started and the player fought unarmed, and after Land of the Goblins the
// graves open the name menu instead of the quest's sealed-gate line.
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, after, test } = require("node:test");
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager: PM } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");

let core;
let next = 9700;
before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PM.getCoreApi();
  PM.emitServerStartup({});
});
after(() => PM.emitServerShutdown({}));

const BONES = [26589, 26590, 26591, 26592, 26593];
const XP = [1250, 2500, 5000, 10000, 20000];
const NAMES = ["Snothead", "Snailfeet", "Mosschin", "Redeyes", "Strongbones"];
const PRIEST_VARBITS = [13620, 13621, 13622, 13623, 13624];
const YUBIUSK = [3571, 4374, 0];

function actor(t, { stage = 1, at = YUBIUSK } = {}) {
  const channel = { kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const p = new Player(new PlayerSession(channel));
  p.setIndex(next++);
  p.setUsername("hopespear" + p.getIndex());
  p.setRegistered(true);
  p.setAttribute("bot-skip-persistence", true);
  p.setLocation(new core.Location(...at));
  p.needsPlacement = false;
  p.setAttribute("quest.hopespears_will.stage", stage);
  const messages = [];
  const varbits = [];
  const sender = p.getPacketSender();
  t.mock.method(sender, "sendMessage", (message) => { messages.push(message); return sender; });
  const sendVarbit = sender.sendVarbit.bind(sender);
  t.mock.method(sender, "sendVarbit", (id, value) => { varbits.push([id, value]); return sendVarbit(id, value); });
  t.after(() => { p.setRegistered(false); core.TaskManager.cancelTasks(p); });
  return { p, messages, varbits };
}

function ticks(n) {
  for (let i = 0; i < n; i++) core.TaskManager.sequence?.() ?? core.TaskManager.process?.();
}

function bury(f, itemId) {
  const slot = f.p.getInventory().getItems().findIndex((item) => item?.getId() === itemId);
  PM.emitItemAction({
    player: f.p, item: f.p.getInventory().getItems()[slot], itemId, slot,
    interfaceId: core.CacheDefinitions.getComponentId("inventory:items"), option: "Bury", clickType: 1, handled: false,
  });
}

const prayerXp = (p) => p.getSkillManager().getExperience(core.Skill.PRAYER);

test("each bone buried in Yu'biusk thanks its priest and pays its XP; the fifth completes the miniquest", (t) => {
  const f = actor(t);
  BONES.forEach((id, slot) => f.p.getInventory().setItem(slot, new core.Item(id, 1)));
  BONES.forEach((id, index) => {
    const before = prayerXp(f.p);
    bury(f, id);
    assert.equal(f.messages.at(-1), "You dig a hole in the ground...");
    assert.equal(f.p.getInventory().getAmount(id), 1, "the bone stays until the next tick");
    ticks(1);
    assert.ok(f.messages.includes(`You bury the bones and feel a wave of gratitude from the spirit of ${NAMES[index]}.`));
    assert.equal(f.p.getInventory().getAmount(id), 0);
    assert.equal(prayerXp(f.p) - before, XP[index]);
    assert.ok(f.varbits.some(([varbit, value]) => varbit === PRIEST_VARBITS[index] && value === 1));
  });
  assert.equal(f.p.getAttribute("quest.hopespears_will.stage"), 2);
  assert.ok(f.varbits.some(([varbit, value]) => varbit === 13619 && value === 2));
  assert.ok(!f.messages.some((m) => /completed a quest/.test(m)), "no completion chat line");
});

test("a bone outside Yu'biusk is not buried", (t) => {
  const f = actor(t, { at: [3742, 4385, 0] });
  f.p.getInventory().setItem(0, new core.Item(BONES[0], 1));
  const before = prayerXp(f.p);
  bury(f, BONES[0]);
  ticks(2);
  assert.equal(f.p.getInventory().getAmount(BONES[0]), 1);
  assert.equal(prayerXp(f.p), before);
});

function dropContext(f, index) {
  const context = { handledItemIds: new Set() };
  PM.emitCustomEvent("npc-drops:context", { player: f.p, npcId: 11269 + index, context });
  assert.ok(context.handledItemIds.has(core.ItemIdentifiers.BONES), "plain bones never drop (rsprox 1702)");
  return context.handledItemIds.has(BONES[index]);
}

test("the bone drops only during the miniquest, for an unarmed player who hasn't buried it", (t) => {
  assert.equal(dropContext(actor(t, { stage: 1 }), 0), false, "started, unarmed: the bone drops");
  assert.equal(dropContext(actor(t, { stage: 0 }), 0), true, "not started: withheld");
  const armed = actor(t, { stage: 1 });
  armed.p.getEquipment().setItem(core.Equipment.WEAPON_SLOT, new core.Item(core.ItemIdentifiers.ABYSSAL_WHIP, 1));
  assert.equal(dropContext(armed, 0), true, "armed: withheld");
  const remembered = actor(t, { stage: 1 });
  const spell = core.CombatSpells.WIND_STRIKE.getSpell();
  remembered.p.getCombat().setAutocastSpell(spell);
  assert.equal(dropContext(remembered, 0), false, "a default spell remembered without a staff isn't a spell");
  const recoil = actor(t, { stage: 1 });
  recoil.p.getEquipment().setItem(core.Equipment.RING_SLOT, new core.Item(core.ItemIdentifiers.RING_OF_RECOIL, 1));
  assert.equal(dropContext(recoil, 0), true, "ring of recoil: withheld");
  const done = actor(t, { stage: 1 });
  done.p.setAttribute("quest.hopespears_will.buried", 1);
  assert.equal(dropContext(done, 0), true, "already buried: withheld");
});

test("a summoned priest goes when its owner logs out", (t) => {
  const f = actor(t, { at: [3740, 4386, 0] });
  f.p.setAttribute("quest.land_of_the_goblins.stage", 56);
  const event = {
    player: f.p, objectId: 43122, clickType: 1, location: { x: 3738, y: 4385, z: 0 },
    object: { getId: () => 43122, getLocation: () => new core.Location(3738, 4385, 0) },
    definition: core.ObjectDefinition.forId(43122), handled: false,
  };
  PM.emitObjectInteraction(event);
  f.p.getDialogueManager().handleOption(1); // the chat menu answers 1-based, as the live packet does: "Snothead."
  const npcs = () => [...core.World.getNpcs()].filter((npc) => npc?.getId?.() === 11269 && npc.getOwner?.() === f.p);
  for (let i = 0; i < 4 && npcs().length === 0 && f.p.getDialogueManager().isActive(); i++) {
    f.p.getDialogueManager().advance();
    ticks(1);
  }
  assert.equal(npcs().length, 1, "the priest rose");
  const priest = npcs()[0];
  PM.emitPlayerLogout({ player: f.p, username: f.p.getUsername() });
  ticks(1);
  const queue = core.World.getRemoveNPCQueue?.() ?? [];
  assert.ok(!npcs().includes(priest) || queue.includes(priest), "removed on logout");
});

test("after Land of the Goblins a grave opens the five-name menu", (t) => {
  const f = actor(t, { at: [3740, 4385, 0] });
  f.p.setAttribute("quest.land_of_the_goblins.stage", 56);
  const event = {
    player: f.p, objectId: 43122, clickType: 1, location: { x: 3738, y: 4385, z: 0 },
    object: { getId: () => 43122, getLocation: () => new core.Location(3738, 4385, 0) },
    definition: core.ObjectDefinition.forId(43122), handled: false,
  };
  PM.emitObjectInteraction(event);
  assert.ok(!f.messages.includes("The crypt gate is sealed."));
  const current = f.p.getDialogueManager().getCurrent();
  assert.ok(current, "a dialogue is open");
  assert.equal(current.constructor.name, "OptionDialogue");
});
