// Run after `yarn build`: node --test tests/kathy-corkat-boat.test.cjs
// Kathy Corkat's boat between the Tree Gnome Stronghold and the Piscatoris Fishing Colony
// (plugins/world/ferries/Kathy.Ferries.js). Real engine: every plugin loaded, a real Player, real
// dialogue packets. No client ran.
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
const QuestRuntime = require("../plugins/quests/QuestRuntime");
const DIALOGUES = require("../data/definitions/npc-dialogues.json");

/** The spawns (npc-spawns.json): the Stronghold multi-NPC and the Piscatoris form. */
const STRONGHOLD = { id: 6207, at: [2368, 3486, 0], stand: [2367, 3485, 0] };
const PISCATORIS = { id: 4299, at: [2357, 3640, 0], stand: [2356, 3639, 0] };
const NORTH_LANDING = [2357, 3641, 0];
const SOUTH_LANDING = [2368, 3486, 0];
const NORTH_TEXT = "Kathy Corkat rows you down the river to the sea...";
const SOUTH_TEXT = "Kathy Corkat rows you up the river...";
const MESSAGE_BOX = 229;
const FADE_OVERLAY = 174;
const CONTINUE_UID = (MESSAGE_BOX << 16) | 4;
const COINS = 995;
const RING_OF_CHAROS_A = 6465;

let core;
let quest;
let next = 9900;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PM.getCoreApi();
  core.RegionManager.init();
  PM.emitServerStartup({});
  core.RegionManager.loadMapFiles(STRONGHOLD.at[0], STRONGHOLD.at[1]);
  core.RegionManager.loadMapFiles(PISCATORIS.at[0], PISCATORIS.at[1]);
  quest = QuestRuntime.questNamed("Swan Song");
});
after(() => PM.emitServerShutdown({}));

/** `stage`: Swan Song's stage, or "complete". */
function actor(t, { dock = STRONGHOLD, stage = 0, coins = 200, ring = false } = {}) {
  const channel = {
    kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true,
    close() {}, onData() {}, onError() {}, onClose() {},
  };
  const p = new Player(new PlayerSession(channel));
  p.setIndex(next++);
  p.setUsername("kathyqa" + p.getIndex());
  p.setRegistered(true);
  p.setAttribute("bot-skip-persistence", true);
  p.setLocation(new core.Location(...dock.stand));
  p.needsPlacement = false;
  if (stage === "complete") quest.complete(p, { scroll: false, announce: false });
  else if (stage) quest.setStage(p, stage);
  for (let slot = 0; slot < 28; slot++) p.getInventory().setItem(slot, new core.Item(-1, 0));
  if (coins) p.getInventory().setItem(0, new core.Item(COINS, coins));
  if (ring) p.getEquipment().setItem(core.Equipment.RING_SLOT, new core.Item(RING_OF_CHAROS_A, 1));
  const connection = new ClientConnection(channel);
  connection.player = p;
  const messages = [];
  const sender = p.getPacketSender();
  t.mock.method(sender, "sendMessage", (message) => {
    messages.push(message);
    return sender;
  });
  // The fade overlay's mounts (fade out, fade in), by trip tick (`clock`, advanced by trip()).
  const f = { p, connection, messages, dock, clock: 0, fades: [] };
  const mount = sender.mountSubInterface.bind(sender);
  t.mock.method(sender, "mountSubInterface", (target, group, ...rest) => {
    if (group === FADE_OVERLAY) f.fades.push({ tick: f.clock, args: rest[1]?.postScripts?.[0]?.args });
    return mount(target, group, ...rest);
  });
  t.after(() => {
    PM.emitPlayerLogout({ player: p, username: p.getUsername() });
    p.setRegistered(false);
    core.TaskManager.cancelTasks(p.getIndex());
    core.TaskManager.cancelTasks(p);
  });
  return f;
}

const coinsOf = (f) => f.p.getInventory().getAmount(COINS);
const at = (f) => [f.p.getLocation().getX(), f.p.getLocation().getY(), f.p.getLocation().getZ()];
const talking = (f) => Boolean(f.p.getDialogueManager().getCurrent());
const shownText = (f) => {
  const entry = f.p.getDialogueManager().getCurrent();
  return String(entry?.getText?.() ?? entry?.text ?? "");
};
const chatbox = (f) => f.p.getPacketSender().getChatboxGroupId();
/** The message box is open, without its continue. */
const heldBox = (f) => chatbox(f) === MESSAGE_BOX && f.p.getPacketSender().isChatboxPauseOff(CONTINUE_UID);

async function tick(f) {
  f.connection.processTurnPackets();
  for (let i = 0; i < 4; i++) core.TaskManager.process();
}

function npcFor(f) {
  return core.NPC.create(f.dock.id, new core.Location(...f.dock.at));
}

function options(f, npc = npcFor(f)) {
  return npc.getCurrentDefinition(f.p).getActions().filter(Boolean);
}

function click(f, option) {
  const npc = npcFor(f);
  const definition = npc.getCurrentDefinition(f.p);
  return PM.emitNpcInteraction({
    player: f.p, npc, npcId: npc.getContentId(f.p), definition,
    clickType: definition.getActions().indexOf(option) + 1, handled: false,
  });
}

function continuePacket(f, choice) {
  const group = chatbox(f);
  return {
    type: "dialogue_continue",
    widgetId: choice == null ? (group << 16) | ([231, 217].includes(group) ? 5 : 0) : core.MultiChatboxPrompt.OPTIONS_WIDGET_ID,
    childIndex: choice ?? -1,
  };
}

/** Sends the packet and handles it, with no game tick after it. */
async function send(f, choice) {
  await f.connection.dispatch([continuePacket(f, choice)]);
  f.connection.processTurnPackets();
}

const menu = (f) => core.MultiChatboxPrompt.getPending(f.p)?.options ?? null;

/** Continues until the menu with `text` shows, then picks it (no tick after the pick). */
async function choose(f, text) {
  for (let i = 0; i < 12; i++) {
    const shown = menu(f);
    if (shown?.includes(text)) return send(f, shown.indexOf(text) + 1);
    assert.ok(talking(f) || shown, `still talking before "${text}" (${shownText(f)})`);
    if (shown) assert.fail(`"${text}" not in ${shown}`);
    await send(f);
    await tick(f);
  }
  return assert.fail(`no menu with "${text}"`);
}

/** Continues until the menu shows; its options. */
async function menuAfterTalk(f) {
  for (let i = 0; i < 12 && !menu(f); i++) {
    await send(f);
    await tick(f);
  }
  return menu(f);
}

/**
 * Runs game ticks one by one, counting on from the trip's click (tick 0): where the player is after each,
 * whether the box shows and still lacks its continue, and whether the fade overlay is open.
 */
function trip(f, ticks = 9) {
  const seen = [];
  for (let i = 1; i <= ticks; i++) {
    f.clock += 1;
    core.TaskManager.process();
    seen.push({
      tick: f.clock, at: at(f).join(","), box: chatbox(f) === MESSAGE_BOX, held: heldBox(f),
      overlay: f.p.getPacketSender().isSubInterfaceOpen(FADE_OVERLAY),
    });
  }
  return seen;
}

/** The fade: out on the click, back in on tick 5, the overlay open until tick 7. */
function assertFade(f, seen) {
  assert.deepEqual(f.fades, [{ tick: 0, args: [0, 255, 0, 0, 50] }, { tick: 5, args: [0, 0, 0, 255, 50] }]);
  assert.equal(firstTick(seen, (s) => !s.overlay), 7, `the overlay closes on tick 7 (${JSON.stringify(seen)})`);
}

function firstTick(seen, predicate) {
  return seen.find(predicate)?.tick;
}

test("the Stronghold Kathy shows Travel only from Swan Song's start; the Piscatoris one always has it", (t) => {
  assert.deepEqual(options(actor(t)), ["Talk-to"]);
  assert.deepEqual(options(actor(t, { stage: 5 })), ["Talk-to", "Travel"]);
  assert.deepEqual(options(actor(t, { dock: PISCATORIS })), ["Talk-to", "Travel"]);
});

test("before Swan Song's start: 50 coins on \"Alright, I'll pay.\", then the box and the fade to Piscatoris", async (t) => {
  const f = actor(t);
  click(f, "Talk-to");
  await tick(f);
  assert.equal(shownText(f), "Oh dear, oh dear, oh dear...");
  assert.deepEqual(await menuAfterTalk(f), ["Can you take me downstream in your boat?", "I don't think I want anything, thanks."]);
  await send(f, 1);
  await tick(f);
  await choose(f, "I'm not afraid - let's go!");
  await tick(f);
  assert.deepEqual(await menuAfterTalk(f), ["Alright, I'll pay.", "Not a chance!"], "no charm option without the ring");
  await choose(f, "Alright, I'll pay.");
  await send(f);
  f.connection.processTurnPackets();
  assert.equal(coinsOf(f), 150);
  assert.equal(heldBox(f), true, "the box shows without its continue");
  assert.equal(shownText(f), "");
  const seen = trip(f);
  assert.equal(firstTick(seen, (s) => s.at === NORTH_LANDING.join(",")), 3, JSON.stringify(seen));
  assert.equal(firstTick(seen, (s) => s.box && !s.held), 8, `the continue on tick 8 (${JSON.stringify(seen)})`);
  assert.ok(seen.every((s) => s.box), "the box stays open throughout");
  assertFade(f, seen);
  assert.deepEqual(f.messages, [], "no game message");
  assert.equal(shownText(f), NORTH_TEXT);
  await send(f);
  assert.equal(chatbox(f), -1, "the continue closes it");
});

test("without 50 coins she says so instead of the fare's menu, and nothing happens", async (t) => {
  const f = actor(t, { coins: 49 });
  click(f, "Talk-to");
  await tick(f);
  await choose(f, "Can you take me downstream in your boat?");
  await tick(f);
  await choose(f, "I'm not afraid - let's go!");
  await tick(f);
  const lines = [];
  for (let i = 0; i < 10 && talking(f); i++) {
    assert.equal(menu(f), null, "no menu");
    lines.push(shownText(f));
    await send(f);
    await tick(f);
  }
  assert.deepEqual(lines.slice(-3), [
    "Ooh, that's better! I'll take you up north for 50 shiny coins.",
    "I haven't got that much with me.",
    "Ooh, and you almost had me persuaded!",
  ]);
  for (let i = 0; i < 10; i++) core.TaskManager.process();
  assert.equal(coinsOf(f), 49);
  assert.deepEqual(at(f), STRONGHOLD.stand);
});

test("with a Ring of Charos(a) worn, the charm option rows for free", async (t) => {
  const f = actor(t, { ring: true });
  click(f, "Talk-to");
  await tick(f);
  await choose(f, "Can you take me downstream in your boat?");
  await tick(f);
  await choose(f, "I'm not afraid - let's go!");
  await tick(f);
  assert.deepEqual(await menuAfterTalk(f), ["Alright, I'll pay.", "Not a chance!", "[Charm] A lady this beautiful shouldn't be so afraid!"]);
  await choose(f, "[Charm] A lady this beautiful shouldn't be so afraid!");
  await tick(f);
  const lines = [];
  for (let i = 0; i < 4 && !heldBox(f); i++) {
    lines.push(shownText(f));
    await send(f);
    f.connection.processTurnPackets();
  }
  assert.deepEqual(lines, ["A lady this beautiful shouldn't be so afraid!", "Oooh, you shouldn't tease a poor girl so! But I'll take you downstream if you like!"]);
  assert.equal(heldBox(f), true);
  trip(f);
  assert.deepEqual(at(f), NORTH_LANDING);
  assert.equal(coinsOf(f), 200, "free");
});

test("with a Ring of Charos(a) and fewer than 50 coins the menu still shows: the charm rows free, paying gets her two lines", async (t) => {
  for (const pick of ["[Charm] A lady this beautiful shouldn't be so afraid!", "Alright, I'll pay."]) {
    const f = actor(t, { ring: true, coins: 10 });
    click(f, "Talk-to");
    await tick(f);
    await choose(f, "Can you take me downstream in your boat?");
    await tick(f);
    await choose(f, "I'm not afraid - let's go!");
    await tick(f);
    assert.deepEqual(await menuAfterTalk(f), ["Alright, I'll pay.", "Not a chance!", "[Charm] A lady this beautiful shouldn't be so afraid!"]);
    await choose(f, pick);
    const lines = [];
    for (let i = 0; i < 5 && talking(f) && !heldBox(f); i++) {
      lines.push(shownText(f));
      await send(f);
    }
    trip(f, 10);
    if (pick === "Alright, I'll pay.") {
      assert.deepEqual(lines, ["Alright, I'll pay.", "I haven't got that much with me.", "Ooh, and you almost had me persuaded!"]);
      assert.deepEqual(at(f), STRONGHOLD.stand);
    } else {
      assert.deepEqual(at(f), NORTH_LANDING);
    }
    assert.equal(coinsOf(f), 10);
  }
});

test("a conversation started during the fade does not row or charge once the trip has landed", async (t) => {
  const f = actor(t);
  await payWithoutTicks(f);
  assert.equal(coinsOf(f), 150);
  trip(f, 1);
  click(f, "Talk-to");
  f.connection.processTurnPackets();
  assert.equal(shownText(f), "Oh dear, oh dear, oh dear...", "NPC clicks still work during the fade");
  trip(f, 5);
  assert.deepEqual(at(f), NORTH_LANDING);
  await payAgain(f);
  assert.equal(coinsOf(f), 150, "no second fare");
  assert.equal(chatbox(f), -1, "the conversation ends");
  trip(f, 9);
  assert.deepEqual(at(f), NORTH_LANDING);
});

test("from Swan Song's start the Stronghold trip is free, with her after-quest talk", async (t) => {
  for (const stage of [5, "complete"]) {
    const f = actor(t, { stage });
    click(f, "Talk-to");
    await tick(f);
    assert.equal(shownText(f), "Hello dearie. Heading up north to the Fishing Colony, are we?", `stage ${stage}`);
    await choose(f, "Yes please.");
    await send(f);
    assert.equal(heldBox(f), true);
    trip(f);
    assert.deepEqual(at(f), NORTH_LANDING);
    assert.equal(coinsOf(f), 200);
  }
});

test("the Piscatoris Kathy rows back up the river for free, before and after Swan Song's start", async (t) => {
  for (const [stage, first] of [
    [0, "I'll be glad to get away from this place, dearie! Fancy a lift up the river?"],
    [5, "Are ye wantin' a lift up the river, dearie?"],
    ["complete", "Are ye wantin' a lift up the river, dearie?"],
  ]) {
    const f = actor(t, { dock: PISCATORIS, stage });
    click(f, "Talk-to");
    await tick(f);
    assert.equal(shownText(f), first);
    await choose(f, "Yes please.");
    assert.equal(shownText(f), "Yes please.");
    await send(f);
    assert.equal(heldBox(f), true);
    const seen = trip(f);
    assert.equal(firstTick(seen, (s) => s.at === SOUTH_LANDING.join(",")), 3);
    assert.equal(firstTick(seen, (s) => s.box && !s.held), 8, "the continue on tick 8");
    assertFade(f, seen);
    assert.equal(shownText(f), SOUTH_TEXT);
    assert.equal(coinsOf(f), 200);
  }
});

test("after Swan Song, \"Why don't you row right into the Colony?\" comes back to her menu without a trip", async (t) => {
  const f = actor(t, { dock: PISCATORIS, stage: "complete" });
  click(f, "Talk-to");
  await tick(f);
  await choose(f, "Why don't you row right into the Colony?");
  await tick(f);
  const lines = [];
  for (let i = 0; i < 4 && !menu(f); i++) {
    lines.push(shownText(f));
    await send(f);
    await tick(f);
  }
  assert.deepEqual(lines, [
    "Why don't you row right into the Colony? It'd make it much easier to get in there.",
    "Oh, Franklin doesn't like it if I take my boat too close. He says I'll damage the nets and scare the fish. But were you wanting a lift up to the river?",
  ]);
  assert.deepEqual(menu(f), ["Why don't you row right into the Colony?", "Yes please.", "No thanks."]);
  assert.deepEqual(at(f), PISCATORIS.stand);
});

test("Travel is free and rows at once", async (t) => {
  for (const [dock, stage, coins, landing, left] of [
    [STRONGHOLD, 5, 200, NORTH_LANDING, 200],
    [STRONGHOLD, "complete", 0, NORTH_LANDING, 0],
    [PISCATORIS, 0, 0, SOUTH_LANDING, 0],
  ]) {
    const f = actor(t, { dock, stage, coins });
    click(f, "Travel");
    f.connection.processTurnPackets();
    assert.equal(heldBox(f), true, "straight to the trip");
    trip(f);
    assert.deepEqual(at(f), landing);
    assert.equal(coinsOf(f), left);
  }
});

/** In the open conversation with the Stronghold Kathy before the quest's start: on to "Alright, I'll pay." and past it, with no tick. */
async function payAgain(f) {
  for (const pick of ["Can you take me downstream in your boat?", "I'm not afraid - let's go!", "Alright, I'll pay."]) {
    for (let i = 0; i < 12 && !(menu(f) ?? []).includes(pick); i++) await send(f);
    await send(f, menu(f).indexOf(pick) + 1);
  }
  await send(f);
}

/** Talk-to at the Stronghold Kathy before the quest's start, on to "Alright, I'll pay." and past it, with no tick. */
async function payWithoutTicks(f) {
  click({ ...f, dock: STRONGHOLD }, "Talk-to");
  f.connection.processTurnPackets();
  await payAgain(f);
}

test("paying while a trip is still under way takes nothing and starts no second trip", async (t) => {
  const f = actor(t, { dock: PISCATORIS });
  click(f, "Travel");
  f.connection.processTurnPackets();
  trip(f, 3);
  assert.deepEqual(at(f), SOUTH_LANDING, "landed, the trip not yet over");
  await payWithoutTicks(f);
  assert.equal(coinsOf(f), 200);
  assert.equal(chatbox(f), -1, "the conversation ends");
  trip(f, 10);
  assert.deepEqual(at(f), SOUTH_LANDING);
  assert.equal(coinsOf(f), 200);
});

test("a refused destination takes nothing, on Travel and on \"Alright, I'll pay.\"", async (t) => {
  t.mock.method(core.TeleportHandler, "destinationAllowed", () => false);
  const travel = actor(t, { stage: 5 });
  click(travel, "Travel");
  travel.connection.processTurnPackets();
  assert.equal(chatbox(travel), -1, "no trip");
  const paid = actor(t);
  await payWithoutTicks(paid);
  assert.equal(coinsOf(paid), 200);
  assert.equal(chatbox(paid), -1, "the conversation ends");
  trip(paid, 10);
  assert.deepEqual(at(paid), STRONGHOLD.stand);
  // Positive control: with the mock restored, a player pays.
  t.mock.restoreAll();
  const control = actor(t);
  await payWithoutTicks(control);
  assert.equal(coinsOf(control), 150);
});

test("a conversation started before tick 8 is not moved on by the trip's continue", async (t) => {
  const f = actor(t, { dock: PISCATORIS, stage: "complete" });
  click(f, "Travel");
  f.connection.processTurnPackets();
  trip(f, 6);
  click({ ...f, dock: STRONGHOLD }, "Talk-to");
  f.connection.processTurnPackets();
  assert.equal(shownText(f), "Hello dearie. Heading up north to the Fishing Colony, are we?");
  trip(f, 3);
  assert.equal(shownText(f), "Hello dearie. Heading up north to the Fishing Colony, are we?", "still her first line after tick 8");
  assert.equal(menu(f), null);
});

test("a trip straight back on tick 6 is left alone by the first trip's tick-7 close and tick-8 continue", async (t) => {
  const f = actor(t, { stage: "complete" });
  click(f, "Travel");
  f.connection.processTurnPackets();
  trip(f, 6);
  assert.deepEqual(at(f), NORTH_LANDING);
  click({ ...f, dock: PISCATORIS }, "Travel");
  f.connection.processTurnPackets();
  assert.equal(heldBox(f), true, "the second trip's box");
  const seen = trip(f, 10);
  const on = (tick) => seen.find((s) => s.tick === tick);
  assert.equal(on(7).overlay, true, "the first trip's close leaves the second fade open");
  assert.equal(on(8).held, true, "the first trip's continue leaves the second box without its continue");
  assert.equal(firstTick(seen, (s) => s.at === SOUTH_LANDING.join(",")), 9);
  assert.deepEqual(f.fades.map((fade) => fade.tick), [0, 5, 6, 11]);
  assert.equal(firstTick(seen, (s) => !s.overlay), 13);
  assert.equal(firstTick(seen, (s) => s.box && !s.held), 14);
});

test("walking away after landing closes the box, and it does not come back", async (t) => {
  const f = actor(t, { stage: "complete" });
  click(f, "Travel");
  f.connection.processTurnPackets();
  trip(f, 6);
  assert.deepEqual(at(f), NORTH_LANDING);
  // The world's update cycle, which this test does not run, places a player moved by moveTo.
  f.p.needsPlacement = false;
  await f.connection.dispatch([{ type: "move", worldX: 2355, worldY: 3643, modifierFlags: 0, run: false }]);
  f.connection.processTurnPackets();
  core.TaskManager.processWalkTo(f.p.getIndex());
  f.p.getMovementQueue().process();
  core.TaskManager.process();
  assert.notDeepEqual(at(f), NORTH_LANDING, "walking");
  assert.equal(chatbox(f), -1, "closed by walking (tick 7)");
  trip(f, 3);
  assert.equal(chatbox(f), -1, "the continue tick reopens nothing");
});

test("the step ids the unit answers are the transcript's rowing steps", () => {
  const { Kathy } = require("../plugins/world/Ferries.plugin")._test;
  const text = JSON.stringify(DIALOGUES["Kathy Corkat"]?.variants ?? {});
  for (const [id, words] of [
    [Kathy.STEPS.paid, NORTH_TEXT],
    ...Kathy.STEPS.north.map((id) => [id, NORTH_TEXT]),
    ...Kathy.STEPS.south.map((id) => [id, SOUTH_TEXT]),
  ]) {
    assert.ok(text.includes(`"text":${JSON.stringify(words)},"id":"${id}"`), `${id}: ${words}`);
  }
  for (const dock of Object.values(Kathy.VARIANTS)) {
    for (const variant of Object.values(dock)) assert.ok(DIALOGUES["Kathy Corkat"].variants[variant], variant);
  }
});
