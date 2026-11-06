// Run after `yarn build`: node --test tests/shadow-of-the-storm-rituals.test.cjs
//
// #2577, the chant and what follows it, as rsprox 3333 (rev 235) shows it:
// - t2067-t2089: on each word the player says it overhead with sequence 2879; the cast repeats it.
// - t2055-t2060: the cast and the player face the circle's centre before the first word.
// - t2101-t2104: Denath at the centre plays 2888 and goes.
// - t2126-t2127: the player picks up Denath's sigil at (2720,4900,2), so it is there to be seen.
// - t2119-t2130: Dave, Eric and Tanya walk off and go; the rest stay.
// - t2133-t2139: nothing moves the player until they click the closing portal 10251.
// - t2475-t2483: as Agrith-Naar attacks, the second ritual's cast walk off to parts of the room.
process.env.DISABLE_PLAYER_BOTS = "1";
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, after, test } = require("node:test");
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager: PM } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");
const { ClientConnection } = require("../dist/net/NetworkBuilder");
const { ItemOnGroundManager } = require("../dist/game/entity/impl/grounditem/ItemOnGroundManager");
const { ActionDialogue } = require("../dist/game/model/dialogues/entries/impl/ActionDialogue");
const QuestRuntime = require("../plugins/quests/QuestRuntime");

const RITUAL_TILE = [2720, 4903, 2];
const CENTRE = [2720, 4900];
const STAGE_BOOK_SHOWN = 70;
const STAGE_RITUAL_DONE = 90;
const STAGE_READY = 110;
const STAGE_SUMMONED = 120;
const STAGE_KILLED = 124;
const ASSEMBLED = "shadow-of-the-storm:summon-assembled";
const CONTINUE_CHILD = { 231: 5, 217: 5, 193: 0, 229: 2 };
const FIRST = ["Nahudu", "Caldar", "Tarren", "Agrith-Naar", "Camerinthum"];
const SECOND = ["Camerinthum", "Agrith-Naar", "Tarren", "Caldar", "Nahudu"];

let core;
let I;
let N;
let next = 8700;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PM.getCoreApi();
  I = core.ItemIdentifiers;
  N = core.NpcIdentifiers;
  core.RegionManager.init();
  core.RegionManager.loadMapFiles(RITUAL_TILE[0], RITUAL_TILE[1]);
  PM.emitServerStartup({});
});
after(() => PM.emitServerShutdown({}));

const quest = () => QuestRuntime.getRegisteredQuests().find((entry) => entry.name === "Shadow of the Storm");

function actor(t, stage) {
  const channel = {
    kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true,
    close() {}, onData() {}, onError() {}, onClose() {},
  };
  const p = new Player(new PlayerSession(channel));
  p.setIndex(next++);
  p.setUsername("ritualqa" + p.getIndex());
  p.setRegistered(true);
  p.setLocation(new core.Location(RITUAL_TILE[0], RITUAL_TILE[1], RITUAL_TILE[2]));
  p.needsPlacement = false;
  const c = new ClientConnection(channel);
  c.player = p;
  const said = [];
  const sequences = [];
  const forceChat = p.forceChat.bind(p);
  t.mock.method(p, "forceChat", (text) => { said.push(text); return forceChat(text); });
  const perform = p.performAnimation.bind(p);
  t.mock.method(p, "performAnimation", (animation) => { sequences.push(animation.getId()); return perform(animation); });
  t.after(() => {
    PM.emitPlayerLogout({ player: p, username: p.getUsername() });
    p.setRegistered(false);
    core.TaskManager.cancelTasks(p.getIndex());
    core.TaskManager.cancelTasks(p);
  });
  quest().setStage(p, stage);
  const f = { p, c, inv: p.getInventory(), said, sequences };
  f.inv.add(new core.Item(I.DEMONIC_SIGIL), false);
  f.inv.add(new core.Item(I.SILVERLIGHT_2), false);
  PM.emitPlayerLogin({ player: p, username: p.getUsername(), isNewAccount: false });
  return f;
}

async function send(f, packet) {
  await f.c.dispatch([packet]);
  f.c.processTurnPackets();
}

function ticks(f, count) {
  for (let i = 0; i < count; i++) {
    core.TaskManager.processWalkTo(f.p.getIndex());
    f.p.getMovementQueue().process();
    core.TaskManager.process();
    // The end of a world tick: overhead lines need the speakers in the player's local npc list, and a
    // moved npc leaves it until the tick after. The player isn't in World's list, so this is called here.
    core.World.updateLocalNpcs(f.p, owned(f));
    for (const npc of owned(f)) npc.setNeedsPlacement(false);
  }
}

const owned = (f) => [...core.World.getNpcs()].filter((npc) => npc.getOwner?.() === f.p);
// By id: other plugins' owner-only npcs also answer to this player, so owner alone isn't the cast.
const cast = (f) => {
  const ids = new Set([N.DENATH, N.ERIC, N.TANYA, N.MATTHEW, N.JENNIFER_2, N.PATRICK, N.EVIL_DAVE_2,
    N.FATHER_REEN, N.FATHER_BADDEN, N.CLAY_GOLEM_2]);
  return owned(f).filter((npc) => ids.has(npc.getId()));
};
const castIds = (f) => cast(f).map((npc) => npc.getId());

function chant(f) {
  const slot = f.inv.getItems().findIndex((held) => held?.getId() === I.DEMONIC_SIGIL);
  return PM.emitItemAction({
    player: f.p, item: f.inv.getItems()[slot], itemId: I.DEMONIC_SIGIL, slot,
    interfaceId: core.CacheDefinitions.getComponentId("inventory:items"), option: "Chant", clickType: 2, handled: false,
  });
}

/** Answers the five word menus in order and plays on until the chat is done. */
async function speak(f, words) {
  const queue = [...words];
  for (let i = 0; i < 160; i++) {
    const menu = core.MultiChatboxPrompt.getPending(f.p);
    if (menu) {
      const word = queue.shift();
      if (word === undefined) return;
      const choice = menu.options.indexOf(word);
      assert.ok(choice >= 0, `${word} is on the menu: ${JSON.stringify(menu.options)}`);
      await send(f, { type: "dialogue_continue", widgetId: core.MultiChatboxPrompt.OPTIONS_WIDGET_ID, childIndex: choice + 1 });
      ticks(f, 1);
      continue;
    }
    if (f.p.getDialogueManager().isActive()) {
      // An overhead line is timed: a client has no continue to send, and one would skip the chain.
      const group = f.p.getPacketSender().getChatboxGroupId();
      if (!(f.p.getDialogueManager().getCurrent() instanceof ActionDialogue) && group in CONTINUE_CHILD) {
        await send(f, { type: "dialogue_continue", widgetId: (group << 16) | CONTINUE_CHILD[group], childIndex: -1 });
      }
    } else if (queue.length === 0) {
      ticks(f, 2);
      if (!f.p.getDialogueManager().isActive() && !core.MultiChatboxPrompt.getPending(f.p)) return;
    }
    ticks(f, 1);
  }
}

test("each word is said overhead with its sequence, and everyone faces the centre", async (t) => {
  const f = actor(t, STAGE_BOOK_SHOWN);
  ticks(f, 2);
  assert.ok(cast(f).length >= 7, `control: the cast is there: ${castIds(f)}`);
  assert.ok(f.p.getLocalNpcs().some((npc) => npc.getId() === N.DENATH), "control: and in view");
  chant(f);
  // Denath's overhead line comes first in this ritual, on its own timer.
  for (let i = 0; i < 6 && !core.MultiChatboxPrompt.getPending(f.p); i++) ticks(f, 1);
  assert.ok(core.MultiChatboxPrompt.getPending(f.p), "control: the first word menu");
  const facing = (mobile) => {
    const tile = mobile.getPositionToFace?.();
    return tile ? [tile.getX(), tile.getY()] : null;
  };
  assert.deepEqual(facing(f.p), CENTRE, "the player faces the centre");
  for (const npc of cast(f)) assert.deepEqual(facing(npc), CENTRE, `${npc.getId()} faces the centre`);
  await speak(f, FIRST);
  for (const [index, word] of FIRST.entries()) {
    const text = index === 4 ? `${word}!` : `${word}...`;
    assert.ok(f.said.includes(text), `the player said ${text}: ${JSON.stringify(f.said)}`);
  }
  assert.equal(f.sequences.filter((id) => id === 2879).length, 5, "one sequence a word");
});

test("after the first ritual Denath's sigil can be seen, some go, and nothing moves the player until the portal", async (t) => {
  const f = actor(t, STAGE_BOOK_SHOWN);
  ticks(f, 2);
  chant(f);
  ticks(f, 1);
  await speak(f, FIRST);
  assert.equal(quest().getStage(f.p), STAGE_RITUAL_DONE, "control: the ritual worked");
  const sigil = ItemOnGroundManager.getGroundItem(f.p.getUsername(), I.DEMONIC_SIGIL, new core.Location(CENTRE[0], CENTRE[1], 2), f.p.getPrivateArea?.());
  assert.ok(sigil, "the sigil is on the floor at the centre");
  assert.equal(sigil.getPrivateArea?.() ?? null, f.p.getPrivateArea?.() ?? null, "where this player can see it");

  ticks(f, 45);
  assert.equal(f.p.getLocation().getZ(), 2, "still in the room");
  assert.equal(f.p.getMovementQueue().isMovementBlocked?.() ?? false, false, "free to move");
  const left = castIds(f);
  t.diagnostic(`left in the room ${left}`);
  assert.equal(left.includes(N.DENATH), false, "Denath has gone");
  for (const gone of [N.EVIL_DAVE_2, N.ERIC, N.TANYA]) assert.equal(left.includes(gone), false, `${gone} has run off`);
  for (const stays of [N.MATTHEW, N.JENNIFER_2, N.PATRICK]) assert.ok(left.includes(stays), `${stays} stays`);

  // The only way out while the scene refuses teleports, so by real packet: the loc the scene placed,
  // and a real walk to it, as t2133-t2139 has the player run from the sigil and click.
  await send(f, { type: "object_option", id: 10251, x: 2719, y: 4883, clickType: 1 });
  for (let i = 0; i < 40 && f.p.getLocation().getZ() !== 0; i++) ticks(f, 1);
  const at = f.p.getLocation();
  assert.deepEqual([at.getX(), at.getY(), at.getZ()], [2721, 4911, 0], "the closing portal takes them out");
});

test("the second ritual: each word is said overhead too", async (t) => {
  const f = actor(t, STAGE_READY);
  f.p.setAttribute(ASSEMBLED, true);
  ticks(f, 2);
  chant(f);
  ticks(f, 1);
  assert.ok(core.MultiChatboxPrompt.getPending(f.p), "control: the first word menu");
  await speak(f, SECOND);
  for (const [index, word] of SECOND.entries()) {
    const text = index === 4 ? `${word}!` : `${word}...`;
    assert.ok(f.said.includes(text), `the player said ${text}: ${JSON.stringify(f.said)}`);
  }
});

test("the second ritual: as Agrith-Naar attacks, the cast walk off, and keep moving after", async (t) => {
  const f = actor(t, STAGE_READY);
  f.p.setAttribute(ASSEMBLED, true);
  // What the first ritual stores, and this test skips: the tome order that SECOND follows.
  f.p.setAttribute("quest.shadow_of_the_storm.incantation", 4371);
  ticks(f, 2);
  chant(f);
  ticks(f, 1);
  const byId = (id) => cast(f).find((npc) => npc.getId() === id);
  const spots = [
    [N.FATHER_REEN, 2721, 4891], [N.FATHER_BADDEN, 2722, 4896], [N.EVIL_DAVE_2, 2713, 4894],
    [N.JENNIFER_2, 2716, 4898], [N.PATRICK, 2712, 4894], [N.CLAY_GOLEM_2, 2726, 4896],
  ];
  for (const [id] of spots) {
    assert.equal(byId(id)?.getMovementCoordinator().getRadius(), 0, `control: ${id} stands still for the chant`);
  }
  await speak(f, SECOND);
  assert.equal(quest().getStage(f.p), STAGE_SUMMONED, "control: the summoning worked");
  for (let i = 0; i < 9; i++) {
    for (const npc of cast(f)) npc.getMovementQueue().process();
    ticks(f, 1);
  }
  for (const [id, x, y] of spots) {
    const tile = byId(id).getLocation();
    assert.deepEqual([tile.getX(), tile.getY()], [x, y], `${id} walked to its captured spot`);
  }
  ticks(f, 3);
  for (const [id] of spots) assert.ok(byId(id).getMovementCoordinator().getRadius() > 0, `${id} keeps moving`);

  // The kill moves the stage, which re-ensures the cast: they must not snap back to their ritual tiles.
  const before = spots.map(([id]) => byId(id).getLocation().clone());
  PM.emitNpcDeath({ npc: owned(f).find((npc) => npc.getId() === N.AGRITH_NAAR), killer: f.p });
  ticks(f, 1);
  assert.equal(quest().getStage(f.p), STAGE_KILLED, "control: the kill counted");
  for (const [index, [id]] of spots.entries()) {
    assert.ok(byId(id).getLocation().equals(before[index]), `${id} stays where it walked to`);
  }
});
