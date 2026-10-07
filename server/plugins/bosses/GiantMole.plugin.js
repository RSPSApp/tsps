/**
 * Giant Mole - Falador Mole Hole boss (npc 5779).
 *
 * Melee-only, max hit 21. Between 5% and 50% hitpoints every player attack has
 * a 25% chance to make her burrow to one of the lair's fixed resurface spots,
 * dropping aggression (Mod Ash: 1/4). Poison damage and magic splashes never
 * trigger a burrow, and she stops digging below 10 hitpoints.
 *
 * Drops (npc-drops.json) and lair spawns (npc-spawns.json) are data-driven and
 * not repeated here.
 *
 * Skipped: paid private instances, light-source bites/extinguish, Falador
 * shield tracking, mole hill Look-inside player count.
 */

const BURIED_ATTRIBUTE = "giant_mole:buried";
const BURROW_TICKS = 4; // ponytail: eyeballed; tune against live if she reads fast/slow
const BURROW_HP_FLOOR = 10;
const BURROW_MIN_FRACTION = 0.05;
const BURROW_MAX_FRACTION = 0.5;
const BURROW_SUBSPOT_COUNT = 4;

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

let TaskManager;
let Misc;
let Animation;
let Graphic;
let Location;
let CombatType;
let NpcIdentifiers;
let ObjectIdentifiers;
let Task;

function isGiantMole(entity) {
  return entity?.isNpc?.() === true && entity.getId() === NpcIdentifiers.GIANT_MOLE;
}

function digMoleHill({ player }) {
  player.performAnimation(new Animation(DIG_ANIMATION_ID));
  player.moveTo(new Location(MOLE_LAIR_ENTRANCE.x, MOLE_LAIR_ENTRANCE.y, 0));
}

function climbMoleHoleExit({ player, location }) {
  if (location.x !== MOLE_HOLE_ROPE.x || location.y !== MOLE_HOLE_ROPE.y) {
    return false;
  }
  player.moveTo(new Location(MOLE_HOLE_WELL_EXIT.x, MOLE_HOLE_WELL_EXIT.y, 0));
  return true;
}

function tryBurrow({ target, hit }) {
  if (!isGiantMole(target) || target.getAttribute(BURIED_ATTRIBUTE) != null) {
    return;
  }

  const hitpoints = target.getHitpoints();
  const maxHitpoints = target.getDefinition().getHitpoints();
  if (maxHitpoints <= 0 || hitpoints < BURROW_HP_FLOOR) {
    return;
  }
  if (
    hitpoints < maxHitpoints * BURROW_MIN_FRACTION ||
    hitpoints > maxHitpoints * BURROW_MAX_FRACTION
  ) {
    return;
  }
  // A magic splash never lands, so it cannot start a burrow.
  if (hit?.getCombatType?.() === CombatType.MAGIC && hit.isAccurate?.() === false) {
    return;
  }
  if (Misc.getRandom(BURROW_SUBSPOT_COUNT - 1) !== 0) {
    return;
  }

  startBurrow(target);
}

function startBurrow(npc) {
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
    emerge(npc, token);
  };
  TaskManager.submit(task);
}

function emerge(npc, token) {
  if (npc.getAttribute(BURIED_ATTRIBUTE) !== token) {
    return;
  }

  npc.setAttribute(BURIED_ATTRIBUTE, null);
  npc.setUntargetable(false);
  npc.setVisible(true);

  const spot = pickBurrowLocation(npc.getLocation());
  if (spot) {
    npc.moveTo(spot);
  }
  npc.performAnimation(new Animation(BURROW_UP_ANIMATION_ID));
  npc.performGraphic(new Graphic(MUD_HOLE_UP_GRAPHIC_ID));
}

function pickBurrowLocation(current) {
  const candidates = BURROW_LOCATIONS.filter(
    ([x, y]) => x !== current.getX() || y !== current.getY()
  );
  if (candidates.length === 0) {
    return null;
  }
  const [x, y] = candidates[Misc.getRandom(candidates.length - 1)];
  return new Location(x, y, current.getZ());
}

function revealBuriedMole({ npc }) {
  if (!isGiantMole(npc) || npc.getAttribute(BURIED_ATTRIBUTE) == null) {
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
    const core = api.core;
    TaskManager = api.getTaskManager();
    Misc = core.Misc;
    Animation = core.Animation;
    Graphic = core.Graphic;
    Location = core.Location;
    CombatType = core.CombatType;
    NpcIdentifiers = core.NpcIdentifiers;
    ObjectIdentifiers = core.ObjectIdentifiers;
    Task = core.Task;

    api.onItemOnObject("Spade", "Mole hill", digMoleHill);
    api.onObjectFirstClick(ObjectIdentifiers.ROPE_17, climbMoleHoleExit);
    api.onPlayerDealtDamage(tryBurrow);
    api.onNpcBeforeDeath(revealBuriedMole);
  },
};
