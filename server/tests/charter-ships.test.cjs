// Run after `yarn build`: node --test tests/charter-ships.test.cjs
const assert = require("node:assert/strict");
const { test, before } = require("node:test");
const path = require("node:path");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();

const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { CacheDefinitions } = require("../dist/game/cache/CacheDefinitions");
const { Equipment } = require("../dist/game/model/container/impl/Equipment");
const { ItemIdentifiers } = require("../dist/util/ItemIdentifiers");
const { Location } = require("../dist/game/model/Location");
const CharterShips = require("../plugins/world/CharterShips.plugin");

const varbitId = (name) => CacheDefinitions.getVarbitId(name);
const varpId = (name) => CacheDefinitions.getVarpId(name);

let completeQuests = new Set();
const dialogueStarts = [];
const tasks = [];
const hooks = { npcs: [], generic: [], clicks: [], events: new Map(), conditions: [], persisted: new Map(), teleports: [] };
let prompt = null;

class Task {
  constructor(delay, key) {
    this.delay = delay;
    this.key = key;
    this.running = true;
  }

  stop() {
    this.running = false;
  }
}

function emitCustomEvent(name, request) {
  if (name === "quest:is-complete") request.complete = completeQuests.has(request.key);
  if (name === "npc-dialogue:start") {
    dialogueStarts.push(request);
    request.handled = true;
  }
}

const api = {
  core: {
    CacheDefinitions,
    Location,
    ItemIdentifiers,
    Equipment,
    ChatType: { SPAM: "spam" },
    Mobile: { onBeforeTeleport: (listener) => hooks.teleports.push(listener) },
    Task,
    TaskManager: { submit: (task) => tasks.push(task) },
    ShopManager: { open: () => true },
  },
  persistAttribute: (key, value) => hooks.persisted.set(key, value),
  onPlayerLogin: () => {},
  onNpcsInteraction: (names, actions) => hooks.npcs.push({ names, actions }),
  onNpcInteraction: (handler) => hooks.generic.push(handler),
  onInterfaceActionClick: (handler) => hooks.clicks.push(handler),
  onCustomEvent: (name, handler) => hooks.events.set(name, handler),
  onNpcDialogueCondition: (handler) => hooks.conditions.push(handler),
  sendMultiChatboxPrompt: (player, title, ...options) => {
    prompt = { title, labels: options.filter((o) => typeof o === "string"), options };
    return true;
  },
  emitCustomEvent,
  log() {},
};

/** Runs every queued task one tick; returns how many ticks until none is left. */
function runTasks() {
  let ticks = 0;
  while (tasks.some((task) => task.running) && ticks < 50) {
    ticks++;
    for (const task of [...tasks]) if (task.running) task.execute();
  }
  tasks.length = 0;
  return ticks;
}

function choosePrompt(label) {
  prompt.options[prompt.options.indexOf(label) + 1]();
}

function createPlayer({ at, coins = 10000, ring = 0, items = [], varbits = {}, varps = {} } = {}) {
  const equipment = new Array(14).fill(null).map(() => ({ getId: () => 0 }));
  if (ring) equipment[Equipment.RING_SLOT] = { getId: () => ring };
  const varbitValues = new Map(Object.entries(varbits).map(([name, value]) => [varbitId(name), value]));
  const varpValues = new Map(Object.entries(varps).map(([name, value]) => [varpId(name), value]));
  const attributes = new Map();
  const sent = { varbits: [], interfaces: [], subs: [], closed: [], flags: [], scripts: [], typed: [], jingles: [], removals: 0 };
  let balance = coins;
  let location = at;
  let interfaceId = -1;
  let blocked = false;
  let dying = false;
  const moves = [];
  const sender = {
    getVarbit: (id) => varbitValues.get(id) ?? 0,
    getVarp: (id) => varpValues.get(id) ?? 0,
    sendVarbit: (id, value) => { varbitValues.set(id, value); sent.varbits.push([id, value]); return sender; },
    sendClientScript: (id, ...args) => { sent.scripts.push([id, ...args]); return sender; },
    getSubInterfaceAt: (uid) => uid === ((161 << 16) | 16) && interfaceId >= 0 ? { targetUid: uid, groupId: interfaceId, type: 0 } : undefined,
    sendInterface: (id) => { interfaceId = id; sent.interfaces.push(id); return sender; },
    sendSubInterface: (uid, id, type, options) => { sent.subs.push({ uid, id, type, options }); return sender; },
    closeSubInterface: (uid) => { sent.closed.push(uid); return sender; },
    sendInterfaceRemoval: () => { interfaceId = -1; sent.removals++; return sender; },
    sendInterfaceFlagsRange: (uid, from, to, flags) => { sent.flags.push({ uid, from, to, flags }); return sender; },
    sendTypedMessage: (type, text) => { sent.typed.push({ type, text }); return sender; },
    sendJingle: (id, delay) => { sent.jingles.push([id, delay]); return sender; },
  };
  const movement = {
    setBlockMovement: (value) => { blocked = value; return movement; },
    reset: () => movement,
  };
  return {
    sent,
    moves,
    get balance() { return balance; },
    get blocked() { return blocked; },
    /** What PlayerDeath does as hitpoints reach zero: dying, and movement locked. */
    die() { dying = true; blocked = true; },
    varbit: (name) => varbitValues.get(varbitId(name)) ?? 0,
    getPacketSender: () => sender,
    getEquipment: () => ({ get: (slot) => equipment[slot] }),
    getInventory: () => ({
      getAmount: (id) => (id === ItemIdentifiers.COINS ? balance : 0),
      contains: (id) => items.includes(id),
      deleteNumber: (id, amount) => { balance = Math.max(0, balance - amount); },
      refreshItems: () => {},
    }),
    getLocation: () => location,
    getMovementQueue: () => movement,
    // Mobile.moveTo tells the teleport listeners first, as every teleport source does.
    moveTo(target) { for (const listener of hooks.teleports) listener(this, target); location = target; moves.push(target); },
    isPlayer: () => true,
    isDyingReturn: () => dying,
    getInterfaceId: () => interfaceId,
    isRegistered: () => true,
    getAttribute: (key) => attributes.get(key),
    setAttribute: (key, value) => attributes.set(key, value),
  };
}

const row = (slug) => CharterShips._test.destinations().find((entry) => entry.slug === slug);
const tile = (x, y, z = 0) => new Location(x, y, z);
const SARIM_DOCK = tile(3039, 3193);
const CATHERBY_DOCK = tile(2796, 3414);
const MAP_COMPONENT = () => CacheDefinitions.getComponentId("sailing_menu:content");
const LIST_COMPONENT = () => CacheDefinitions.getComponentId("chartering_menu_side:list_content");

function click(player, component, slot) {
  const event = { player, buttonId: component, groupId: component >>> 16, childId: component & 0xffff, slot, handled: false };
  hooks.clicks[0](event);
  return event;
}

function trader(name, slug, options) {
  const ops = ["Talk-to", null, "Trade", "Charter", slug ? `Charter-to ${slug}` : null];
  return {
    npc: { getId: () => 1334, getLocation: () => tile(3039, 3193) },
    definition: { getName: () => name, getId: () => 9379, getActions: () => ops },
    ...options,
  };
}

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  CharterShips.register(api);
});

test("the destinations are the cache's chartering_destinations rows, decks on plane 1", () => {
  const rows = CharterShips._test.destinations();
  assert.equal(rows.length, 24);
  assert.deepEqual(rows.slice(0, 3).map((entry) => entry.name), ["Port Sarim", "Brimhaven", "Catherby"]);
  // Captured landings: the Pandemonium (rsprox 235/3834) and Port Tyras (237/1103).
  assert.deepEqual(row("pandemonium").deck, { x: 3060, y: 3000, z: 1 });
  assert.deepEqual(row("porttyras").deck, { x: 2142, y: 3125, z: 1 });
  assert.equal(row("pandemonium").inlineName, "the Pandemonium");
  assert.equal(row("brimhaven").inlineName, "Brimhaven");
  assert.equal(CharterShips._test.portAt(SARIM_DOCK).slug, "portsarim");
  assert.equal(CharterShips._test.portAt(tile(3039, 3193, 1)), null, "the deck is not in the port's zone");
});

test("captured clicks resolve sub 2k+1 on the map and 2k on the list to table row k", () => {
  // rsprox: Brimhaven 3, Port Tyras 17, Civitas illa Fortis 27, Aldarin 29, the Pandemonium 37.
  const rows = CharterShips._test.destinations();
  const bySub = (sub) => rows[Math.floor(sub / 2)].slug;
  assert.deepEqual([3, 17, 27, 29, 37].map(bySub), ["brimhaven", "porttyras", "fortis", "aldarin", "pandemonium"]);
});

test("availability follows client script 9104: quest varps, visits and excluded routes", () => {
  const { available } = CharterShips._test;
  const sarim = row("portsarim");
  const bare = createPlayer({ at: SARIM_DOCK });
  assert.equal(available(bare, sarim, row("catherby")), true);
  assert.equal(available(bare, sarim, row("porttyras")), false, "Regicide not done");
  assert.equal(available(createPlayer({ varps: { regicide_quest: 15 } }), sarim, row("porttyras")), true);
  assert.equal(available(bare, sarim, row("musapoint")), false, "no Sarim-Musa route");
  assert.equal(available(bare, row("catherby"), row("musapoint")), true);
  assert.equal(available(createPlayer({ varps: { priestperil: 61 } }), row("mosleharmless"), row("portphasmatys")), false);
  assert.equal(available(createPlayer({ varps: { priestperil: 61 } }), sarim, row("portphasmatys")), true);
  assert.equal(available(createPlayer({ varps: { fever_quest: 140 } }), sarim, row("mosleharmless")), false, "Mos needs Priest in Peril too");
  assert.equal(available(bare, sarim, row("tempestus")), false);
  assert.equal(available(bare, sarim, row("crandor")), false);
  assert.equal(available(createPlayer({ varps: { dragonquest: 5 } }), sarim, row("crandor")), true);
  const sailingOn = { content_restrict_sailing_serverside: 1, sailing_intro: 16 };
  assert.equal(available(createPlayer({ varbits: { sailing_intro: 16 } }), row("catherby"), row("pandemonium")), false, "Sailing content");
  assert.equal(available(createPlayer({ varbits: sailingOn }), row("catherby"), row("pandemonium")), true);
  assert.equal(available(createPlayer({ varbits: sailingOn }), sarim, row("pandemonium")), false);
  assert.equal(available(createPlayer({ varbits: { varlamore_visited: 1 } }), row("aldarin"), row("sunsetcoast")), false);
  assert.equal(available(createPlayer({ varbits: { varlamore_visited: 1 } }), row("fortis"), row("aldarin")), true);
});

test("fares are the Wiki's directed table, halved by a ring of charos(a) and by Cabin Fever", () => {
  const { fareBetween, fareFor } = CharterShips._test;
  completeQuests = new Set();
  assert.equal(fareBetween("Corsair Cove", "The Pandemonium"), 800);
  assert.equal(fareBetween("Red Rock", "Corsair Cove"), 1500);
  assert.equal(fareBetween("Port Sarim", "Musa Point"), null);
  const player = createPlayer();
  assert.equal(fareFor(player, row("catherby"), row("portsarim")), 1000);
  // rsprox with one halving: Catherby to Corsair Cove 500, to Port Tyras 1,600, to the Pandemonium 600.
  const ringed = createPlayer({ ring: ItemIdentifiers.RING_OF_CHAROS_A_ });
  assert.equal(fareFor(ringed, row("catherby"), row("corsaircove")), 500);
  assert.equal(fareFor(ringed, row("catherby"), row("porttyras")), 1600);
  assert.equal(fareFor(ringed, row("catherby"), row("pandemonium")), 600);
  completeQuests = new Set(["cabin_fever"]);
  assert.equal(fareFor(ringed, row("brimhaven"), row("catherby")), 120);
  // Mos fares already include Cabin Fever: only the ring halves them.
  assert.equal(fareFor(player, row("catherby"), row("mosleharmless")), 1250);
  assert.equal(fareFor(ringed, row("catherby"), row("mosleharmless")), 625);
  completeQuests = new Set();
});

test("Charter opens the map and its list with op1 on every marker and row", () => {
  const player = createPlayer({ at: SARIM_DOCK });
  const event = trader("Trader Stan", null, { player, clickType: 4, handled: false });
  const charter = hooks.npcs.find((hook) => hook.names.includes("Trader Stan")).actions.Charter;
  assert.equal(charter(event), true);
  assert.equal(player.varbit("content_restrict_sailing_serverside"), 1);
  assert.deepEqual(player.sent.scripts[0], [917, -1, -1]);
  assert.deepEqual(player.sent.interfaces, [CacheDefinitions.getInterfaceId("sailing_menu")]);
  assert.deepEqual(player.sent.subs[0], { uid: (161 << 16) | 74, id: CacheDefinitions.getInterfaceId("chartering_menu_side"), type: 3, options: undefined });
  assert.deepEqual(player.sent.flags.map((flag) => [flag.uid, flag.from, flag.to, flag.flags]), [
    [MAP_COMPONENT(), 0, 47, 2],
    [LIST_COMPONENT(), 0, 47, 2],
  ]);
  runTasks();
  assert.equal(player.varbit("busy"), 1);
});

test("a picked port asks first, then pays and lands on the deck on the captured ticks", () => {
  completeQuests = new Set();
  prompt = null;
  const player = createPlayer({ at: SARIM_DOCK });
  CharterShips._test.openMap(player);
  runTasks();
  click(player, MAP_COMPONENT(), row("catherby").index * 2 + 1);
  assert.equal(prompt.title, "Sail to Catherby for 1,000 coins?");
  assert.deepEqual(prompt.labels, ["Yes.", "Choose again.", "Yes, and don't ask again.", "Cancel."]);
  assert.equal(player.balance, 10000, "nothing paid before Yes");

  choosePrompt("Cancel.");
  assert.equal(player.balance, 10000);
  assert.equal(player.varbit("busy"), 0);

  CharterShips._test.openMap(player);
  runTasks();
  click(player, LIST_COMPONENT(), row("catherby").index * 2);
  choosePrompt("Yes, and don't ask again.");
  assert.equal(player.balance, 9000);
  assert.equal(player.varbit("settings_warning_confirmation_charter_ships"), 1);
  assert.equal(player.varbit("chartering_previous_destination"), row("catherby").id);
  assert.deepEqual(player.sent.typed.at(-1), { type: "spam", text: "You pay 1,000 coins and sail to Catherby." });
  assert.deepEqual(player.sent.jingles.at(-1), [171, 0]);
  assert.equal(player.blocked, true);
  const fadeOut = player.sent.subs.at(-1);
  assert.equal(fadeOut.id, 174);
  assert.deepEqual(fadeOut.options.postScripts[0], { scriptId: 948, args: [0, 255, 0, 0, 50] });

  // Tick by tick: minimap off on 1, land on 3, fade in on 4, overlay closed on 6.
  assert.equal(tasks.length, 1);
  const [task] = tasks;
  const timeline = [];
  for (let tick = 1; tick <= 6; tick++) {
    const before = { moves: player.moves.length, subs: player.sent.subs.length };
    task.execute();
    timeline.push({
      tick,
      minimap: player.varbit("minimap_state"),
      moved: player.moves.length > before.moves,
      fadeIn: player.sent.subs.length > before.subs,
    });
  }
  assert.deepEqual(timeline.map((entry) => entry.minimap), [2, 2, 2, 0, 0, 0]);
  assert.deepEqual(timeline.map((entry) => entry.moved), [false, false, true, false, false, false]);
  assert.deepEqual(timeline.map((entry) => entry.fadeIn), [false, false, false, true, false, false]);
  assert.equal(task.running, false);
  assert.equal(player.blocked, false);
  assert.equal(player.getLocation().getX(), 2792);
  assert.equal(player.getLocation().getY(), 3417);
  assert.equal(player.getLocation().getZ(), 1);
  tasks.length = 0;
});

test("without the fare the crew say what it costs and offer only Choose again / Cancel", () => {
  prompt = null;
  const player = createPlayer({ at: CATHERBY_DOCK, coins: 499 });
  CharterShips._test.openMap(player);
  click(player, MAP_COMPONENT(), row("corsaircove").index * 2 + 1);
  assert.equal(prompt.title, "Sailing to Corsair Cove costs 1,000 coins.");
  assert.deepEqual(prompt.labels, ["Choose again", "Cancel"]);
  choosePrompt("Choose again");
  assert.equal(player.getInterfaceId(), CacheDefinitions.getInterfaceId("sailing_menu"));
  assert.equal(player.balance, 499);
  tasks.length = 0;
});

test("the current port and locked ports cannot be picked", () => {
  prompt = null;
  const player = createPlayer({ at: SARIM_DOCK });
  CharterShips._test.openMap(player);
  click(player, MAP_COMPONENT(), row("portsarim").index * 2 + 1);
  click(player, MAP_COMPONENT(), row("porttyras").index * 2 + 1);
  assert.equal(prompt, null);
  assert.equal(player.balance, 10000);
  tasks.length = 0;
});

test("with the warning off a click sails at once, and Charter-to goes to the last destination", () => {
  const player = createPlayer({ at: CATHERBY_DOCK, varps: { regicide_quest: 15 } });
  player.setAttribute(CharterShips._test.SKIP_CONFIRMATION_ATTRIBUTE, true);
  player.setAttribute(CharterShips._test.PREVIOUS_DESTINATION_ATTRIBUTE, row("porttyras").id);
  const event = trader("Trader Crewmember", "Port Tyras", { player, clickType: 5, handled: false });
  hooks.generic[0](event);
  assert.equal(event.handled, true);
  assert.equal(player.balance, 6800);
  assert.deepEqual(player.sent.typed.at(-1), { type: "spam", text: "You pay 3,200 coins and sail to Port Tyras." });
  runTasks();
  assert.deepEqual([player.getLocation().getX(), player.getLocation().getY(), player.getLocation().getZ()], [2142, 3125, 1]);
});

test("Charter-to at the last destination itself plays the crew's question", () => {
  dialogueStarts.length = 0;
  const player = createPlayer({ at: SARIM_DOCK });
  player.setAttribute(CharterShips._test.PREVIOUS_DESTINATION_ATTRIBUTE, row("portsarim").id);
  const event = trader("Trader Crewmember", "Port Sarim", { player, clickType: 5, handled: false });
  hooks.generic[0](event);
  assert.equal(dialogueStarts.at(-1).variant, "right-click-charter-to-current-location");
  assert.equal(dialogueStarts.at(-1).npcId, 9379, "the transcript is the transformed crewmember's");
  assert.equal(player.balance, 10000);
});

test("rum or a bedsheet stops Charter with the transcript's own refusal", () => {
  dialogueStarts.length = 0;
  const rum = CacheDefinitions.getObjId("karamja_rum");
  const player = createPlayer({ at: SARIM_DOCK, items: [rum] });
  const event = trader("Trader Crewmember", null, { player, clickType: 4, handled: false });
  hooks.npcs.find((hook) => hook.names.includes("Trader Crewmember")).actions.Charter(event);
  assert.equal(player.sent.interfaces.length, 0, "no map");
  const steps = [{ type: "condition", text: "If the player has the bedsheet in their inventory:", steps: [{ npc: "laundry" }] },
    { type: "condition", text: "If the player has Karamjan rum in their inventory:", steps: [{ npc: "rum" }] }];
  assert.deepEqual(dialogueStarts.at(-1).select(steps), [{ npc: "rum" }]);
});

test("Talk-to's transcript opens the map and answers its item conditions", () => {
  const player = createPlayer({ at: SARIM_DOCK, items: [CacheDefinitions.getObjId("ahoy_bedsheet")] });
  const definition = { getName: () => "Trader Crewmember" };
  const answer = (text) => hooks.conditions[0]({ player, definition, text });
  assert.equal(answer("If the player does not have the bedsheet in their inventory:"), false);
  assert.equal(answer("If the player has the bedsheet in their inventory:"), true);
  assert.equal(answer("If the player has the ectoplasm covered bedsheet in their inventory:"), false);
  assert.equal(answer("If the player has Karamjan rum in their inventory:"), false);
  assert.equal(answer("If the player chooses Crandor during Dragon Slayer I:"), false);

  const clean = createPlayer({ at: SARIM_DOCK });
  const action = { player: clean, definition, action: "open_interface", target: "Charter ship", handled: false };
  hooks.events.get("npc-dialogue:action")(action);
  assert.equal(action.handled, true);
  assert.equal(action.end, true);
  runTasks();
  assert.deepEqual(clean.sent.interfaces, [CacheDefinitions.getInterfaceId("sailing_menu")]);
  const stan = { player: clean, definition: { getName: () => "Trader Stan" }, text: "The player chooses from :File:Trade charter map.png", handled: false };
  hooks.events.get("npc-dialogue:action")(stan);
  assert.equal(stan.handled, true);
  tasks.length = 0;
});

test("a passenger who dies before arrival stays where they died, still locked", () => {
  tasks.length = 0;
  const player = createPlayer({ at: CATHERBY_DOCK });
  CharterShips._test.sail(player, row("brimhaven"), 480);
  const [task] = tasks;
  task.execute();
  task.execute();
  player.die();
  for (let tick = 3; tick <= 6; tick++) task.execute();
  assert.deepEqual(player.moves, [], "never put on the deck");
  assert.equal(player.getLocation(), CATHERBY_DOCK);
  assert.equal(player.blocked, true, "the death keeps its movement lock");
  assert.equal(task.running, false);
  assert.equal(player.varbit("minimap_state"), 0);
  assert.equal(player.varbit("busy"), 0);
  assert.ok(player.sent.closed.includes((161 << 16) | 1), "the fade overlay is taken down");
  tasks.length = 0;
});

test("a relocated passenger's voyage ends, and its leftover ticks never touch the next one", () => {
  tasks.length = 0;
  const player = createPlayer({ at: CATHERBY_DOCK });
  CharterShips._test.sail(player, row("brimhaven"), 480);
  const [first] = tasks;
  first.execute();
  player.moveTo(SARIM_DOCK);
  assert.equal(player.blocked, false, "a teleport frees the voyage's lock");

  CharterShips._test.sail(player, row("catherby"), 1000);
  assert.equal(tasks.length, 2, "a new voyage can start at once");
  const second = tasks[1];
  for (let tick = 2; tick <= 6; tick++) first.execute();
  assert.equal(first.running, false);
  assert.deepEqual(player.moves.slice(1), [], "the old voyage lands nobody");
  assert.equal(player.blocked, true, "nor frees the new voyage's lock");

  for (let tick = 1; tick <= 6; tick++) second.execute();
  assert.equal(player.getLocation().getX(), row("catherby").deck.x);
  assert.equal(player.blocked, false);
  assert.equal(second.running, false);
  tasks.length = 0;
});

test("closing the map closes its list", () => {
  const player = createPlayer({ at: SARIM_DOCK });
  hooks.events.get("interface:closed")({ player, interfaceId: CacheDefinitions.getInterfaceId("sailing_menu") });
  assert.deepEqual(player.sent.closed, [(161 << 16) | 74]);
});

test("the plugin persists the last destination and the warning, and hooks by name", () => {
  assert.equal(CharterShips.members, true);
  assert.equal(hooks.persisted.get(CharterShips._test.PREVIOUS_DESTINATION_ATTRIBUTE), 0);
  assert.equal(hooks.persisted.get(CharterShips._test.SKIP_CONFIRMATION_ATTRIBUTE), false);
  const names = hooks.npcs[0].names;
  assert.ok(names.includes("Trader Stan") && names.includes("Trader Crewmember"));
  assert.deepEqual(Object.keys(hooks.npcs[0].actions), ["Charter", "Trade"], "Talk-to stays with the transcript");
});

test("the transcripts play the crew's current-port question as an exact variant, by name", () => {
  const starts = new Map();
  require("../plugins/npcs/NpcDialogues.plugin").register(new Proxy({
    core: {},
    onCustomEvent: (name, handler) => starts.set(name, handler),
  }, { get: (target, key) => target[key] ?? (() => {}) }));
  const shown = [];
  const player = {
    getDialogueManager: () => ({
      reset() {},
      startDialogues(chain) {
        for (const entry of [...chain.getDialogues().values()]) shown.push(entry.getText?.() ?? entry.constructor.name);
      },
    }),
    getPacketSender: () => ({ sendInterfaceRemoval() {} }),
    getAppearance: () => ({ isMale: () => true }),
    getUsername: () => "charter",
    sendMessage() {},
  };
  // 9338 is the Catherby crewmember as a player who last chartered to Catherby sees him.
  const crew = { player, npcId: 9338, variant: "right-click-charter-to-current-location", exact: true, handled: false };
  starts.get("npc-dialogue:start")(crew);
  assert.equal(crew.handled, true);
  const stan = { player, npcId: 9301, variant: "right-click-charter-to-current-location", exact: true, handled: false };
  starts.get("npc-dialogue:start")(stan);
  assert.equal(stan.handled, false, "Trader Stan has no such variant, so nothing plays");
});

// Keep full native registration after the legacy callbacks above, which use a fake task queue.
test("native Charter dialogue preserves a newer trading post interface", async t => {
  const previousBotsSetting = process.env.DISABLE_PLAYER_BOTS;
  process.env.DISABLE_PLAYER_BOTS = "1";
  const TRADING_POST_SHOP_ID = 1354;
  const { PluginManager } = require("../dist/plugins/PluginManager");
  const { Player } = require("../dist/game/entity/impl/player/Player");
  const { PlayerSession } = require("../dist/net/PlayerSession");
  const { ClientConnection } = require("../dist/net/NetworkBuilder");
  const { ShopDefinitionLoader } = require("../dist/game/definition/loader/impl/ShopDefinitionLoader");
  const { NpcDialogue } = require("../dist/game/model/dialogues/entries/impl/NpcDialogue");
  const { PlayerDialogue } = require("../dist/game/model/dialogues/entries/impl/PlayerDialogue");
  PluginManager.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  const core = PluginManager.getCoreApi();
  core.RegionManager.init();
  core.RegionManager.loadMapFiles(3226, 3218);
  assert.equal(new ShopDefinitionLoader().load(), true);
  core.ShopManager.initialize();
  assert.equal(core.ShopDefinition.forId(TRADING_POST_SHOP_ID).getName(), "Trader Stan's Trading Post");
  PluginManager.emitServerStartup({});
  t.after(() => {
    PluginManager.emitServerShutdown({});
    CharterShips.register(api);
    if (previousBotsSetting === undefined) delete process.env.DISABLE_PLAYER_BOTS;
    else process.env.DISABLE_PLAYER_BOTS = previousBotsSetting;
  });
  const stanId = CacheDefinitions.getNpcId("sailing_transport_trader_stan_catherby");
  assert.equal(stanId, 9301);
  const mapId = CacheDefinitions.getInterfaceId("sailing_menu");
  const sideId = CacheDefinitions.getInterfaceId("chartering_menu_side");
  assert.equal(mapId, 72);
  assert.equal(sideId, 885);
  assert.equal(MAP_COMPONENT(), (mapId << 16) | 3);
  assert.equal(LIST_COMPONENT(), (sideId << 16) | 4);
  let mapTarget;
  let nextIndex = 1940;
  for (const mode of ["stationary Talk-to", "direct Charter", "replacement Trade"]) {
    await t.test(mode, async t => {
      const channel = {
        kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true,
        close() {}, onData() {}, onError() {}, onClose() {},
      };
      const player = new Player(new PlayerSession(channel));
      player.setIndex(nextIndex++);
      player.setUsername("charter" + player.getIndex());
      player.setRegistered(true);
      player.setLocation(new Location(3226, 3218, 0));
      player.needsPlacement = false;
      const connection = new ClientConnection(channel);
      connection.player = player;
      // Real cache actor at loaded geometry, for interface admission rather than retail spawning.
      const npc = core.NPC.create(stanId, new Location(3227, 3218, 0));
      assert.equal(core.World.getNpcs().add(npc), true);
      const definition = npc.getCurrentDefinition(player);
      assert.equal(definition.getId(), stanId);
      assert.equal(definition.getName(), "Trader Stan");
      assert.equal(npc.getContentId(player), stanId);
      const option = name => {
        const slot = definition.getActions().indexOf(name);
        assert.ok(slot >= 0, "actual cache action: " + name);
        return { type: "npc_option", index: npc.getIndex(), clickType: slot + 1 };
      };
      for (const name of ["Talk-to", "Trade", "Charter"]) option(name);
      const inventory = player.getInventory();
      inventory.add(new core.Item(ItemIdentifiers.COINS, 10000), false);
      const sender = player.getPacketSender(), manager = player.getDialogueManager();
      const producers = [], operations = [], shops = [], flags = [], gains = [], voyages = [], submitted = [];
      const submit = core.TaskManager.submit.bind(core.TaskManager);
      t.mock.method(core.TaskManager, "submit", task => { submitted.push(task); return submit(task); });
      const emit = PluginManager.emitCustomEvent.bind(PluginManager);
      t.mock.method(PluginManager, "emitCustomEvent", (name, event) => {
        const result = emit(name, event);
        if (event.player !== player) return result;
        if (name === "npc-dialogue:action" && /charter map/i.test(event.text ?? "")) {
          producers.push({ step: event.stepId, npc: event.npc, handled: event.handled, end: event.end });
        }
        if (name === "npc:operated") operations.push(event.option);
        if (name === "shop:opened") shops.push(event.shopId);
        if (name === "charter-ships:arrived") voyages.push(true);
        return result;
      });
      const sendFlags = sender.sendInterfaceFlagsRange.bind(sender);
      t.mock.method(sender, "sendInterfaceFlagsRange", (...args) => {
        flags.push(args);
        return sendFlags(...args);
      });
      const skills = player.getSkillManager(), addXp = skills.addExperiences.bind(skills);
      t.mock.method(skills, "addExperiences", (...args) => {
        gains.push(args);
        return addXp(...args);
      });
      const items = container => container.getItems().map(item => item ? [item.getId(), item.getAmount()] : null);
      const stores = () => ({
        inventory: items(inventory), equipment: items(player.getEquipment()),
        banks: player.getBanks().map((bank, tab) => bank && tab !== core.Bank.BANK_SEARCH_TAB_INDEX ? items(bank) : null),
        ground: core.World.getItems().filter(item => !item.isPendingRemoval()
          && item.getOwner() === player.getUsername()).map(item => [item.getItem().getId(), item.getItem().getAmount()]),
      });
      const initialStores = stores();
      const unchanged = () => {
        assert.deepEqual(stores(), initialStores);
        assert.deepEqual(gains, []);
        assert.deepEqual(voyages, []);
        assert.equal(player.getAttribute(CharterShips._test.PREVIOUS_DESTINATION_ATTRIBUTE) ?? 0, 0);
      };
      t.after(() => {
        player.closeInterruptibleInterfaces();
        core.ShopManager.close(player);
        PluginManager.emitPlayerDisconnect({ player, username: player.getUsername() });
        PluginManager.emitPlayerLogout({ player, username: player.getUsername() });
        player.setRegistered(false);
        core.TaskManager.cancelTasks(player.getIndex());
        core.TaskManager.cancelTasks(player);
        core.World.getNpcs().remove(npc);
        for (const task of submitted) if (task.isRunning()) task.stop();
      });
      let turns = 0;
      const turn = () => {
        assert.ok(++turns <= 20, "bounded native phase budget");
        player.resetUpdating();
        core.World.processCycle = (core.World.processCycle + 1) & 0x7fffffff;
        core.TaskManager.process();
        connection.processTurnPackets();
        const queue = player.getMovementQueue();
        queue.beginCycle();
        queue.processEntityPursuit();
        if (queue.hasPendingWork()) queue.process();
        core.TaskManager.processWalkTo(player.getIndex());
      };
      const send = async (...packets) => { await connection.dispatch(packets); turn(); };
      const resume = () => ({ type: "dialogue_continue", widgetId: (sender.getChatboxGroupId() << 16) | 5, childIndex: -1 });
      if (mode === "direct Charter") {
        await send(option("Charter"));
        for (let i = 0; i < 5 && player.getInterfaceId() !== mapId; i++) turn();
        assert.ok(operations.includes("charter"), "real native Charter producer");
      } else {
        await send(option("Talk-to"));
        for (let i = 0; i < 5 && !manager.getCurrent(); i++) turn();
        assert.ok(operations.includes("talk-to"));
        assert.ok(manager.getCurrent() instanceof NpcDialogue);
        assert.equal(manager.getCurrent().getText(), "Can I help you?");
        assert.equal(sender.getChatboxGroupId(), 231);
        assert.equal(manager.getOwner(), undefined);
        assert.equal(sender.getChatboxOwner(), undefined);
        await send(resume());
        const prompt = core.MultiChatboxPrompt.getPending(player);
        assert.ok(prompt, "actual transcript menu is the owning consumer");
        assert.equal(manager.isActive(), false);
        const label = "Yes, I would like to charter a ship.";
        const choice = prompt.options.indexOf(label) + 1;
        assert.ok(choice > 0);
        await send({ type: "dialogue_continue", widgetId: core.MultiChatboxPrompt.OPTIONS_WIDGET_ID, childIndex: choice });
        assert.equal(core.MultiChatboxPrompt.getPending(player), null);
        assert.ok(manager.getCurrent() instanceof PlayerDialogue);
        assert.equal(manager.getCurrent().getText(), label);
        assert.equal(sender.getChatboxGroupId(), 217);
        await send(resume());
        assert.ok(manager.getCurrent() instanceof NpcDialogue);
        assert.match(manager.getCurrent().getText(), /^Certainly(?:, (?:sir|madam))?\. Where would you like to go\?$/);
        assert.equal(sender.getChatboxGroupId(), 231);
        assert.equal(manager.getOwner(), undefined);
        assert.equal(sender.getChatboxOwner(), undefined);
        const terminal = sender.subInterfaceTargets.get(sender.getChatboxGroupId());
        assert.ok(terminal && Object.isFrozen(terminal));
        assert.equal(sender.getSubInterfaceAt(terminal.targetUid), terminal);
        assert.equal(player.getMovementQueue().size(), 0, "Talk-to approach has settled");
        const admissionPosition = player.getLocation().clone();
        unchanged();
        await send(resume(), ...(mode === "replacement Trade" ? [option("Trade")] : []));
        assert.equal(producers.length, 1);
        assert.equal(producers[0].step, "YNVF6c");
        assert.equal(producers[0].npc === npc, true);
        assert.equal(producers[0].handled, true);
        assert.equal(producers[0].end, true);
        assert.equal(manager.isActive(), false);
        assert.equal(sender.getChatboxGroupId(), -1);
        assert.equal(player.getLocation().equals(admissionPosition), true);
        assert.notEqual(player.getInterfaceId(), mapId, "deferred map has not run in the input phase");
        unchanged();
        let replacement;
        if (mode === "replacement Trade") {
          assert.ok(operations.includes("trade"), "successful real native Trade producer before next global phase");
          assert.deepEqual(shops, [TRADING_POST_SHOP_ID]);
          assert.equal(player.getInterfaceId(), core.ShopManager.MAIN_INTERFACE_ID);
          replacement = sender.subInterfaceTargets.get(core.ShopManager.MAIN_INTERFACE_ID);
          assert.ok(replacement && Object.isFrozen(replacement));
          assert.equal(replacement.targetUid, mapTarget, "the controls prove the shared main target");
          assert.equal(sender.getSubInterfaceAt(replacement.targetUid), replacement);
        }
        turn();
        unchanged();
        if (replacement) {
          assert.equal(sender.getSubInterfaceAt(replacement.targetUid), replacement,
            "deferred Charter must preserve the newer trading post main mount");
          assert.equal(player.getInterfaceId(), core.ShopManager.MAIN_INTERFACE_ID);
          assert.equal(sender.isSubInterfaceOpen(sideId), false);
          return;
        }
      }
      assert.equal(player.getInterfaceId(), mapId);
      const map = sender.subInterfaceTargets.get(mapId), side = sender.subInterfaceTargets.get(sideId);
      assert.ok(map && side);
      if (mapTarget === undefined) mapTarget = map.targetUid;
      assert.equal(map.targetUid, mapTarget);
      assert.equal(map.targetUid, CacheDefinitions.getComponentId("toplevel_osrs_stretch:mainmodal"));
      assert.equal(side.targetUid, CacheDefinitions.getComponentId("toplevel_osrs_stretch:sidemodal"));
      assert.equal(map.type, 0);
      assert.equal(side.type, 3);
      assert.equal(sender.getSubInterfaceAt(map.targetUid), map);
      assert.equal(sender.getSubInterfaceAt(side.targetUid), side);
      const last = CharterShips._test.destinations().length * 2 - 1;
      assert.deepEqual(flags.filter(([uid]) => uid === MAP_COMPONENT() || uid === LIST_COMPONENT()), [
        [MAP_COMPONENT(), 0, last, 2], [LIST_COMPONENT(), 0, last, 2],
      ]);
      unchanged();
    });
  }
});
