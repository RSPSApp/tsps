// Run after yarn build: node --test tests/canifis-citizens.test.cjs
const assert = require("node:assert/strict");
const { before, test } = require("node:test");
const { Server } = require("../dist/Server");
Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager } = require("../dist/plugins/PluginManager");
const { PendingHit } = require("../dist/game/content/combat/hit/PendingHit");
const { NPCDeathTask } = require("../dist/game/task/impl/NPCDeathTask");
const Citizens = require("../plugins/npcs/CanifisCitizens.plugin");
let core;
before(async () => {
  await CachePipeline.initialize(require("node:path").resolve(__dirname, ".."));
  core = PluginManager.getCoreApi();
  const api = PluginManager.createApi("CanifisCitizensTest");
  Citizens.register(api);
  PluginManager.emitServerStartup();
});
function player(weapon = -1) {
  const channel = { kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const p = new (require("../dist/game/entity/impl/player/Player").Player)(
    new (require("../dist/net/PlayerSession").PlayerSession)(channel));
  p.setUsername("canifistest");
  if (weapon >= 0) p.getEquipment().getItems()[core.Equipment.WEAPON_SLOT] = new core.Item(weapon, 1);
  return p;
}
function citizen(name = "canafis_man1") {
  return core.NPC.create(core.CacheDefinitions.getNpcId(name), new core.Location(3495, 3491));
}
function hit(p, npc, type = core.CombatType.MELEE) {
  return new PendingHit(p, npc, { type: () => type, accuracyDefenceType: () => undefined },
    { damage: 0, rollAccuracy: false, experience: false, handleAfterHitEffects: false });
}
test("all twenty cache human variants become their matching werewolf at an actual hit roll", () => {
  for (const [sex, count] of [["man", 8], ["woman", 12]]) {
    for (let i = 1; i <= count; i++) {
      const npc = citizen(`canafis_${sex}${i}`), base = npc.getId();
      hit(player(), npc);
      assert.equal(npc.getId(), core.CacheDefinitions.getNpcId(`canafis_werewolf_${sex}${i}`));
      assert.equal(npc.getRealId(), base, "spawn identity stays human");
      assert.equal(npc.getCurrentDefinition().getCombatLevel(), 88);
    }
  }
});
test("Wolfbane in the weapon slot protects the human, and removing it midfight permits transformation", () => {
  for (const weapon of [core.ItemIdentifiers.WOLFBANE, core.ItemIdentifiers.WOLFBANE_2]) {
    const p = player(weapon), npc = citizen();
    hit(p, npc);
    assert.equal(npc.getId(), npc.getRealId());
    p.getEquipment().getItems()[core.Equipment.WEAPON_SLOT] = new core.Item(-1, 0);
    hit(p, npc);
    assert.equal(npc.getId(), core.CacheDefinitions.getNpcId("canafis_werewolf_man1"));
  }
});
test("carrying Wolfbane does not protect against ranged or magic transformation", () => {
  for (const type of [core.CombatType.RANGED, core.CombatType.MAGIC]) {
    const p = player(), npc = citizen();
    p.getInventory().add(new core.Item(core.ItemIdentifiers.WOLFBANE, 1), false);
    hit(p, npc, type);
    assert.equal(npc.getId(), core.CacheDefinitions.getNpcId("canafis_werewolf_man1"));
  }
});
test("transform retains missing health and only runs once, without changing NPC identity", () => {
  const p = player(), npc = citizen();
  npc.setHitpoints(npc.getMaxHitpoints() - 7);
  hit(p, npc);
  assert.equal(npc.getHitpoints(), npc.getMaxHitpoints() - 7);
  const hp = npc.getHitpoints();
  hit(p, npc);
  assert.equal(npc.getHitpoints(), hp);
});
test("unrelated humans, native werewolves and NPC attackers do not trigger a citizen transform", () => {
  const p = player(), npc = citizen();
  PluginManager.emitCombatHitRoll({ attacker: npc, target: npc, combatType: core.CombatType.MELEE });
  assert.equal(npc.getId(), npc.getRealId());
  for (const id of [core.NpcIdentifiers.MAN, core.CacheDefinitions.getNpcId("canafis_werewolf_man1")]) {
    const other = core.NPC.create(id, new core.Location(3495,3491));
    hit(p, other);
    assert.equal(other.getId(), id);
  }
});
test("transformation uses the wolf combat definition and preserves the attack target", () => {
  const p = player(), npc = citizen();
  p.getCombat().attack(npc);
  hit(p, npc);
  const wolf = core.NpcDefinition.forId(core.CacheDefinitions.getNpcId("canafis_werewolf_man1"));
  assert.deepEqual(npc.getCurrentDefinition().getStats(), wolf.getStats());
  assert.equal(npc.getCurrentDefinition().getMaxHit(), wolf.getMaxHit());
  assert.equal(npc.getCombat().getTarget(), null);
  assert.equal(p.getCombat().getTarget(), npc);
});
test("existing NPC death lifecycle resets the transformed NPC to its human spawn", () => {
  const npc = citizen();
  hit(player(), npc);
  assert.equal(npc.getId(), core.CacheDefinitions.getNpcId("canafis_werewolf_man1"));
  new NPCDeathTask(npc).remove();
  assert.equal(npc.getNpcTransformationId(), -1);
  assert.equal(npc.getId(), npc.getRealId());
  const queue = core.World.getAddNPCQueue();
  const before = queue.length;
  new (require("../dist/game/task/impl/NPCRespawnTask").NPCRespawnTask)(npc, 1).execute();
  const respawn = queue[before];
  assert.equal(respawn.getId(), npc.getRealId());
  assert.equal(respawn.getHitpoints(), 60);
  assert.equal(respawn.getCurrentDefinition().getCombatLevel(), 24);
  queue.splice(before);

});
