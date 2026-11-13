// Run after `yarn build`: node --test tests/slayer-zeroed-hit-xp.test.cjs
// A player's hit that a Slayer monster takes no damage from (a harpie bug swarm without a lit bug lantern, a
// kurask without a leaf-bladed weapon) pays no combat XP: combat XP is paid per damage dealt (Wiki: Combat), and
// these hits deal none (Wiki: Harpie Bug Swarm, Kurask).
const assert = require("node:assert/strict");
const path = require("node:path");
const { test, before, afterEach } = require("node:test");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();

const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager } = require("../dist/plugins/PluginManager");
const { World } = require("../dist/game/World");
const { HitQueue } = require("../dist/game/content/combat/hit/HitQueue");
const { Player } = require("../dist/game/entity/impl/player/Player");
const SlayerEquipment = require("../plugins/skills/slayer/Equipment.Slayer");

let core;
const npcs = [];

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  core = PluginManager.getCoreApi();
  const api = PluginManager.createApi("SlayerZeroedHitXpTest");
  SlayerEquipment.init(api);
  SlayerEquipment.attach(api);
});

afterEach(() => {
  for (const npc of npcs.splice(0)) World.getNpcs().remove(npc);
});

function fighter(worn = {}) {
  const p = new Player(null);
  p.setUsername(`fighter${Math.random()}`);
  p.setLocation(new core.Location(3260, 3260, 0));
  const sender = new Proxy({}, { get: () => () => sender });
  p.getPacketSender = () => sender;
  p.sendMessage = () => {};
  p.performAnimation = () => {};
  p.isRegistered = () => true;
  for (const [slot, id] of Object.entries(worn)) p.getEquipment().setItem(Number(slot), new core.Item(id, 1));
  return p;
}

function spawnNpc(id) {
  const npc = new core.NPC(id, new core.Location(3260, 3261, 0));
  World.getNpcs().add(npc, true);
  npcs.push(npc);
  return npc;
}

const combatXp = (p) =>
  ["ATTACK", "STRENGTH", "DEFENCE", "HITPOINTS"].reduce((sum, name) => sum + p.getSkillManager().getExperience(core.Skill[name]), 0);

/** The combat XP that one rolled melee hit of `damage` from `p`, pays: queued as an attack queues it, then landed. */
function meleeHit(p, npc, damage) {
  const before = combatXp(p);
  const hit = new core.PendingHit(p, npc, core.CombatFactory.MELEE_COMBAT, { delay: 0, rollAccuracy: false });
  hit.setTotalDamage(damage);
  core.CombatFactory.addPendingHit(hit);
  for (let i = 0; i < 3; i++) {
    World.processCycle = (World.processCycle + 1) & 0x7fffffff;
    HitQueue.processAll(World.processCycle);
  }
  return combatXp(p) - before;
}

test("a harpie bug swarm hit without a lit bug lantern deals nothing and pays no combat XP", () => {
  const { WEAPON_SLOT, SHIELD_SLOT } = core.Equipment;
  const bare = fighter({ [WEAPON_SLOT]: core.ItemIdentifiers.DRAGON_SCIMITAR });
  const swarm = spawnNpc(core.NpcIdentifiers.HARPIE_BUG_SWARM);
  const hitpoints = swarm.getHitpoints();
  const paid = meleeHit(bare, swarm, 3);
  assert.equal(swarm.getHitpoints(), hitpoints, "no damage without a lit bug lantern");
  assert.equal(paid, 0, "no XP for the zeroed hit");

  const lit = fighter({ [WEAPON_SLOT]: core.ItemIdentifiers.DRAGON_SCIMITAR, [SHIELD_SLOT]: core.ItemIdentifiers.LIT_BUG_LANTERN });
  assert.ok(meleeHit(lit, spawnNpc(core.NpcIdentifiers.HARPIE_BUG_SWARM), 3) > 0, "a lit lantern worn: the hit lands and pays");
});

test("a kurask hit without a leaf-bladed weapon deals nothing and pays no combat XP", () => {
  const { WEAPON_SLOT } = core.Equipment;
  const scimitar = fighter({ [WEAPON_SLOT]: core.ItemIdentifiers.DRAGON_SCIMITAR });
  const kurask = spawnNpc(core.NpcIdentifiers.KURASK);
  const hitpoints = kurask.getHitpoints();
  const paid = meleeHit(scimitar, kurask, 5);
  assert.equal(kurask.getHitpoints(), hitpoints, "a dragon scimitar does nothing");
  assert.equal(paid, 0, "no XP for the zeroed hit");

  const leaf = fighter({ [WEAPON_SLOT]: core.ItemIdentifiers.LEAF_BLADED_SWORD });
  assert.ok(meleeHit(leaf, spawnNpc(core.NpcIdentifiers.KURASK), 5) > 0, "a leaf-bladed sword: the hit lands and pays");
});
