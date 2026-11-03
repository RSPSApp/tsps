// Run after `yarn build`: node --test tests/npc-spawn-overrides.test.cjs
// The map editor saves NPC spawn changes as a patch file merged over npc-spawns.json:
// a later source replaces a spawn at the same tile (wander range, facing) and a
// `remove` record drops it without disturbing every other spawn.
const assert = require("node:assert/strict");
const path = require("node:path");
const { test, before } = require("node:test");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();

const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { RegionManager } = require("../dist/game/collision/RegionManager");
const { DefinitionLoader } = require("../dist/game/definition/loader/DefinitionLoader");
const { NpcDefinitionLoader } = require("../dist/game/definition/loader/impl/NpcDefinitionLoader");
const { NpcSpawnDefinitionLoader } = require("../dist/game/definition/loader/impl/NpcSpawnDefinitionLoader");
const { NpcSpawnDefinition } = require("../dist/game/definition/NpcSpawnDefinition");

const MAN = 3106;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  RegionManager.init();
  new NpcDefinitionLoader().load();
  const canonical = [
    { id: MAN, x: 3200, y: 3200, level: 0, wanderRadius: 5 },
    { id: MAN, x: 3210, y: 3210, level: 0 },
    { id: MAN, x: 3220, y: 3220, level: 1 },
    { id: MAN, x: 3240, y: 3240, level: 0, wanderRadius: 4 },
    { id: MAN, x: 3250, y: 3250, level: 0 },
  ];
  const patch = [
    { id: MAN, x: 3200, y: 3200, level: 0, wanderRadius: 0 },
    { id: MAN, x: 3210, y: 3210, level: 0, remove: true },
    { id: MAN, x: 3230, y: 3230, level: 0, wanderRadius: 2 },
    // A spawn moved away and then back onto its original tile: the removal
    // comes first, so the later addition must survive.
    { id: MAN, x: 3240, y: 3240, level: 0, remove: true },
    { id: MAN, x: 3240, y: 3240, level: 0, wanderRadius: 6 },
    // An addition followed by its removal is gone.
    { id: MAN, x: 3260, y: 3260, level: 0, wanderRadius: 2 },
    { id: MAN, x: 3260, y: 3260, level: 0, remove: true },
  ];
  DefinitionLoader.registerSource("npc_spawns", "test", {
    name: "canonical",
    priority: 100,
    load: () => canonical,
  });
  DefinitionLoader.registerSource("npc_spawns", "test", {
    name: "editor",
    priority: 200,
    load: () => patch,
  });
  new NpcSpawnDefinitionLoader().load();
});

function spawnAt(x, y, level) {
  return NpcSpawnDefinition.all().find((spawn) => {
    const position = spawn.getPosition();
    return position.getX() === x && position.getY() === y && position.getZ() === level;
  });
}

test("a patch replaces the wander range at the same spawn tile", () => {
  assert.equal(spawnAt(3200, 3200, 0)?.getRadius(), 0, "0 anchors the NPC");
});

test("a remove record drops only the matching spawn", () => {
  assert.equal(spawnAt(3210, 3210, 0), undefined, "the removed spawn is gone");
  assert.ok(spawnAt(3200, 3200, 0), "a different tile keeps its spawn");
  assert.ok(spawnAt(3220, 3220, 1), "a different plane keeps its spawn");
});

test("a patch adds new spawns alongside the canonical ones", () => {
  assert.equal(spawnAt(3230, 3230, 0)?.getRadius(), 2);
});

test("a spawn moved back onto its original tile survives the removal", () => {
  assert.equal(spawnAt(3240, 3240, 0)?.getRadius(), 6, "the later addition replaces the removed original");
});

test("a removal after an addition in the same patch still drops it", () => {
  assert.equal(spawnAt(3260, 3260, 0), undefined);
  assert.ok(spawnAt(3250, 3250, 0), "an untouched canonical spawn stays");
  assert.equal(NpcSpawnDefinition.all().length, 5);
});

test("the live editor resolves exact spawn lineage and refuses stale or ambiguous NPCs", () => {
  const { World } = require("../dist/game/World");
  const { Location } = require("../dist/game/model/Location");
  const { NpcSpawnLineage } = require("../dist/game/entity/impl/npc/NpcSpawnLineage");
  const { encodePluginMessage } = require("../dist/net/protocol/ClientProtocol");
  NpcSpawnDefinitionLoader.activateNear(new Location(3200, 3200, 0));
  const npc = [...World.getNpcs()].find((candidate) =>
    candidate.getRealId() === MAN && candidate.getSpawnPosition().equals(new Location(3200, 3200, 0)));
  assert.ok(npc, "the real spawn loader registered the source NPC");
  const originalLocation = npc.getLocation().clone();
  const originalLineage = npc.getSpawnLineage();
  const definitions = NpcSpawnDefinition.all().slice();
  let receive, worldResource;
  require("../plugins/world/EditModeApi.plugin.js").register({
    core: { World, NpcSpawnDefinition, encodePluginMessage, Server },
    registerContentEndpoint(name, handler) { assert.equal(name, "world"); worldResource = handler; },
    onCustomEvent(name, handler) { assert.equal(name, "network:plugin-message"); receive = handler; },
  });
  const packets = [];
  let local = [npc];
  const player = {
    getLocalNpcs: () => local,
    getSession: () => ({ sendClientPacket: (packet) => packets.push(packet) }),
  };
  const request = (changes = {}) => {
    packets.length = 0;
    const event = { channel: "npc-editor", handled: false, player, data: {
      type: "spawn", request: 1, index: npc.getIndex(), id: MAN, x: 3204, y: 3201, plane: 0,
      ...changes,
    } };
    receive(event);
    assert.equal(event.handled, true);
    return packets.length ? JSON.parse(packets[0].subarray(3).toString("utf8")).data : undefined;
  };
  try {
    npc.getLocation().setX(3204).setY(3201);
    const reply = request();
    assert.deepEqual(reply, { type: "spawn", request: 1, spawn: {
      id: MAN, tileX: 3200, tileY: 3200, plane: 0, wanderRadius: 0, direction: 1,
    } }, "the response uses the source tile even after the NPC wanders");
    assert.equal(request({ x: 3200 }).spawn, undefined, "a stale position refuses the lookup");
    assert.equal(request({ id: MAN + 1 }).spawn, undefined, "a reused index with another type is refused");
    local = [];
    assert.equal(request().spawn, undefined, "NPCs outside this player's actual local list are refused");
    local = [npc];
    npc.setSpawnLineage(new NpcSpawnLineage("plugin-temp"));
    assert.equal(request().spawn, undefined, "matching type/position is insufficient for plugin NPCs");
    npc.setSpawnLineage({ owner: "npc-spawns", isRetired: () => true });
    assert.equal(request().spawn, undefined, "retired source instances cannot be edited");
    npc.setSpawnLineage(originalLineage);
    NpcSpawnDefinition.replace([...definitions, definitions.find((definition) =>
      definition.getId() === MAN && definition.getPosition().equals(new Location(3200, 3200, 0)))]);
    assert.equal(request().spawn, undefined, "duplicate source records cannot accidentally be removed together");
    assert.equal(request({ index: -1 }), undefined, "invalid requests produce no response");
    assert.equal(request({ x: 0x4000 }), undefined);
    assert.equal(typeof worldResource, "function");
  } finally {
    npc.getLocation().setX(originalLocation.getX()).setY(originalLocation.getY()).setZ(originalLocation.getZ());
    npc.setSpawnLineage(originalLineage);
    NpcSpawnDefinition.replace(definitions);
  }
});
