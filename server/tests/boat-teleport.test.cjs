// Run after `yarn build`: node --test tests/boat-teleport.test.cjs
const assert = require("node:assert/strict");
const { test, before } = require("node:test");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();

const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { Location } = require("../dist/game/model/Location");
const { ItemIdentifiers } = require("../dist/util/ItemIdentifiers");

const teleports = [];
const prompts = [];
let allowTeleport = true;
let breakTablet;

before(async () => {
  await CachePipeline.initialize();
  require("../plugins/skills/sailing/BoatTeleport.plugin").register({
    core: {
      Location,
      TeleportHandler: {
        checkReqs: () => allowTeleport,
        teleport: (player, destination, type, warning, onArrival) => teleports.push({ destination, type, onArrival }),
      },
      TeleportType: { TELE_TAB: "TELE_TAB" },
    },
    onItemAction: (name, actions) => { breakTablet = actions.Break; },
    sendMultiChatboxPrompt: (player, title, ...pairs) => prompts.push({ title, pairs }),
  });
});

const { facilityNamed, setFacility } = require("../plugins/skills/sailing/boatFacilities");

function boat(slot, dock, { focus = true, kind = "docked" } = {}) {
  const owned = { slot, type: "sloop", name: [], location: kind === "docked" ? { kind, dock } : { kind } };
  if (focus) setFacility(owned, 0, facilityNamed("Greater teleport focus"));
  return owned;
}

function createPlayer(boats, activeBoatSlot = null) {
  const items = [ItemIdentifiers.TELEPORT_TO_BOAT];
  const messages = [];
  return {
    items,
    messages,
    getSailing: () => ({ boats, activeBoatSlot }),
    getArea: () => null,
    getPrivateArea: () => null,
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

test("a tablet takes you to the dock of your only boat with a greater teleport focus", () => {
  teleports.length = 0;
  allowTeleport = true;
  const player = createPlayer([boat(0, "port_sarim"), boat(1, "the_pandemonium", { focus: false }), boat(2, null, { kind: "sunk" })]);
  breakIt(player);
  assert.equal(player.items.length, 0);
  assert.equal(teleports.length, 1);
  assert.equal(teleports[0].type, "TELE_TAB");
  assert.equal(typeof teleports[0].onArrival, "function", "boards on arrival");
});

test("no boat with a focus, or a refused teleport, keeps the tablet", () => {
  teleports.length = 0;
  allowTeleport = true;
  const none = createPlayer([boat(0, "port_sarim", { focus: false })]);
  breakIt(none);
  assert.equal(none.items.length, 1);
  assert.match(none.messages[0], /greater teleport focus/);

  allowTeleport = false;
  const blocked = createPlayer([boat(0, "port_sarim")]);
  breakIt(blocked);
  assert.equal(blocked.items.length, 1);
  assert.equal(teleports.length, 0);
});

test("with several boats the player picks one, the last sailed first", () => {
  prompts.length = 0;
  teleports.length = 0;
  allowTeleport = true;
  const player = createPlayer([boat(0, "port_sarim"), boat(1, "the_pandemonium")], 1);
  breakIt(player);
  assert.equal(teleports.length, 0);
  const { pairs } = prompts[0];
  assert.match(pairs[0], /The Pandemonium/);
  assert.match(pairs[2], /Port Sarim/);
  pairs[1]();
  assert.equal(teleports.length, 1);
  assert.equal(player.items.length, 0);
});
