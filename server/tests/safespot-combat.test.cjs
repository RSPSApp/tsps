// Safespots (issue 1952): a wall the target can't walk past but a projectile can cross.
//
// - An NPC whose target keeps fighting it from behind the wall keeps that target, facing it and
//   trying its step, as live does. It used to drop the target on the first refused step and
//   wander off between hits (Combat.isSafespotted).
// - A spell cast by hand with an autocast spell remembered but no staff to cast it casts once and
//   stops (Autocasting.isActive). It fell back to melee on the next cycle and walked the player
//   round the wall: the Tree spirit fight on Entrana, where weapons are banned.
//
// Ticked like tests/unreachable-combat.test.cjs, but on the real map, so the wall is real
// clipping (0x100: blocks walking, not projectiles).
//
// Run after `yarn build`: node --test tests/safespot-combat.test.cjs
const assert = require("node:assert/strict");
const { before, test } = require("node:test");
const { Server } = require("../dist/Server");
Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { NpcDefinitionLoader } = require("../dist/game/definition/loader/impl/NpcDefinitionLoader");
const { PluginManager } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const core = PluginManager.getCoreApi();

const MUGGER = core.NpcIdentifiers.MUGGER_2;
/** Matches Combat.UNREACHABLE_GIVE_UP_CYCLES. */
const GIVE_UP_CYCLES = 20;
/** Lumbridge cow field: no clipping on x-4..x+4, y-2..y+8. */
const FIELD = { x: 3260, y: 3280 };
const WALK_BLOCKED = 0x100;

before(async () => {
  await CachePipeline.initialize(require("node:path").resolve(__dirname, ".."));
  new NpcDefinitionLoader().load();
  core.RegionManager.init();
  core.RegionManager.loadMapFiles(FIELD.x, FIELD.y);
});

/** The player at FIELD, the npc `gap` tiles north, a walk-only wall two tiles north of the player. */
function scene(t, { gap = 4, npcImmobile = false } = {}) {
  let cycle = 1000;
  t.mock.method(core.World, "getProcessCycle", () => cycle);
  const tasks = [];
  t.mock.method(core.TaskManager, "submit", (task) => { task.setRunning(true); tasks.push(task); });

  for (let x = FIELD.x - 3; x <= FIELD.x + 3; x++) {
    const y = FIELD.y + 2;
    const clip = core.RegionManager.getClipping(x, y, 0, null);
    core.RegionManager.addClipping(x, y, 0, WALK_BLOCKED, null);
    t.after(() => { if (!(clip & WALK_BLOCKED)) core.RegionManager.removeClipping(x, y, 0, WALK_BLOCKED, null); });
  }

  const player = new Player(null);
  player.setUsername("safespot-combat");
  const sender = new Proxy({}, { get: () => () => sender });
  player.getPacketSender = () => sender;
  player.getSession = () => ({ sendClientPacket: () => true, processPackets: () => {} });
  t.mock.method(player, "sendMessage", () => {});
  player.setLocation(new core.Location(FIELD.x, FIELD.y, 0));
  player.setRegistered(true);
  player.setNeedsPlacement(false);
  for (const skill of core.Skill.values()) {
    player.getSkillManager().setCurrentLevel(skill, 99);
    player.getSkillManager().setMaxLevel(skill, 99);
  }

  const npc = core.NPC.create(MUGGER, new core.Location(FIELD.x, FIELD.y + gap, 0));
  npc.isRegistered = () => true;
  npc.setNeedsPlacement(false);
  npc.setHitpoints(500);
  if (npcImmobile) npc.getMovementQueue().setBlockMovement(true);

  function tick() {
    cycle++;
    for (let i = tasks.length - 1; i >= 0; i--) {
      const task = tasks[i];
      if (!(task.isRunning() && task.execute() !== false)) tasks.splice(i, 1);
    }
    npc.process();
    const combat = player.getCombat(), movement = player.getMovementQueue();
    combat.getHitQueue().process(cycle);
    player.getTimers().process();
    movement.beginCycle();
    if (combat.hasPendingWork()) combat.preMovementProcess();
    if (movement.hasPendingWork()) movement.process();
    if (combat.hasPendingWork()) combat.postMovementProcess();
  }
  t.after(() => {
    core.World.unregisterNpcPosition(npc);
    core.World.unregisterPlayerPosition(player);
  });
  return { player, npc, tick, ticks: (count) => { for (let i = 0; i < count; i++) tick(); } };
}

test("an npc stuck behind a wall lets go of a target that isn't fighting it", (t) => {
  // The pre-existing release, kept: the map refuses the step and nobody is fighting the npc.
  const s = scene(t);
  s.npc.getCombat().attack(s.player);
  s.ticks(5);
  assert.equal(s.npc.getLocation().getY() > FIELD.y + 2, true, "the wall held");
  assert.equal(s.npc.getCombat().getTarget(), null);
});

test("a safespotted npc keeps the target that is fighting it", (t) => {
  const s = scene(t);
  s.npc.getCombat().attack(s.player);
  for (let i = 0; i < GIVE_UP_CYCLES * 2; i++) {
    // The player's hits landing from the far side of the wall.
    if (i % 4 === 0) s.npc.getCombat().setUnderAttack(s.player);
    s.tick();
  }
  assert.equal(s.npc.getLocation().getY() > FIELD.y + 2, true, "the wall held");
  assert.equal(s.npc.getCombat().getTarget(), s.player);
});

test("a hand cast with a default spell but no staff casts once and stays put", (t) => {
  const s = scene(t, { npcImmobile: true });
  s.player.getInventory().add(new core.Item(core.ItemIdentifiers.AIR_RUNE, 100));
  s.player.getInventory().add(new core.Item(core.ItemIdentifiers.MIND_RUNE, 100));
  const spell = core.CombatSpells.WIND_STRIKE.getSpell();
  s.player.getCombat().setAutocastSpell(spell);
  assert.equal(s.player.getEquipment().hasStaffEquipped(), false);
  s.player.getCombat().setCastSpell(spell);
  s.player.getCombat().attack(s.npc);
  const from = s.player.getLocation();
  s.ticks(10);
  assert.equal(s.player.getCombat().getPreviousCast(), spell, "the spell was cast");
  assert.equal(s.player.getLocation().equals(from), true, "the player never walked toward melee range");
  assert.equal(s.player.getCombat().getTarget(), null, "one cast, then the attack ends");
});
