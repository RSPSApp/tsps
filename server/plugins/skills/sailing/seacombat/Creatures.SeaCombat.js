// Sea creatures fighting a boat (Wiki: Boat combat; rsprox: the user's captures and rsprox.net).
// - A creature hit by a player on their boat (a cannon, or a bow or spell from the deck), or an
//   aggressive one (its definition's: krakens and every shark but the bull shark, as the Wiki
//   says) that a player's boat comes near,
//   takes the boat as its target. It never fights the player: it attacks the boat.
// - It comes over the water to its reach of the hull (data/sea-combat.json `reach`), faces the
//   boat and attacks every attack speed ticks: its attack animation and sound, then a tick later
//   (rsprox: the osprey's 13233 at 777, the hit on the boat at 778) a hit on the boat: a roll
//   against the hull's defence, up to its max hit, less 1 per 100 of the keel's armour (Wiki; a
//   creature whose max hit is below the armour can't hurt it). The boat's sound: 11165 for a
//   blocked hit, 10700 for damage (rsprox).
// - Directly under the hull a creature can't attack (Wiki: silhouettes). It gives up when the boat
//   leaves its reach far behind (ours: 20 tiles) or its owner steps off.
const common = require("./Common.SeaCombat");
const { boatType, playSound } = require("../SailingContent.Sailing");

/** How near an aggressive creature notices a boat (ours). */
const AGGRESSION_RANGE = 8;
/** How far behind a boat may leave a creature before it gives up (ours). */
const GIVE_UP_DISTANCE = 20;
const SOUND_BOAT_BLOCKED = 11165;
const SOUND_BOAT_DAMAGED = 10700;
const IGNORE_CLIPPING_FLAG = "movement:ignore-clipping";

/** npc -> its fight with a boat: `{ boat, player, nextAttackTick }`. */
const fights = new Map();
let attached = false;

function now() {
  return common.core().World.getProcessCycle();
}

/** The player's own boat they stand on, if it is the one a creature fights. */
function boatOf(player) {
  return common.core().Sailing.instanceAboard(player);
}

/** A creature takes a boat as its target (or keeps the one it has). */
function engage(npc, player) {
  if (!common.creatureOf(npc) || npc.getHitpoints() <= 0) return;
  const boat = boatOf(player);
  if (!boat) return;
  const fight = fights.get(npc);
  if (fight && fight.boat === boat) return;
  fights.set(npc, { boat, player, nextAttackTick: now() + 1 });
  // Its walk is this unit's while it fights: over the water, and not back to its spawn.
  npc.setScriptedMovement?.(true);
  npc.setFlag?.(IGNORE_CLIPPING_FLAG, true);
  npc.getCombat?.().reset?.();
}

function release(npc) {
  if (!fights.delete(npc)) return;
  npc.setScriptedMovement?.(false);
  npc.setFlag?.(IGNORE_CLIPPING_FLAG, false);
  npc.getMovementQueue().reset();
}

/** Whether a creature's footprint can stand on these sea tiles. */
function sailable(x, y, size, level) {
  const { BoatManager } = common.core();
  for (let dx = 0; dx < size; dx++) {
    for (let dy = 0; dy < size; dy++) if (!BoatManager.isSailable(x + dx, y + dy, level)) return false;
  }
  return true;
}

/** One step over the water toward (or, `away`, from) a tile: diagonal first, then straight. */
function step(npc, tx, ty, away = false) {
  const at = npc.getLocation();
  const size = Math.max(1, npc.getSize?.() ?? 1);
  // Towards a tile only while it's past the footprint on that axis, so a creature lined up with
  // it goes straight rather than wobbling about its half-tile centre.
  const towards = (target, low) => (target < low ? -1 : target > low + size - 1 ? 1 : 0);
  const sx = towards(tx, at.getX()) * (away ? -1 : 1) || (away ? Math.sign(at.getX() - tx) || 1 : 0);
  const sy = towards(ty, at.getY()) * (away ? -1 : 1) || (away ? Math.sign(at.getY() - ty) || 1 : 0);
  const candidates = [[sx, sy], [sx, 0], [0, sy]].filter(([x, y]) => x !== 0 || y !== 0);
  for (const [x, y] of candidates) {
    if (!sailable(at.getX() + x, at.getY() + y, size, at.getZ())) continue;
    const movement = npc.getMovementQueue();
    movement.reset();
    movement.walkStep(x, y);
    return true;
  }
  return false;
}

/** The hit a creature lands on a boat: 0 on a miss, else its roll less the keel's armour. */
function rollHit(npc, owned, random = Math.random) {
  const { BoatParts } = { BoatParts: require("../BoatParts.Sailing") };
  const stats = { ...boatType(owned.type)?.stats };
  const armour = BoatParts.boatStats(owned).armour ?? 0;
  const max = npc.getCurrentDefinition?.()?.getMaxHit?.() ?? npc.getDefinition?.()?.getMaxHit?.() ?? 0;
  const { CombatType, Skill } = common.core();
  const type = npc.getCurrentDefinition?.()?.getAttackType?.();
  const defenceBonus = type === CombatType.MAGIC ? stats.magicDefence
    : type === CombatType.RANGED ? stats.standardRangedDefence
      : Math.max(stats.stabDefence ?? 0, stats.slashDefence ?? 0, stats.crushDefence ?? 0);
  const attack = (npc.getCurrentLevel(type === CombatType.MAGIC ? Skill.MAGIC : type === CombatType.RANGED ? Skill.RANGED : Skill.ATTACK) + 9) * 64;
  const defence = ((stats.defence ?? 1) + 9) * ((defenceBonus ?? 0) + 64);
  const chance = attack > defence ? 1 - (defence + 2) / (2 * (attack + 1)) : attack / (2 * (defence + 1));
  if (random() >= chance) return 0;
  return Math.max(0, Math.floor(random() * (max + 1)) - Math.floor(armour / 100));
}

/** A creature's attack on its boat: the animation and sound now, the hit a tick later. */
function attack(npc, fight) {
  const creature = common.creatureOf(npc);
  const { Animation, Location, Task, TaskManager } = common.core();
  const centre = common.boatCentre(fight.boat);
  npc.setPositionToFace(new Location(centre.x, centre.y, fight.boat.level));
  const anim = npc.getAttackAnim?.() ?? -1;
  if (anim > 0) npc.performAnimation(new Animation(anim));
  if (creature?.attackSound) playSound(fight.player, creature.attackSound);
  const { player, boat } = fight;
  TaskManager.submit(new (class extends Task {
    constructor() { super(1, npc, false); }
    execute() {
      this.stop();
      if (fights.get(npc) !== fight || npc.getHitpoints() <= 0 || boatOf(player) !== boat) return;
      const owned = common.core().Sailing.activeBoat(player);
      if (!owned) return;
      const damage = rollHit(npc, owned);
      playSound(player, damage > 0 ? SOUND_BOAT_DAMAGED : SOUND_BOAT_BLOCKED);
      require("../ShipCombat.Sailing").damagePlayerBoat(player, damage, { creature: npc });
    }
  })());
}

function tick() {
  const cycle = now();
  for (const [npc, fight] of [...fights]) {
    if (!npc.isRegistered?.() || npc.getHitpoints() <= 0 || !common.creatureOf(npc) || boatOf(fight.player) !== fight.boat) {
      release(npc);
      continue;
    }
    const distance = common.distanceToBoat(npc, fight.boat);
    if (distance > GIVE_UP_DISTANCE) {
      release(npc);
      continue;
    }
    const centre = common.boatCentre(fight.boat);
    const creature = common.creatureOf(npc);
    if (distance === 0) {
      step(npc, centre.x, centre.y, true);
      continue;
    }
    if (distance > (creature.reach ?? 1)) {
      step(npc, centre.x, centre.y);
      continue;
    }
    npc.getMovementQueue().reset();
    if (cycle < fight.nextAttackTick) continue;
    const speed = npc.getCurrentDefinition?.()?.getAttackSpeed?.() ?? 4;
    fight.nextAttackTick = cycle + Math.max(1, speed);
    attack(npc, fight);
  }
  aggression();
}

/** Aggressive creatures near a player's boat take it on (Wiki: they never become tolerant). */
function aggression() {
  const { BoatManager, Sailing } = common.core();
  for (const boat of BoatManager.all()) {
    if (boat.static) continue;
    const owner = BoatManager.getDeck(boat)?.getPlayers?.().find((player) => player.getIndex() === boat.ownerPlayerId);
    if (!owner || Sailing.instanceAboard(owner) !== boat) continue;
    for (const npc of owner.getLocalNpcs?.() ?? []) {
      const creature = common.creatureOf(npc);
      if (!creature || fights.has(npc) || npc.getHitpoints() <= 0) continue;
      if (npc.getCurrentDefinition?.()?.isAggressive?.() !== true) continue;
      if (common.distanceToBoat(npc, boat) <= AGGRESSION_RANGE) engage(npc, owner);
    }
  }
}

/** Hit by a player on their own boat (a cannon, a bow or a spell): the creature fights back. */
function attacked({ player, npc }) {
  if (player && npc) engage(npc, player);
}

function hitResolved({ attacker, target }) {
  if (!attacker?.isPlayer?.() || !target?.isNpc?.()) return;
  if (common.creatureOf(target) && boatOf(attacker)) engage(target, attacker);
}

function fightOf(npc) {
  return fights.get(npc);
}

function burnImmune(event) {
  const creature = common.creatureOf(event.target);
  if (creature && !["Osprey", "Albatross", "Frigatebird", "Tern"].includes(creature.name)) event.immune = true;
}

/** The creatures' per-tick work, hooked once however often the unit attaches (tests attach again). */
function startTicking(api) {
  if (attached) return;
  attached = true;
  api.core.BoatManager.onAfterTick(tick);
}

function attach(api) {
  common.init(api);
  api.onCustomEvent("sea-combat:creature-attacked", attacked);
  api.onCustomEvent("combat:burn-immune", burnImmune);
  api.onCombatHitResolved(hitResolved);
  startTicking(api);
}

module.exports = attach;
module.exports.engage = engage;
module.exports.release = release;
module.exports.fightOf = fightOf;
module.exports.tick = tick;
module.exports.rollHit = rollHit;
module.exports.step = step;
module.exports._test = { fights, step, sailable, AGGRESSION_RANGE, GIVE_UP_DISTANCE };
