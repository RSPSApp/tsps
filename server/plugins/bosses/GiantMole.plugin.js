/**
 * Giant Mole - Falador Mole Hole boss (npc 5779).
 *
 * Melee-only, max hit 21. Between 5% and 50% hitpoints every player attack has
 * a 25% chance to make her burrow to one of the lair's fixed resurface spots,
 * dropping aggression (Mod Ash: 1/4). Poison damage and magic splashes never
 * trigger a burrow, and she stops digging at or below 10 hitpoints.
 *
 * Drops (npc-drops.json) and lair spawns (npc-spawns.json) are data-driven and
 * not repeated here.
 *
 * Skipped: paid private instances, light-source bites/extinguish, Falador
 * shield tracking, mole hill Look-inside player count.
 */

const BURIED_ATTRIBUTE = "giant-mole:buried";
const BURROW_TICKS = 4; // ponytail: eyeballed; tune against live if she reads fast/slow
const BURROW_HP_FLOOR = 10;
const BURROW_MIN_FRACTION = 0.05;
const BURROW_MAX_FRACTION = 0.5;
const BURROW_SUBSPOT_COUNT = 4;
/** Wiki: she respawns 16 ticks after dying (the definition's default is 25). */
const RESPAWN_TICKS = 16;

const DIG_ANIMATION_ID = 830;
const BURROW_DOWN_ANIMATION_ID = 3314;
const BURROW_UP_ANIMATION_ID = 3315;
const MUD_CLOUD_GRAPHIC_ID = 571;
const MUD_HOLE_UP_GRAPHIC_ID = 573;

const MOLE_LAIR_ENTRANCE = { x: 1752, y: 5236 };
const MOLE_HOLE_WELL_EXIT = { x: 2984, y: 3314 };
const MOLE_HOLE_ROPE = { x: 1752, y: 5136 };

// OSRS Wiki map data: the lair's fixed burrow spots.
const BURROW_LOCATIONS = [
  [1739, 5220], [1775, 5232], [1737, 5208], [1778, 5207], [1753, 5197],
  [1778, 5187], [1741, 5177], [1758, 5179], [1746, 5170], [1775, 5173],
  [1778, 5164], [1760, 5163], [1753, 5150],
];

function isGiantMole({ NpcIdentifiers }, entity) {
  return entity?.isNpc?.() === true && entity.getId() === NpcIdentifiers.GIANT_MOLE;
}

function setRespawn({ NpcDefinition, NpcIdentifiers }) {
  NpcDefinition.forId(NpcIdentifiers.GIANT_MOLE).setRespawn(RESPAWN_TICKS);
}

function digMoleHill({ Animation, Location }, { player }) {
  player.performAnimation(new Animation(DIG_ANIMATION_ID));
  player.moveTo(new Location(MOLE_LAIR_ENTRANCE.x, MOLE_LAIR_ENTRANCE.y, 0));
}

function climbMoleHoleExit({ Location }, { player, location }) {
  if (location.x !== MOLE_HOLE_ROPE.x || location.y !== MOLE_HOLE_ROPE.y) {
    return false;
  }
  player.moveTo(new Location(MOLE_HOLE_WELL_EXIT.x, MOLE_HOLE_WELL_EXIT.y, 0));
  return true;
}

function watchBurrow(core, { target, hit }) {
  if (!isGiantMole(core, target)) return;
  // Regular attacks, cannonballs and thralls carry the player's source. Poison,
  // reflected damage and magic splashes must not start a dig (splashes apply no hit).
  if (!hit.getSource()?.isPlayer() || hit.isReflected() || hit.getHitmask() === core.HitMask.GREEN) return;
  hit.onApplied(() => tryBurrow(core, target));
}

function tryBurrow(core, target) {
  if (target.getAttribute(BURIED_ATTRIBUTE) != null) return;
  const hitpoints = target.getHitpoints();
  const maxHitpoints = target.getDefinition().getHitpoints();
  if (maxHitpoints <= 0 || hitpoints <= BURROW_HP_FLOOR) return;
  if (
    hitpoints < maxHitpoints * BURROW_MIN_FRACTION ||
    hitpoints > maxHitpoints * BURROW_MAX_FRACTION
  ) return;
  if (core.Misc.getRandom(BURROW_SUBSPOT_COUNT - 1) !== 0) return;
  startBurrow(core, target);
}

function startBurrow(core, npc) {
  const { Animation, Graphic, Task, TaskManager } = core;
  const token = {};
  npc.setAttribute(BURIED_ATTRIBUTE, token);
  npc.getCombat().reset();
  npc.performAnimation(new Animation(BURROW_DOWN_ANIMATION_ID));
  npc.performGraphic(new Graphic(MUD_CLOUD_GRAPHIC_ID));
  npc.setVisible(false);
  npc.setUntargetable(true);

  const task = new Task(BURROW_TICKS, npc, false);
  task.execute = () => {
    task.stop();
    emerge(core, npc, token);
  };
  TaskManager.submit(task);
}

function emerge(core, npc, token) {
  const { Animation, Graphic } = core;
  if (npc.getAttribute(BURIED_ATTRIBUTE) !== token) {
    return;
  }

  npc.setAttribute(BURIED_ATTRIBUTE, null);
  npc.setUntargetable(false);
  npc.setVisible(true);

  const spot = pickBurrowLocation(core, npc.getLocation());
  if (spot) {
    npc.moveTo(spot);
  }
  npc.performAnimation(new Animation(BURROW_UP_ANIMATION_ID));
  npc.performGraphic(new Graphic(MUD_HOLE_UP_GRAPHIC_ID));
}

function pickBurrowLocation({ Misc, Location }, current) {
  const candidates = BURROW_LOCATIONS.filter(
    ([x, y]) => x !== current.getX() || y !== current.getY()
  );
  if (candidates.length === 0) {
    return null;
  }
  const [x, y] = candidates[Misc.getRandom(candidates.length - 1)];
  return new Location(x, y, current.getZ());
}

function revealBuriedMole(core, { npc }) {
  if (!isGiantMole(core, npc) || npc.getAttribute(BURIED_ATTRIBUTE) == null) {
    return;
  }
  npc.setAttribute(BURIED_ATTRIBUTE, null);
  npc.setUntargetable(false);
  npc.setVisible(true);
}

module.exports = {
  name: "GiantMole",
  members: true,
  register(api) {
    api.onItemOnObject("Spade", "Mole hill", digMoleHill.bind(null, api.core));
    api.onObjectFirstClick(api.core.ObjectIdentifiers.ROPE_17, climbMoleHoleExit.bind(null, api.core));
    api.onCustomEvent("combat:damage-apply", watchBurrow.bind(null, api.core));
    api.onNpcBeforeDeath(revealBuriedMole.bind(null, api.core));
    api.onServerStartup(setRespawn.bind(null, api.core));
  },
};
