// Run after `yarn build`: node --test tests/npc-owner-index.test.cjs
// World.getNpcsOwnedBy is kept by World's NPC list itself, so every way an NPC leaves the world
// (the removal queue, PluginManager.removeNpc's direct removal) also leaves the index.
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, test } = require("node:test");
const { Server } = require("../dist/Server");
Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { NpcDefinitionLoader } = require("../dist/game/definition/loader/impl/NpcDefinitionLoader");
const { PluginManager } = require("../dist/plugins/PluginManager");
const core = PluginManager.getCoreApi();
const { NPC, World, Location } = core;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  new NpcDefinitionLoader().load();
});

const retained = (owner) => NPC["ownedNpcs"].get(owner)?.size ?? 0;
const spawn = (owner) => {
  const npc = NPC.create(core.NpcIdentifiers.MUGGER_2, new Location(3220, 3220, 0));
  npc.setOwner(owner);
  assert.equal(World.getNpcs().add(npc), true);
  return npc;
};

test("NPCs removed directly (PluginManager.removeNpc) leave the owner index", () => {
  const owner = {};
  for (let cycle = 0; cycle < 100; cycle++) {
    const npc = spawn(owner);
    assert.deepEqual(World.getNpcsOwnedBy(owner), [npc]);
    PluginManager.removeNpc(npc);
  }
  assert.deepEqual(World.getNpcsOwnedBy(owner), []);
  assert.equal(retained(owner), 0, "no removed NPC is kept while its owner is online");
});

test("NPCs removed through the world's list leave it too, and re-entering re-indexes them", () => {
  const owner = {};
  const npc = spawn(owner);
  World.getNpcs().remove(npc);
  assert.equal(retained(owner), 0);
  assert.equal(World.getNpcs().add(npc), true);
  assert.deepEqual(World.getNpcsOwnedBy(owner), [npc], "a respawned NPC is found again");
  World.getNpcs().remove(npc);
});

test("an owner set outside the world is indexed only once the NPC enters it", () => {
  const owner = {}, other = {};
  const npc = NPC.create(core.NpcIdentifiers.MUGGER_2, new Location(3220, 3220, 0));
  npc.setOwner(owner);
  assert.equal(retained(owner), 0, "an NPC that never enters the world is not held");
  World.getNpcs().add(npc);
  assert.deepEqual(World.getNpcsOwnedBy(owner), [npc]);
  npc.setOwner(other);
  assert.deepEqual(World.getNpcsOwnedBy(owner), []);
  assert.deepEqual(World.getNpcsOwnedBy(other), [npc]);
  World.getNpcs().remove(npc);
  assert.equal(retained(other), 0);
});
