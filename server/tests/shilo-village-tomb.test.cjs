// Run after `yarn build`: node --test tests/shilo-village-tomb.test.cjs
//
// #2586: the scrolls show their text, and the way into and through Rashiliyia's tomb works.
// The cache's tomb doors are multilocs on varbit 8180: 0 jungle plants, 1 carved doors, 2 hillside entrance.
//
// Native fixture: real object_option, item_on_object and inventory_action through ClientConnection.dispatch,
// the real transcripts and multiloc resolution. Quest stage set directly. No client ran.
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
const QuestRuntime = require("../plugins/quests/QuestRuntime");

const PALM = 2237;
const PALM_TILE = [2916, 3092];
const DOOR_LOC = 34657;
const DOOR_TILE = [2917, 3090];
const NEAR_DOORS = [2918, 3089];
const NEAR_PALM = [2915, 3091];
const VARBIT_DOORS = 8180;
const JUNGLE_PLANT = 2244;
const CARVED_DOORS = 2240;
const HILLSIDE = 34658;
const TOMB_INSIDE = [2929, 9525];
const ROCKS = 2257;
const ABOVE_ROCKS = [2929, 9515];
const BELOW_ROCKS = [2928, 9511];
const ROCK_ABOVE = [2928, 9515];
const ROCK_BELOW = [2929, 9511];
const STAGE_ENTERED_BERVIRIUS = 9;
const STAGE_UNLOCKED_TOMB = 10;
const MECH = "quest.shilo_village.mechanisms";
const MECH_READ_CRUMPLED = 1;
const MECH_FOUND_BONE_DOOR = 2;
const MESSAGE_SCROLL = 220;
const TOMB_DOLMEN = 2258;
const STAGE_UNLOCKED_TOMB_DOOR = 12;
const MECH_DEFEATED_1 = 1 << 9;
const SILENT = "The dolmen remains silent.";
const NAZASTAROOL_FORMS = [5353, 5354, 5355];

let core;
let I;
let next = 7900;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PM.getCoreApi();
  I = core.ItemIdentifiers;
  core.RegionManager.init();
  core.RegionManager.loadMapFiles(...PALM_TILE);
  core.RegionManager.loadMapFiles(...TOMB_INSIDE);
  PM.emitServerStartup({});
});
after(() => PM.emitServerShutdown({}));

function actor(t, [x, y], stage = STAGE_ENTERED_BERVIRIUS) {
  const channel = {
    kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true,
    close() {}, onData() {}, onError() {}, onClose() {},
  };
  const p = new Player(new PlayerSession(channel));
  p.setIndex(next++);
  p.setUsername("shiloqa" + p.getIndex());
  p.setRegistered(true);
  p.setLocation(new core.Location(x, y, 0));
  p.needsPlacement = false;
  const sender = p.getPacketSender();
  const messages = [];
  const strings = [];
  const interfaces = [];
  t.mock.method(sender, "sendMessage", (message) => { messages.push(message); return sender; });
  const sendString = sender.sendString.bind(sender);
  t.mock.method(sender, "sendString", (text, ...rest) => { strings.push(String(text)); return sendString(text, ...rest); });
  const sendInterface = sender.sendInterface.bind(sender);
  t.mock.method(sender, "sendInterface", (id, ...rest) => { interfaces.push(id); return sendInterface(id, ...rest); });
  const c = new ClientConnection(channel);
  c.player = p;
  t.after(() => {
    PM.emitPlayerLogout({ player: p, username: p.getUsername() });
    p.setRegistered(false);
    core.TaskManager.cancelTasks(p.getIndex());
  });
  shilo().setStage(p, stage);
  return { p, c, inv: p.getInventory(), messages, strings, interfaces };
}

const shilo = () => QuestRuntime.getRegisteredQuests().find((quest) => quest.key === "shilo_village");
const at = (f) => [f.p.getLocation().getX(), f.p.getLocation().getY()];
const doorsSeen = (f) => core.ObjectDefinition.forPlayer(DOOR_LOC, f.p)?.id;

function drain(f, rounds = 8) {
  for (let i = 0; i < rounds; i++) {
    // Player sync clears this each tick; a moveTo leaves the player busy until it does.
    f.p.needsPlacement = false;
    core.TaskManager.processWalkTo(f.p.getIndex());
    f.p.getMovementQueue().process();
    core.TaskManager.process();
  }
}

async function send(f, packet) {
  await f.c.dispatch([packet]);
  f.c.processTurnPackets();
  drain(f);
}

async function playThrough(f, pick) {
  for (let i = 0; i < 20; i++) {
    const prompt = core.MultiChatboxPrompt.getPending(f.p);
    if (prompt) {
      const index = prompt.options.findIndex((option) => pick?.test(option));
      await send(f, { type: "dialogue_continue", widgetId: core.MultiChatboxPrompt.OPTIONS_WIDGET_ID, childIndex: index + 1 });
    } else if (f.p.getDialogueManager().isActive()) {
      const group = f.p.getPacketSender().chatboxGroupId;
      if (group < 0) { drain(f); continue; }
      await send(f, { type: "dialogue_continue", widgetId: group << 16, childIndex: -1 });
    } else {
      return;
    }
  }
}

/** What the interface shows, ignoring where its lines break. */
const shown = (f) => f.strings.join(" ").replace(/\s+/g, " ");

/** NetworkBuilder's order: the login hooks, then the bootstrap. */
function login(f) {
  const event = { player: f.p, username: f.p.getUsername() };
  PM.emitPlayerLogin(event);
  PM.emitCustomEvent("player:bootstrap-complete", event);
}

const click = (f, id, [x, y], clickType) => send(f, { type: "object_option", id, x, y, clickType });

async function searchPalm(f) {
  await click(f, PALM, PALM_TILE, 2);
  await playThrough(f);
}

function useOnDoors(f, itemId) {
  const slot = f.inv.getSlotForItemId(itemId);
  return send(f, { type: "item_on_object", objectId: DOOR_LOC, x: DOOR_TILE[0], y: DOOR_TILE[1], itemId, slot, widgetId: 3214 });
}

// ------------------------------------------------------------------ the hidden doors

test("Rashiliyia's tomb: plants hide the doors until the palm is searched", async (t) => {
  const f = actor(t, NEAR_PALM);
  assert.equal(doorsSeen(f), JUNGLE_PLANT, "control: plants before the search");
  await searchPalm(f);
  t.diagnostic(`varbit ${f.p.getPacketSender().getVarbit(VARBIT_DOORS)}; loc ${doorsSeen(f)}; messages ${f.messages}`);
  assert.ok(f.messages.some((message) => /reveal an ancient doorway/.test(message)), "the transcript says so");
  assert.equal(f.p.getPacketSender().getVarbit(VARBIT_DOORS), 1, "the varbit is sent");
  assert.equal(doorsSeen(f), CARVED_DOORS, "the doors are there");
});

test("Rashiliyia's tomb: the revealed doors can be opened and searched, which finds the bone lock", async (t) => {
  const f = actor(t, NEAR_PALM);
  await searchPalm(f);
  f.p.setLocation(new core.Location(...NEAR_DOORS));
  f.messages.length = 0;
  await click(f, DOOR_LOC, DOOR_TILE, 1);
  await playThrough(f);
  assert.ok(f.messages.some((message) => /recepticle/.test(message)), `Open: ${f.messages}`);

  assert.equal((Number(f.p.getAttribute(MECH)) || 0) & MECH_FOUND_BONE_DOOR, 0, "control: the lock isn't found yet");
  f.messages.length = 0;
  await click(f, DOOR_LOC, DOOR_TILE, 2);
  await playThrough(f);
  assert.ok(f.messages.some((message) => /strange lock/.test(message)), `Search: ${f.messages}`);
  assert.equal(Number(f.p.getAttribute(MECH)) & MECH_FOUND_BONE_DOOR, MECH_FOUND_BONE_DOOR, "the lock is found");
});

test("Rashiliyia's tomb: the bone key opens the doors into the entrance, which leads inside", async (t) => {
  const f = actor(t, NEAR_PALM);
  f.inv.adds(I.BONE_KEY, 1);
  await searchPalm(f);
  f.p.setLocation(new core.Location(...NEAR_DOORS));
  await useOnDoors(f, I.BONE_KEY);
  await playThrough(f);
  assert.equal(shilo().getStage(f.p), STAGE_UNLOCKED_TOMB, "unlocked");
  assert.equal(doorsSeen(f), HILLSIDE, "the hillside entrance shows");
  await click(f, DOOR_LOC, DOOR_TILE, 1);
  await playThrough(f);
  assert.deepEqual(at(f), TOMB_INSIDE, "Enter goes in");
});

test("Rashiliyia's tomb: a key on the plants does nothing, and the doors come back on login", async (t) => {
  const hidden = actor(t, NEAR_DOORS);
  hidden.inv.adds(I.BONE_KEY, 1);
  await useOnDoors(hidden, I.BONE_KEY);
  await playThrough(hidden);
  assert.equal(shilo().getStage(hidden.p), STAGE_ENTERED_BERVIRIUS, "control: still hidden, not unlocked");

  const f = actor(t, NEAR_PALM);
  await searchPalm(f);
  f.p.getPacketSender().sendVarbit(VARBIT_DOORS, 0);
  login(f);
  assert.equal(f.p.getPacketSender().getVarbit(VARBIT_DOORS), 1, "searched: doors");

  const unlocked = actor(t, NEAR_PALM, STAGE_UNLOCKED_TOMB);
  login(unlocked);
  assert.equal(unlocked.p.getPacketSender().getVarbit(VARBIT_DOORS), 2, "unlocked: entrance");

  const fresh = actor(t, NEAR_PALM);
  login(fresh);
  assert.equal(fresh.p.getPacketSender().getVarbit(VARBIT_DOORS), 0, "control: not searched, plants");
});

// ------------------------------------------------------------------ the rocks

test("Rashiliyia's tomb: the rocks need the Beads of the Dead, and go down and back up", async (t) => {
  const bare = actor(t, ABOVE_ROCKS);
  await click(bare, ROCKS, ROCK_ABOVE, 1);
  await playThrough(bare);
  t.diagnostic(`bare at ${at(bare)}; ${bare.messages}`);
  assert.deepEqual(at(bare), ABOVE_ROCKS, "without them, they stay above");

  const f = actor(t, ABOVE_ROCKS);
  f.p.getEquipment().setItem(core.Equipment.AMULET_SLOT, new core.Item(I.BEADS_OF_THE_DEAD, 1));
  await click(f, ROCKS, ROCK_ABOVE, 1);
  await playThrough(f);
  t.diagnostic(`down at ${at(f)}; ${f.messages}`);
  assert.deepEqual(at(f), BELOW_ROCKS, "down");
  assert.ok(f.messages.some((message) => /clamber down/.test(message)), "the transcript plays");

  await click(f, ROCKS, ROCK_BELOW, 1);
  await playThrough(f);
  assert.deepEqual(at(f), ABOVE_ROCKS, "and back up");
});

// ------------------------------------------------------------------ the scrolls

async function read(f, itemId, pick) {
  f.inv.adds(itemId, 1);
  await send(f, { type: "inventory_action", slot: f.inv.getSlotForItemId(itemId), itemId, widgetId: 3214, option: "Read" });
  await playThrough(f, pick);
  drain(f);
}

test("Scrolls: Yes shows the tattered scroll's text, and No doesn't", async (t) => {
  const f = actor(t, NEAR_PALM);
  await read(f, I.TATTERED_SCROLL, /Yes please/);
  assert.ok(f.interfaces.includes(MESSAGE_SCROLL), `the text opens: ${f.interfaces}`);
  const text = shown(f);
  assert.match(text, /Bervirius, son of King/, "its first words");
  assert.match(text, /witches and the undead/, "its last words");

  const no = actor(t, NEAR_PALM);
  await read(no, I.TATTERED_SCROLL, /No thanks/);
  assert.ok(!no.interfaces.includes(MESSAGE_SCROLL), "control: No opens nothing");
});

test("Scrolls: Yes shows the crumpled scroll's text and counts as reading it; No doesn't", async (t) => {
  const f = actor(t, NEAR_PALM);
  await read(f, I.CRUMPLED_SCROLL, /Yes please/);
  assert.ok(f.interfaces.includes(MESSAGE_SCROLL), `the text opens: ${f.interfaces}`);
  const text = shown(f);
  assert.match(text, /rage went unchecked/, "its first words");
  assert.match(text, /Witch Queen at bay/, "its last words");
  assert.equal(Number(f.p.getAttribute(MECH)) & MECH_READ_CRUMPLED, MECH_READ_CRUMPLED, "read");

  const no = actor(t, NEAR_PALM);
  await read(no, I.CRUMPLED_SCROLL, /No thanks/);
  assert.ok(!no.interfaces.includes(MESSAGE_SCROLL), "control: No opens nothing");
  assert.equal((Number(no.p.getAttribute(MECH)) || 0) & MECH_READ_CRUMPLED, 0, "and doesn't count");
});

test("Bervirius' notes: each papyrus shows its own text", async (t) => {
  for (const [choice, first, last] of [
    [/Tattered Yellow/, /rest like your mother/, /final resting place/],
    [/Decayed White/, /objects of beauty/, /near to each other/],
    [/Crusty Orange/, /the sphere is activated/, /draining on the body/],
  ]) {
    const f = actor(t, NEAR_PALM);
    assert.ok(!f.interfaces.includes(MESSAGE_SCROLL), "control: nothing open before reading");
    await read(f, I.BERVIRIUS_NOTES, choice);
    assert.ok(f.interfaces.includes(MESSAGE_SCROLL), `${choice} opens: ${f.interfaces}`);
    const text = shown(f);
    assert.match(text, first, "its first words");
    assert.match(text, last, "its last words");
  }
});

// ------------------------------------------------------------------ Nazastarool

/** The dolmen through its object hook with a stand-in definition: its tile isn't established here. */
async function searchDolmen(f) {
  const location = f.p.getLocation();
  PM.emitObjectInteraction({
    player: f.p,
    object: new core.GameObject(TOMB_DOLMEN, new core.Location(location.getX() + 1, location.getY(), 0), 10, 0, null),
    objectId: TOMB_DOLMEN,
    clickType: 2,
    option: "Search",
    definition: { getName: () => "Tomb dolmen", getInteractions: () => ["Look-at", "Search"] },
    location: { x: location.getX() + 1, y: location.getY(), z: 0 },
    sourceLocation: { x: location.getX(), y: location.getY(), z: 0 },
    handled: false,
  });
  await playThrough(f);
}

function nazastarool(t) {
  const f = actor(t, TOMB_INSIDE, STAGE_UNLOCKED_TOMB_DOOR);
  f.spawned = [];
  const spawnNpc = PM.spawnNpc.bind(PM);
  t.mock.method(PM, "spawnNpc", (...args) => {
    const npc = spawnNpc(...args);
    if (npc && NAZASTAROOL_FORMS.includes(npc.getId())) f.spawned.push(npc);
    return npc;
  });
  return f;
}

test("Nazastarool: the player dying leaves him standing, so he can still be killed", async (t) => {
  const f = nazastarool(t);
  await searchDolmen(f);
  assert.equal(f.spawned.length, 1, "searching raises him");
  const [npc] = f.spawned;

  f.p.setHitpoints(0);
  f.p.appendDeath();
  for (let i = 0; i < 12; i++) drain(f, 1);
  t.diagnostic(`after death: player at ${at(f)}; npc registered ${npc.isRegistered()} hp ${npc.getHitpoints()}`);
  assert.equal(npc.isRegistered(), true, "he's still there");

  f.messages.length = 0;
  await searchDolmen(f);
  assert.ok(f.messages.includes(SILENT), `the dolmen is silent while he stands: ${f.messages}`);
  assert.equal(f.spawned.length, 1, "and raises no second one");

  PM.emitNpcDeath({ npc, npcId: npc.getId(), killer: f.p, location: { x: 0, y: 0, z: 0 } });
  assert.equal(Number(f.p.getAttribute(MECH)) & MECH_DEFEATED_1, MECH_DEFEATED_1, "killing him still counts");
});
