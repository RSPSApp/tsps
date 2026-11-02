// Run after `yarn build`: node --test tests/ferries.test.cjs
const assert = require("node:assert/strict");
const { test, before, beforeEach } = require("node:test");
const path = require("node:path");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();

const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { CacheDefinitions } = require("../dist/game/cache/CacheDefinitions");
const { Location } = require("../dist/game/model/Location");
const { Item } = require("../dist/game/model/Item");
const { ItemDefinition } = require("../dist/game/definition/ItemDefinition");
const { Equipment } = require("../dist/game/model/container/impl/Equipment");
const { ItemIdentifiers } = require("../dist/util/ItemIdentifiers");
const { ObjectDefinition } = require("../dist/game/definition/ObjectDefinition");
const { Player } = require("../dist/game/entity/impl/player/Player");
const Ferries = require("../plugins/world/Ferries.plugin");
const BarnabyFerry = require("../plugins/world/BarnabyFerry.plugin");

const { Common, Voyages, Routes } = Ferries._test;
const npcId = (name) => CacheDefinitions.getNpcId(name);

let tasks = [];
let quests = { complete: new Set(), started: new Set() };
const starts = [];
const hooks = { npc: [], object: [], events: new Map(), conditions: [], logout: [], shutdown: [] };

class Task {
  constructor(delay, key) {
    this.delay = delay;
    this.key = key;
    this.running = true;
    this.elapsed = 0;
  }

  stop() {
    this.running = false;
  }
}

class CountdownTask extends Task {
  constructor(key, ticks, action) {
    super(ticks, key);
    this.action = action;
  }

  execute() {
    this.stop();
    this.action();
  }
}

class TemplatedInstanceArea {
  setChunk() {}

  tile() {
    return new Location(3064, 3208, 1);
  }

  enter(player) {
    player.area = this;
  }

  leave(player, logout) {
    player.area = null;
    this.postLeave(player, logout);
  }

  postLeave() {}
}

const api = {
  core: {
    CacheDefinitions, Location, ItemDefinition, Equipment, ItemIdentifiers, Task, CountdownTask, TemplatedInstanceArea,
    ChatType: { SPAM: "spam" },
    TaskManager: { submit: (task) => tasks.push(task), cancelTasks: (key) => tasks.forEach((task) => task.key === key && task.stop()) },
    StatementDialogue: { send: (player, text) => player.sent.boxes.push(text) },
    TeleportHandler: { checkReqs: () => true, teleport: () => assert.fail("a ferry must not cast a teleport") },
    TeleportType: { NORMAL: "NORMAL" },
  },
  onNpcInteraction: (handler) => hooks.npc.push(handler),
  onObjectInteraction: (handler) => hooks.object.push(handler),
  onNpcDialogueCondition: (handler) => hooks.conditions.push(handler),
  onCustomEvent: (name, handler) => hooks.events.set(name, [...(hooks.events.get(name) ?? []), handler]),
  onPlayerLogout: (handler) => hooks.logout.push(handler),
  onServerShutdown: (handler) => hooks.shutdown.push(handler),
  emitCustomEvent: (name, request) => {
    if (name === "quest:is-complete") request.complete = quests.complete.has(request.key);
    if (name === "quest:is-started") request.started = quests.started.has(request.key);
    if (name === "npc-dialogue:start") {
      starts.push(request);
      request.handled = true;
    }
    for (const handler of hooks.events.get(name) ?? []) handler(request);
  },
};

function tick(count = 1) {
  for (let i = 0; i < count; i++) {
    for (const task of [...tasks]) {
      if (!task.running) continue;
      if (++task.elapsed >= task.delay) {
        task.elapsed = 0;
        task.execute();
      }
    }
  }
  tasks = tasks.filter((task) => task.running);
}

function createPlayer({ at = new Location(3046, 3236, 0), items = [], worn = [], coins = 0 } = {}) {
  const inventory = Array.from({ length: 28 }, () => new Item(-1, 0));
  items.forEach((id, index) => { inventory[index] = new Item(id, 1); });
  if (coins) inventory[27] = new Item(ItemIdentifiers.COINS, coins);
  const equipment = Array.from({ length: 14 }, () => new Item(-1, 0));
  for (const id of worn) equipment[ItemDefinition.forId(id).getEquipmentType().getSlot()] = new Item(id, 1);
  const sent = { messages: [], spam: [], boxes: [], interfaces: [], scripts: [], anims: [], subs: [], closed: [], songs: [], jingles: [], shown: [], varbits: new Map(), removals: 0 };
  let location = at;
  let blocked = false;
  let registered = true;
  const sender = {
    sendTypedMessage: (type, text) => { sent.spam.push(text); return sender; },
    sendSong: (id) => { sent.songs.push(id); return sender; },
    sendJingle: (id) => { sent.jingles.push(id); return sender; },
    sendInterface: (id) => { sent.interfaces.push(id); return sender; },
    sendClientScript: (id, ...args) => { sent.scripts.push([id, ...args]); return sender; },
    sendInterfaceScript: (id, args) => { sent.scripts.push([id, ...args]); return sender; },
    sendInterfaceAnimation: (uid, seq) => { sent.anims.push([uid, seq]); return sender; },
    sendInterfaceDisplayState: (uid, hide) => { if (!hide) sent.shown.push(uid); return sender; },
    sendSubInterface: (uid, id, type, options) => { sent.subs.push({ uid, id, options }); return sender; },
    closeSubInterface: (uid) => { sent.closed.push(uid); return sender; },
    sendInterfaceRemoval: () => { sent.removals++; return sender; },
    sendTabInterface: () => sender,
    sendVarbit: (id, value) => { sent.varbits.set(id, value); return sender; },
  };
  const container = (slots) => ({
    get: (slot) => slots[slot],
    getItems: () => slots,
    getAmount: (id) => slots.reduce((sum, item) => sum + (item.getId() === id ? item.getAmount() : 0), 0),
    deleteNumber: (id, amount) => { const item = slots.find((slot) => slot.getId() === id); item.setAmount(item.getAmount() - amount); },
    refreshItems: () => {},
  });
  const movement = { reset: () => movement, setBlockMovement: (value) => { blocked = value; return movement; } };
  return {
    sent,
    area: null,
    get blocked() { return blocked; },
    getLocation: () => location,
    moveTo: (target) => { location = target; },
    getInventory: () => container(inventory),
    getEquipment: () => container(equipment),
    getPacketSender: () => sender,
    getMovementQueue: () => movement,
    getDialogueManager: () => ({ reset() {} }),
    getSpellbook: () => ({ getInterfaceId: () => 218 }),
    setUntargetable() {},
    isRegistered: () => registered,
    setRegistered: (value) => { registered = value; },
    sendMessage: (text) => sent.messages.push(text),
  };
}

function npc(name, x = 0, y = 0) {
  const id = npcId(name);
  const definition = CacheDefinitions.getNpc(id);
  return { id, location: new Location(x, y, 0), definition };
}

/** A click on an NPC option by label: the transformed definition carries the label and name. */
function click(player, name, label, { gameval = null, at = [0, 0] } = {}) {
  const base = gameval ? npcId(gameval) : -1;
  const actions = [null, null, label, null, null];
  const event = {
    player,
    npc: { getId: () => base, getLocation: () => new Location(at[0], at[1], 0) },
    npcId: base,
    clickType: 3,
    definition: { getName: () => name, getActions: () => actions, getId: () => base },
    handled: false,
  };
  for (const handler of hooks.npc) handler(event);
  return event;
}

const at = (player) => [player.getLocation().getX(), player.getLocation().getY(), player.getLocation().getZ()];

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  ObjectDefinition.init();
  Ferries.register(api);
  BarnabyFerry.register({ ...api, onNpcInteraction() {}, onNpcDialogueVariant() {}, onNpcDialogueCondition() {}, onCustomEvent() {} });
});

beforeEach(() => {
  tasks = [];
  starts.length = 0;
  quests = { complete: new Set(), started: new Set() };
});

test("Take-boat to Entrana: the captured search line, ship_journey route 1, the deck fourteen ticks later", () => {
  const player = createPlayer();
  click(player, "Monk of Entrana", "Take-boat", { gameval: "shipmonk" });
  assert.deepEqual(player.sent.messages, ["After a quick search, the monk smiles at you and allows you to board."]);
  assert.deepEqual(player.sent.interfaces, [299]);
  assert.deepEqual(player.sent.scripts, [[1131, 1]]);
  assert.deepEqual(player.sent.songs, [147]);
  assert.deepEqual(player.sent.jingles, [172]);
  assert.ok(player.area, "at sea on the ship instance");
  assert.ok(player.blocked);
  assert.equal(click(player, "Monk of Entrana", "Take-boat", { gameval: "shipmonk" }).handled, true);
  assert.deepEqual(player.sent.scripts, [[1131, 1]], "a second click while sailing does nothing");
  tick(13);
  assert.deepEqual(at(player), [3064, 3208, 1]);
  tick(1);
  assert.deepEqual(at(player), [2834, 3331, 1]);
  assert.deepEqual(player.sent.boxes, ["The ship arrives at Entrana."]);
  assert.equal(player.blocked, false);
  assert.equal(player.area, null);
});

test("the monks turn back weapons or armour, worn or carried, with the transcript's own refusal", () => {
  const sword = ItemIdentifiers.BRONZE_SWORD;
  const armed = createPlayer({ items: [sword] });
  click(armed, "Monk of Entrana", "Take-boat", { gameval: "shipmonk1_b" });
  assert.equal(armed.sent.interfaces.length, 0, "no boat");
  const steps = [
    { type: "condition", text: "If the player has a forbidden item dedicated to Saradomin:", steps: [{ npc: "saradomin" }] },
    { type: "condition", text: "If the player has a forbidden item:", steps: [{ npc: "NO WEAPONS OR ARMOUR" }] },
  ];
  assert.deepEqual(starts.at(-1).select(steps), [{ npc: "NO WEAPONS OR ARMOUR" }]);

  const answer = (player, text) => hooks.conditions.map((handler) => handler({ player, definition: { getName: () => "Monk of Entrana" }, text })).find((value) => value != null);
  assert.equal(answer(armed, "If the player has a forbidden item:"), true);
  assert.equal(answer(armed, "If the player does not have any forbidden items:"), false);
  const clean = createPlayer({ items: [ItemIdentifiers.LOBSTER, ItemIdentifiers.LAW_RUNE] });
  assert.equal(answer(clean, "If the player does not have any forbidden items:"), true);
  assert.equal(answer(clean, "If the player has not taken the boat to entrana during their current login session:"), true);
  const worn = createPlayer({ worn: [ItemIdentifiers.BRONZE_FULL_HELM] });
  assert.equal(answer(worn, "If the player has a forbidden item:"), true);
});

test("the transcript's travel steps sail; Jarvald's paid trip takes 1,000 coins first", () => {
  const player = createPlayer({ at: new Location(3041, 3202, 0) });
  const step = (stepId, extra = {}) => {
    const event = { player, stepId, handled: false, npcId: -1, ...extra };
    for (const handler of hooks.events.get("npc-dialogue:action")) handler(event);
    return event;
  };
  const event = step("XkS9kZ");
  assert.equal(event.handled, true);
  assert.equal(event.end, true, "the transcript stops; the voyage says the ship arrives");
  assert.deepEqual(player.sent.scripts, [[1131, 10]]);
  tick(11);
  assert.deepEqual(at(player), [2663, 2676, 1]);

  const paying = createPlayer({ at: new Location(2621, 3683, 0), coins: 1500 });
  const paid = { player: paying, stepId: "uqNLqh", handled: false };
  for (const handler of hooks.events.get("npc-dialogue:action")) handler(paid);
  assert.equal(paying.getInventory().getAmount(ItemIdentifiers.COINS), 500);
  tick(7);
  assert.deepEqual(at(paying), [2545, 3761, 0]);
});

test("the Sailor's longship needs the Fremennik Trials, then sails under misc_shipjourney as captured", () => {
  const player = createPlayer({ at: new Location(2629, 3693, 0) });
  click(player, "Sailor", "Miscellania");
  assert.equal(starts.at(-1).variant, "before-the-fremennik-trials");
  assert.equal(player.sent.interfaces.length, 0);

  quests.complete.add("fremennik_trials");
  click(player, "Sailor", "Miscellania");
  assert.deepEqual(player.sent.spam, ["You board the longship..."]);
  assert.deepEqual(player.sent.interfaces, [CacheDefinitions.getInterfaceId("misc_shipjourney")]);
  assert.deepEqual(player.sent.anims, [[CacheDefinitions.getComponentId("misc_shipjourney:misc_shipmodel"), CacheDefinitions.getSeqId("misc_shipjourney_to_misc")]]);
  assert.deepEqual(player.sent.scripts, [[2524, 4404769, 0]]);
  assert.deepEqual(player.sent.jingles, [171]);
  tick(7);
  assert.deepEqual(at(player), [2581, 3845, 0]);
  assert.deepEqual(player.sent.spam, ["You board the longship...", "The ship arrives at Miscellania."]);
  assert.equal(player.sent.boxes.length, 0, "no message box");

  quests.started.add("the_fremennik_isles");
  const ferry = createPlayer({ at: new Location(2644, 3709, 0) });
  click(ferry, "Mord Gunnars", "Jatizso");
  assert.deepEqual(ferry.sent.spam, ["Leaving Rellekka for Jatizso."]);
  assert.equal(ferry.sent.songs.length, 0, "the Gunnars' ships have no song or jingle");
  tick(10);
  assert.deepEqual(at(ferry), [2420, 3782, 0]);
});

test("Captain Bentley's galleon sails from Pirates' Cove; from Lunar Isle he fades back", () => {
  const player = createPlayer({ at: new Location(2222, 3797, 2) });
  click(player, "Captain Bentley", "Travel", { at: [2222, 3796] });
  assert.deepEqual(player.sent.interfaces, [CacheDefinitions.getInterfaceId("quest_lunar_galleon")]);
  assert.deepEqual(player.sent.anims, [[CacheDefinitions.getComponentId("quest_lunar_galleon:lunar_galleon"), CacheDefinitions.getSeqId("quest_lunar_set_sail_right")]]);
  assert.equal(player.area, null, "no instanced ship: the player waits on deck");
  tick(10);
  assert.deepEqual(at(player), [2222, 3797, 2]);
  tick(1);
  assert.deepEqual(at(player), [2130, 3899, 2]);

  click(player, "Captain Bentley", "Travel", { at: [2138, 3899] });
  tick(3);
  assert.deepEqual(at(player), [2224, 3796, 2]);
});

test("Torfinn's fade: spam on boarding, the minimap off from the first tick, Ungael on the third", () => {
  const minimap = CacheDefinitions.getVarbitId("minimap_state");
  const player = createPlayer({ at: new Location(2640, 3697, 0) });
  click(player, "Torfinn", "Ungael");
  assert.deepEqual(player.sent.spam, ["You board the boat and travel to Ungael."]);
  assert.deepEqual(player.sent.subs.at(-1).options.postScripts[0].args, [0, 255, 0, 0, 50]);
  tick(1);
  assert.equal(player.sent.varbits.get(minimap), 2);
  tick(2);
  assert.deepEqual(at(player), [2277, 4034, 0]);
  assert.equal(player.blocked, true);
  tick(2);
  assert.equal(player.sent.varbits.get(minimap), 0);
  assert.deepEqual(player.sent.subs.at(-1).options.postScripts[0].args, [0, 0, 0, 255, 50]);
  assert.equal(player.blocked, false);
  tick(2);
  assert.ok(player.sent.closed.includes((161 << 16) | 1));
});

/** A real Player whose packets are recorded; `varbits` answers what the client was last sent. */
function realPlayer(at, varbits = new Map()) {
  const player = new Player(null);
  const sent = { spam: [], subs: [], varbits: new Map(), closed: [] };
  const sender = new Proxy({
    sendTypedMessage: (type, text) => (sent.spam.push(text), sender),
    sendSubInterface: (uid, id, type, options) => (sent.subs.push({ uid, id, options }), sender),
    closeSubInterface: (uid) => (sent.closed.push(uid), sender),
    sendVarbit: (id, value) => (sent.varbits.set(id, value), sender),
    getVarbit: (id) => varbits.get(id) ?? 0,
    getVarp: () => 0,
  }, { get: (target, key) => target[key] ?? (() => sender) });
  player.getPacketSender = () => sender;
  player.setUsername("ungaelboat");
  player.setRegistered(true);
  player.setLocation(at);
  return { player, sent };
}

/** Op1 on the Rellekka boat as the client sends it: the base multiloc, the variant the player sees. */
function clickBoat(player) {
  const BOAT = CacheDefinitions.getLocId("fremennik_boat_ungael");
  const event = { player, objectId: BOAT, clickType: 1, definition: ObjectDefinition.forPlayer(BOAT, player), location: { x: 2638, y: 3696, z: 0 }, handled: false };
  for (const handler of hooks.object) handler(event);
  return event;
}

test("the Rellekka boat's Travel sails to Ungael as Torfinn's boat does; without it there is no option", () => {
  const frem = CacheDefinitions.getVarbitId("ds2_frem");
  // Recorded (229/2334) after Dragon Slayer II: the boat shows Travel and sails as Torfinn's does.
  const after = realPlayer(new Location(2639, 3697, 0), new Map([[frem, 30]]));
  const event = clickBoat(after.player);
  assert.equal(event.definition.getInteractions()[0], "Travel");
  assert.equal(event.handled, true);
  assert.deepEqual(after.sent.spam, ["You board the boat and travel to Ungael."]);
  // A second click while sailing doesn't start another voyage.
  clickBoat(after.player);
  assert.deepEqual(after.sent.spam, ["You board the boat and travel to Ungael."]);
  assert.equal(after.player.getMovementQueue().isMovementBlocked(), true);
  tick(3);
  assert.deepEqual(at(after.player), [2277, 4034, 0]);
  tick(4);
  assert.equal(after.player.getMovementQueue().isMovementBlocked(), false);

  // Before the quest gets there (ds2_frem under 20) the boat has no option, so nothing sails.
  const before = realPlayer(new Location(2639, 3697, 0), new Map([[frem, 19]]));
  const early = clickBoat(before.player);
  assert.equal(early.definition.getInteractions()?.[0], undefined);
  assert.equal(early.handled, false);
  assert.deepEqual(before.sent.spam, []);
  assert.deepEqual(at(before.player), [2639, 3697, 0]);
});

test("Veos's ship fades with the sea's song and says where it sails as the player lands", () => {
  const player = createPlayer({ at: new Location(1826, 3691, 0) });
  click(player, "Cabin Boy Herbert", "Port Sarim");
  assert.deepEqual(player.sent.songs, [147]);
  assert.deepEqual(player.sent.jingles, [171]);
  tick(2);
  assert.equal(player.sent.messages.length, 0);
  tick(1);
  assert.deepEqual(at(player), [3055, 3242, 1]);
  assert.deepEqual(player.sent.messages, ["You board the ship and sail to Port Sarim."]);

  // Veos's menu has no travel step: his closing line sails to the port picked.
  const talker = createPlayer({ at: new Location(3054, 3245, 0) });
  const definition = { getName: () => "Veos" };
  for (const handler of hooks.events.get("npc-dialogue:choice")) handler({ player: talker, definition, option: "I'd like to travel to Land's End, please." });
  const line = { player: talker, definition, text: "As you wish, I hope you don't get seasick, it is a long voyage." };
  for (const handler of hooks.events.get("npc-dialogue:line")) handler(line);
  line.after();
  tick(3);
  assert.deepEqual(at(talker), [1504, 3395, 1]);
  const owned = { player: talker, definition, text: line.text, after: () => {} };
  const previous = owned.after;
  for (const handler of hooks.events.get("npc-dialogue:line")) handler(owned);
  assert.equal(owned.after, previous, "a quest that already sails after the line keeps it");
});

test("Jeb rows across under seaslug_boat_travel and lands on the platform with its message box", () => {
  const player = createPlayer({ at: new Location(2718, 3304, 0) });
  click(player, "Jeb", "Travel", { at: [2719, 3304] });
  tick(2);
  assert.deepEqual(at(player), [2782, 3273, 0]);
  assert.deepEqual(player.sent.interfaces, [CacheDefinitions.getInterfaceId("seaslug_boat_travel")]);
  assert.deepEqual(player.sent.shown, [CacheDefinitions.getComponentId("seaslug_boat_travel:seaslug_witchhaven_to_fishingpier_layer")]);
  assert.deepEqual(player.sent.jingles, [172]);
  tick(6);
  assert.deepEqual(player.sent.boxes, ["You arrive at the fishing platform."]);
  assert.equal(player.blocked, false);
});

test("a logout at sea lands the player at the destination; a shutdown lands everyone", () => {
  const player = createPlayer();
  click(player, "Squire", "Travel", { gameval: "pest_squire_ship_portsarim" });
  tick(4);
  for (const handler of hooks.logout) handler({ player });
  assert.deepEqual(at(player), [2663, 2676, 1]);
  assert.equal(player.blocked, false);
  assert.equal(Common.travelling(player), false);

  const rower = createPlayer({ at: new Location(3361, 3446, 0) });
  click(rower, "Barge guard", "Quick-Travel");
  for (const handler of hooks.shutdown) handler({});
  assert.deepEqual(at(rower), [3724, 3808, 0]);
});

test("quest plugins hand crossings over with ferries:travel", () => {
  const player = createPlayer({ at: new Location(2620, 3693, 0) });
  const request = { player, route: "pirates-cove", handled: false };
  api.emitCustomEvent("ferries:travel", request);
  assert.equal(request.handled, true);
  tick(3);
  assert.deepEqual(at(player), [2213, 3794, 0]);
  const unknown = { player: createPlayer(), route: "atlantis", handled: false };
  api.emitCustomEvent("ferries:travel", unknown);
  assert.equal(unknown.handled, false, "the quest falls back to its own move");
});

test("Barnaby's three destinations fade, sail and arrive without casting a teleport or charging twice", () => {
  const destinations = [[2680, 3274, 0], [2768, 3227, 0], [2916, 3225, 0]];
  for (const [index, port] of BarnabyFerry._test.PORTS.entries()) {
    const player = createPlayer({ coins: 100 });
    const sail = () => BarnabyFerry._test.sail(player, port, BarnabyFerry._test.fareFor(player));
    sail();
    sail();
    assert.equal(player.getInventory().getAmount(ItemIdentifiers.COINS), 70, "only the accepted voyage charges");
    assert.deepEqual(player.sent.messages, ["You pay 30 coins and board the ship."]);
    assert.equal(player.blocked, true);
    assert.equal(player.sent.subs.length, 1);
    assert.equal(player.sent.subs[0].id, 174, "fade overlay, not a spellbook animation");
    assert.deepEqual(player.sent.subs[0].options.postScripts, [{ scriptId: 948, args: [0, 255, 0, 0, 50] }]);
    tick(2);
    assert.deepEqual(at(player), [3046, 3236, 0], "the crossing takes time");
    tick(1);
    assert.deepEqual(at(player), destinations[index]);
    assert.equal(player.blocked, true, "arrival remains held until fade-in");
    tick(1);
    assert.deepEqual(player.sent.subs[1].options.postScripts, [{ scriptId: 948, args: [0, 0, 0, 255, 50] }]);
    assert.equal(player.blocked, false);
    assert.equal(Common.travelling(player), false);
    tick(3);
    assert.deepEqual(player.sent.closed, [(161 << 16) | 1]);
  }
});

test("logging out on Barnaby's discounted crossing lands the player and releases the travel hold", () => {
  const player = createPlayer({ coins: 100, worn: [ItemIdentifiers.KARAMJA_GLOVES_1] });
  const port = BarnabyFerry._test.PORTS[1];
  BarnabyFerry._test.sail(player, port, BarnabyFerry._test.fareFor(player));
  assert.equal(player.getInventory().getAmount(ItemIdentifiers.COINS), 85);
  tick(1);
  for (const handler of hooks.logout) handler({ player });
  player.setRegistered(false);
  assert.deepEqual(at(player), [2768, 3227, 0]);
  assert.equal(player.blocked, false);
  assert.equal(Common.travelling(player), false);
  tick(10);
  assert.equal(player.sent.subs.length, 1, "logged-out players receive no later fade callbacks");
  assert.equal(player.getInventory().getAmount(ItemIdentifiers.COINS), 85);
});

test("Achilka's riverboat: fade, minimap and busy off on +1, Kastori with the captured message on +3, back on +5", () => {
  const minimap = CacheDefinitions.getVarbitId("minimap_state");
  const busy = CacheDefinitions.getVarbitId("busy");
  const player = createPlayer({ at: new Location(1257, 3122, 0) });
  const event = click(player, "Achilka", "Kastori", { gameval: "tlati_riverboat_owner_west" });
  assert.equal(event.handled, true);
  assert.deepEqual(player.sent.subs.at(-1).options.postScripts[0].args, [0, 255, 0, 0, 50]);
  tick(1);
  assert.equal(player.sent.varbits.get(minimap), 2);
  assert.equal(player.sent.varbits.get(busy), 1);
  tick(2);
  assert.deepEqual(at(player), [1390, 3074, 0]);
  assert.deepEqual(player.sent.spam, ["Achilka takes you along the river to Kastori."]);
  tick(2);
  assert.equal(player.sent.varbits.get(minimap), 0);
  assert.equal(player.sent.varbits.get(busy), 0);
  assert.deepEqual(player.sent.subs.at(-1).options.postScripts[0].args, [0, 0, 0, 255, 50]);
  assert.equal(player.blocked, false);
  tick(2);
  assert.ok(player.sent.closed.includes((161 << 16) | 1));
});

test("every Achilka offers the other two stops; her transcript rides and hides the stop she stands at", () => {
  const stops = { tlati_riverboat_owner_south: "Kastori", tlati_riverboat_owner_west: "Tal Teklan", tlati_riverboat_owner_north: "Gloomthorn Trail" };
  for (const [gameval, stop] of Object.entries(stops)) {
    const definition = CacheDefinitions.getNpc(npcId(gameval));
    assert.equal(definition.name, "Achilka");
    const others = Object.values(stops).filter((other) => other !== stop).sort();
    assert.deepEqual(definition.actions.filter((action) => action && action !== "Talk-to").sort(), others, gameval);
    for (const option of others) {
      tasks = [];
      const player = createPlayer();
      assert.equal(click(player, "Achilka", option, { gameval }).handled, true, `${gameval} ${option}`);
    }
  }
  const player = createPlayer();
  const step = { player, stepId: "WjyUrt", handled: false };
  for (const handler of hooks.events.get("npc-dialogue:action")) handler(step);
  assert.equal(step.handled, true);
  tick(7);
  assert.deepEqual(at(player), [1400, 3246, 0]);
  const west = npcId("tlati_riverboat_owner_west");
  const ask = (name, text) => hooks.conditions.map((handler) => handler({
    player, npcId: west, text, definition: { getName: () => name },
  })).find((answer) => answer != null);
  assert.equal(ask("Achilka", "If not already at Tal Teklan:"), false);
  assert.equal(ask("Achilka", "If not already at Kastori:"), true);
  assert.equal(ask("Hans", "If not already at Kastori:"), undefined);
});

test("every route's gamevals resolve in the cache", () => {
  for (const [name, route] of Object.entries(Common.data.routes)) {
    if (route.seq) assert.ok(CacheDefinitions.getSeqId(route.seq) != null, `${name}: ${route.seq}`);
    if (route.layer) assert.ok(CacheDefinitions.getComponentId(route.layer) != null, `${name}: ${route.layer}`);
  }
  for (const entry of Common.data.ops) {
    for (const gameval of entry.from ?? []) assert.ok(npcId(gameval) != null, gameval);
    assert.ok(Common.data.routes[entry.route], entry.route);
  }
  assert.equal(Ferries.members, true);
});
