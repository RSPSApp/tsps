// Run after `yarn build`: node --test tests/mounted-digsite-pendant.test.cjs
// Wiki (Digsite pendant): the mounted pendant has "the same locations as the normal unmounted version", so its
// Fossil Island and Lithkren teleports need Bone Voyage and Dragon Slayer II too, refused with the same line.
const assert = require("node:assert/strict");
const path = require("node:path");
const { test, before } = require("node:test");
process.env.DISABLE_PLAYER_BOTS = "1";
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager } = require("../dist/plugins/PluginManager");

let core;
let Mounted;
let House;
let Ids;
const handlers = new Map();
const done = new Set();

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  core = PluginManager.getCoreApi();
  const api = {
    core,
    emitCustomEvent(name, request) { if (name === "quest:is-complete") request.complete = done.has(request.key); },
    onObjectInteraction(name, options) { handlers.set(name, options); },
  };
  require("../plugins/skills/construction/Core.Construction").init(api);
  Ids = require("../plugins/skills/construction/Ids.Construction");
  House = require("../plugins/skills/construction/House.Construction");
  Mounted = require("../plugins/skills/construction/Mounted.Construction");
  Mounted.attachMountedItems(api);
});

function visit(t, option, label) {
  const statements = [];
  const teleports = [];
  const player = {
    getDialogueManager: () => ({ startDialogues: (chain) => statements.push(chain) }),
    sendMessage() {},
  };
  t.mock.method(House, "houseFor", () => ({ owner: player }));
  t.mock.method(core.TeleportHandler, "checkReqs", () => true);
  t.mock.method(core.TeleportHandler, "teleport", (_p, target) => teleports.push([target.getX(), target.getY()]));
  const event = { player, definition: { getName: () => "Digsite Pendant" }, objectId: Ids.loc(label), handled: false };
  handlers.get("Digsite Pendant")[option](event);
  return { statements, teleports };
}

test("the mounted pendant's Lithkren needs Dragon Slayer II and Fossil Island needs Bone Voyage", (t) => {
  for (const [option, loc, key] of [["Lithkren", "poh_amulet_dig_lithkren", "dragon_slayer_ii"], ["Fossil Island", "poh_amulet_dig_fossil", "bone_voyage"]]) {
    const locked = visit(t, option, loc);
    assert.equal(locked.teleports.length, 0, `${option}: refused before ${key}`);
    assert.equal(locked.statements.length, 1, `${option}: the refusal box`);
    done.add(key);
    assert.equal(visit(t, option, loc).teleports.length, 1, `${option}: teleports after ${key}`);
    done.delete(key);
  }
  assert.equal(visit(t, "Digsite", "poh_amulet_dig_digsite").teleports.length, 1, "the Digsite needs nothing");
});
