// Run after `yarn build`: node --test tests/teleport-interface.test.cjs
// ::teleports: the destination data against the cache and collision map, the rows each tab
// sends, and selecting, teleporting, favourites, recents and the Wilderness warning.
const assert = require("node:assert/strict");
const { test, before } = require("node:test");
const path = require("node:path");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();

const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { RegionManager } = require("../dist/game/collision/RegionManager");
const { PluginManager } = require("../dist/plugins/PluginManager");
const TeleportInterface = require("../plugins/interface/TeleportInterface.plugin");

const { COMPONENT, TAB, TAB_UIDS, ROW_UIDS, OP, Destinations, uid } = TeleportInterface._test;
const teleports = [];
const liveTiles = new Map();
const events = [];
let dialogue;
let commands;
let buttons;

class OptionDialogue {
  constructor(_id, handler, ...options) { this.handler = handler; this.options = options; }
  setTitle(title) { this.title = title; return this; }
}

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  RegionManager.init();
  const core = {
    ...PluginManager.getCoreApi(),
    TeleportHandler: { checkReqs: () => true, teleport: (player, location, type) => teleports.push({ location, type }) },
    DialogueChainBuilder: class { add(step) { dialogue = step; return this; } },
    OptionDialogue,
  };
  commands = new Map();
  buttons = new Map();
  TeleportInterface.register({
    core,
    registerCustomInterface() {},
    persistAttribute() {},
    registerCommand: (name, handler) => commands.set(name, handler),
    onInterfaceActionButton: (ids, handler) => ids.forEach((id) => buttons.set(id, handler)),
    emitCustomEvent: (name, request) => {
      if (name === "combat-achievements:count") request.total = request.monster === "Zulrah" ? 12 : 0;
      if (liveTiles.has(name)) request.tile = liveTiles.get(name);
      events.push(name);
    },
  });
});

function player() {
  const attributes = new Map();
  const texts = new Map();
  const items = new Map();
  const hidden = new Map();
  const messages = [];
  let interfaceId = -1;
  const sender = {
    sendSubInterface() { return this; },
    sendString(text, id) { texts.set(id, text); return this; },
    sendItemOnInterface(id, item) { items.set(id, item); return this; },
    clearItemOnInterface(id) { items.delete(id); return this; },
    sendInterfaceDisplayState(id, hide) { hidden.set(id, hide); return this; },
    sendInterfaceRemoval() { interfaceId = -1; return this; },
    sendMessage(message) { messages.push(message); return this; },
  };
  return {
    texts, items, hidden, messages, attributes,
    getAttribute: (key) => attributes.get(key),
    setAttribute: (key, value) => attributes.set(key, value),
    getInterfaceId: () => interfaceId,
    setInterfaceId: (id) => { interfaceId = id; },
    getPacketSender: () => sender,
    getDialogueManager: () => ({ startDialogues() {} }),
  };
}

const run = (p, ...parts) => commands.get("teleports")({ player: p, parts: ["teleports", ...parts] });
const { DATA_PART_COMPONENTS } = require("../plugins/interface/teleportinterface/Layout.TeleportInterface");
const catalog = (p) => DATA_PART_COMPONENTS.flatMap((component) => JSON.parse(p.texts.get(uid(component))));
const layout = (p) => JSON.parse(p.texts.get(uid(COMPONENT.LAYOUT)));
/** What the client lists on a tab (by default the player's), as the runtime builds it. */
const rows = (p, tab = p.getAttribute("teleports:tab")) => {
  const byId = new Map(catalog(p).map((row) => [row.id, row]));
  return layout(p).tabs[Destinations.TAB_ORDER.indexOf(tab)]
    .map((entry) => (typeof entry === "number" ? byId.get(entry) : { name: entry.header, header: true }));
};
const click = (p, buttonId, extra = {}) => buttons.get(buttonId)({ player: p, buttonId, ...extra });
const rowFor = (p, key) => catalog(p).find((row) => row.id === Destinations.byKey(key).id);
const clickRow = (p, key, opId) => click(p, ROW_UIDS[0], { slot: Destinations.byKey(key).id, opId });

test("every destination lands on a free tile, with a known icon, type and tab", () => {
  const { DESTINATIONS, TAB_ORDER } = Destinations;
  const keys = new Set();
  const blocked = [];
  const core = PluginManager.getCoreApi();
  for (const entry of DESTINATIONS) {
    assert.ok(!keys.has(entry.key), `duplicate key ${entry.key}`);
    keys.add(entry.key);
    assert.ok(Destinations.iconId(entry) >= 0, `${entry.key}: unknown icon ${entry.icon}`);
    assert.ok(core.TeleportType[entry.type], `${entry.key}: unknown type ${entry.type}`);
    assert.ok(entry.tabs.every((tab) => TAB_ORDER.includes(tab) && tab !== TAB.SAVED && tab !== TAB.ALL), `${entry.key}: bad tab`);
    assert.ok(entry.description, `${entry.key}: no description`);
    if (entry.live) {
      assert.ok(!entry.tile && entry.unavailable, `${entry.key}: a live destination has no tile but says when it's unavailable`);
      continue;
    }
    if (RegionManager.blocked(Destinations.location(entry.tile), null)) blocked.push(`${entry.key} ${entry.tile}`);
  }
  assert.deepEqual(blocked, [], "landing tiles must be walkable");
  for (const entry of DESTINATIONS.filter((row) => row.tabs.includes(TAB.WILDERNESS))) {
    assert.ok(Destinations.wildernessLevel(entry) > 0, `${entry.key} is on the Wilderness tab but not in it`);
  }
  assert.equal(Destinations.wildernessLevel(Destinations.byKey("corporeal-beast")), 0, "Corp's cave is not PvP ground");
});

test("one catalog and a layout per tab; the client switches tabs, the server remembers", () => {
  const p = player();
  run(p);
  // Widget text travels in a packet with a 16-bit length; every part stays well inside it.
  for (const component of DATA_PART_COMPONENTS) {
    const bytes = Buffer.byteLength(p.texts.get(uid(component)), "latin1");
    assert.ok(bytes < 48000, `a catalog part is ${bytes} bytes, too close to the 65535-byte packet limit`);
  }
  assert.equal(catalog(p).length, Destinations.DESTINATIONS.length, "every destination is sent once");
  assert.equal(layout(p).active, Destinations.TAB_ORDER.indexOf(TAB.ALL), "a first open shows All");
  assert.equal(layout(p).tabs.length, Destinations.TAB_ORDER.length);
  assert.equal(rows(p, TAB.ALL).filter((row) => !row.header).length, Destinations.DESTINATIONS.length, "All lists everything once");
  const bosses = rows(p, TAB.BOSSES);
  assert.deepEqual(bosses.filter((row) => row.header).map((row) => row.name), ["Bosses", "God Wars Dungeon"]);
  const firstSection = bosses.slice(1, bosses.findIndex((row, index) => index > 0 && row.header)).map((row) => row.name);
  assert.deepEqual(firstSection, [...firstSection].sort((a, b) => a.localeCompare(b)), "sections are sorted by name");
  assert.ok(bosses.some((row) => row.name === "Nex"));
  assert.deepEqual(rows(p, TAB.MINIGAMES).slice(0, 5).map((row) => row.name),
    ["Raids", "Chambers of Xeric", "The Fractured Archive", "Theatre of Blood", "Tombs of Amascut"]);
  const callisto = rows(p, TAB.WILDERNESS).find((row) => row.name === "Callisto");
  assert.match(callisto.detail, /^ Lvl \d+$/, "Wilderness rows carry their level");
  assert.ok(callisto.icon >= 0);
  const sent = p.texts.size;
  const data = p.texts.get(uid(COMPONENT.DATA));
  click(p, TAB_UIDS[Destinations.TAB_ORDER.indexOf(TAB.WILDERNESS)]);
  assert.equal(p.texts.size, sent, "a tab click sends nothing");
  assert.equal(p.texts.get(uid(COMPONENT.DATA)), data);
  run(p);
  assert.equal(layout(p).active, Destinations.TAB_ORDER.indexOf(TAB.WILDERNESS), "reopening returns to the last tab");
  run(p, "god", "wars");
  assert.equal(p.texts.get(uid(COMPONENT.SEARCH_INPUT)), "god wars", "a search opens All with the query");
  assert.equal(layout(p).active, Destinations.TAB_ORDER.indexOf(TAB.ALL));
});

test("rows carry their panel text; selecting arms the panel and right-click both teleport", () => {
  const p = player();
  run(p);
  assert.equal(p.hidden.get(uid(COMPONENT.TELEPORT_BUTTON)), true, "nothing selected, no buttons");
  assert.equal(p.texts.get(uid(COMPONENT.PANEL_TITLE)), "Teleports");
  assert.deepEqual(rowFor(p, "zulrah").panel, {
    title: "Zulrah", subtitle: "Bosses", info: "Kill count: <col=ffffff>12</col>", info2: "",
    description: Destinations.byKey("zulrah").description, favourite: "Favourite",
  }, "outside the Wilderness the kill count takes the first line");
  assert.match(rowFor(p, "callisto").panel.info, /^<col=ff5f5f>Level \d+ Wilderness/);
  assert.equal(rowFor(p, "callisto").panel.info2, "Kill count: <col=ffffff>0</col>");
  assert.equal(rowFor(p, "elvarg").panel.info, "", "no Wilderness and no kill count, no lines");
  const sent = p.texts.size;
  clickRow(p, "zulrah", OP.SELECT);
  assert.equal(p.texts.size, sent, "the client draws the selection; the server sends nothing");
  teleports.length = 0;
  click(p, uid(COMPONENT.TELEPORT_BUTTON));
  assert.deepEqual([teleports[0].location.getX(), teleports[0].location.getY()], [2196, 3056]);
  assert.equal(p.getInterfaceId(), -1, "teleporting closes the interface");
  run(p);
  clickRow(p, "count-draynor", OP.TELEPORT);
  assert.equal(teleports.length, 2);
  assert.ok(events.includes("count-draynor:arriving"), "a destination's plugin hears of the arrival");
  assert.deepEqual(p.getAttribute(TeleportInterface._test.RECENT_ATTRIBUTE), ["count-draynor", "zulrah"]);
  const before = teleports.length;
  click(p, ROW_UIDS[0], { slot: Destinations.byKey("zulrah").id, opId: OP.TELEPORT });
  assert.equal(teleports.length, before, "a closed interface ignores stale clicks");
});

test("the Wilderness asks first, and remembers 'don't ask again'", () => {
  const p = player();
  teleports.length = 0;
  dialogue = undefined;
  run(p);
  clickRow(p, "callisto", OP.TELEPORT);
  assert.equal(teleports.length, 0, "no teleport before the answer");
  assert.match(dialogue.title, /^Teleport into level \d+ Wilderness\?$/);
  dialogue.handler.executeOption(2);
  assert.equal(teleports.length, 0, "No stays put");
  run(p);
  clickRow(p, "callisto", OP.TELEPORT);
  dialogue.handler.executeOption(3);
  assert.equal(teleports.length, 1);
  assert.equal(p.getAttribute(TeleportInterface._test.SKIP_WILDERNESS_WARNING_ATTRIBUTE), true);
  dialogue = undefined;
  run(p);
  clickRow(p, "callisto", OP.TELEPORT);
  assert.equal(dialogue, undefined, "no question once declined");
  assert.equal(teleports.length, 2);
});

test("favourites and recents fill the Saved tab; ::teleports last repeats the newest", () => {
  const p = player();
  teleports.length = 0;
  run(p, "last");
  assert.deepEqual(p.messages, ["You haven't teleported with ::teleports yet."]);
  run(p);
  clickRow(p, "zulrah", OP.FAVOURITE);
  clickRow(p, "barrows", OP.FAVOURITE);
  assert.deepEqual(p.getAttribute(TeleportInterface._test.FAVOURITES_ATTRIBUTE), ["zulrah", "barrows"]);
  for (const key of ["vorkath", "gwd-nex", "kraken", "giant-mole", "scurrius", "yama"]) {
    run(p);
    clickRow(p, key, OP.TELEPORT);
  }
  assert.deepEqual(p.getAttribute(TeleportInterface._test.RECENT_ATTRIBUTE), ["yama", "scurrius", "giant-mole", "kraken", "gwd-nex"],
    "the five newest, newest first");
  run(p);
  click(p, TAB_UIDS[Destinations.TAB_ORDER.indexOf(TAB.SAVED)]);
  assert.deepEqual(rows(p).map((row) => row.name),
    ["Favourites", "Barrows", "Zulrah", "Recent", "Yama", "Scurrius", "Giant Mole", "Kraken", "Nex"]);
  assert.equal(rowFor(p, "zulrah").panel.favourite, "Unfavourite");
  clickRow(p, "zulrah", OP.SELECT);
  click(p, uid(COMPONENT.FAVOURITE_BUTTON));
  assert.ok(!rows(p).slice(0, 3).some((row) => row.name === "Zulrah"), "the Saved tab redraws");
  assert.equal(layout(p).active, undefined, "a refresh leaves the client on its own tab");
  click(p, TAB_UIDS[Destinations.TAB_ORDER.indexOf(TAB.BOSSES)]);
  clickRow(p, "zulrah", OP.FAVOURITE);
  assert.equal(rowFor(p, "zulrah").panel.favourite, "Unfavourite", "any tab resends rows with the new label");
  p.setAttribute(TeleportInterface._test.FAVOURITES_ATTRIBUTE, ["barrows", "a-removed-destination"]);
  run(p);
  assert.deepEqual(rows(p, TAB.SAVED).slice(0, 2).map((row) => row.name), ["Favourites", "Barrows"], "unknown keys are skipped");
  teleports.length = 0;
  run(p, "last");
  assert.deepEqual([teleports[0].location.getX(), teleports[0].location.getY()], Destinations.byKey("yama").tile.slice(0, 2));
});

test("live destinations ask their plugin where to go, and say so when there's nowhere", () => {
  const p = player();
  teleports.length = 0;
  run(p);
  clickRow(p, "shooting-star", OP.TELEPORT);
  assert.deepEqual(p.messages, ["No shooting star has landed at the moment."]);
  assert.equal(teleports.length, 0);
  liveTiles.set("shooting-stars:current", [3029, 3348, 0]);
  run(p);
  clickRow(p, "shooting-star", OP.TELEPORT);
  assert.deepEqual([teleports[0].location.getX(), teleports[0].location.getY()], [3029, 3348]);
  assert.equal(p.getAttribute(TeleportInterface._test.RECENT_ATTRIBUTE)[0], "shooting-star");
  dialogue = undefined;
  liveTiles.set("shooting-stars:current", [3093, 3756, 0]);
  run(p);
  clickRow(p, "shooting-star", OP.TELEPORT);
  assert.match(dialogue?.title ?? "", /^Teleport into level \d+ Wilderness\?$/, "a star in the Wilderness asks first");
  liveTiles.clear();
});

test("the shooting star and Gemstone Crab plugins answer where they are", () => {
  const Common = require("../plugins/skills/shootingstars/Common.ShootingStars");
  const request = {};
  Common.locateStar(request);
  assert.equal(request.tile, undefined, "no star, no tile");
  Common.world.star = { x: 3030, y: 3348, z: 0, gone: false };
  Common.locateStar(request);
  assert.deepEqual(request.tile, [3029, 3348, 0], "the tile west of the star's footprint");
  Common.world.star = null;
  const Crab = require("../plugins/bosses/GemstoneCrab.plugin")._test;
  const answer = (setup) => { Object.assign(Crab.state, setup); const r = {}; Crab.locate(r); return r.tile; };
  assert.equal(answer({ spot: -1, nextSpot: -1, crab: null, burrow: null }), undefined, "before the first crab");
  assert.deepEqual(answer({ spot: 1, nextSpot: 2, crab: {}, burrow: null }), [...Crab.SPOTS[1].exit, 0], "the active crab's mine");
  assert.deepEqual(answer({ spot: 1, nextSpot: 2, crab: {}, burrow: {} }), [...Crab.SPOTS[2].exit, 0], "burrowing: the next mine");
  Object.assign(Crab.state, { spot: -1, nextSpot: -1, crab: null, burrow: null });
});

test("Count Draynor readies his crypt's instance for a teleport in", () => {
  const { arriving, ATTR_PENDING_INSTANCE } = require("../plugins/bosses/CountDraynor.plugin")._test;
  const p = player();
  arriving({ player: p });
  assert.equal(p.getAttribute(ATTR_PENDING_INSTANCE), true);
  assert.equal(Destinations.byKey("count-draynor").arrival, "count-draynor:arriving");
});

test("ports and house portals follow the Sailing and skillcape data they come from", () => {
  const PORTS = require("../plugins/skills/sailing/data/sailing-ports.json");
  const { housePortals } = require("../plugins/items/data/skillcapes.json");
  // The source tile, or (only where our collision map blocks it) a free tile beside it.
  const follows = (entry, [x, y, z]) => {
    const [tx, ty, tz] = entry.tile;
    if (tx === x && ty === y && tz === z) return true;
    return RegionManager.blocked(Destinations.location([x, y, z]), null) && tz === z && Math.max(Math.abs(tx - x), Math.abs(ty - y)) === 1;
  };
  const drifted = [];
  for (const port of PORTS) {
    const entry = Destinations.byKey(`port-${port.id.replace(/_/g, "-")}`);
    const { x, y, z } = port.landing;
    if (!entry) drifted.push(`${port.name}: no ::teleports row`);
    else if (entry.name !== port.name || !follows(entry, [x, y, z])) drifted.push(`${port.name}: ${entry.name} ${entry.tile} vs ${x},${y},${z}`);
  }
  for (const [town, tile] of Object.entries(housePortals)) {
    const entry = Destinations.byKey(`house-${town}`);
    if (!entry) drifted.push(`${town} house portal: no ::teleports row`);
    else if (!follows(entry, tile)) drifted.push(`${town} house portal: ${entry.tile} vs ${tile}`);
  }
  const ports = Destinations.DESTINATIONS.filter((entry) => entry.key.startsWith("port-")).length;
  const portals = Destinations.DESTINATIONS.filter((entry) => entry.key.startsWith("house-")).length;
  assert.deepEqual(drifted, [], "update data/teleports.json from the data these rows copy");
  assert.equal(ports, PORTS.length, "no port rows the Sailing data has dropped");
  assert.equal(portals, Object.keys(housePortals).length, "no house portal rows the skillcape data has dropped");
});
