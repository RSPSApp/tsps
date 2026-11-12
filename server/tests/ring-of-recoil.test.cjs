// Run after `yarn build`: node --test tests/ring-of-recoil.test.cjs
const assert = require("node:assert/strict");
const { before, test } = require("node:test");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();

const { CombatFactory } = require("../dist/game/content/combat/CombatFactory");
const { Equipment } = require("../dist/game/model/container/impl/Equipment");
const { ItemIdentifiers } = require("../dist/util/ItemIdentifiers");
const { PluginManager } = require("../dist/plugins/PluginManager");
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const RingOfRecoil = require("../plugins/items/RingOfRecoil.plugin");

function createPlayer(ringId = ItemIdentifiers.RING_OF_RECOIL) {
  const attributes = new Map();
  const equipment = new Array(14).fill(null).map(() => ({ getId: () => -1 }));
  equipment[Equipment.RING_SLOT] = { getId: () => ringId };
  return {
    attributes,
    messages: [],
    getAttribute: (key) => attributes.get(key),
    setAttribute: (key, value) => attributes.set(key, value),
    getEquipment: () => ({
      get: (slot) => equipment[slot],
      set: (slot, item) => { equipment[slot] = item; },
      refreshItems() {},
    }),
    sendMessage(message) { this.messages.push(message); },
  };
}

function attacker() {
  const pending = [];
  return {
    pending,
    getCombat: () => ({ getHitQueue: () => ({ addPendingDamage: (hits) => pending.push(...hits) }) }),
  };
}

function land(player, damage) {
  const enemy = attacker();
  CombatFactory.handleRecoil(player, enemy, damage);
  return enemy.pending;
}

test("the ring of recoil reflects 10% + 1 and spends charges per point reflected", () => {
  const player = createPlayer();
  assert.deepEqual(land(player, 100).map((hit) => hit.getDamage()), [11]);
  assert.equal(player.attributes.get(CombatFactory.RECOIL_DAMAGE_ATTRIBUTE), 11);
  assert.deepEqual(land(player, 5).map((hit) => hit.getDamage()), [1]);
  assert.deepEqual(land(player, 0), [], "a zero hit reflects nothing");
  assert.equal(CombatFactory.recoilDamage(0), 0);
});

test("the last recoil deals only the remaining charges and shatters the ring", () => {
  const player = createPlayer();
  player.attributes.set(CombatFactory.RECOIL_DAMAGE_ATTRIBUTE, 39);
  assert.deepEqual(land(player, 100).map((hit) => hit.getDamage()), [1]);
  assert.equal(player.getEquipment().get(Equipment.RING_SLOT).getId(), -1);
  assert.equal(player.attributes.get(CombatFactory.RECOIL_DAMAGE_ATTRIBUTE), 0);
  assert.match(player.messages.at(-1), /Ring of Recoil has shattered/);
});

test("a charged ring of suffering is left to its own plugin", () => {
  const player = createPlayer(ItemIdentifiers.RING_OF_SUFFERING_R_);
  assert.equal(CombatFactory.wearingRecoilRing(player), false);
});

test("recoil immunity prevents reflected damage and preserves ordinary-ring charges", () => {
  const player = createPlayer(), enemy = attacker();
  enemy.getAttribute = key => key === 'combat:recoil-immune';
  player.attributes.set(CombatFactory.RECOIL_DAMAGE_ATTRIBUTE, 39);
  CombatFactory.handleRecoil(player, enemy, 100);
  assert.deepEqual(enemy.pending, []);
  assert.equal(player.attributes.get(CombatFactory.RECOIL_DAMAGE_ATTRIBUTE), 39);
  assert.equal(player.getEquipment().get(Equipment.RING_SLOT).getId(), ItemIdentifiers.RING_OF_RECOIL);
});

test("recoil immunity does not suppress Vengeance", () => {
  const player = createPlayer(), enemy = attacker();
  player.forceChat = () => {}; player.setHasVengeance = () => {};
  enemy.getAttribute = key => key === 'combat:recoil-immune';
  CombatFactory.handleVengeance(player, enemy, 20);
  assert.equal(enemy.pending[0].getDamage(), 15);
});

// ---- Break, Check and the monsters that cannot be recoiled (Wiki: Ring of recoil, its transcript
// and Category:Monsters immune to recoil)

let actions, events;
before(async () => {
  await CachePipeline.initialize(require("node:path").resolve(__dirname, ".."));
  actions = new Map();
  events = new Map();
  const api = PluginManager.createApi("RingOfRecoilRegression");
  RingOfRecoil.register({
    ...api,
    onItemAction: (name, handlers) => actions.set(name, handlers),
    onCustomEvent: (name, handler) => events.set(name, handler),
  });
});

function ringItem(id = ItemIdentifiers.RING_OF_RECOIL) {
  return { getId: () => id };
}

function withInventory(player, ...items) {
  const slots = [...items];
  const dialogues = [];
  player.getInventory = () => ({
    getItems: () => slots,
    deleteAtSlot: (slot) => { slots[slot] = { getId: () => -1 }; },
  });
  player.getDialogueManager = () => ({ startDialogues: (chain) => dialogues.push(chain) });
  player.getPacketSender = () => ({ sendInterfaceRemoval() {} });
  player.dialogues = dialogues;
  return slots;
}

function entries(chain) {
  return [...chain.getDialogues().values()];
}

test("Check on a worn ring says how much damage it has left", () => {
  const player = createPlayer();
  player.attributes.set(CombatFactory.RECOIL_DAMAGE_ATTRIBUTE, 13);
  actions.get("Ring of recoil").Check({ player, item: ringItem() });
  assert.equal(player.messages.at(-1), "You can inflict 27 more points of damage before a ring will shatter.");
});

test("Break refuses a fully charged ring", () => {
  const player = createPlayer();
  const ring = ringItem();
  const slots = withInventory(player, ring);
  actions.get("Ring of recoil").Break({ player, item: ring, interfaceId: 3214 });
  assert.equal(player.dialogues.length, 1);
  assert.equal(entries(player.dialogues[0])[0].getText(), "The ring is fully charged. There would be no point in breaking it.");
  assert.equal(slots[0], ring, "the ring is kept");
});

test("Break on a used ring asks, then spends it and restores all 40 points to the next one", () => {
  const player = createPlayer();
  player.attributes.set(CombatFactory.RECOIL_DAMAGE_ATTRIBUTE, 13);
  const ring = ringItem();
  const slots = withInventory(player, ring);
  actions.get("Ring of recoil").Break({ player, item: ring, interfaceId: 3214 });
  const [question] = entries(player.dialogues[0]);
  assert.equal(question.getTitle(), "Status: 27 damage points left.");
  assert.deepEqual(question.getOptions(), ["Break the ring.", "Cancel."]);
  question.execute(2);
  assert.equal(slots[0], ring, "Cancel keeps the ring");
  assert.equal(player.attributes.get(CombatFactory.RECOIL_DAMAGE_ATTRIBUTE), 13);
  question.execute(1);
  assert.equal(slots[0].getId(), -1, "the ring is gone");
  assert.equal(player.attributes.get(CombatFactory.RECOIL_DAMAGE_ATTRIBUTE), 0);
  assert.equal(entries(player.dialogues[1])[0].getText(),
    "The ring shatters. Your next ring of recoil will start afresh from 40 damage points.");
});

test("Break is for the inventory, and for the ring itself rather than a note of it", () => {
  const player = createPlayer();
  player.attributes.set(CombatFactory.RECOIL_DAMAGE_ATTRIBUTE, 13);
  const worn = ringItem();
  withInventory(player, worn);
  assert.equal(actions.get("Ring of recoil").Break({ player, item: worn, interfaceId: 1688 }), false);
  const note = ringItem(ItemIdentifiers.RING_OF_RECOIL + 1);
  assert.equal(actions.get("Ring of recoil").Break({ player, item: note, interfaceId: 3214 }), false);
  assert.equal(player.dialogues.length, 0);
});

// ---- The kill a reflection wins (issue #3919). A ring of recoil's damage is nobody's kill — a
// monster killed by it alone drops nothing (Wiki: Ring of recoil) — while a League's Thorns
// damage counts as the wearer's, which is what let it stop a "magic damage only" Combat
// Achievement (Jagex, Further Leagues VI Changes). Only a hit that says it counts is credited.

function reflectedFixture() {
  const { Player } = require("../dist/game/entity/impl/player/Player");
  const { PlayerSession } = require("../dist/net/PlayerSession");
  const { NPC } = require("../dist/game/entity/impl/npc/NPC");
  const { NpcIdentifiers } = require("../dist/util/NpcIdentifiers");
  const { Location } = require("../dist/game/model/Location");
  const channel = {
    kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true,
    close() {}, onData() {}, onError() {}, onClose() {},
  };
  const player = new Player(new PlayerSession(channel), new Location(3222, 3218));
  player.setIndex(2400);
  player.setUsername("reflector");
  player.setRegistered(true);
  player.setHitpoints(10);
  player.setNeedsPlacement(false);
  const npc = NPC.create(NpcIdentifiers.MAN, new Location(3223, 3218));
  npc.setIndex(2401);
  npc.setRegistered(true);
  npc.setHitpoints(6);
  return { player, npc };
}

function reflectOnto(target, source, damage = 3, credits = false) {
  const { HitDamage } = require("../dist/game/content/combat/hit/HitDamage");
  const { HitMask } = require("../dist/game/content/combat/hit/HitMask");
  const hit = new HitDamage(damage, HitMask.RED).markReflected();
  if (credits) hit.markCreditsSource();
  target.decrementHealth(hit.setSource(source));
}

test("a ring of recoil's reflection on an npc is nobody's kill", () => {
  const { player, npc } = reflectedFixture();
  reflectOnto(npc, player);
  assert.equal(npc.getCombat().damageMapContains(player), false,
    "recoil alone credits nobody, as live: such a kill drops nothing");
  assert.equal(npc.getCombat().getKiller(false), null);
  player.setRegistered(false);
});

test("a thorns hit counts as the wearer's damage, so they win the kill", () => {
  const { player, npc } = reflectedFixture();
  assert.equal(npc.getCombat().getKiller(false), null, "nothing credited yet");
  reflectOnto(npc, player, 3, true);
  assert.equal(npc.getCombat().damageMapContains(player), true,
    "the thorns hit is recorded against the player");
  assert.equal(npc.getCombat().getKiller(false), player,
    "an npc killed by thorns is the wearer's kill");
  player.setRegistered(false);
});

test("a reflection that does not come from a player still credits nobody", () => {
  const { player, npc } = reflectedFixture();
  const { NPC } = require("../dist/game/entity/impl/npc/NPC");
  const { NpcIdentifiers } = require("../dist/util/NpcIdentifiers");
  const { Location } = require("../dist/game/model/Location");
  const other = NPC.create(NpcIdentifiers.MAN, new Location(3221, 3218));
  other.setIndex(2402);
  other.setRegistered(true);
  reflectOnto(npc, other);
  assert.equal(npc.getCombat().getKiller(false), null, "an npc's reflection is nobody's kill");
  player.setRegistered(false);
  other.setRegistered(false);
});

test("the Wiki's immune monsters take no recoil, other monsters and players still do", () => {
  const immune = (name) => ({
    isNpc: () => true,
    getAsNpc: () => ({ getCurrentDefinition: () => ({ getName: () => name }) }),
  });
  for (const name of ["Callisto", "Vet'ion", "Venenatis", "Vorkath", "Nex", "Skotizo", "The Nightmare"]) {
    const check = { target: immune(name), allow: true };
    events.get("combat:recoil-target")(check);
    assert.equal(check.allow, false, name);
  }
  for (const name of ["Zulrah", "Cow"]) {
    const check = { target: immune(name), allow: true };
    events.get("combat:recoil-target")(check);
    assert.equal(check.allow, true, name);
  }
  const player = createPlayer();
  const callisto = Object.assign(immune("Callisto"), { getCombat: () => ({ getHitQueue: () => ({ addPendingDamage() { throw new Error("recoiled"); } }) }) });
  // Through the real event, as the combat code asks.
  const original = PluginManager.emitCustomEvent;
  PluginManager.emitCustomEvent = (name, payload) => { if (name === "combat:recoil-target") events.get(name)(payload); };
  try {
    assert.equal(CombatFactory.canReceiveRecoil(callisto), false);
    CombatFactory.handleRecoil(player, callisto, 100);
    assert.equal(player.attributes.get(CombatFactory.RECOIL_DAMAGE_ATTRIBUTE), undefined, "no charges are spent on it");
  } finally {
    PluginManager.emitCustomEvent = original;
  }
});

// Wiki (Category:Monsters immune to recoil) lists "Judge of Yama (A Kingdom Divided)" only; the Yama fight's
// Judge (yama_judge_of_yama, 14180) shares the name and takes recoil.
test("only A Kingdom Divided's Judge of Yama is immune, not the Yama fight's", () => {
  const judge = (id) => ({ isNpc: () => true, getAsNpc: () => ({ getId: () => id, getCurrentDefinition: () => ({ getName: () => "Judge of Yama" }) }) });
  const quest = { target: judge(10938), allow: true };
  events.get("combat:recoil-target")(quest);
  assert.equal(quest.allow, false, "A Kingdom Divided");
  const yama = { target: judge(14180), allow: true };
  events.get("combat:recoil-target")(yama);
  assert.equal(yama.allow, true, "the Yama fight");
});
