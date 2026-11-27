// Run after `yarn build`: node --test tests/barcrawl-drinks.test.cjs
// Alfred Grimhand's Barcrawl: each bar's drink plays out tick by tick once the price line is continued: its
// lines (game or filterable), stat drops, hit, shout or chatbox line, and the Hand of Death's sway
// (plugins/quests/quests/AlfredGrimhandsBarcrawl.Quest.js). Real engine: every plugin loaded, a real Player,
// the bar's Talk-to hook and real dialogue packets, tick by tick. No client ran.
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, after, test } = require("node:test");
process.env.DISABLE_PLAYER_BOTS = "1";
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager: PM } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");
const { ClientConnection } = require("../dist/net/NetworkBuilder");
const { World } = require("../dist/game/World");
const QuestRuntime = require("../plugins/quests/QuestRuntime");
const { decodeClientPackets } = require("../dist/net/protocol/ClientProtocol");
const { ClientPacketId } = require("../dist/net/protocol/NativeClientPackets");

const COINS = 995;
const CARD = 455;
const LEVEL = 60;
const SPAM = 105;
const DIALOGUE_LOG = 114;
const ATMOSPHERIC_SHAKE_OFF = 16110;
/** Five plus 5% (and Fire Brandy's 10%) of 60. */
const FIVE = LEVEL - 5 - 3;
const TEN = LEVEL - 5 - 6;

/**
 * Each bar's drink as the footage and Lost City time it, with every level at 60: `game` and `filtered` lines,
 * `drain` (the stats that drop then), `hit` (its damage), `shout` and `say` (the chatbox line), `shake`, and
 * `sign` (the card signed, noted after the tick's other steps).
 */
const DRINKS = {
  1312: [
    "0 game You buy some Uncle Humphrey's Gutrot.",
    "3 game You drink the Uncle Humphrey's Gutrot.",
    "6 game Your insides feel terrible.",
    "6 drain ATTACK DEFENCE SMITHING STRENGTH",
    "9 game The bartender signs your card.",
    "9 sign",
    "12 hit 1",
    "12 shout Blearrgh!",
  ],
  6531: [
    "0 filtered You buy a Fire Toad Blast.",
    "3 filtered Your mouth and throat burn as you gulp it down.",
    "6 game Blurberry signs your card.",
    "6 sign",
    "8 hit 3",
  ],
  1314: [
    "0 game The bartender serves you a glass of strange thick dark liquid.",
    "0 sign",
    "3 filtered You wince and drink it.",
    "7 filtered You stagger backwards.",
    "7 drain ATTACK COOKING DEFENCE HERBLORE PRAYER",
    "10 game You think you see 2 bartenders signing 2 barcrawl cards.",
  ],
  1320: [
    "0 game The bartender hands you a small glass and sets light to the contents.",
    "3 filtered You blow out the flame and drink it.",
    "7 filtered Your vision blurs and you stagger slightly.",
    "7 drain ATTACK DEFENCE",
    "10 game You can just about make out the bartender signing your barcrawl card.",
    "10 sign",
  ],
  1319: [
    "0 game The bartender hands you a shot of Heart Stopper.",
    "3 filtered You grimace and drink it.",
    "7 filtered You clutch your chest.",
    "10 game Through your tears you see the bartender...",
    "10 game signing your barcrawl card",
    "10 hit 15",
    "10 sign",
  ],
  1318: [
    "0 game The bartender gives you a glass of Liverbane Ale.",
    "3 filtered You gulp it down.",
    "7 game The room seems to be swaying.",
    "7 drain ATTACK DEFENCE FIREMAKING FLETCHING WOODCUTTING",
    "10 game The bartender scrawls his signature on your card.",
    "10 sign",
  ],
  1310: [
    "0 filtered You buy a pint of Olde Suspiciouse.",
    "3 filtered You gulp it down.",
    "6 filtered Your head is spinning.",
    "6 drain ATTACK CRAFTING DEFENCE MAGIC MINING",
    "9 game The bartender signs your card.",
    "9 sign",
    "12 say Thanksh very mush...",
  ],
  13655: [
    "0 filtered You buy some Ape Bite Liqueur.",
    "3 filtered You swirl it around and swallow it.",
    "6 game Zembo signs your card.",
    "9 sign",
    "9 say Mmmmm, dat was luverly...",
  ],
  1317: [
    "0 filtered You buy a Hand of Death cocktail.",
    "3 filtered You drink the cocktail.",
    "3 drain ATTACK DEFENCE FISHING RANGED",
    "6 filtered You stumble around the room.",
    "6 shake 0,0,15,2",
    "10 game Tina giggles and signs your card.",
    "10 shake 0,0,0,0",
    "10 hit 1",
    "10 sign",
  ],
  1313: [
    "0 filtered You buy a Black Skull Ale.",
    "0 sign",
    "3 filtered You drink your Black Skull Ale...",
    "6 filtered Your vision blurs.",
    "9 game The bartender signs your card.",
    "9 shout Hiccup!",
  ],
};
const DROPPED = { 1320: TEN };

let core;
let Skill;
let quest;
let next = 9800;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PM.getCoreApi();
  Skill = core.Skill;
  core.RegionManager.init();
  PM.emitServerStartup({});
  quest = QuestRuntime.questNamed("Alfred Grimhand's Barcrawl");
});
let shutDown = false;
after(() => {
  if (!shutDown) PM.emitServerShutdown({});
});

const skillNames = () => Object.keys(Skill).filter((key) => Skill[key] instanceof Skill && key !== "HITPOINTS");

function actor(t, { coins = 208, level = LEVEL } = {}) {
  const channel = {
    kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true,
    close() {}, onData() {}, onError() {}, onClose() {},
  };
  const p = new Player(new PlayerSession(channel));
  p.setIndex(next++);
  p.setUsername("barcrawlqa" + p.getIndex());
  p.setRegistered(true);
  p.setAttribute("bot-skip-persistence", true);
  p.setLocation(new core.Location(3224, 3399, 0));
  p.needsPlacement = false;
  const skills = p.getSkillManager();
  for (const skill of Skill.values()) {
    skills.setMaxLevels(skill, level);
    skills.setCurrentLevels(skill, level);
  }
  for (let slot = 0; slot < 28; slot++) p.getInventory().setItem(slot, new core.Item(-1, 0));
  p.getInventory().setItem(0, new core.Item(CARD, 1));
  if (coins) p.getInventory().setItem(1, new core.Item(COINS, coins));
  quest.setStage(p, 1);
  const connection = new ClientConnection(channel);
  connection.player = p;
  const sender = p.getPacketSender();
  // What the drink did, by tick from the box closing: "TICK KIND VALUE".
  const f = { p, connection, clock: 0, seen: [], masks: [] };
  const sendTyped = sender.sendTypedMessage.bind(sender);
  const note = (kind, value) => f.seen.push(`${f.clock} ${kind} ${value}`);
  t.mock.method(sender, "sendMessage", (text) => { note("game", text); return sender; });
  // The chatbox's log of conversation lines (type 114) is the conversation's, not the drink's.
  t.mock.method(sender, "sendTypedMessage", (type, text, ...rest) => {
    if (type !== DIALOGUE_LOG) note(type === SPAM ? "filtered" : `type${type}`, text);
    return sendTyped(type, text, ...rest);
  });
  t.mock.method(sender, "sendCameraShake", (...args) => { note("shake", args.join(",")); return sender; });
  t.mock.method(p, "forceChat", (text) => { note("shout", text); return p; });
  const queue = p.getCombat().getHitQueue();
  const add = queue.addPendingDamage.bind(queue);
  t.mock.method(queue, "addPendingDamage", (hits) => {
    for (const hit of hits) {
      note("hit", hit.getDamage());
      f.masks.push(hit.getHitmask());
    }
    return add(hits);
  });
  t.after(() => {
    PM.emitPlayerLogout({ player: p, username: p.getUsername() });
    p.setRegistered(false);
    core.TaskManager.cancelTasks(p.getIndex());
    core.TaskManager.cancelTasks(p);
  });
  return f;
}

const level = (f, name) => f.p.getSkillManager().getCurrentLevel(Skill[name]);
const signed = (f) => Number(f.p.getAttribute("alfred-grimhands-barcrawl:bars")) | 0;
const shownText = (f) => String(f.p.getDialogueManager().getCurrent()?.getText?.() ?? "");

function levels(f) {
  return Object.fromEntries(skillNames().map((name) => [name, level(f, name)]));
}

/** One game tick: notes the stats that dropped and a chatbox line that opened. */
function tick(f) {
  const before = levels(f);
  const said = shownText(f);
  const card = signed(f);
  f.clock++;
  core.TaskManager.processWalkTo(f.p.getIndex());
  f.p.getMovementQueue().process();
  f.connection.processTurnPackets();
  core.TaskManager.process();
  const dropped = skillNames().filter((name) => level(f, name) < before[name]).sort();
  if (dropped.length) f.seen.push(`${f.clock} drain ${dropped.join(" ")}`);
  if (signed(f) !== card) f.seen.push(`${f.clock} sign`);
  if (shownText(f) && shownText(f) !== said) f.seen.push(`${f.clock} say ${shownText(f)}`);
}

/** Lands the hits queued so far. */
function landHits(f) {
  f.p.getCombat().getHitQueue().process(World.getProcessCycle() + 1000 + f.clock);
}

function talk(f, npcId) {
  const npc = core.NPC.create(npcId, new core.Location(3225, 3399, 0));
  const definition = npc.getCurrentDefinition(f.p);
  return PM.emitNpcInteraction({
    player: f.p, npc, npcId, definition,
    clickType: definition.getActions().indexOf("Talk-to") + 1, handled: false,
  });
}

const coins = (f) => f.p.getInventory().getAmount(COINS);

const menu = (f) => core.MultiChatboxPrompt.getPending(f.p)?.options ?? null;

/**
 * Clicks through the conversation to its end, without a tick, taking the Barcrawl option in a menu. The continue
 * that takes the coins (the price line's) must close the box by itself.
 */
async function finish(f) {
  const manager = f.p.getDialogueManager();
  const before = coins(f);
  for (let i = 0; i < 12 && (manager.getCurrent() || menu(f)); i++) {
    const shown = menu(f);
    const group = f.p.getPacketSender().getChatboxGroupId();
    // The drink's timeline starts with the price line's continue; what the conversation sent before is its own.
    const noted = f.seen.length;
    if (shown) {
      const index = shown.findIndex((text) => /barcrawl/i.test(text));
      assert.ok(index >= 0, `a Barcrawl option in ${shown}`);
      await f.connection.dispatch([{ type: "dialogue_continue", widgetId: core.MultiChatboxPrompt.OPTIONS_WIDGET_ID, childIndex: index + 1 }]);
    } else {
      const widgetId = (group << 16) | ([231, 217].includes(group) ? 5 : group === 229 ? 4 : 0);
      await f.connection.dispatch([{ type: "dialogue_continue", widgetId, childIndex: -1 }]);
    }
    f.connection.processTurnPackets();
    if (coins(f) !== before) {
      f.seen.splice(0, noted);
      assert.ok(!manager.getCurrent(), "the price line's continue closes the conversation");
      assert.equal(f.p.getPacketSender().getChatboxGroupId(), -1, "and the box");
      return;
    }
  }
  assert.ok(!manager.getCurrent() && !menu(f), "the conversation ends");
}

/** Talks to the bar and clicks through to its first menu; returns the menu's options. */
async function firstMenu(f, npcId) {
  talk(f, npcId);
  for (let i = 0; i < 6 && !menu(f) && f.p.getDialogueManager().getCurrent(); i++) {
    const group = f.p.getPacketSender().getChatboxGroupId();
    const widgetId = (group << 16) | ([231, 217].includes(group) ? 5 : group === 229 ? 4 : 0);
    await f.connection.dispatch([{ type: "dialogue_continue", widgetId, childIndex: -1 }]);
    f.connection.processTurnPackets();
  }
  return menu(f);
}

/** Buys the bar's drink (tick 0 is the price line's continue) and plays `ticks` ticks of it. */
async function drink(f, npcId, ticks = 14) {
  talk(f, npcId);
  f.seen.length = 0;
  f.clock = 0;
  const card = signed(f);
  await finish(f);
  if (signed(f) !== card) f.seen.push("0 sign");
  for (let i = 0; i < ticks; i++) tick(f);
}

for (const [npcId, timeline] of Object.entries(DRINKS)) {
  test(`bar NPC ${npcId}: the drink plays on its ticks`, async (t) => {
    const f = actor(t);
    await drink(f, Number(npcId));
    assert.notEqual(signed(f), 0, "the bar signs the card");
    assert.deepEqual(f.seen, timeline);
    const drained = timeline.filter((line) => line.split(" ")[1] === "drain").flatMap((line) => line.split(" ").slice(2));
    for (const name of skillNames()) {
      assert.equal(level(f, name), drained.includes(name) ? DROPPED[npcId] ?? FIVE : LEVEL, name);
    }
    landHits(f);
    const hit = timeline.find((line) => line.split(" ")[1] === "hit");
    assert.equal(level(f, "HITPOINTS"), LEVEL - Number(hit?.split(" ")[2] ?? 0), "Hitpoints after the hit");
  });
}

test("the player is held under a full stall until the drink's last step", async (t) => {
  const f = actor(t);
  const stalled = () => f.p.getCombat().isHeldStall();
  talk(f, 1312);
  await finish(f);
  assert.equal(stalled(), true, "under a full stall from the box closing");
  assert.equal(f.p.getMovementQueue().isMovementBlocked(), false, "which drops new walks; the drink takes no movement hold of its own");
  for (let i = 0; i < 11; i++) tick(f);
  assert.equal(stalled(), true, "still on tick 11");
  assert.equal(PM.emitCanLogout(f.p), "You can't log out right now.", "the Logout button too");
  tick(f);
  assert.equal(stalled(), false, "free on tick 12, with the last step");
  assert.equal(PM.emitCanLogout(f.p), null);
});

test("the drops and the damage are shares of the current level, when they come", async (t) => {
  const f = actor(t, { level: 99 });
  f.p.getSkillManager().setCurrentLevels(Skill.ATTACK, 40);
  f.p.getSkillManager().setCurrentLevels(Skill.HITPOINTS, 40);
  await drink(f, 1320); // Fire Brandy: 5 + 10%
  assert.equal(level(f, "ATTACK"), 40 - 5 - 4);
  assert.equal(level(f, "DEFENCE"), 99 - 5 - 9);
  talk(f, 1319); // Heart Stopper: 25% of the Hitpoints on its tick 10
  await finish(f);
  for (let i = 0; i < 9; i++) tick(f);
  f.p.getSkillManager().setCurrentLevels(Skill.HITPOINTS, 20);
  tick(f);
  landHits(f);
  assert.equal(level(f, "HITPOINTS"), 15);
});

test("a share that rounds to 0 is a hit of 0", async (t) => {
  const f = actor(t, { level: 30 });
  await drink(f, 1312); // Gutrot: 3% of 30
  assert.ok(f.seen.includes("12 hit 0"));
  assert.deepEqual(f.masks, [core.HitMask.BLUE], "a blue 0");
  assert.ok(f.seen.includes("12 shout Blearrgh!"));
});

test("without the coins, or at a signed bar, there is no drink", async (t) => {
  const poor = actor(t, { coins: 10 });
  talk(poor, 1312);
  poor.seen.length = 0;
  await finish(poor);
  for (let i = 0; i < 14; i++) tick(poor);
  assert.equal(signed(poor), 0);
  assert.deepEqual(poor.seen, []);

  const f = actor(t);
  await drink(f, 1320);
  f.p.getDialogueManager().reset?.();
  const again = await firstMenu(f, 1320);
  assert.ok(again && !again.some((option) => /barcrawl/i.test(option)), `the second visit offers no drink: ${again}`);
  assert.equal(level(f, "ATTACK"), TEN, "one Fire Brandy");
  assert.equal(coins(f), 208 - 12);
});

test("the sway is sent whatever the atmospheric camera shake setting", async (t) => {
  const f = actor(t);
  f.p.getPacketSender().sendVarbit(ATMOSPHERIC_SHAKE_OFF, 1);
  await drink(f, 1317);
  assert.ok(f.seen.includes("6 shake 0,0,15,2"), "the cache does not group it with the atmospheric shakes");
});

test("a poison hit due during the drink comes when it ends, and its period starts again from then", async (t) => {
  const { CombatPoisonEffect } = require("../dist/game/task/impl/CombatPoisonEffect");
  const hits = (f) => f.seen.filter((line) => / hit /.test(line)).length;
  const f = actor(t);
  f.p.setPoisonDamage(6);
  const effect = new CombatPoisonEffect(f.p);
  t.after(() => CombatPoisonEffect.suspend(f.p));
  f.p.delayFor(5); // the World cycle stands still in this test, so the delay lasts until endDelay
  for (let i = 0; i < 40; i++) effect.execute();
  assert.equal(hits(f), 0, "no poison hit while delayed (osrs-docs: Timers, a normal timer halts at 0)");
  f.p.endDelay();
  effect.execute();
  assert.equal(hits(f), 1, "the overdue hit comes on the first tick after");
  for (let i = 0; i < 29; i++) effect.execute();
  assert.equal(hits(f), 1, "and the next waits a full period");
  effect.execute();
  assert.equal(hits(f), 2);
});

/** A disease of 20, its value, the sum of the levels it can drain, and `n` task ticks. */
function diseased(t, f) {
  t.after(() => PM.emitCustomEvent("disease:cure", { player: f.p }));
  PM.emitCustomEvent("disease:inflict", { player: f.p, value: 20 });
  return {
    value: () => { const request = { player: f.p }; PM.emitCustomEvent("disease:state", request); return request.value; },
    total: () => skillNames().filter((name) => name !== "PRAYER").reduce((sum, name) => sum + level(f, name), 0),
    ticks: (n) => { for (let i = 0; i < n; i++) core.TaskManager.process(); },
  };
}

test("a disease step due during a delay comes when it ends, and its period starts again from then", async (t) => {
  const f = actor(t);
  const d = diseased(t, f);
  const full = d.total();
  f.p.delayFor(5); // the World cycle stands still in this test, so the delay lasts until endDelay
  d.ticks(40);
  assert.equal(d.value(), 20, "no step while delayed (osrs-docs: Timers, toxins halt at 0)");
  assert.equal(d.total(), full, "and no drain");
  f.p.endDelay();
  d.ticks(1);
  assert.equal(d.value(), 19, "the overdue step comes on the first tick after");
  d.ticks(1);
  assert.ok(d.total() < full, "with its drain on the next");
  d.ticks(28);
  assert.equal(d.value(), 19, "and the next waits a full period");
  d.ticks(1);
  assert.equal(d.value(), 18);
});

test("a disease drain due when a delay starts waits until it ends", async (t) => {
  const f = actor(t);
  const d = diseased(t, f);
  const full = d.total();
  d.ticks(30);
  assert.equal(d.value(), 19, "the step; its drain is due on the next tick");
  f.p.delayFor(5);
  d.ticks(10);
  assert.equal(d.total(), full, "no drain while delayed");
  f.p.endDelay();
  d.ticks(1);
  assert.ok(d.total() < full, "the drain comes when the delay ends");
});

test("the price line's continue takes the coins and closes the box at every bar", async (t) => {
  for (const npcId of Object.keys(DRINKS)) {
    const f = actor(t);
    talk(f, Number(npcId));
    await finish(f);
    assert.ok(coins(f) < 208, `bar NPC ${npcId} takes the coins on the price line's continue`);
  }
});

test("a death stops the rest of the drink", async (t) => {
  const f = actor(t);
  talk(f, 1312);
  await finish(f);
  tick(f);
  f.p.setHitpoints(0); // a death that is no hit (damage waits until the drink ends)
  for (let i = 0; i < 14; i++) tick(f);
  assert.ok(f.seen.some((line) => line.endsWith("Oh dear, you are dead!")), "the player died");
  const rest = f.seen.filter((line) => !line.endsWith("Oh dear, you are dead!") && !line.endsWith(" sign"));
  assert.deepEqual(rest, ["0 game You buy some Uncle Humphrey's Gutrot."]);
  assert.notEqual(signed(f), 0, "the card it was paid for is signed");
});

test("a player removed mid-drink gets its lasting steps at once", async (t) => {
  const f = actor(t);
  talk(f, 1312); // Gutrot: drops on tick 6, signed on 9, hit on 12
  await finish(f);
  for (let i = 0; i < 3; i++) tick(f);
  assert.equal(signed(f), 0, "not yet signed on tick 3");
  PM.emitPlayerLogout({ player: f.p, username: f.p.getUsername() });
  core.TaskManager.cancelTasks(f.p);
  assert.notEqual(signed(f), 0, "signed");
  assert.equal(level(f, "ATTACK"), FIVE, "the drops");
  assert.equal(level(f, "HITPOINTS"), LEVEL - 1, "the Hitpoints");
  const seen = f.seen.length;
  for (let i = 0; i < 12; i++) tick(f);
  assert.equal(f.seen.length, seen, "nothing plays after");
  assert.equal(level(f, "ATTACK"), FIVE, "no second drop");
});

test("a removal after a step does not repeat it", async (t) => {
  const f = actor(t);
  talk(f, 1312);
  await finish(f);
  for (let i = 0; i < 7; i++) tick(f); // the drops came on tick 6
  PM.emitPlayerLogout({ player: f.p, username: f.p.getUsername() });
  core.TaskManager.cancelTasks(f.p);
  assert.equal(level(f, "ATTACK"), FIVE);
});

test("a removal on the last step's tick, before the drink's hit lands, still takes the Hitpoints", async (t) => {
  const f = actor(t);
  talk(f, 1319); // Heart Stopper: 25% on tick 10, its last
  await finish(f);
  for (let i = 0; i < 10; i++) tick(f);
  assert.equal(PM.emitCanLogout(f.p), null, "the drink is over on its last step's tick");
  assert.equal(level(f, "HITPOINTS"), LEVEL, "and its hit has not landed yet");
  PM.emitPlayerLogout({ player: f.p, username: f.p.getUsername() });
  assert.equal(level(f, "HITPOINTS"), LEVEL - 15);

  const landed = actor(t);
  talk(landed, 1319);
  await finish(landed);
  for (let i = 0; i < 10; i++) tick(landed);
  landHits(landed);
  PM.emitPlayerLogout({ player: landed.p, username: landed.p.getUsername() });
  assert.equal(level(landed, "HITPOINTS"), LEVEL - 15, "a hit that landed is not taken again");
});

test("a death before the drink's last hit lands drops that hit for good", async (t) => {
  const f = actor(t);
  talk(f, 1319); // Heart Stopper: 25% on tick 10, its last
  await finish(f);
  for (let i = 0; i < 10; i++) tick(f);
  f.p.setHitpoints(0); // a death that is no hit, before the player's turn lands the drink's hit
  for (let i = 0; i < 8; i++) tick(f);
  assert.equal(level(f, "HITPOINTS"), LEVEL, "respawned");
  PM.emitPlayerLogout({ player: f.p, username: f.p.getUsername() });
  assert.equal(level(f, "HITPOINTS"), LEVEL, "a later logout does not take the dropped hit");
});

test("the Logout button is refused while the drink plays", async (t) => {
  const f = actor(t);
  assert.equal(PM.emitCanLogout(f.p), null, "allowed before");
  talk(f, 1312);
  await finish(f);
  assert.equal(PM.emitCanLogout(f.p), "You can't log out right now.");
  for (let i = 0; i < 13; i++) tick(f);
  assert.equal(PM.emitCanLogout(f.p), null, "allowed after");
});

test("hits from others during the drink wait until its last tick", async (t) => {
  const f = actor(t);
  const cycle = World.getProcessCycle();
  talk(f, 1319); // Heart Stopper: 25% on tick 10, its last
  await finish(f);
  const queue = f.p.getCombat().getHitQueue();
  tick(f);
  const attacker = core.NPC.create(1312, new core.Location(3226, 3399, 0));
  queue.addPendingDamage([new core.HitDamage(5, core.HitMask.RED).setSource(attacker)]);
  queue.process(cycle + 2);
  assert.equal(level(f, "HITPOINTS"), LEVEL, "held on tick 2");
  for (let i = 0; i < 8; i++) tick(f);
  queue.process(cycle + 9);
  assert.equal(level(f, "HITPOINTS"), LEVEL, "still held on tick 9");
  tick(f);
  queue.process(cycle + 10);
  assert.equal(level(f, "HITPOINTS"), LEVEL - 5 - 15, "both land on tick 10");
});

test("the player's own damage during the drink waits until its last tick too", async (t) => {
  const f = actor(t);
  const cycle = World.getProcessCycle();
  talk(f, 1319); // Heart Stopper: 25% on tick 10, its last
  await finish(f);
  const queue = f.p.getCombat().getHitQueue();
  tick(f);
  queue.addPendingDamage([new core.HitDamage(4, core.HitMask.GREEN)]); // a poison hit has no source
  queue.process(cycle + 2);
  assert.equal(level(f, "HITPOINTS"), LEVEL, "held on tick 2");
  for (let i = 0; i < 8; i++) tick(f);
  queue.process(cycle + 9);
  assert.equal(level(f, "HITPOINTS"), LEVEL, "still held on tick 9");
  tick(f);
  queue.process(cycle + 10);
  assert.equal(level(f, "HITPOINTS"), LEVEL - 4 - 15, "both land on tick 10");
});

test("a death during the drink ends the hold on hits from others", async (t) => {
  const f = actor(t);
  const cycle = World.getProcessCycle();
  talk(f, 1312); // Gutrot: hits held until tick 12
  await finish(f);
  tick(f);
  f.p.setHitpoints(0);
  for (let i = 0; i < 7; i++) tick(f);
  assert.equal(level(f, "HITPOINTS"), LEVEL, "respawned");
  assert.equal(f.p.isDelayed(), false, "no longer delayed");
  const attacker = core.NPC.create(1312, new core.Location(3226, 3399, 0));
  f.p.getCombat().getHitQueue().addPendingDamage([new core.HitDamage(3, core.HitMask.RED).setSource(attacker)]);
  f.p.getCombat().getHitQueue().process(cycle + 8);
  assert.equal(level(f, "HITPOINTS"), LEVEL - 3, "a hit after the respawn lands at once");
});

test("clicks during the drink are dropped", async (t) => {
  const f = actor(t);
  const npc = core.NPC.create(1312, new core.Location(3225, 3399, 0));
  core.World.getNpcs().add(npc);
  t.after(() => core.World.getNpcs().remove(npc));
  const talkTo = async () => f.connection.dispatch([{
    type: "npc_option", index: npc.getIndex(), clickType: npc.getCurrentDefinition(f.p).getActions().indexOf("Talk-to") + 1,
  }]);
  const read = async () => f.connection.dispatch([{ type: "inventory_action", slot: 0, itemId: CARD, widgetId: 3214, option: "Read" }]);
  talk(f, 1312);
  await finish(f);
  tick(f);
  await talkTo();
  for (let i = 0; i < 3; i++) tick(f);
  assert.equal(shownText(f), "", "Talk-to does nothing");
  await read();
  tick(f);
  assert.equal(shownText(f), "", "the card's Read does nothing");
  for (let i = 0; i < 9; i++) tick(f);
  await read();
  tick(f);
  assert.match(shownText(f), /Blue Moon Inn: signed/, "afterwards the card reads");
});

/** The spellbook's component for a spell. */
function spellChild(name) {
  for (let child = 0; child < 400; child++) {
    if (core.CacheDefinitions.getSpellName((218 << 16) | child, -1)?.toLowerCase() === name.toLowerCase()) return child;
  }
  return -1;
}

test("held buttons do nothing during the drink", async (t) => {
  const P = core.PrayerHandler;
  const BONES = 526;
  const BEER = 1917;
  const bananas = spellChild("Bones to Bananas");
  const orb = core.CacheDefinitions.getComponentId("orbs:prayerbutton");
  assert.ok(bananas >= 0 && Number.isInteger(orb), "the spell and the orb exist");
  const press = async (f, groupId, childId, extra = {}) => {
    await f.connection.dispatch([{ type: "widget_action", groupId, childId, widgetId: (groupId << 16) | childId, slot: -1, buttonNum: 1, ...extra }]);
    f.connection.processTurnPackets();
  };
  const unequipHead = async (f) => {
    const frame = Buffer.alloc(9);
    frame[0] = ClientPacketId.IF_BUTTON1;
    frame.writeInt32BE((387 << 16) | 15, 1);
    frame.writeUInt16BE(65535, 5);
    frame.writeUInt16BE(65535, 7);
    await f.connection.dispatch(decodeClientPackets(frame));
    f.connection.processTurnPackets();
  };
  const send = async (f, packet) => {
    await f.connection.dispatch([packet]);
    f.connection.processTurnPackets();
  };
  const everything = async (f) => {
    await press(f, orb >>> 16, orb & 0xffff); // quick prayers (Thick Skin)
    await press(f, 541, 23); // Protect from Melee
    await unequipHead(f);
    await press(f, 218, bananas);
    await press(f, 593, 32); // auto retaliate
    await press(f, 216, 2, { slot: 0 }); // the first emote
    await send(f, { type: "widget_drag", sourceWidgetId: 3214, sourceSlot: 5, sourceItemId: BEER, targetWidgetId: 3214, targetSlot: 10, targetItemId: -1 });
    await send(f, { type: "varp_transmit", varpId: 173, value: f.p.isRunningReturn() ? 0 : 1 }); // run
    tick(f);
  };
  const state = (f) => ({
    praying: P.isActivated(f.p, P.PROTECT_FROM_MELEE) === true,
    quickPraying: P.isActivated(f.p, P.THICK_SKIN) === true,
    helm: f.p.getEquipment().getItems()[core.Equipment.HEAD_SLOT]?.getId?.() ?? -1,
    bones: f.p.getInventory().getAmount(BONES),
    autoRetaliate: f.p.autoRetaliateReturn(),
    emotes: f.emotes,
    beerSlot: f.p.getInventory().getItems().findIndex((item) => item?.getId?.() === BEER),
    running: f.p.isRunningReturn(),
  });
  const f = actor(t);
  f.emotes = 0;
  const animate = f.p.performAnimation.bind(f.p);
  t.mock.method(f.p, "performAnimation", (...args) => { f.emotes++; return animate(...args); });
  f.p.getEquipment().setItem(core.Equipment.HEAD_SLOT, new core.Item(core.ItemIdentifiers.BRONZE_FULL_HELM, 1));
  for (let slot = 2; slot < 5; slot++) f.p.getInventory().setItem(slot, new core.Item(BONES, 1));
  f.p.getInventory().setItem(5, new core.Item(BEER, 1));
  f.p.getInventory().setItem(6, new core.Item(561, 5));
  f.p.getInventory().setItem(7, new core.Item(557, 5));
  f.p.getInventory().setItem(8, new core.Item(555, 5));
  f.p.getQuickPrayers().toggle(P.THICK_SKIN);
  const before = state(f);
  talk(f, 1312);
  await finish(f);
  tick(f);
  await everything(f);
  assert.deepEqual(state(f), before, "nothing changed during the drink");
  for (let i = 0; i < 12; i++) tick(f);
  await everything(f);
  const after = state(f);
  for (const [key, value] of Object.entries(before)) assert.notDeepEqual(after[key], value, `${key} changes afterwards`);
});

test("the special attack bar and orb still turn the special on and off during the drink, as Lost City's bar does", async (t) => {
  const specOrb = core.CacheDefinitions.getComponentId("orbs:specbutton");
  assert.ok(Number.isInteger(specOrb), "the orb exists");
  const press = async (f, groupId, childId, widgetId = (groupId << 16) | childId) => {
    await f.connection.dispatch([{ type: "widget_action", groupId, childId, widgetId, slot: -1, buttonNum: 1 }]);
    f.connection.processTurnPackets();
  };
  const armed = (f, weapon) => {
    f.p.getEquipment().setItem(core.Equipment.WEAPON_SLOT, new core.Item(weapon, 1));
    core.CombatSpecial.assign(f.p);
    return f;
  };
  const f = armed(actor(t), core.ItemIdentifiers.DRAGON_DAGGER);
  talk(f, 1312);
  await finish(f);
  tick(f);
  await press(f, 593, 57);
  assert.equal(f.p.isSpecialActivated(), true, "the bar turns the dragon dagger's special on");
  await press(f, specOrb >>> 16, specOrb & 0xffff, specOrb);
  assert.equal(f.p.isSpecialActivated(), false, "and the orb turns it off");

  // Lost City's bar checks the delay for a special that acts on the press: the dragon battleaxe's.
  const axe = armed(actor(t), core.ItemIdentifiers.DRAGON_BATTLEAXE);
  const energy = axe.p.getSpecialPercentage();
  talk(axe, 1312);
  await finish(axe);
  tick(axe);
  await press(axe, 593, 57);
  await press(axe, specOrb >>> 16, specOrb & 0xffff, specOrb);
  assert.equal(axe.p.getSpecialPercentage(), energy, "the dragon battleaxe's special does not fire");
  for (let i = 0; i < 12; i++) tick(axe);
  await press(axe, 593, 57);
  assert.ok(axe.p.getSpecialPercentage() < energy, "and works after the drink");

  // Lost City checks the energy first: too little, and the press says so during the delay too.
  const weak = armed(actor(t), core.ItemIdentifiers.DRAGON_BATTLEAXE);
  weak.p.setSpecialPercentage(10);
  talk(weak, 1312);
  await finish(weak);
  tick(weak);
  await press(weak, 593, 57);
  assert.ok(weak.seen.some((line) => line.endsWith("game You don't have enough power left.")), "too little energy is said");
  assert.ok(!axe.seen.some((line) => line.includes("enough power")), "with the energy, nothing is said");
});

test("what the client changed by itself is sent back during the drink", async (t) => {
  const f = actor(t);
  const sender = f.p.getPacketSender();
  const configs = [];
  const sendConfig = sender.sendConfig.bind(sender);
  t.mock.method(sender, "sendConfig", (id, value) => { configs.push(`${id}=${value}`); return sendConfig(id, value); });
  const runs = t.mock.method(sender, "sendRunStatus", () => sender);
  const refreshes = t.mock.method(f.p.getInventory(), "refreshItems", () => f.p.getInventory());
  const send = async (packet) => {
    await f.connection.dispatch([packet]);
    f.connection.processTurnPackets();
  };
  // Not the defaults, so a resend of zeros would show: the third style, retaliate off, the special on.
  f.p.getEquipment().setItem(core.Equipment.WEAPON_SLOT, new core.Item(core.ItemIdentifiers.DRAGON_DAGGER, 1));
  core.CombatSpecial.assign(f.p);
  sendConfig(43, 2);
  f.p.setAutoRetaliate(false);
  sendConfig(172, 1);
  sendConfig(301, 1);
  const style = sender.getVarp(43);
  const retaliate = f.p.autoRetaliateReturn();
  talk(f, 1312);
  await finish(f);
  tick(f);
  configs.length = 0;
  await send({ type: "widget_action", groupId: 593, childId: 32, widgetId: (593 << 16) | 32, slot: -1, buttonNum: 1 });
  assert.deepEqual([...configs].sort(), ["172=1", "301=1", "43=2"], "a held combat click resends the style, retaliate and special");
  configs.length = 0;
  await send({ type: "varp_transmit", varpId: 43, value: style + 1 });
  await send({ type: "varp_transmit", varpId: 172, value: retaliate ? 1 : 0 });
  assert.deepEqual(configs, ["43=2", "172=1"], "the style and retaliate the client sent are sent back as they were");
  assert.equal(sender.getVarp(43), style, "the style is unchanged");
  assert.equal(f.p.autoRetaliateReturn(), retaliate, "and retaliate");
  await send({ type: "varp_transmit", varpId: 173, value: f.p.isRunningReturn() ? 0 : 1 });
  assert.equal(runs.mock.callCount(), 1, "the run state is sent back");
  const refreshed = refreshes.mock.callCount();
  await send({ type: "widget_drag", sourceWidgetId: 3214, sourceSlot: 0, sourceItemId: CARD, targetWidgetId: 3214, targetSlot: 9, targetItemId: -1 });
  assert.equal(refreshes.mock.callCount(), refreshed + 1, "a drag is put back");
  assert.equal(f.p.getInventory().getItems()[0]?.getId?.(), CARD, "and the card stays in its slot");
  await send({ type: "inventory_move", from: 0, to: 9, widgetId: 3214 });
  assert.equal(refreshes.mock.callCount(), refreshed + 2, "the web client's move is put back too");
  assert.equal(f.p.getInventory().getItems()[0]?.getId?.(), CARD, "and the card stays in its slot");
  for (let i = 0; i < 12; i++) tick(f);
  await send({ type: "inventory_move", from: 0, to: 9, widgetId: 3214 });
  assert.equal(f.p.getInventory().getItems()[9]?.getId?.(), CARD, "after the drink the move goes through");
});

test("the offhand's special and the special attack orb's second option do nothing during the drink", async (t) => {
  const orb = core.CacheDefinitions.getComponentId("orbs:specbutton");
  const press = async (f, groupId, childId, widgetId, buttonNum = 1) => {
    await f.connection.dispatch([{ type: "widget_action", groupId, childId, widgetId, slot: -1, buttonNum }]);
    f.connection.processTurnPackets();
  };
  const f = actor(t);
  f.p.getEquipment().setItem(core.Equipment.SHIELD_SLOT, new core.Item(core.ItemIdentifiers.RONDACHE, 1));
  const tries = async () => {
    const before = f.seen.length;
    await press(f, 593, 67, (593 << 16) | 67);
    await press(f, orb >>> 16, orb & 0xffff, orb, 2);
    return f.seen.slice(before).filter((line) => /rondache/i.test(line)).length;
  };
  talk(f, 1312);
  await finish(f);
  tick(f);
  assert.equal(await tries(), 0, "during the drink");
  for (let i = 0; i < 12; i++) tick(f);
  assert.equal(await tries(), 2, "afterwards both answer");
});

test("the native client's inventory clicks do nothing during the drink", async (t) => {
  const { ItemActionPacketListener } = require("../dist/net/packet/impl/ItemActionPacketListener");
  const SHRIMP = 315;
  const op = (itemId, name) => [1, 2, 3, 4, 6, 7].find((n) => ItemActionPacketListener.resolveInventoryWidgetAction(itemId, n)?.option === name);
  const click = async (f, slot, itemId, name) => {
    await f.connection.dispatch([{ type: "widget_action", widgetId: 149 << 16, groupId: 149, childId: 0, buttonNum: op(itemId, name), slot, itemId }]);
    f.connection.processTurnPackets();
  };
  const f = actor(t);
  f.p.getInventory().setItem(2, new core.Item(SHRIMP, 1));
  f.p.setHitpoints(40);
  talk(f, 1312);
  await finish(f);
  tick(f);
  await click(f, 0, CARD, "Read");
  assert.equal(shownText(f), "", "the card's Read does nothing");
  await click(f, 2, SHRIMP, "Eat");
  assert.equal(f.p.getInventory().getAmount(SHRIMP), 1, "the shrimp is not eaten");
  for (let i = 0; i < 12; i++) tick(f);
  await click(f, 2, SHRIMP, "Eat");
  assert.equal(f.p.getInventory().getAmount(SHRIMP), 0, "afterwards it is");
});

test("during the drink only the open interfaces take clicks", async (t) => {
  const cache = core.CacheDefinitions;
  const at = (name) => { const id = cache.getComponentId(name); return { groupId: id >>> 16, childId: id & 0xffff, widgetId: id }; };
  const group = (name, childId = 1) => { const groupId = cache.getInterfaceId(name); return { groupId, childId, widgetId: (groupId << 16) | childId }; };
  const taken = (p, button, buttonNum = 1) => {
    const event = { player: p, packet: { type: "widget_action", buttonNum, slot: -1, ...button }, handled: false };
    PM.emitCustomEvent("player:widget-action", event);
    return event.handled;
  };
  const open = [
    ...["settings_side", "settings", "music", "questlist", "side_journal", "questjournal", "stats", "skill_guide",
      "skill_guide_v2", "friends", "ignore", "chatchannel_current", "chatchannel_setup", "clans_sidepanel",
      "clans_guest_sidepanel", "chatbox", "reportabuse", "worldmap", "quickprayer", "toplevel", "toplevel_osrs_stretch",
      "toplevel_pre_eoc", "toplevel_osm"].map((name) => [name, group(name)]),
    ...["orbs:worldmap", "orbs_nomap:worldmap", "orbs_osm:worldmap"].map((name) => [name, at(name)]),
  ];
  const held = [
    ["the inventory", group("inventory", 0)],
    ["the equipment stats", group("wornitems", 1)],
    ["the autocast spells", group("autocast", 1)],
    ["the account tab", group("account")],
    ["the Hitpoints orb", at("orbs:healthbutton")],
  ];
  for (const [, button] of [...open, ...held]) assert.ok(Number.isInteger(button.groupId) && button.groupId > 0);
  const prayerOrbs = ["orbs:prayerbutton", "orbs_osm:prayerbutton"].map(at);
  const specialOrbs = ["orbs:specbutton", "orbs_nomap:specbutton", "orbs_osm:specbutton", "orbs_osm_nomap:specbutton"].map(at);
  for (const orb of [...prayerOrbs, ...specialOrbs]) assert.ok(Number.isInteger(orb.groupId) && orb.groupId > 0);
  const f = actor(t);
  const other = actor(t);
  talk(f, 1312);
  await finish(f);
  tick(f);
  for (const [name, button] of open) assert.equal(taken(f.p, button), false, `${name} stays open`);
  for (const orb of prayerOrbs) assert.equal(taken(f.p, orb, 2), false, `the quick-prayer orb ${orb.widgetId}'s Setup stays open`);
  for (const orb of specialOrbs) {
    assert.equal(taken(f.p, orb, 1), false, `the special attack orb ${orb.widgetId} turns the special on or off`);
    assert.equal(taken(f.p, orb, 2), true, `the special attack orb ${orb.widgetId}'s offhand option is held`);
  }
  for (const [name, button] of held) {
    assert.equal(taken(f.p, button), true, `${name} is held`);
    assert.equal(taken(other.p, button), false, `${name} is open to a player not drinking`);
  }
  for (const orb of prayerOrbs) assert.equal(taken(f.p, orb, 1), true, `the quick-prayer orb ${orb.widgetId} is held`);
  for (let i = 0; i < 12; i++) tick(f);
  for (const [name, button] of held) assert.equal(taken(f.p, button), false, `${name} is open after the drink`);
});

test("the drink delays the player's run energy until its last step; Prayer drain and restores go on", async (t) => {
  const P = core.PrayerHandler;
  const f = actor(t, { level: 70 });
  const start = core.World.processCycle;
  t.after(() => { core.World.processCycle = start; });
  f.p.setRunEnergyUnits(5000);
  f.p.getSkillManager().setCurrentLevel(Skill.STRENGTH, 60);
  P.activatePrayerPrayerId(f.p, P.PROTECT_FROM_MELEE);
  talk(f, 6531); // Fire Toad Blast: its last step on tick 8, no stat drops
  await finish(f);
  f.p.statRestoreDue = core.World.processCycle + 3; // a restore that comes due during the drink
  const prayer = level(f, "PRAYER");
  for (let i = 1; i < 8; i++) {
    core.World.processCycle = start + i;
    f.p.process();
  }
  assert.equal(f.p.getRunEnergyUnits(), 5000, "no run energy back");
  // osrs-docs (Timers): prayer draining and stat replenishment are soft timers, which run regardless.
  assert.ok(level(f, "PRAYER") < prayer, "Prayer drains");
  assert.equal(level(f, "STRENGTH"), 61, "the restore that came due happens on its tick");
  core.World.processCycle = start + 8;
  f.p.process();
  assert.ok(f.p.getRunEnergyUnits() > 5000, "run energy comes back on the last step's tick");
});

test("a death during the Rising Sun's sway stops the sway", async (t) => {
  const f = actor(t);
  talk(f, 1317);
  await finish(f);
  for (let i = 0; i < 7; i++) tick(f);
  assert.ok(f.seen.includes("6 shake 0,0,15,2"), "swaying");
  f.p.setHitpoints(0);
  for (let i = 0; i < 10; i++) tick(f);
  assert.ok(f.seen.some((line) => line.endsWith(" shake 0,0,0,0")), "stopped");
});

test("a stat drop is a share of the level on its own tick", async (t) => {
  const f = actor(t, { level: 99 });
  talk(f, 1320); // Fire Brandy: 5 + 10% on tick 7
  await finish(f);
  for (let i = 0; i < 3; i++) tick(f);
  f.p.getSkillManager().setCurrentLevels(Skill.ATTACK, 40);
  for (let i = 0; i < 7; i++) tick(f);
  assert.equal(level(f, "ATTACK"), 40 - 5 - 4);
});


/** Each bar's menu while it offers the drink: the option's words and place, as the Wiki's transcript has them. */
const MENUS = {
  1312: [4, "I'm doing Alfred Grimhand's Barcrawl."],
  1314: [4, "I'm doing Alfred Grimhand's Barcrawl."],
  1320: [4, "I'm doing Alfred Grimhand's Barcrawl."],
  1319: [3, "I'm doing Alfred Grimhand's Barcrawl."],
  1318: [3, "I'm doing Alfred Grimhand's Barcrawl."],
  1310: [4, "I'm doing Alfred Grimhands Barcrawl."],
  13655: [3, "I'm doing Alfred Grimhand's barcrawl."],
  1317: [2, "I'm doing Alfred Grimhand's barcrawl."],
  1313: [3, "I'm doing Alfred Grimhand's Barcrawl."],
};

for (const [npcId, [place, text]] of Object.entries(MENUS)) {
  test(`bar NPC ${npcId}: the menu offers the Barcrawl only while the bar is unsigned with the card held`, async (t) => {
    const f = actor(t);
    const shown = await firstMenu(f, Number(npcId));
    assert.equal(shown?.[place - 1], text, `option ${place} of ${shown}`);
    assert.equal(shown.filter((option) => /barcrawl/i.test(option)).length, 1);

    if (Number(npcId) === 1317) return; // the Rising Sun's own menu: see its tests
    const rest = shown.filter((option) => !/barcrawl/i.test(option));
    const done = actor(t);
    done.p.setAttribute("alfred-grimhands-barcrawl:bars", 1023);
    assert.deepEqual(await firstMenu(done, Number(npcId)), rest, "signed: the usual menu without it");

    const cardless = actor(t);
    cardless.p.getInventory().setItem(0, new core.Item(-1, 0));
    assert.deepEqual(await firstMenu(cardless, Number(npcId)), rest, "no card: the usual menu without it");
  });
}

test("Zembo's greeting goes straight to his menu, without an empty line", async (t) => {
  const f = actor(t);
  f.seen.length = 0;
  const shown = await firstMenu(f, 13655);
  assert.ok(shown?.length, "his menu");
  assert.deepEqual(f.seen.filter((line) => line.split(" ")[1] === "game"), [], "no game message before it");
});

test("the Blurberry Bar's barman points to Blurberry only while Blurberry offers the drink", async (t) => {
  const option = "I'm trying to do Alfred Grimhand's barcrawl.";
  const f = actor(t);
  assert.ok((await firstMenu(f, 6532))?.includes(option), "card held, Blurberry unsigned");
  const done = actor(t);
  done.p.setAttribute("alfred-grimhands-barcrawl:bars", 2);
  const signedMenu = await firstMenu(done, 6532);
  assert.ok(signedMenu?.length && !signedMenu.includes(option), `Blurberry signed: ${signedMenu}`);
  const cardless = actor(t);
  cardless.p.getInventory().setItem(0, new core.Item(-1, 0));
  const cardlessMenu = await firstMenu(cardless, 6532);
  assert.ok(cardlessMenu?.length && !cardlessMenu.includes(option), `no card: ${cardlessMenu}`);
});

test("Blurberry and the Rising Sun go straight to the Barcrawl only while they offer the drink", async (t) => {
  const f = actor(t);
  talk(f, 6531);
  assert.equal(shownText(f), "I'm doing Alfred Grimhand's Barcrawl.");
  const sun = actor(t);
  talk(sun, 1317);
  assert.equal(shownText(sun), "Heya! What can I get you?");
  for (const npcId of [6531, 1317]) {
    const done = actor(t);
    done.p.setAttribute("alfred-grimhands-barcrawl:bars", 1023);
    const cardless = actor(t);
    cardless.p.getInventory().setItem(0, new core.Item(-1, 0));
    for (const [who, g] of [["signed", done], ["no card", cardless]]) {
      const shown = await firstMenu(g, npcId);
      assert.ok(shown, `${npcId} ${who}: the usual talk's menu`);
      assert.ok(!shown?.some((option) => /barcrawl/i.test(option)), `${npcId} ${who}: no Barcrawl option in ${shown}`);
    }
  }
});

test("without the coins, the price line's continue gets the bar's decline", async (t) => {
  const f = actor(t, { coins: 10 });
  await firstMenu(f, 1312);
  const index = menu(f).findIndex((text) => /barcrawl/i.test(text));
  await f.connection.dispatch([{ type: "dialogue_continue", widgetId: core.MultiChatboxPrompt.OPTIONS_WIDGET_ID, childIndex: index + 1 }]);
  f.connection.processTurnPackets();
  const said = [];
  for (let i = 0; i < 6 && f.p.getDialogueManager().getCurrent(); i++) {
    said.push(shownText(f));
    const group = f.p.getPacketSender().getChatboxGroupId();
    const widgetId = (group << 16) | ([231, 217].includes(group) ? 5 : group === 229 ? 4 : 0);
    await f.connection.dispatch([{ type: "dialogue_continue", widgetId, childIndex: -1 }]);
    f.connection.processTurnPackets();
  }
  assert.equal(said.at(-1), "I don't have 50 coins.");
  assert.equal(coins(f), 10);
});

test("the Rising Sun's 'What ales are you serving?' plays the barmaid's ales talk", async (t) => {
  for (const npcId of [1317, 1315, 1316]) {
    const f = actor(t);
    const shown = await firstMenu(f, npcId);
    assert.deepEqual(shown, ["What ales are you serving?", "I'm doing Alfred Grimhand's barcrawl."], `NPC ${npcId}`);
    await f.connection.dispatch([{ type: "dialogue_continue", widgetId: core.MultiChatboxPrompt.OPTIONS_WIDGET_ID, childIndex: 1 }]);
    f.connection.processTurnPackets();
    const said = [];
    for (let i = 0; i < 3 && !menu(f); i++) {
      said.push(shownText(f));
      const group = f.p.getPacketSender().getChatboxGroupId();
      const widgetId = (group << 16) | ([231, 217].includes(group) ? 5 : group === 229 ? 4 : 0);
      await f.connection.dispatch([{ type: "dialogue_continue", widgetId, childIndex: -1 }]);
      f.connection.processTurnPackets();
    }
    assert.deepEqual(said.slice(0, 2), ["What ales are you serving?", "Well, we've got Asgarnian Ale, Wizard's Mind Bomb and Dwarven Stout, all for only 3 coins."], `NPC ${npcId}`);
    assert.ok(menu(f)?.includes("One Asgarnian Ale, please."), `NPC ${npcId}: the ales menu`);
  }
});

/** Uses the Barcrawl card on the NPC; returns whether a plugin took it. */
function useCard(f, npcId) {
  const npc = core.NPC.create(npcId, new core.Location(3225, 3399, 0));
  return PM.emitItemOnNpc({
    player: f.p, target: npc, npcId, targetIndex: 0, item: new core.Item(CARD, 1), definition: npc.getCurrentDefinition(f.p),
  });
}

test("using the card on a bartender starts the Barcrawl while the bar offers it", async (t) => {
  const f = actor(t);
  assert.equal(useCard(f, 1312), true);
  assert.equal(shownText(f), "I'm doing Alfred Grimhand's Barcrawl.");
  await finish(f);
  assert.equal(coins(f), 208 - 50, "and buys the drink");

  const done = actor(t);
  done.p.setAttribute("alfred-grimhands-barcrawl:bars", 1023);
  assert.equal(useCard(done, 1312), true, "a signed bar");
  assert.deepEqual(done.seen, ["0 game Nothing interesting happens."], "answers as for an item with no use (Wiki)");
  assert.equal(shownText(done), "", "and no conversation starts");
  assert.equal(useCard(done, 1317), true, "a Rising Sun barmaid");
  assert.equal(shownText(done), "No thanks, I don't need that.", "answers as her transcripts do for any other item");
});

test("after the crawl, a card taken to a bar starts it over", async (t) => {
  const barcrawl = QuestRuntime.questNamed("Alfred Grimhand's Barcrawl");
  const f = actor(t);
  barcrawl.setStage(f.p, 2);
  f.p.setAttribute("alfred-grimhands-barcrawl:bars", 1023);
  const shown = await firstMenu(f, 1312);
  assert.ok(shown?.includes("I'm doing Alfred Grimhand's Barcrawl."), `the Barcrawl option: ${shown}`);
  talk(f, 1312);
  await finish(f);
  assert.equal(barcrawl.getStage(f.p), 1, "the crawl starts over");
  for (let i = 0; i < 13; i++) tick(f);
  assert.equal(signed(f), 1, "with only this bar signed");
  const cardless = actor(t);
  barcrawl.setStage(cardless.p, 2);
  cardless.p.getInventory().setItem(0, new core.Item(-1, 0));
  assert.ok(!(await firstMenu(cardless, 1312))?.some((option) => /barcrawl/i.test(option)), "no card, no option");
});

test("after a restart, the vial smashing setting stays open only once Scorpion Catcher is done, as the cache's lock", async (t) => {
  const barcrawl = QuestRuntime.questNamed("Alfred Grimhand's Barcrawl");
  const scorpion = QuestRuntime.questNamed("Scorpion Catcher");
  const AUTO_SMASH = "alfred-grimhands-barcrawl:auto-smash";
  const click = (f) => {
    const request = { player: f.p, settingId: 380, handled: false };
    PM.emitCustomEvent("settings:setting-clicked", request);
    return request.handled;
  };
  for (const scorpionDone of [false, true]) {
    const f = actor(t);
    barcrawl.setStage(f.p, 2);
    if (scorpionDone) scorpion.setStage(f.p, 4);
    f.p.setAttribute(AUTO_SMASH, true);
    talk(f, 1312);
    await finish(f);
    assert.equal(barcrawl.getStage(f.p), 1, "the crawl starts over");
    for (let i = 0; i < 13; i++) tick(f);
    f.seen.length = 0;
    assert.equal(click(f), true);
    if (scorpionDone) {
      assert.equal(f.p.getAttribute(AUTO_SMASH), false, "with Scorpion Catcher done the row turns smashing off");
      assert.deepEqual(f.seen, []);
    } else {
      assert.equal(f.p.getAttribute(AUTO_SMASH), true, "without it the row stays locked");
      assert.deepEqual(f.seen, ["13 game You must have completed the Alfred Grimhand's Barcrawl miniquest to access this setting."]);
    }
  }
});

test("using the card on a Rising Sun barmaid opens her menu without the greeting", async (t) => {
  const f = actor(t);
  assert.equal(useCard(f, 1316), true);
  assert.deepEqual(menu(f), ["What ales are you serving?", "I'm doing Alfred Grimhand's barcrawl."]);
});

test("using the card on the Blurberry Bar's barman points to Blurberry", async (t) => {
  const f = actor(t);
  assert.equal(useCard(f, 6532), true);
  assert.equal(shownText(f), "I'm trying to do Alfred Grimhand's barcrawl.");

  const done = actor(t);
  done.p.setAttribute("alfred-grimhands-barcrawl:bars", 1 << 1); // Blurberry signed
  assert.equal(useCard(done, 6532), true);
  assert.equal(shownText(done), "", "signed: no pointer");
  assert.deepEqual(done.seen, ["0 game Nothing interesting happens."]);
});

test("during Recipe for Disaster's Golden Nectar, the barmaid's menu has all three options", async (t) => {
  const rfd = QuestRuntime.questNamed("Recipe for Disaster");
  const f = actor(t);
  rfd.setStage(f.p, 4);
  assert.deepEqual(await firstMenu(f, 1317),
    ["What ales are you serving?", "I'm doing Alfred Grimhand's barcrawl.", "What can you tell me about dwarves and ale?"]);
  const cardless = actor(t);
  rfd.setStage(cardless.p, 4);
  cardless.p.getInventory().setItem(0, new core.Item(-1, 0));
  assert.deepEqual(await firstMenu(cardless, 1317), ["What ales are you serving?", "What can you tell me about dwarves and ale?"]);
  const carded = actor(t);
  rfd.setStage(carded.p, 4);
  assert.equal(useCard(carded, 1317), true);
  assert.deepEqual(menu(carded), ["What ales are you serving?", "I'm doing Alfred Grimhand's barcrawl."],
    "the card opens the Barcrawl's menu (ours: no source covers card use in that step)");
  const three = ["What ales are you serving?", "I'm doing Alfred Grimhand's barcrawl.", "What can you tell me about dwarves and ale?"];
  // The Mountain Dwarf freed, after asking a barmaid about the secret (16) or without asking (0).
  for (const state of [16, 0]) {
    const freed = actor(t);
    rfd.setStage(freed.p, 4);
    freed.p.setAttribute("recipe-for-disaster:rescues", 1); // the Golden Nectar is over
    freed.p.setAttribute("recipe-for-disaster:dwarf-state", state);
    assert.deepEqual(await firstMenu(freed, 1317), three, "after the dwarf step the option stays (rsprox 3241, 1636)");
    await freed.connection.dispatch([{ type: "dialogue_continue", widgetId: core.MultiChatboxPrompt.OPTIONS_WIDGET_ID, childIndex: 3 }]);
    freed.connection.processTurnPackets();
    for (let i = 0; i < 3 && !/again/.test(shownText(freed)); i++) {
      const group = freed.p.getPacketSender().getChatboxGroupId();
      await freed.connection.dispatch([{ type: "dialogue_continue", widgetId: (group << 16) | ([231, 217].includes(group) ? 5 : group === 229 ? 4 : 0), childIndex: -1 }]);
      freed.connection.processTurnPackets();
    }
    assert.match(shownText(freed), /Oh it's you again\. Forgotten the secret already\?/, `dwarf-state ${state}: the "again" talk`);
    for (let i = 0; i < 6 && freed.p.getDialogueManager().getCurrent(); i++) {
      assert.equal(menu(freed), null, `dwarf-state ${state}: no offer to buy the secret`);
      const group = freed.p.getPacketSender().getChatboxGroupId();
      await freed.connection.dispatch([{ type: "dialogue_continue", widgetId: (group << 16) | ([231, 217].includes(group) ? 5 : group === 229 ? 4 : 0), childIndex: -1 }]);
      freed.connection.processTurnPackets();
    }
    assert.ok(!freed.p.getDialogueManager().getCurrent() && !menu(freed), `dwarf-state ${state}: the talk ends`);
    assert.equal(coins(freed), 208, `dwarf-state ${state}: no coins taken`);
  }
  const before = actor(t);
  assert.deepEqual(await firstMenu(before, 1317), ["What ales are you serving?", "I'm doing Alfred Grimhand's barcrawl."],
    "before Recipe for Disaster's dwarf step, two options");
});

// Last: it fires every plugin's shutdown hooks.
test("a server shutdown mid-drink loses the rest of it, as in Lost City", async (t) => {
  const f = actor(t);
  talk(f, 1312);
  await finish(f);
  for (let i = 0; i < 3; i++) tick(f);
  PM.emitServerShutdown({ timestamp: Date.now() });
  shutDown = true;
  assert.equal(signed(f), 0, "not signed");
  assert.equal(level(f, "ATTACK"), LEVEL, "no drops");
  assert.equal(coins(f), 208 - 50, "the coins went with the price line");
});
