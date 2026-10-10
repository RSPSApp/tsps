// Run after `yarn build`: node --test tests/archery-competition.test.cjs
const assert = require("node:assert/strict");
const { test, beforeEach } = require("node:test");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();

const { PluginManager } = require("../dist/plugins/PluginManager");

const ArcheryCompetition = require("../plugins/minigames/ArcheryCompetition.plugin");
const Session = require("../plugins/minigames/archerycompetition/Session.ArcheryCompetition");
const Judge = require("../plugins/minigames/archerycompetition/Judge.ArcheryCompetition");
const Targets = require("../plugins/minigames/archerycompetition/Targets.ArcheryCompetition");

const CORE = PluginManager.getCoreApi();
const ItemIds = CORE.ItemIdentifiers;

let installedCore;
let projectileSends;

function install() {
  const core = { ...CORE };
  projectileSends = [];
  core.Projectile = {
    arrivalCycles: CORE.Projectile.arrivalCycles,
    createProjectile: (...args) => ({ sendProjectile: () => projectileSends.push(args) }),
  };
  Session._test.reset();
  Session._test.init({ core });
  Judge._test.init({ core });
  Targets._test.init({ core });
  return core;
}

function player({ ranged = 60, coins = 1000, arrows = 0, weapon = 841 } = {}) {
  const attributes = new Map();
  const items = new Map();
  if (coins > 0) items.set(ItemIds.COINS, coins);
  if (arrows > 0) items.set(ItemIds.BRONZE_ARROW, arrows);
  const equipment = new Array(14).fill(null);
  equipment[CORE.Equipment.WEAPON_SLOT] = weapon === null ? null : { getId: () => weapon };
  const p = {
    messages: [], xp: 0, animationIds: [], items, dialogues: [],
    getAttribute: (key) => attributes.get(key),
    setAttribute: (key, value) => attributes.set(key, value),
    getInventory: () => ({
      getAmount: (id) => items.get(id) ?? 0,
      contains: (id) => (items.get(id) ?? 0) > 0,
      getFreeSlots: () => 28 - items.size,
      deleteNumber: (id, n) => items.set(id, (items.get(id) ?? 0) - n),
      addItem: (item) => items.set(item.getId(), (items.get(item.getId()) ?? 0) + item.getAmount()),
      forceAdd: (_, item) => items.set(item.getId(), (items.get(item.getId()) ?? 0) + item.getAmount()),
    }),
    getEquipment: () => ({ getItems: () => equipment }),
    getSkillManager: () => ({
      getCurrentLevel: (skill) => (skill === CORE.Skill.RANGED ? ranged : 1),
      addExperiences: (_, xp) => { p.xp += xp; },
    }),
    getPacketSender: () => ({ sendInterfaceRemoval() {} }),
    getDialogueManager: () => ({ startDialogues: (chain) => { p.dialogues.push(chain); } }),
    sendMessage: (message) => p.messages.push(message),
    performAnimation: (animation) => p.animationIds.push(animation.getId()),
    getLocation: () => new CORE.Location(2679, 3426, 0),
    getSize: () => 1,
    getPrivateArea: () => null,
  };
  return p;
}

function dialogueTexts(player) {
  return player.dialogues.flatMap((chain) =>
    [...chain.getDialogues().values()].map((entry) => entry.getText?.() ?? ""));
}

function chooseOption(player, index) {
  const chain = player.dialogues.at(-1);
  const option = [...chain.getDialogues().values()].find((entry) => entry instanceof CORE.OptionDialogue);
  assert.ok(option, "an option menu is open");
  option.execute(index);
}

beforeEach(() => {
  installedCore = install();
});

test("the plugin is a members plugin and exposes the scoring seams", () => {
  assert.equal(ArcheryCompetition.name, "ArcheryCompetition");
  assert.equal(ArcheryCompetition.members, true);
  assert.equal(ArcheryCompetition._test.scoreShot, Session.scoreShot);
  assert.equal(typeof ArcheryCompetition._test.sessions?.get, "function");
});

test("wiki accuracy formula and ring chain, first failed bucket scores the ring before it", () => {
  assert.ok(Math.abs(Session.accuracy(200, 1000) - 200 / 2002) < 1e-12);
  assert.ok(Math.abs(Session.accuracy(2000, 1000) - (1 - 1002 / 4002)) < 1e-12);
  assert.ok(Math.abs(Session.accuracy(1000, 1000) - (1 - 1002 / 2002)) < 1e-12);

  const seq = (...values) => {
    let i = 0;
    return () => values[i++] ?? 1;
  };
  assert.equal(Session.scoreShot(1000, () => 0.99).score, 0, "fails black");
  assert.equal(Session.scoreShot(16000, seq(0, 0, 0.99)).score, 20, "black and blue, fails red");
  assert.equal(Session.scoreShot(16000, seq(0, 0, 0, 0.99)).score, 30, "fails yellow");
  assert.equal(Session.scoreShot(16000, () => 0).score, 100, "bullseye");
  assert.equal(Session.scoreShot(16000, () => 0).caption, "Bulls-Eye!");
});

test("score becomes XP at 1 per 2 points and tickets at 1 per 10 points", () => {
  assert.equal(Session.xpFor(50), 25);
  assert.equal(Session.xpFor(0), 0);
  assert.equal(Session.ticketsFor(0), 0);
  assert.equal(Session.ticketsFor(9), 0);
  assert.equal(Session.ticketsFor(10), 1);
  assert.equal(Session.ticketsFor(95), 9);
  assert.equal(Session.scoreMessage(0), "You haven't started yet.");
  assert.equal(Session.scoreMessage(50), "Not bad, keep going.");
  assert.equal(Session.scoreMessage(85), "Not bad, keep going.");
  assert.equal(Session.scoreMessage(90), "You're pretty good, keep it up.");
  Session._test.setAttackRoll(() => 1234);
  assert.equal(Session.attackRoll(player()), 1234);
});

test("a round costs 200 coins and 10 arrows, and under 40 Ranged is refused", () => {
  const low = player({ ranged: 39 });
  assert.equal(Session.startRound(low), false);
  assert.equal(low.items.get(ItemIds.COINS), 1000);
  assert.equal(Session.sessionOf(low), null);

  const p = player({ ranged: 40 });
  assert.equal(Session.startRound(p), true);
  assert.equal(p.items.get(ItemIds.COINS), 800);
  assert.equal(p.items.get(ItemIds.BRONZE_ARROW), 10);
  assert.deepEqual(Session.sessionOf(p), { shots: 0, score: 0, provided: 10, finished: false, ticketsAwarded: false });
  assert.equal(Session.startRound(p), false, "no restart mid-round");
  assert.equal(p.items.get(ItemIds.COINS), 800);
});

test("a round is exactly 10 shots, each scoring its ring and XP share", () => {
  Session._test.setAttackRoll(() => 16000);
  Session._test.setRandom(() => 0);
  const p = player({ ranged: 60 });
  Session.startRound(p);
  for (let i = 0; i < 10; i++) assert.equal(Session.takeShot(p).score, 100);
  assert.equal(Session.takeShot(p), null, "11th shot is refused");
  const session = Session.sessionOf(p);
  assert.equal(session.shots, 10);
  assert.equal(session.score, 1000);
  assert.equal(session.finished, true);
  assert.equal(p.xp, 500);
  assert.equal(p.items.get(ItemIds.BRONZE_ARROW), 0);
});

test("tickets are floor(points / 10) and a repeated claim pays nothing more", () => {
  Session._test.setAttackRoll(() => 16000);
  Session._test.setRandom(() => 0);
  const p = player({});
  Session.startRound(p);
  for (let i = 0; i < 10; i++) Session.takeShot(p);
  Session.sessionOf(p).score = 95;
  assert.equal(Session.claimTickets(p), 9);
  assert.equal(Session.claimTickets(p), 0);
  assert.equal(Session.claimTickets(p), 0);
  assert.equal(p.items.get(ItemIds.ARCHERY_TICKET), 9);
});

test("a replay starts at score 0 with a fresh 10 arrows", () => {
  Session._test.setAttackRoll(() => 16000);
  Session._test.setRandom(() => 0);
  const p = player({});
  Session.startRound(p);
  for (let i = 0; i < 10; i++) Session.takeShot(p);
  Session.claimTickets(p);
  assert.equal(Session.startRound(p), true);
  assert.equal(p.items.get(ItemIds.COINS), 600);
  const next = Session.sessionOf(p);
  assert.equal(next.score, 0);
  assert.equal(next.shots, 0);
  assert.equal(next.finished, false);
  assert.equal(p.items.get(ItemIds.BRONZE_ARROW), 10);
});

test("logging out mid-round clears the round, takes back the arrows and owes no tickets", () => {
  const hooks = {};
  Session({
    core: installedCore,
    persistAttribute() {},
    onPlayerLogout: (fn) => { hooks.logout = fn; },
    onPlayerDisconnect: (fn) => { hooks.disconnect = fn; },
    onPlayerDeath: (fn) => { hooks.death = fn; },
  });
  Session._test.setAttackRoll(() => 16000);
  Session._test.setRandom(() => 0);
  const p = player({});
  Session.startRound(p);
  Session.takeShot(p);
  Session.takeShot(p);
  Session.takeShot(p);
  assert.equal(p.items.get(ItemIds.BRONZE_ARROW), 7);
  hooks.logout({ player: p });
  assert.equal(Session.sessionOf(p), null);
  assert.equal(p.items.get(ItemIds.BRONZE_ARROW), 0);
  assert.equal(p.items.get(ItemIds.ARCHERY_TICKET) ?? 0, 0);
});

test("the target needs a bow that can fire bronze arrows", () => {
  assert.equal(Session.bowEquipped(player({ weapon: 841 })), true, "shortbow");
  assert.equal(Session.bowEquipped(player({ weapon: 9185 })), false, "rune crossbow");
  assert.equal(Session.bowEquipped(player({ weapon: null })), false, "unarmed");
});

test("Fire-at shoots an arrow with the ranged animation and a projectile at the target", () => {
  Session._test.setAttackRoll(() => 16000);
  Session._test.setRandom(() => 0);
  const p = player({});
  Session.startRound(p);
  const object = { getLocation: () => new CORE.Location(2679, 3425, 0), getSize: () => 1 };
  Targets._test.fireAt({ player: p, objectId: CORE.ObjectIdentifiers.TARGET_2, object });
  assert.deepEqual(p.animationIds, [426]);
  assert.equal(projectileSends.length, 1);
  assert.equal(projectileSends[0][2], 10);
  assert.equal(p.items.get(ItemIds.BRONZE_ARROW), 9);
  assert.equal(Session.sessionOf(p).score, 100);
  assert.ok(p.messages.includes("Bulls-Eye!"));
  Targets._test.fireAt({ player: p, objectId: 829, object });
  assert.equal(p.animationIds.length, 1, "another Target object is ignored");
});

test("the judge refuses under 40 Ranged", () => {
  const low = player({ ranged: 30 });
  Judge._test.talkTo({ player: low });
  assert.ok(dialogueTexts(low).some((text) => text.includes("Ranged level of 40")));
  assert.equal(Session.sessionOf(low), null);
});

test("the judge's finishing dialogue pays once and offers the replay", () => {
  Session._test.setAttackRoll(() => 16000);
  Session._test.setRandom(() => 0);
  const p = player({});
  Session.startRound(p);
  for (let i = 0; i < 10; i++) Session.takeShot(p);
  Judge._test.talkTo({ player: p });
  assert.equal(p.items.get(ItemIds.ARCHERY_TICKET), 100);
  assert.ok(dialogueTexts(p).some((text) => text.includes("Well done. Your score is: 1000.")));
  Judge._test.talkTo({ player: p });
  assert.equal(p.items.get(ItemIds.ARCHERY_TICKET), 100, "re-opening the line pays nothing more");
});

test("starting without 200 coins is refused with the wiki lines", () => {
  const p = player({ coins: 0 });
  Judge._test.talkTo({ player: p });
  chooseOption(p, 0);
  const texts = dialogueTexts(p);
  assert.ok(texts.includes("Oops, I don't have enough coins on me..."));
  assert.ok(texts.includes("Never mind, come back when you've got enough."));
  assert.equal(Session.sessionOf(p), null);
  assert.equal(p.items.get(ItemIds.COINS) ?? 0, 0);
});
