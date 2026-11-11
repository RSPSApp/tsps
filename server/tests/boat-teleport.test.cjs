// Run after `yarn build`: node --test tests/boat-teleport.test.cjs
const assert = require("node:assert/strict");
const { test, before } = require("node:test");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();

const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { Location } = require("../dist/game/model/Location");
const { ItemIdentifiers } = require("../dist/util/ItemIdentifiers");

const teleports = [];
let allowTeleport = true;
let breakTablet;
let plugin;

before(async () => {
  await CachePipeline.initialize();
  plugin = require("../plugins/skills/sailing/BoatTeleport.Sailing");
  plugin.register({
    core: {
      Location,
      TeleportHandler: {
        checkReqs: () => allowTeleport,
        teleport: (player, destination, type, warning, onArrival, onMiddle) =>
          teleports.push({ destination, type, onArrival, onMiddle }),
      },
      TeleportType: { TELE_TAB: "TELE_TAB" },
    },
    onItemAction: (name, actions) => { breakTablet = actions.Break; },
    onCustomEvent() {},
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
  return {
    items,
    messages,
    sent,
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
  assert.equal(teleports[0].onArrival, undefined, "the player isn't put aboard");
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
