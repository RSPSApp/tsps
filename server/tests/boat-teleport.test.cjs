// Run after `yarn build`: node --test tests/boat-teleport.test.cjs
const assert = require("node:assert/strict");
const { test, before } = require("node:test");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();

const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { Location } = require("../dist/game/model/Location");
const { ItemIdentifiers } = require("../dist/util/ItemIdentifiers");

const { CacheDefinitions } = require("../dist/game/cache/CacheDefinitions");
const { Item } = require("../dist/game/model/Item");
const { MagicSpellbook } = require("../dist/game/model/MagicSpellbook");

const teleports = [];
let allowTeleport = true;
let confirmAnswer = true;
let holdConfirm = false;
let heldConfirm = null;
let breakTablet;
let castSpell;
let plugin;

class FakeSpell {
  canCast(player, del) {
    player.casts.push(del);
    return player.castable !== false;
  }
}

before(async () => {
  await CachePipeline.initialize();
  plugin = require("../plugins/skills/sailing/BoatTeleport.Sailing");
  plugin.register({
    core: {
      Location, CacheDefinitions, Item, MagicSpellbook,
      Spell: FakeSpell,
      Skill: { MAGIC: "MAGIC" },
      TeleportHandler: {
        checkReqs: () => allowTeleport,
        confirm: (player, destination, go, level, { refused } = {}) => {
          if (holdConfirm) heldConfirm = go;
          else if (confirmAnswer) go();
          else refused?.();
        },
        teleport: (player, destination, type, warning, onArrival, onMiddle) =>
          teleports.push({ destination, type, onArrival, onMiddle }),
      },
      TeleportType: { TELE_TAB: "TELE_TAB" },
    },
    onItemAction: (name, actions) => { breakTablet = actions.Break; },
    onSpellCast: (handler) => { castSpell = handler; },
    emitCustomEvent: (name, query) => {
      if (name === "quest:is-complete" && query.key === "pandemonium") query.complete = query.player.pandemonium !== false;
    },
    onCustomEvent() {},
    persistAttribute() {},
  });
});

const { facilityNamed, setFacility, teleportFocusOf } = require("../plugins/skills/sailing/BoatFacilities.Sailing");
const { slotVarbits } = require("../plugins/skills/sailing/BoatVarbits.Sailing");

function boat(slot, dock, { focus = "Greater teleport focus", kind = "docked" } = {}) {
  const owned = { slot, type: "sloop", name: [], cargo: [], location: kind === "docked" ? { kind, dock } : { kind } };
  if (focus) setFacility(owned, 0, facilityNamed(focus));
  return owned;
}

function createPlayer(boats) {
  const items = [ItemIdentifiers.TELEPORT_TO_BOAT];
  const messages = [];
  const sent = [];
  const sender = new Proxy({}, {
    get: (_target, key) => (...args) => {
      if (key === "sendVarbit" || key === "sendConfig") sent.push(`${key} ${args[0]}=${args[1]}`);
      if (key === "sendSubInterface") sent.push(`open ${args[1]}`);
      return sender;
    },
  });
  const attributes = new Map();
  const xp = [];
  return {
    items,
    messages,
    sent,
    xp,
    casts: [],
    getAttribute: (key) => attributes.get(key),
    setAttribute: (key, value) => attributes.set(key, value),
    getSkillManager: () => ({ addExperiences: (skill, amount) => xp.push([skill, amount]) }),
    getSpellbook: () => ({ getTeleportType: () => "NORMAL" }),
    getSailing: () => ({ boats, activeBoatSlot: null, lastDock: null }),
    getLocation: () => new Location(3222, 3218, 0), // Lumbridge, near no dock
    getArea: () => null,
    getPrivateArea: () => null,
    getPacketSender: () => sender,
    setInterfaceId: () => {},
    getInventory: () => ({
      contains: (id) => items.includes(id),
      deleteNumber: (id) => items.splice(items.indexOf(id), 1),
    }),
    sendMessage: (message) => messages.push(message),
  };
}

function breakIt(player) {
  breakTablet({ player, itemId: ItemIdentifiers.TELEPORT_TO_BOAT });
}

test("each boat's teleport focus varbit: 1 for a teleport focus, 2 for a greater one (rsprox)", () => {
  assert.equal(teleportFocusOf(boat(0, "port_sarim", { focus: null })), 0);
  assert.equal(teleportFocusOf(boat(0, "port_sarim", { focus: "Teleport focus" })), 1);
  assert.equal(teleportFocusOf(boat(0, "port_sarim")), 2);
  // sailing_boat_1_teleport_focus is 19270, sailing_boat_3_teleport_focus 19346.
  assert.equal(slotVarbits(0, boat(0, "port_sarim")).get(19270), 2);
  assert.equal(slotVarbits(2, boat(2, "port_sarim", { focus: "Teleport focus" })).get(19346), 1);
  assert.equal(slotVarbits(1, undefined).get(19308), 0);
});

test("the tablet opens the boat selection's Teleport to Boat mode; the choice teleports to the boat's dock, not aboard", () => {
  teleports.length = 0;
  allowTeleport = true;
  const player = createPlayer([boat(0, "port_sarim"), boat(1, "the_pandemonium", { focus: "Teleport focus" })]);
  breakIt(player);
  assert.ok(player.sent.includes("sendVarbit 18553=8") && player.sent.includes("open 934"));
  // Script 8997 makes every boat "Boat Unavailable" without a current dock: here the boat's own.
  assert.ok(player.sent.includes("sendConfig 5005=8587"), "Port Sarim's row as the current dock");
  assert.equal(teleports.length, 0);
  plugin._test.teleportToBoat(player, ItemIdentifiers.TELEPORT_TO_BOAT, 1);
  assert.deepEqual(player.messages, ["You can't choose that boat at the moment."], "a teleport focus isn't enough");
  plugin._test.teleportToBoat(player, ItemIdentifiers.TELEPORT_TO_BOAT, 0);
  assert.equal(teleports.length, 1);
  assert.equal(teleports[0].type, "TELE_TAB");
  assert.deepEqual([teleports[0].destination.getX(), teleports[0].destination.getY()], [3050, 3193], "Port Sarim's landing");
  player.sent.length = 0;
  teleports[0].onArrival();
  assert.deepEqual(player.sent, ["sendVarbit 12393=0"], "the landing only clears busy: the player isn't put aboard");
  assert.equal(player.items.length, 1, "the tablet goes as it is absorbed");
  teleports[0].onMiddle();
  assert.equal(player.items.length, 0);
});

test("no moored boat with a greater focus, or a refused teleport, keeps the tablet", () => {
  teleports.length = 0;
  allowTeleport = true;
  const none = createPlayer([boat(0, "port_sarim", { focus: "Teleport focus" }), boat(1, null, { kind: "sunk" })]);
  breakIt(none);
  assert.equal(none.items.length, 1);
  assert.match(none.messages[0], /greater teleport focus/);

  allowTeleport = false;
  const blocked = createPlayer([boat(0, "port_sarim")]);
  plugin._test.teleportToBoat(blocked, ItemIdentifiers.TELEPORT_TO_BOAT, 0);
  assert.equal(blocked.items.length, 1);
  assert.equal(teleports.length, 0);
});

function cast(player, opId = 1) {
  castSpell({ player, spellName: "Teleport to Boat", opId, handled: false });
}

test("the Teleport to Boat spell is refused before The Pandemonium, or with no moored boat with a greater focus (rsprox)", () => {
  const early = createPlayer([boat(0, "port_sarim")]);
  early.pandemonium = false;
  cast(early);
  assert.deepEqual(early.messages, ["You must have completed Pandemonium to use this spell."]);

  const none = createPlayer([boat(0, "port_sarim", { focus: "Teleport focus" })]);
  cast(none);
  assert.deepEqual(none.messages, ["Your boat needs to have a greater teleport focus on it for you to do that."]);
  assert.ok(!none.sent.includes("open 934"));
});

test("the spell opens the Teleport to Boat selection with busy; the choice uses its runes, gives 77 xp and casts the standard teleport (rsprox)", () => {
  teleports.length = 0;
  allowTeleport = true;
  confirmAnswer = true;
  const player = createPlayer([boat(0, "port_sarim")]);
  cast(player);
  const opened = player.sent.filter((line) => /18553|5005|12393|open/.test(line));
  assert.deepEqual(opened, ["sendVarbit 18553=8", "sendConfig 5005=8587", "sendVarbit 12393=1", "open 934"]);
  plugin._test.teleportBySpell(player, 0);
  assert.deepEqual(player.casts, [false, true], "checked, then used up after any warning");
  assert.deepEqual(player.xp, [["MAGIC", 77]]);
  assert.equal(teleports.length, 1);
  assert.equal(teleports[0].type, "NORMAL");
  assert.deepEqual([teleports[0].destination.getX(), teleports[0].destination.getY()], [3050, 3193], "Port Sarim's landing");
  assert.equal(player.items.length, 1, "no tablet used");
  assert.equal(player.getAttribute(plugin._test.LAST_TELEPORTED_ATTRIBUTE), 0);
  player.sent.length = 0;
  teleports[0].onArrival();
  assert.deepEqual(player.sent, ["sendVarbit 12393=0"]);
});

test("a spell teleport that can't go ahead (runes, teleport rules, a No to a warning) uses nothing and clears busy", () => {
  teleports.length = 0;
  const poor = createPlayer([boat(0, "port_sarim")]);
  poor.castable = false;
  plugin._test.teleportBySpell(poor, 0);
  assert.deepEqual(poor.sent, ["sendVarbit 12393=0"]);

  confirmAnswer = false;
  const declined = createPlayer([boat(0, "port_sarim")]);
  plugin._test.teleportBySpell(declined, 0);
  assert.deepEqual(declined.casts, [false]);
  assert.deepEqual(declined.sent, ["sendVarbit 12393=0"]);
  assert.deepEqual(declined.xp, []);
  assert.equal(teleports.length, 0);
  confirmAnswer = true;
});

test("the spell's Last Boat goes to the boat last teleported to, else the one at the last dock", () => {
  teleports.length = 0;
  allowTeleport = true;
  const player = createPlayer([boat(0, "port_sarim"), boat(1, "the_pandemonium")]);
  cast(player, 2);
  assert.ok(!player.sent.includes("open 934"), "without the selection");
  assert.equal(teleports.length, 1);
  assert.deepEqual([teleports[0].destination.getX(), teleports[0].destination.getY()], [3050, 3193], "the first boat with none yet");
  player.setAttribute(plugin._test.LAST_TELEPORTED_ATTRIBUTE, 1);
  cast(player, 2);
  assert.notDeepEqual([teleports[1].destination.getX(), teleports[1].destination.getY()], [3050, 3193], "the Pandemonium's");
});

test("after a teleport warning the spell checks the boat again: moved meanwhile, it uses nothing", () => {
  teleports.length = 0;
  allowTeleport = true;
  const moored = boat(0, "port_sarim");
  const player = createPlayer([moored]);
  holdConfirm = true;
  plugin._test.teleportBySpell(player, 0);
  holdConfirm = false;
  moored.location = { kind: "docked", dock: "the_pandemonium" };
  heldConfirm();
  assert.equal(teleports.length, 0);
  assert.deepEqual(player.xp, []);
  assert.deepEqual(player.casts, [false]);
  assert.ok(player.sent.includes("sendVarbit 12393=0"));
});
