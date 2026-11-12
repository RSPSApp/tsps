/**
 * The Agility Pyramid's moving blocks (the course itself is
 * plugins/skills/agility/courses/AgilityPyramid.Agility.js).
 *
 * Captured (rsprox 2932, 1757): each block is an NPC that slides out of the pyramid one tile a
 * tick for two ticks (a step each, as Doom's larvae move: an instant move would jump), with area sound 1395 (range 5) at its home tile as it starts, waits two
 * ticks, and slides back the same way; the floor 1 block (agility_pyramid_penny_waterfall_npc_east)
 * starts every 15 ticks, the floor 3 one (_north) every 13. A player whose next step is under a
 * block waits and walks on once it has gone back (captured: 3374,2849 on floor 1, four ticks).
 *
 * Wiki (Agility Pyramid, Pyramid block): a block that moves onto a player pushes them down to the
 * floor below for 8 damage. No push was captured, so its animation and landing (two tiles on, the
 * way the block moves) are guesses.
 */
const BLOCKS = Object.freeze([
  { npc: 5788, home: [3372, 2847, 1], dir: [1, 0], period: 15 },
  { npc: 5787, home: [3366, 2845, 3], dir: [0, 1], period: 13 },
]);
/** How far out each block is, by tick of its cycle; tick 0 is the first slide. */
const SLIDE_OFFSETS = [1, 2, 2, 2, 1];
const BLOCK_SIZE = 2;
const SLIDE_SOUND = 1395;
const SLIDE_SOUND_RADIUS = 5;
const PUSH_DAMAGE = 8;
const PUSH_DISTANCE = 2;
const FALL_ANIMATION = 768;
/** The block slides through the pyramid's wall and onto players, as the Doom's larvae crawl. */
const IGNORE_CLIPPING_FLAG = "movement:ignore-clipping";
/** agility_pyramid_level: the floor the player is on, 0 to 5 (the course plugin's). */
const PYRAMID_LEVEL_VARBIT = 1550;

let core;

function offsetAt(block, tick) {
  return SLIDE_OFFSETS[tick % block.period] ?? 0;
}

function findBlock(block) {
  const [x, y, z] = block.home;
  const home = new core.Location(x, y, z);
  return core.World.getNpcsNear(home, SLIDE_OFFSETS.length, null).find((npc) => npc.getId() === block.npc) ?? null;
}

function footprintPlayers(location) {
  if (!core.World.isPlayerOccupyingTile(location, null, BLOCK_SIZE)) return [];
  const x = location.getX();
  const y = location.getY();
  return [...core.World.getPlayers()].filter((player) => {
    const at = player?.getLocation();
    return at && at.getZ() === location.getZ()
      && at.getX() >= x && at.getX() < x + BLOCK_SIZE && at.getY() >= y && at.getY() < y + BLOCK_SIZE;
  });
}

/** Down a floor, two tiles on the way the block moved. Every block is below the top square. */
function push(player, block) {
  const at = player.getLocation();
  const [dx, dy] = block.dir;
  const below = new core.Location(at.getX() + dx * PUSH_DISTANCE, at.getY() + dy * PUSH_DISTANCE, at.getZ() - 1);
  player.getMovementQueue().reset();
  player.performAnimation(new core.Animation(FALL_ANIMATION));
  player.moveTo(below);
  player.getPacketSender().sendVarbit(PYRAMID_LEVEL_VARBIT, below.getZ());
  player.getCombat().getHitQueue().addPendingDamage([new core.HitDamage(PUSH_DAMAGE, core.HitMask.RED)]);
}

function slide(block, tick) {
  const npc = findBlock(block);
  if (!npc) return;
  npc.setFlag(core.NPC.BLOCKS_PLAYERS_FLAG, true);
  npc.setFlag(IGNORE_CLIPPING_FLAG, true);
  const offset = offsetAt(block, tick);
  const [x, y, z] = block.home;
  const target = new core.Location(x + block.dir[0] * offset, y + block.dir[1] * offset, z);
  if (npc.getLocation().equals(target)) return;
  const outward = offset > offsetAt(block, tick + block.period - 1);
  if (outward && offset === 1) {
    core.Sounds.playAreaSound({ soundId: SLIDE_SOUND, x, y, level: z, radius: SLIDE_SOUND_RADIUS });
  }
  const movement = npc.getMovementQueue();
  movement.reset();
  movement.addSteps(target);
  if (outward) {
    for (const player of footprintPlayers(target)) push(player, block);
  }
}

function slideBlocks() {
  const tick = core.World.getProcessCycle();
  for (const block of BLOCKS) slide(block, tick);
}

function startSliding() {
  class PyramidBlockTask extends core.Task { execute() { slideBlocks(); } }
  core.TaskManager.submit(new PyramidBlockTask(1));
}

module.exports = {
  name: "AgilityPyramid",
  description: "Moves the Agility Pyramid's sliding blocks on floors 1 and 3, which push players down a floor for 8 damage. The course itself is a separate plugin.",
  members: true,
  _test: { BLOCKS, offsetAt },
  register(api) {
    core = api.core;
    api.onServerStartup(startSliding);
  },
};
