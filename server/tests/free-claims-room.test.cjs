// Run after `yarn build`: node --test tests/free-claims-room.test.cjs
//
// A reward that doesn't fit must not be lost. The Overseer's bludgeon, Bardur's bought shield and the Staff of
// Armadyl wait for room. Tamayu's spear, Lubufu's vessel and Bardur's charmed shield go to the floor, as their
// steps can't run twice.
//
// Native fixture. Bardur, Tamayu, Lubufu, the Guardian and Lucien are registered NPCs through real npc_option
// and their real transcripts, answered through ClientConnection.dispatch; the charmed shield is picked up by a
// real ground_item_action. The Overseer goes through his object hook with a stand-in definition, since his object
// isn't in the fixture's map, and the walk-off is a real move packet. Quest state is set directly. No client ran.
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, after, test } = require("node:test");
// The bots rewrite their tracked object index on load, and nothing here needs them.
process.env.DISABLE_PLAYER_BOTS = "1";
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager: PM } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");
const { ClientConnection } = require("../dist/net/NetworkBuilder");
const { ItemOnGroundManager } = require("../dist/game/entity/impl/grounditem/ItemOnGroundManager");
const { SkillManager } = require("../dist/game/content/skill/SkillManager");

const QuestRuntime = require("../plugins/quests/QuestRuntime");
const Common = require("../plugins/bosses/abyssalsire/Common.AbyssalSire");
const { LORE } = require("../plugins/bosses/abyssalsire/Overseer.AbyssalSire");

const HOME = [3222, 3218];
const NO_SPACE = "You don't have enough inventory space.";
const NO_COINS = "You don't have 150,000 coins.";
const LEVEL_UP_POPUP = 233;

const OVERSEER = "<col=ffff00>The Overseer</col>";
const OVERSEER_OBJECT = 27044;
const BLUDGEON = 13263;
const PIECES = [13274, 13275, 13276];
const PRESENTS = "The Overseer presents you with an Abyssal Bludgeon.";

const SHIELD_PRICE = 150000;
const BARDUR_GOT = "quest.the_fremennik_exiles.bardur-got";
const SHIELD_COMPONENTS_STAGE = 50;
const BUY_SHIELD = [/Maybe I could buy/, /Sounds good/];
const BARDUR_THANKS = /Perhaps I misjudged you/;

const TAMAYU_KEY = "quest.tai_bwo_wannai_trio.tamayu";
const TAMAYU_DONE = 4;
const TAMAYU_CLAIMED = 5;
const TAI_BWO_STARTED = 3;
const TAI_BWO_COMPLETE = 6;
const LUBUFU_KEY = "quest.tai_bwo_wannai_trio.lubufu";
const LUBUFU_GIVEN = 25;
const LUBUFU_APPRENTICE = 31;
const BECOME_APPRENTICE = [/use to catch Karambwan/, /^Yes!$/];

const IKOV_SIDE = "quest.temple_of_ikov.side";
const IKOV_SIDE_LUCIEN = 2;
const IKOV_FIRE_WARRIOR_KILLED = 60;
const IKOV_HAS_STAFF = 70;
const NOT_YET = "No, not yet.";
const TAKES_STAFF = "You take the Staff of Armadyl.";

let core;
let I;
let next = 6600;
const spoken = new WeakMap();

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PM.getCoreApi();
  I = core.ItemIdentifiers;
  core.RegionManager.init();
  core.RegionManager.loadMapFiles(...HOME);
  PM.emitServerStartup({});
  PM.createApi("FreeClaimsRoomTest").onCustomEvent("npc-dialogue:line", (event) => {
    spoken.get(event.player)?.push(String(event.text));
  });
});
after(() => PM.emitServerShutdown({}));

function actor(t) {
  const channel = {
    kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true,
    close() {}, onData() {}, onError() {}, onClose() {},
  };
  const p = new Player(new PlayerSession(channel));
  p.setIndex(next++);
  p.setUsername("claimroom" + p.getIndex());
  p.setRegistered(true);
  p.setLocation(new core.Location(HOME[0], HOME[1], 0));
  p.needsPlacement = false;
  const messages = [];
  t.mock.method(p.getPacketSender(), "sendMessage", (message) => {
    messages.push(message);
    return p.getPacketSender();
  });
  const lines = [];
  spoken.set(p, lines);
  const c = new ClientConnection(channel);
  c.player = p;
  t.after(() => {
    PM.emitPlayerLogout({ player: p, username: p.getUsername() });
    p.setRegistered(false);
    core.TaskManager.cancelTasks(p.getIndex());
  });
  return { t, p, c, inv: p.getInventory(), messages, lines };
}

function drain(f) {
  for (let i = 0; i < 6; i++) {
    core.TaskManager.processWalkTo(f.p.getIndex());
    f.p.getMovementQueue().process();
    core.TaskManager.process();
  }
}

async function send(f, packet) {
  await f.c.dispatch([packet]);
  f.c.processTurnPackets();
}

const plain = (id, count = 1) => new core.Item(id, count);
const pending = (f) => core.MultiChatboxPrompt.getPending(f.p);
const amount = (f, id) => f.inv.getAmount(id);
const inConversation = (f) => f.p.getDialogueManager().isActive() || pending(f) !== null;
const quest = (key) => QuestRuntime.getRegisteredQuests().find((entry) => entry.key === key);
const xp = (f, skill) => f.p.getSkillManager().getExperience(skill);

function fill(f) {
  while (f.inv.getFreeSlots() > 0) f.inv.add(plain(I.RAKE), false);
  f.inv.refreshItems();
  assert.equal(f.inv.getFreeSlots(), 0);
}

function freeOne(f) {
  f.inv.delete(I.RAKE, 1);
  assert.equal(f.inv.getFreeSlots(), 1);
}

/** Plays whatever is open to its end: each menu takes the option `picks` names, or else its first. */
async function playThrough(f, picks = []) {
  const menus = [];
  for (let i = 0; i < 80; i++) {
    const prompt = pending(f);
    if (prompt) {
      menus.push(prompt.options.join("/"));
      const index = prompt.options.findIndex((option) => picks.some((pick) => pick.test(option)));
      await send(f, {
        type: "dialogue_continue",
        widgetId: core.MultiChatboxPrompt.OPTIONS_WIDGET_ID,
        childIndex: index >= 0 ? index + 1 : 1,
      });
    } else if (f.p.getDialogueManager().isActive()) {
      // An overhead line shows no chatbox: it moves on by itself after its ticks.
      const group = f.p.getPacketSender().chatboxGroupId;
      if (group >= 0) await send(f, { type: "dialogue_continue", widgetId: group << 16, childIndex: -1 });
    } else {
      return menus;
    }
    drain(f);
  }
  assert.fail(`the conversation never ended: ${menus.join(" | ")} ${f.lines.slice(-3).join(" | ")}`);
}

async function talk(f, id, picks = []) {
  const npc = core.NPC.create(id, new core.Location(HOME[0] + 1, HOME[1], 0));
  core.World.getNpcs().add(npc);
  f.t.after(() => core.World.getNpcs().remove(npc));
  // Player sync would have done this. An overhead line, such as the Guardian's, needs its speaker local.
  f.p.getLocalNpcs().push(npc);
  const clickType = npc.getDefinition().getActions().findIndex((action) => action === "Talk-to") + 1;
  assert.ok(clickType > 0, `NPC ${id} offers Talk-to`);
  await send(f, { type: "npc_option", index: npc.getIndex(), clickType });
  drain(f);
  return playThrough(f, picks);
}

function floor(f, id) {
  const item = ItemOnGroundManager.getGroundItem(f.p.getUsername(), id, f.p.getLocation(), null);
  if (item) f.t.after(() => ItemOnGroundManager.deregister(item));
  return item;
}

// ------------------------------------------------------------------ The Overseer's bludgeon

function readyToHandIn(t) {
  const f = actor(t);
  f.p.setAttribute(Common.LORE_ATTRIBUTE, LORE.ASKED);
  PIECES.forEach((id, slot) => f.inv.setItem(slot, plain(id)));
  return f;
}

function talkOverseer(f) {
  const location = new core.Location(HOME[0] + 1, HOME[1], 0);
  const definition = { getName: () => OVERSEER, getInteractions: () => ["Talk-to"] };
  PM.emitObjectInteraction({
    player: f.p,
    object: new core.GameObject(OVERSEER_OBJECT, location, 10, 0, null),
    objectId: OVERSEER_OBJECT,
    clickType: 1,
    option: "Talk-to",
    definition,
    location: { x: location.getX(), y: location.getY(), z: 0 },
    sourceLocation: { x: HOME[0], y: HOME[1], z: 0 },
    handled: false,
  });
}

function assertBludgeonWaits(f) {
  assert.equal(amount(f, BLUDGEON), 0, "no bludgeon yet");
  assert.ok(f.messages.includes(NO_SPACE), `the player is told: ${f.messages}`);
  assert.equal(f.p.getAttribute(Common.LORE_ATTRIBUTE), LORE.GIVEN, "he still holds the components for you");
  assert.ok(!f.p.getAttribute(Common.BLUDGEON_GIVEN_ATTRIBUTE), "and still owes the bludgeon");
  assert.equal(inConversation(f), false, "nothing is left open");
}

async function assertBludgeonComes(f) {
  talkOverseer(f);
  await playThrough(f);
  assert.equal(amount(f, BLUDGEON), 1, "the bludgeon");
  assert.equal(f.p.getAttribute(Common.BLUDGEON_GIVEN_ATTRIBUTE), true, "given");
  talkOverseer(f);
  await playThrough(f);
  assert.equal(amount(f, BLUDGEON), 1, "and only one");
}

test("Overseer: straight through the hand-over, the bludgeon comes once", async (t) => {
  const f = readyToHandIn(t);
  talkOverseer(f);
  assert.equal(amount(f, PIECES[0]), 0, "the pieces went");
  await playThrough(f);
  assert.equal(amount(f, BLUDGEON), 1, "the bludgeon");
  assert.ok(!f.messages.includes(NO_SPACE), "no refusal");
  talkOverseer(f);
  await playThrough(f);
  assert.equal(amount(f, BLUDGEON), 1, "and only one");
});

test("Overseer: walk off after handing over, fill up, and talk: he keeps it until there's room", async (t) => {
  const f = readyToHandIn(t);
  talkOverseer(f);
  assert.equal(f.p.getAttribute(Common.LORE_ATTRIBUTE), LORE.GIVEN, "handed over");
  assert.equal(f.p.getDialogueManager().isActive(), true, "his lines are playing");
  await send(f, { type: "move", worldX: HOME[0], worldY: HOME[1] + 1, modifierFlags: 0 });
  drain(f);
  assert.equal(f.p.getDialogueManager().isActive(), false, "walking off ended them");
  fill(f);

  talkOverseer(f);
  await playThrough(f);
  assertBludgeonWaits(f);

  talkOverseer(f);
  await playThrough(f);
  assertBludgeonWaits(f);

  freeOne(f);
  await assertBludgeonComes(f);
});

test("Overseer: filling up during his hand-over lines is refused the same way", async (t) => {
  const f = readyToHandIn(t);
  talkOverseer(f);
  fill(f);
  await playThrough(f);
  assertBludgeonWaits(f);
  freeOne(f);
  await assertBludgeonComes(f);
});

// ------------------------------------------------------------------ Bardur's shield

async function buyShield(t, coins, { full = false } = {}) {
  const f = actor(t);
  quest("the_fremennik_exiles").setStage(f.p, SHIELD_COMPONENTS_STAGE);
  f.inv.setItem(0, plain(I.COINS, coins));
  if (full) fill(f);
  const menus = await talk(f, core.NpcIdentifiers.BARDUR, BUY_SHIELD);
  assert.ok(menus.some((menu) => /Sounds good/.test(menu)), `the purchase was reached: ${menus.join(" | ")}`);
  return f;
}

function assertShieldBought(f, coinsLeft) {
  assert.equal(amount(f, I.FREMENNIK_SHIELD), 1, "the shield");
  assert.equal(amount(f, I.COINS), coinsLeft, "for 150,000");
  assert.equal(f.p.getAttribute(BARDUR_GOT), true, "he remembers");
  assert.ok(f.lines.some((line) => BARDUR_THANKS.test(line)), "and the transcript plays on");
}

function assertShieldRefused(f, coins, message) {
  assert.equal(amount(f, I.FREMENNIK_SHIELD), 0, "no shield");
  assert.equal(amount(f, I.COINS), coins, "the coins stay");
  assert.ok(f.messages.includes(message), `the player is told: ${f.messages}`);
  assert.ok(!f.p.getAttribute(BARDUR_GOT), "he won't refuse to sell another later");
  assert.ok(!f.lines.some((line) => BARDUR_THANKS.test(line)), "and the transcript doesn't thank you for it");
  assert.equal(inConversation(f), false, "the conversation has ended");
}

test("Bardur: with room he sells the shield", async (t) => {
  assertShieldBought(await buyShield(t, SHIELD_PRICE + 10000), 10000);
});

test("Bardur: exactly 150,000 coins on a full inventory works, as paying frees the slot", async (t) => {
  assertShieldBought(await buyShield(t, SHIELD_PRICE, { full: true }), 0);
});

test("Bardur: a full inventory with coins to spare keeps the coins, and he'll sell it later", async (t) => {
  const f = await buyShield(t, SHIELD_PRICE + 10000, { full: true });
  assertShieldRefused(f, SHIELD_PRICE + 10000, NO_SPACE);
  // Not remembered as bought, so the same transcript offers it again.
  freeOne(f);
  f.lines.length = 0;
  await talk(f, core.NpcIdentifiers.BARDUR, BUY_SHIELD);
  assertShieldBought(f, 10000);
});

test("Bardur: too few coins ends the conversation instead of thanking you", async (t) => {
  assertShieldRefused(await buyShield(t, SHIELD_PRICE - 1), SHIELD_PRICE - 1, NO_COINS);
});

async function charmShield(t, { full = false } = {}) {
  const f = actor(t);
  quest("the_fremennik_exiles").setStage(f.p, SHIELD_COMPONENTS_STAGE);
  f.p.getEquipment().setItem(core.Equipment.RING_SLOT, plain(I.RING_OF_CHAROS_A_));
  if (full) fill(f);
  const menus = await talk(f, core.NpcIdentifiers.BARDUR, [/\(Charm\)/]);
  assert.ok(menus.some((menu) => /\(Charm\)/.test(menu)), `the charm was offered: ${menus.join(" | ")}`);
  assert.equal(f.p.getAttribute(BARDUR_GOT), true, "he remembers");
  return f;
}

test("Bardur: charmed, with room the shield goes in the inventory", async (t) => {
  const f = await charmShield(t);
  assert.equal(amount(f, I.FREMENNIK_SHIELD), 1, "the shield");
  assert.equal(floor(f, I.FREMENNIK_SHIELD), null, "none on the floor");
});

test("Bardur: charmed, on a full inventory the shield lands at your feet and can be taken", async (t) => {
  const f = await charmShield(t, { full: true });
  assert.equal(amount(f, I.FREMENNIK_SHIELD), 0, "no room for it");
  assert.ok(floor(f, I.FREMENNIK_SHIELD), "it is on the floor");
  freeOne(f);
  await send(f, { type: "ground_item_action", itemId: I.FREMENNIK_SHIELD, x: HOME[0], y: HOME[1], option: "Take" });
  drain(f);
  assert.equal(amount(f, I.FREMENNIK_SHIELD), 1, "and can be picked up");
});

// ------------------------------------------------------------------ Tamayu's spear

function tamayu(t, { levels = false } = {}) {
  const f = actor(t);
  // At 99 his XP step levels nothing, so the whole transcript plays. The level-up has its own test below.
  for (const skill of levels ? [] : [core.Skill.ATTACK, core.Skill.STRENGTH]) {
    const skills = f.p.getSkillManager();
    skills.setCurrentLevel(skill, 99, false);
    skills.setMaxLevel(skill, 99);
    skills.setExperience(skill, SkillManager.getExperienceForLevel(99));
  }
  quest("tai_bwo_wannai_trio").setStage(f.p, TAI_BWO_COMPLETE);
  f.p.setAttribute(TAMAYU_KEY, TAMAYU_DONE);
  return f;
}

test("Tamayu: with room the spear goes in the inventory, once", async (t) => {
  const f = tamayu(t);
  await talk(f, core.NpcIdentifiers.TAMAYU);
  assert.equal(amount(f, I.RUNE_SPEAR_KP_), 1, "the spear");
  assert.equal(floor(f, I.RUNE_SPEAR_KP_), null, "none on the floor");
  assert.equal(f.p.getAttribute(TAMAYU_KEY), TAMAYU_CLAIMED, "claimed");
});

test("Tamayu: on a full inventory the spear lands at your feet, with the XP paid once", async (t) => {
  const control = tamayu(t);
  const before = xp(control, core.Skill.ATTACK);
  await talk(control, core.NpcIdentifiers.TAMAYU);
  const paid = xp(control, core.Skill.ATTACK) - before;
  assert.ok(paid > 0, "control: he pays Attack XP");

  const f = tamayu(t);
  fill(f);
  const start = xp(f, core.Skill.ATTACK);
  await talk(f, core.NpcIdentifiers.TAMAYU);
  assert.equal(amount(f, I.RUNE_SPEAR_KP_), 0, "no room for it");
  assert.ok(floor(f, I.RUNE_SPEAR_KP_), "it is on the floor");
  assert.equal(f.p.getAttribute(TAMAYU_KEY), TAMAYU_CLAIMED, "claimed");
  assert.equal(xp(f, core.Skill.ATTACK) - start, paid, "the same XP as with room");

  await talk(f, core.NpcIdentifiers.TAMAYU);
  assert.equal(xp(f, core.Skill.ATTACK) - start, paid, "a later talk doesn't pay it again");
});

test("Tamayu: levelling from his XP step ends the transcript there, with one spear and the XP once", async (t) => {
  const f = tamayu(t, { levels: true });
  const skills = f.p.getSkillManager();
  const startLevel = skills.getMaxLevel(core.Skill.ATTACK);
  const start = xp(f, core.Skill.ATTACK);

  await talk(f, core.NpcIdentifiers.TAMAYU);
  const levelled = skills.getMaxLevel(core.Skill.ATTACK);
  const popup = f.p.getPacketSender().chatboxGroupId;
  const lines = [...f.lines];
  const heardRest = lines.some((line) => /This is the one thing/.test(line));
  const spearFirst = amount(f, I.RUNE_SPEAR_KP_);
  const paidFirst = xp(f, core.Skill.ATTACK) - start;

  // Clicks through the pop-ups, then talks again.
  for (let i = 0; i < 8 && f.p.getPacketSender().chatboxGroupId === LEVEL_UP_POPUP; i++) {
    await send(f, { type: "dialogue_continue", widgetId: LEVEL_UP_POPUP << 16, childIndex: -1 });
    drain(f);
  }
  await talk(f, core.NpcIdentifiers.TAMAYU);
  const spearSecond = amount(f, I.RUNE_SPEAR_KP_);
  const paidBoth = xp(f, core.Skill.ATTACK) - start;
  t.diagnostic(`Attack ${startLevel} to ${levelled}; chatbox ${popup}; last line "${lines.at(-1)}"; heard the rest ${heardRest}; `
    + `spear ${spearFirst} then ${spearSecond}; Attack XP ${paidFirst} then ${paidBoth}; state ${f.p.getAttribute(TAMAYU_KEY)}`);

  assert.ok(levelled > startLevel, "the XP levelled Attack");
  assert.equal(popup, LEVEL_UP_POPUP, "the level-up pop-up is up");
  assert.equal(heardRest, false, "and his lines after the XP step didn't play");
  assert.ok(paidFirst > 0, "he paid XP");
  assert.equal(spearFirst, 1, "the spear came anyway");
  assert.equal(f.p.getAttribute(TAMAYU_KEY), TAMAYU_CLAIMED, "claimed");
  assert.equal(spearSecond, 1, "a second talk gives no second spear");
  assert.equal(paidBoth, paidFirst, "and doesn't pay the XP again");
});

// ------------------------------------------------------------------ Lubufu's vessel

function lubufu(t) {
  const f = actor(t);
  quest("tai_bwo_wannai_trio").setStage(f.p, TAI_BWO_STARTED);
  f.p.setAttribute(LUBUFU_KEY, LUBUFU_GIVEN);
  return f;
}

test("Lubufu: with room the vessel goes in the inventory", async (t) => {
  const f = lubufu(t);
  await talk(f, core.NpcIdentifiers.LUBUFU, BECOME_APPRENTICE);
  assert.equal(amount(f, I.KARAMBWAN_VESSEL), 1, "the vessel");
  assert.equal(floor(f, I.KARAMBWAN_VESSEL), null, "none on the floor");
  assert.equal(f.p.getAttribute(LUBUFU_KEY), LUBUFU_APPRENTICE, "apprenticed");
});

test("Lubufu: on a full inventory the vessel lands on the ground, as the transcript says", async (t) => {
  const f = lubufu(t);
  fill(f);
  await talk(f, core.NpcIdentifiers.LUBUFU, BECOME_APPRENTICE);
  assert.equal(amount(f, I.KARAMBWAN_VESSEL), 0, "no room for it");
  assert.ok(floor(f, I.KARAMBWAN_VESSEL), "it is on the floor");
  assert.equal(f.p.getAttribute(LUBUFU_KEY), LUBUFU_APPRENTICE, "apprenticed");
});

// ------------------------------------------------------------------ The Staff of Armadyl

function ikov(t) {
  const f = actor(t);
  quest("temple_of_ikov").setStage(f.p, IKOV_FIRE_WARRIOR_KILLED);
  f.p.setAttribute(IKOV_SIDE, IKOV_SIDE_LUCIEN);
  return f;
}

const talkGuardian = (f) => talk(f, core.NpcIdentifiers.GUARDIAN_OF_ARMADYL);
const talkLucien = (f) => talk(f, core.NpcIdentifiers.LUCIEN_4, [/Yes! Here it is/]);

test("Temple of Ikov: with room the Staff goes to Lucien and the quest completes", async (t) => {
  const f = ikov(t);
  await talkGuardian(f);
  assert.equal(amount(f, I.STAFF_OF_ARMADYL), 1, "the staff");
  assert.equal(quest("temple_of_ikov").getStage(f.p), IKOV_HAS_STAFF, "stage");
  await talkLucien(f);
  assert.equal(quest("temple_of_ikov").isComplete(f.p), true, "complete");
  assert.equal(amount(f, I.STAFF_OF_ARMADYL), 0, "he took it");
});

test("Temple of Ikov: a full inventory leaves the Staff there, and talking again takes it to Lucien", async (t) => {
  const q = quest("temple_of_ikov");
  const f = ikov(t);
  fill(f);
  await talkGuardian(f);
  const dropped = floor(f, I.STAFF_OF_ARMADYL) !== null;
  const stage = q.getStage(f.p);
  const told = [...f.messages];

  // Walks on either way, so the run shows what happens to a player who lost the staff.
  freeOne(f);
  f.lines.length = 0;
  await talkGuardian(f);
  const retry = [...f.lines];
  const carried = amount(f, I.STAFF_OF_ARMADYL);
  f.lines.length = 0;
  await talkLucien(f);
  const toLucien = [...f.lines];
  const complete = q.isComplete(f.p);
  t.diagnostic(`on floor ${dropped}; stage ${stage}; told "${told.join(" / ")}"; Guardian again "${retry.join(" / ")}"; `
    + `carried ${carried}; Lucien "${toLucien.join(" / ")}"; complete ${complete}`);

  assert.equal(stage, IKOV_FIRE_WARRIOR_KILLED, "the stage waits");
  assert.equal(dropped, false, "the Staff isn't on the floor, where it would despawn");
  assert.ok(told.includes(NO_SPACE), `the player is told: ${told}`);
  assert.ok(!told.includes(TAKES_STAFF), "and isn't told they took it");
  assert.equal(carried, 1, "talking again with room takes it");
  assert.ok(!toLucien.includes(NOT_YET), "Lucien isn't told not yet");
  assert.equal(complete, true, "complete");
  assert.equal(amount(f, I.STAFF_OF_ARMADYL), 0, "he took it");
});
