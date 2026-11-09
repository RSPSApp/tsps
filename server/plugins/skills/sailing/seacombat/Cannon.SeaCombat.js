// Boat cannons, manned by the player or a crewmate (rsprox: the user's rev 241 captures of a rune
// cannon on a sloop against ospreys and of Jittery Jim on a skiff's adamant cannon against terns;
// Wiki: Boat combat).
// - Operate mans it: facility_lockedin 4, varps 5042/5043 the loc and its table 162 row, the
//   hotspot number, the combat tab as "Category: Cannon" (357 -> 33, com_mode -> 5), "You man the
//   cannon and take aim...", the side panel's player-at-facility and ammunition, the engage
//   animation then the idle (13325, 13327) and the cannon's (13322, 13324). Operate again: "You
//   disengage from the cannon." and all of it back; stepping away or taking the helm says nothing.
// - Check-ammunition and Reset-ammunition, and a cannonball used on a cannon, show, clear and set
//   the preferred cannonball (varbit 19101). A cannon fires the preferred one if there is any,
//   otherwise the best it can (its table 162 `ammunition_max_tier`); the player's from the
//   inventory, then the cargo hold, a crewmate's from the hold only.
// - Attack on a creature while manning fires every attack_rate (7) ticks until it dies or leaves
//   the cannon's reach (15 tiles, the 180 degrees in front of it; Wiki): "I can't reach that!".
//   A shot: the gunner's attack (13326), the cannon's (13323) and its flash on the cannon's deck
//   tile (vfx_sailing_cannon01_small01_attack01-04 by the cannon's rotation: 3538 facing 1, 3540
//   facing 3, in 900 recorded shots), the cannonball's projectile from the tile outboard of the
//   cannon (46 + 5 per tile cycles; heights 30 to a quarter of the creature's impact height, as
//   rsprox prints map_projanim_v2 heights four times over: 120 -> 210 for an osprey), its impact
//   (3541) delayed to land with it, and the hit floor(cycles / 30) ticks later with sound 10927.
// - Max hit: the player's ranged max hit with the cannon's and cannonball's strength added to the
//   worn gear the cannon counts (not the weapon, shield or ammo slots); accuracy the same way
//   against the creature's heavy ranged defence. XP: 1 Sailing and 4 Ranged per point of the
//   rolled damage, overkill included, on the shot. A crewmate's max hit is the captain's Sailing
//   level's, scaled by their Privateering ((P + 13) / 20); the captain gets 0.7 of its damage as
//   Sailing XP (rsprox: 9 -> 7, 13 -> 9, 17 -> 12, 21 -> 15) and no Ranged.
const common = require("./Common.SeaCombat");
const cargo = require("../Cargo.Sailing");
const facilities = require("../BoatFacilities.Sailing");
const { animateDeckLoc, playSound } = require("../SailingContent.Sailing");
const { STAT } = require("../crew/Common.Crew");

const ANIM = Object.freeze({ ENGAGE: 13325, ATTACK: 13326, IDLE: 13327 });
const LOC_ANIM = Object.freeze({ DISENGAGED: 13321, ENGAGE: 13322, ATTACK: 13323, ENGAGED: 13324 });
/** vfx_sailing_cannon01_small01_attack01: the flash for a cannon of rotation 0; +1 per rotation. */
const GRAPHIC_FIRE0 = 3537;
const GRAPHIC_IMPACT = 3541;
const SOUND_IMPACT = 10927;
const PROJECTILE = Object.freeze({ startHeight: 30, angle: 15, progress: 0, baseCycles: 46, cyclesPerTile: 5 });
/** A projectile's end height is a quarter of the impact spotanim's (v2 projectile heights are 4x, rsprox). */
const PROJECTILE_HEIGHT_SCALE = 4;
/** The normal deck reach to work a facility: its tile and the ones next to it. */
const CANNON_REACH = 2;
const COMBAT_INTERFACE_CATEGORY = (593 << 16) | 5;
const RANGED_XP_PER_DAMAGE = 4;
/** A crewmate's shot gives the captain this much Sailing XP per point of damage (rsprox). */
const CREW_XP_SHARE = 0.7;
/** "You gain some experience by watching your crew work." comes with a crew shot about every 25 ticks (rsprox: 21 at least). */
const WATCHING_GAP_TICKS = 21;
/** When the captain was last told they're watching their crew work (not saved). */
const WATCHING_ATTRIBUTE = "sea-combat:watching";
/** The cannon locs, by name (table 176's cannon rows: bronze to dragon). */
const CANNON_NAMES = Object.freeze([
  "Bronze cannon", "Iron cannon", "Steel cannon", "Mithril cannon", "Adamant cannon", "Rune cannon", "Dragon cannon",
]);
/** Equipment slots a cannon doesn't count (Wiki: weapon, shield and ammunition). */
const UNCOUNTED_SLOTS = [3, 5, 13];
const BONUS_RANGED_ACCURACY = 4;
const BONUS_RANGED_STRENGTH = 11;
/** The crew's orders (sailing_sidepanel_weapon_n_following_target, rsprox). */
const ORDER = Object.freeze({ CAPTAINS_TARGET: 0, AWAIT: 1, FIRE_AT_WILL: 2 });
/** "Fire at will" lasts ten minutes, then they follow the captain again (rsprox: 5730 -> 6730). */
const FIRE_AT_WILL_TICKS = 1000;

const MAN = "You man the cannon and take aim...";
const DISENGAGE = "You disengage from the cannon.";
const CANT_REACH = "I can't reach that!";
const NO_PREFERRED = "You have no preferred ammunition type set. Set it by using a cannonball on any cannon.";
const PREFERRED_RESET = "Your preferred ammunition type has been reset.";
const CREW_NO_AMMO = "Your crewmate on the cannon can't find any ammo in the cargo hold.";
const CREW_NO_AMMO_LINE = "I can't find any ammo in the cargo hold.";
const WATCHING = "You gain some experience by watching your crew work.";

/** `${boat}:${hotspot}` -> the cannon's gunner: the player or a crewmate. */
const gunners = new Map();
/** player index -> the key of the cannon they man. */
const manned = new Map();
/** `${boat}:${hotspot}` -> the crew's order and when "fire at will" ends. */
const orders = new Map();
let attached = false;

function keyOf(boat, hotspot) {
  return `${boat.entityIndex}:${hotspot}`;
}

function now() {
  return common.core().World.getProcessCycle();
}

/** The cannon loc on a hotspot of a boat at sea, with its stats. */
function cannonOn(boat, hotspot) {
  const loc = common.core().BoatManager.getSpec(boat)?.locs.find((candidate) =>
    candidate.hotspot === hotspot && common.cannonAt(candidate.id));
  return loc ? { loc, stats: common.cannonAt(loc.id) } : undefined;
}

function cannonTile(gunner) {
  return common.worldTile(gunner.boat, gunner.boat.deckBaseX + gunner.loc.x, gunner.boat.deckBaseY + gunner.loc.y);
}

/** The cannon's own deck tile, where its flash plays (in the deck scene, so it turns with the boat). */
function cannonDeckTile(gunner) {
  return new (common.core().Location)(gunner.boat.deckBaseX + gunner.loc.x, gunner.boat.deckBaseY + gunner.loc.y, gunner.loc.level);
}

/** Where the cannonball leaves: the tile outboard of the cannon (rsprox: x - 1 facing 1, x + 1 facing 3). */
function muzzleTile(gunner) {
  const outboard = gunner.loc.rotation === 1 ? -1 : gunner.loc.rotation === 3 ? 1 : 0;
  return common.worldTile(gunner.boat, gunner.boat.deckBaseX + gunner.loc.x + outboard, gunner.boat.deckBaseY + gunner.loc.y);
}

/** The side a hotspot is on (1 starboard, 3 port, 0 the centre line). */
function sideOf(owned, hotspot) {
  return facilities.hotspotsOf(owned.type)[hotspot]?.side ?? 0;
}

/**
 * Whether a creature is in a cannon's reach: within 15 tiles and in the half of the sea the
 * cannon faces, out over its side as the boat now lies.
 */
function inReach(gunner, npc) {
  const from = cannonTile(gunner);
  if (common.distanceToNpc(from, npc) > common.CANNON_RANGE) return false;
  const outward = sideOf(gunner.owned, gunner.hotspot) === 1 ? -1 : sideOf(gunner.owned, gunner.hotspot) === 3 ? 1 : 0;
  if (outward === 0) return true;
  const radians = (gunner.boat.angle * Math.PI) / 1024;
  const ox = outward * Math.cos(radians);
  const oy = -outward * Math.sin(radians);
  const size = Math.max(1, npc.getSize?.() ?? 1);
  const tx = npc.getLocation().getX() + (size - 1) / 2 - from.getX();
  const ty = npc.getLocation().getY() + (size - 1) / 2 - from.getY();
  return tx * ox + ty * oy >= 0;
}

/** The cannonball a gunner would fire next and how many of it they can draw on, or undefined. */
function ammoFor(gunner) {
  const sender = gunner.captain.getPacketSender();
  const preferred = common.ballByType(sender.getVarbit(common.VARBIT.PREFERRED_AMMUNITION));
  const countOf = (ball) => cargo.countIn(gunner.owned, ball.item)
    + (gunner.crew ? 0 : gunner.captain.getInventory().getAmount(ball.item));
  const usable = (ball) => ball && ball.type <= gunner.stats.maxTier && countOf(ball) > 0;
  if (usable(preferred)) return { ball: preferred, count: countOf(preferred) };
  const best = [...common.DATA.cannonballs].sort((a, b) => b.type - a.type).find(usable);
  return best ? { ball: best, count: countOf(best) } : undefined;
}

/** Takes one of a cannonball: from the player's inventory first, then the boat's hold. */
function takeOne(gunner, ball) {
  const inventory = gunner.captain.getInventory();
  if (!gunner.crew && inventory.getAmount(ball.item) > 0) {
    inventory.deleteNumber(ball.item, 1);
    return true;
  }
  if (cargo.take(gunner.owned, 0, ball.item, 1) <= 0) return false;
  common.core().PluginManager.emitCustomEvent("sailing:cargo-changed", { player: gunner.captain, boat: gunner.owned });
  sendRepairKitsAndHold(gunner.captain, gunner.owned);
  return true;
}

function sendRepairKitsAndHold(player, owned) {
  player.getPacketSender().sendVarbit(common.VARBIT.REPAIR_KITS, cargo.repairKitUses(owned));
}

/** The side panel's ammunition for a manned cannon (rsprox: flags 4, the type and the count). */
function sendAmmo(gunner, { clear = false } = {}) {
  const sender = gunner.captain.getPacketSender();
  const ammo = clear ? undefined : ammoFor(gunner);
  sender.sendVarbit(common.VARBIT.AMMO_NEEDS_UPDATE, 1);
  sender.sendVarbit(common.PANEL.ammoFlags(gunner.hotspot), ammo ? common.AMMO_FLAGS_LOADED : 0);
  sender.sendConfig(common.PANEL.ammoCount(gunner.hotspot), ammo?.count ?? 0);
  sender.sendVarbit(common.PANEL.ammoType(gunner.hotspot), ammo?.ball.type ?? 0);
  sender.sendVarbit(common.VARBIT.AMMO_NEEDS_UPDATE, 0);
}

function setHasTarget(gunner, has) {
  gunner.captain.getPacketSender().sendVarbit(common.PANEL.hasTarget(gunner.hotspot), has ? 1 : 0);
}

/** The worn ranged accuracy and strength a cannon counts (not the weapon, shield or ammo slots). */
function countedGear(player) {
  let accuracy = 0;
  let strength = 0;
  const { ItemDefinition } = common.core();
  player.getEquipment().getItems().forEach((item, slot) => {
    if (!item || item.getId() <= 0 || UNCOUNTED_SLOTS.includes(slot)) return;
    const bonuses = ItemDefinition.forId(item.getId())?.getBonuses?.() ?? [];
    accuracy += Number(bonuses[BONUS_RANGED_ACCURACY] ?? 0);
    strength += Number(bonuses[BONUS_RANGED_STRENGTH] ?? 0);
  });
  return { accuracy, strength };
}

/** A player's max hit firing a cannon (Wiki: their ranged max hit with the cannon's and ball's strength). */
function playerMaxHit(player, stats, ball) {
  const gear = countedGear(player);
  return common.core().DamageFormulas.rangedMaxHitWithStrength(player, stats.strength + ball.strength + gear.strength);
}

/** A crewmate's max hit (Wiki, Boat combat): the captain's Sailing level, scaled by their Privateering. */
function crewMaxHit(captain, stats, ball, privateering) {
  const sailing = captain.getSkillManager().getCurrentLevel(common.core().Skill.SAILING);
  const base = Math.floor((sailing * (stats.strength + ball.strength + 64) + 320) / 640);
  return Math.floor(base * (privateering + 13) / 20);
}

/** A keg of perildance bitter on the captain's boat raises every cannon's max hit by one. */
function kegBonus(captain) {
  return require("../Kegs.plugin").cannonMaxHitBonus(captain);
}

function hitChance(attackRoll, defenceRoll) {
  return attackRoll > defenceRoll
    ? 1 - (defenceRoll + 2) / (2 * (attackRoll + 1))
    : attackRoll / (2 * (defenceRoll + 1));
}

/** The damage a shot rolls: 0 on a miss, otherwise 0 to the max hit. */
function rollDamage(gunner, ball, npc, random = Math.random) {
  const { AccuracyFormulasDpsCalc, Skill } = common.core();
  if (gunner.crew) {
    const sailing = gunner.captain.getSkillManager().getCurrentLevel(Skill.SAILING);
    const attack = (sailing + 8) * (gunner.stats.accuracy + ball.accuracy + 64);
    const defence = npc ? AccuracyFormulasDpsCalc.defenseRangedRoll(npc, "heavy") : 0;
    const max = crewMaxHit(gunner.captain, gunner.stats, ball, gunner.crew.crew.stats[STAT.PRIVATEERING] ?? 1) + kegBonus(gunner.captain);
    return random() < hitChance(attack, defence) ? Math.floor(random() * (max + 1)) : 0;
  }
  const gear = countedGear(gunner.captain);
  const attack = AccuracyFormulasDpsCalc.rangedAttackRollWithBonus(gunner.captain, gunner.stats.accuracy + ball.accuracy + gear.accuracy);
  const defence = npc ? AccuracyFormulasDpsCalc.defenseRangedRoll(npc, "heavy") : 0;
  const max = playerMaxHit(gunner.captain, gunner.stats, ball) + kegBonus(gunner.captain);
  return random() < hitChance(attack, defence) ? Math.floor(random() * (max + 1)) : 0;
}

function later(entity, ticks, action) {
  const { Task, TaskManager } = common.core();
  TaskManager.submit(new (class extends Task {
    constructor() { super(Math.max(1, ticks), entity, false); }
    execute() {
      this.stop();
      action();
    }
  })());
}

/** Everyone who should see a deck loc's animation: the captain and those who see them. */
function animateCannon(gunner, animId) {
  animateDeckLoc(gunner.captain, gunner.boat, gunner.loc, animId);
}

function cannonMethod() {
  const { CombatMethod, CombatType } = common.core();
  cannonMethod.cached ??= new (class BoatCannonMethod extends CombatMethod {
    type() { return CombatType.RANGED; }
    hits() { return []; }
  })();
  return cannonMethod.cached;
}

/**
 * Fires one shot at a target: a creature (`npc`) or a static ship (`ship`, whose damage the caller
 * applies). Returns the rolled damage, or undefined when there was no ammunition.
 */
function fire(gunner, { npc, ship, onShipHit } = {}) {
  const ammo = ammoFor(gunner);
  if (!ammo) {
    noAmmo(gunner);
    return undefined;
  }
  if (!takeOne(gunner, ammo.ball)) return undefined;
  gunner.outOfAmmo = false;
  const { Animation, Graphic, Projectile, PendingHit, CombatFactory, Skill } = common.core();
  const from = muzzleTile(gunner);
  const end = npc ? npc.getLocation() : new (common.core().Location)(ship.boat.tileX, ship.boat.tileY, ship.boat.level);
  const distance = npc ? common.distanceToNpc(from, npc) : from.getDistance(end);
  const cycles = PROJECTILE.baseCycles + PROJECTILE.cyclesPerTile * Math.max(1, distance);
  const impactHeight = npc ? common.creatureOf(npc)?.impactHeight ?? 20 : 210;
  gunner.actor.performAnimation(new Animation(ANIM.ATTACK));
  animateCannon(gunner, LOC_ANIM.ATTACK);
  const flash = new Graphic(GRAPHIC_FIRE0 + ((gunner.loc.rotation ?? 1) & 3));
  for (const viewer of viewers(gunner)) viewer.getPacketSender().sendGraphic(flash, cannonDeckTile(gunner));
  new Projectile(from, npc ? Projectile.centreOf(npc) : end, npc ?? null, ammo.ball.projectile, 0, cycles,
    PROJECTILE.startHeight, Math.round(impactHeight / PROJECTILE_HEIGHT_SCALE), null)
    .withAngle(PROJECTILE.angle).withProgress(PROJECTILE.progress).sendProjectile();
  const hitTicks = Math.max(1, Math.floor(cycles / 30));
  const damage = rollDamage(gunner, ammo.ball, npc);
  const sender = gunner.captain.getPacketSender();
  sendAmmo(gunner);
  setHasTarget(gunner, true);
  if (!gunner.crew) sender.sendVarbit(common.VARBIT.LAST_FIRED_AMMUNITION, ammo.ball.type);
  if (npc) {
    npc.performGraphic(new Graphic(GRAPHIC_IMPACT, cycles, impactHeight));
    CombatFactory.addPendingHit(new PendingHit(gunner.captain, npc, cannonMethod(), {
      delay: Math.max(0, hitTicks - 1), rollAccuracy: false, experience: false, handleAfterHitEffects: false, damage,
    }));
    later(gunner.captain, hitTicks, () => playSound(gunner.captain, SOUND_IMPACT));
    common.core().PluginManager.emitCustomEvent("sea-combat:creature-attacked", { player: gunner.captain, npc, boat: gunner.boat });
    rewardXp(gunner, damage);
  } else if (onShipHit) {
    later(gunner.captain, hitTicks, () => onShipHit(damage));
  }
  return damage;
}

/** XP for a shot's rolled damage (Wiki: overkill counts). */
function rewardXp(gunner, damage) {
  if (damage <= 0) return;
  const { Skill } = common.core();
  const skills = gunner.captain.getSkillManager();
  if (!gunner.crew) {
    skills.addExperiences(Skill.SAILING, damage);
    skills.addExperiences(Skill.RANGED, damage * RANGED_XP_PER_DAMAGE);
    return;
  }
  skills.addExperiences(Skill.SAILING, damage * CREW_XP_SHARE);
  const last = gunner.captain.getAttribute?.(WATCHING_ATTRIBUTE) ?? -Infinity;
  if (now() - last >= WATCHING_GAP_TICKS) {
    gunner.captain.setAttribute?.(WATCHING_ATTRIBUTE, now());
    common.spam(gunner.captain, WATCHING);
  }
}

/**
 * Out of ammunition: the target goes. A crewmate says so once until they next fire (live says it
 * again now and then; firing at will here would otherwise repeat it every attack).
 */
function noAmmo(gunner) {
  gunner.target = undefined;
  setHasTarget(gunner, false);
  sendAmmo(gunner);
  if (!gunner.crew || gunner.outOfAmmo) return;
  gunner.outOfAmmo = true;
  common.spam(gunner.captain, CREW_NO_AMMO);
  const lines = require("../crew/Lines.Crew");
  if (!lines.say(gunner.actor, gunner.crew.crew, "noAmmo")) gunner.actor.forceChat(CREW_NO_AMMO_LINE);
}

function viewers(gunner) {
  const player = gunner.captain;
  return [player, ...player.getLocalPlayers().filter((other) => other.getLocalPlayers().includes(player))];
}

/** The gunner the player is, if they man a cannon. */
function mannedBy(player) {
  const key = manned.get(player.getIndex());
  const gunner = key && gunners.get(key);
  return gunner && !gunner.crew && gunner.actor === player ? gunner : undefined;
}

/** Whether a player mans the cannon on a hotspot. */
function playerAt(boat, hotspot) {
  const gunner = gunners.get(keyOf(boat, hotspot));
  return gunner !== undefined && !gunner.crew;
}

/** Mans a cannon (rsprox, the user's captures). */
function man(player, boat, owned, loc, stats) {
  const hotspot = loc.hotspot;
  const key = keyOf(boat, hotspot);
  // A crewmate at this cannon (or on their way to it) leaves it to the player.
  common.core().PluginManager.emitCustomEvent("sailing:cannon-taken", { player, boat, hotspot });
  const sender = player.getPacketSender();
  const gunner = {
    boat, owned, hotspot, loc, stats, captain: player, actor: player,
    target: undefined, nextAttackTick: 0, stance: player.getLocation().clone(),
    previous: { category: sender.getVarbit(common.VARBIT.COMBAT_WEAPON_CATEGORY), comMode: sender.getVarp(common.VARP.COM_MODE) },
  };
  gunners.set(key, gunner);
  manned.set(player.getIndex(), key);
  sender.sendVarbit(common.VARBIT.LOCKED_IN, common.LOCKED_IN_CANNON);
  sender.sendConfig(common.VARP.COMBAT_FACILITY_IN_USE, loc.id);
  sender.sendConfig(common.VARP.COMBAT_FACILITY_DATA, stats.dataRow);
  sender.sendVarbit(common.VARBIT.HOTSPOT_NUMBER, hotspot + 1);
  sender.sendVarbit(common.VARBIT.COMBAT_WEAPON_CATEGORY, common.CANNON_WEAPON_CATEGORY);
  sender.sendConfig(common.VARP.COM_MODE, common.CANNON_COM_MODE);
  common.spam(player, MAN);
  sendAmmo(gunner);
  sender.sendVarbit(common.PANEL.playerAtFacility(hotspot), 1);
  sender.sendString("Category: Cannon", COMBAT_INTERFACE_CATEGORY);
  player.getMovementQueue().reset();
  player.setPositionToFace(new (common.core().Location)(boat.deckBaseX + loc.x, boat.deckBaseY + loc.y, 0));
  player.performAnimation(new (common.core().Animation)(ANIM.ENGAGE));
  animateCannon(gunner, LOC_ANIM.ENGAGE);
  later(player, 1, () => {
    if (gunners.get(key) !== gunner) return;
    player.performAnimation(new (common.core().Animation)(ANIM.IDLE));
    animateCannon(gunner, LOC_ANIM.ENGAGED);
  });
}

/** Leaves the cannon: everything manning set goes back (with the message when asked to). */
function disengage(player, { message = false } = {}) {
  const key = manned.get(player.getIndex());
  manned.delete(player.getIndex());
  const gunner = key && gunners.get(key);
  if (!gunner || gunner.crew) return;
  gunners.delete(key);
  const sender = player.getPacketSender();
  sender.sendConfig(common.VARP.COMBAT_FACILITY_DATA, -1);
  sender.sendConfig(common.VARP.COMBAT_FACILITY_IN_USE, -1);
  sender.sendVarbit(common.PANEL.playerAtFacility(gunner.hotspot), 0);
  sender.sendVarbit(common.VARBIT.HOTSPOT_NUMBER, 0);
  sender.sendVarbit(common.VARBIT.LOCKED_IN, 0);
  sendAmmo(gunner, { clear: true });
  setHasTarget(gunner, false);
  sender.sendVarbit(common.VARBIT.COMBAT_WEAPON_CATEGORY, gunner.previous.category);
  sender.sendConfig(common.VARP.COM_MODE, gunner.previous.comMode);
  if (message) common.spam(player, DISENGAGE);
  if (player.isRegistered?.() !== false) {
    player.performAnimation(common.core().Animation.DEFAULT_RESET_ANIMATION);
    if (common.core().Sailing.instanceAboard(player) === gunner.boat) animateCannon(gunner, LOC_ANIM.DISENGAGED);
  }
}

/** A crewmate takes a cannon (crew/Cannon.Crew.js): they fire by the captain's orders. */
function manByCrew(player, boat, owned, member, hotspot) {
  const cannon = cannonOn(boat, hotspot);
  if (!cannon) return undefined;
  const key = keyOf(boat, hotspot);
  // The player took it while they walked there: the player keeps it.
  if (playerAt(boat, hotspot)) return undefined;
  const gunner = {
    boat, owned, hotspot, loc: cannon.loc, stats: cannon.stats, captain: player, actor: member.npc, crew: member,
    target: undefined, nextAttackTick: 0,
  };
  gunners.set(key, gunner);
  const { Animation } = common.core();
  member.npc.performAnimation(new Animation(ANIM.ENGAGE));
  animateCannon(gunner, LOC_ANIM.ENGAGE);
  sendAmmo(gunner);
  later(member.npc, 1, () => {
    if (gunners.get(key) !== gunner) return;
    member.npc.performAnimation(new Animation(ANIM.IDLE));
    animateCannon(gunner, LOC_ANIM.ENGAGED);
  });
  return {
    stop: () => {
      if (gunners.get(key) !== gunner) return;
      gunners.delete(key);
      // Off the cannon they stand (and walk) normally again, not in its idle pose.
      member.npc.performAnimation(common.core().Animation.DEFAULT_RESET_ANIMATION);
      setHasTarget(gunner, false);
      sendAmmo(gunner, { clear: true });
      if (common.core().Sailing.instanceAboard(player) === boat) animateCannon(gunner, LOC_ANIM.DISENGAGED);
    },
  };
}

function orderOf(boat, hotspot) {
  const order = orders.get(keyOf(boat, hotspot));
  if (order?.order === ORDER.FIRE_AT_WILL && now() >= order.until) return ORDER.CAPTAINS_TARGET;
  return order?.order ?? ORDER.CAPTAINS_TARGET;
}

/**
 * The crew's order buttons on a cannon's row (rsprox): the first cycles "Attack my targets!",
 * "Await further orders!" and "Fire at will!", the second is "Hold fire!".
 */
function setOrder(player, boat, hotspot, order) {
  orders.set(keyOf(boat, hotspot), { order, until: now() + FIRE_AT_WILL_TICKS });
  player.getPacketSender().sendVarbit(common.PANEL.followingTarget(hotspot), order);
}

function holdFire(boat, hotspot) {
  const gunner = gunners.get(keyOf(boat, hotspot));
  if (!gunner) return;
  gunner.target = undefined;
  setHasTarget(gunner, false);
}

/** Whether a creature can be fired at: alive, attackable and not the player's only. */
function validTarget(npc) {
  return npc && npc.isRegistered?.() !== false && npc.getHitpoints() > 0 && common.creatureOf(npc) !== undefined
    && !npc.isDyingFunction?.();
}

/** The captain's Attack while they man a cannon (or command one): the cannon takes the target. */
/**
 * The captain's Attack on a creature. Crewmates following the captain's target take it whether
 * or not the captain mans a cannon (rsprox: crew-combat, "Fire!" off the cannon, then "I can't reach
 * that!" from the captain's own attack); a captain
 * on a cannon fires it, otherwise their own attack goes on as normal combat.
 */
function attackOption(event) {
  const { player, npc } = event;
  const boat = common.core().Sailing.instanceAboard(player);
  if (boat && validTarget(npc)) captainTargets(player, boat, npc);
  const gunner = mannedBy(player);
  if (!gunner) return;
  event.handled = true;
  player.getMovementQueue().reset();
  if (!validTarget(npc) || !inReach(gunner, npc)) {
    player.sendMessage(CANT_REACH);
    return;
  }
  gunner.target = npc;
}

/** Crew following the captain's target take it too; the captain calls "Fire!" (rsprox). */
function captainTargets(player, boat, npc) {
  let called = false;
  for (const gunner of gunners.values()) {
    if (gunner.boat !== boat || !gunner.crew || orderOf(boat, gunner.hotspot) !== ORDER.CAPTAINS_TARGET) continue;
    if (!inReach(gunner, npc)) continue;
    gunner.target = npc;
    called = true;
  }
  if (called) player.forceChat("Fire!");
}

/** A target for a crewmate firing at will: the nearest creature the cannon reaches. */
function anyTarget(gunner) {
  const from = cannonTile(gunner);
  let best;
  let bestDistance = Infinity;
  for (const npc of gunner.captain.getLocalNpcs?.() ?? []) {
    if (!validTarget(npc) || !inReach(gunner, npc)) continue;
    const distance = common.distanceToNpc(from, npc);
    if (distance < bestDistance) {
      best = npc;
      bestDistance = distance;
    }
  }
  return best;
}

/** Each tick: gunners who left their cannon stop, the rest fire when their cannon is ready. */
function tick() {
  const cycle = now();
  for (const [key, gunner] of [...gunners]) {
    const { Sailing } = common.core();
    if (!gunner.crew) {
      const here = gunner.captain.getLocation();
      const stayed = Sailing.instanceAboard(gunner.captain) === gunner.boat && gunner.stance
        && here.getX() === gunner.stance.getX() && here.getY() === gunner.stance.getY();
      if (!stayed || !cannonOn(gunner.boat, gunner.hotspot)) {
        disengage(gunner.captain);
        continue;
      }
    } else if (gunners.get(key) !== gunner) {
      continue;
    }
    if (gunner.crew && !gunner.target && orderOf(gunner.boat, gunner.hotspot) === ORDER.FIRE_AT_WILL) {
      gunner.target = anyTarget(gunner);
    }
    if (gunner.crew) expireFireAtWill(gunner);
    if (!gunner.target) continue;
    if (!validTarget(gunner.target) || !inReach(gunner, gunner.target)) {
      if (!gunner.crew && validTarget(gunner.target)) gunner.captain.sendMessage(CANT_REACH);
      gunner.target = undefined;
      setHasTarget(gunner, false);
      continue;
    }
    if (cycle < gunner.nextAttackTick) continue;
    gunner.nextAttackTick = cycle + gunner.stats.attackRate;
    fire(gunner, { npc: gunner.target });
  }
}

/** "Fire at will" running out puts the crew back on the captain's targets (rsprox: 2 -> 0). */
function expireFireAtWill(gunner) {
  const key = keyOf(gunner.boat, gunner.hotspot);
  const order = orders.get(key);
  if (order?.order !== ORDER.FIRE_AT_WILL || now() < order.until) return;
  orders.set(key, { order: ORDER.CAPTAINS_TARGET, until: 0 });
  gunner.captain.getPacketSender().sendVarbit(common.PANEL.followingTarget(gunner.hotspot), ORDER.CAPTAINS_TARGET);
}

/** The deck loc of the cannon a player clicked, with the boat and its stats; undefined otherwise. */
function clickedCannon(event) {
  const stats = common.cannonAt(event.objectId);
  if (!stats) return undefined;
  const aboard = common.ownBoat(event.player);
  if (!aboard) return { stats };
  const { boat, owned } = aboard;
  const loc = common.core().BoatManager.getSpec(boat)?.locs.find((candidate) => candidate.id === event.objectId
    && boat.deckBaseX + candidate.x === event.location.x && boat.deckBaseY + candidate.y === event.location.y);
  return { stats, boat, owned, loc };
}

/** Operate: man the cannon, or leave it when already manning it. */
function operate(event) {
  const clicked = clickedCannon(event);
  if (!clicked) return false;
  const { player } = event;
  event.handled = true;
  const { stats, boat, owned, loc } = clicked;
  if (!boat || !loc) {
    player.sendMessage("You can only operate the cannon on your own boat.");
    return;
  }
  const deckTile = new (common.core().Location)(boat.deckBaseX + loc.x, boat.deckBaseY + loc.y, 0);
  if (!player.getLocation().isWithinDistance(deckTile, CANNON_REACH)) return;
  const current = mannedBy(player);
  if (current && current.boat === boat && current.hotspot === loc.hotspot) {
    disengage(player, { message: true });
    return;
  }
  if (current) disengage(player);
  const { Skill } = common.core();
  const skills = player.getSkillManager();
  if (skills.getMaxLevel(Skill.SAILING) < stats.sailing) {
    player.sendMessage(`You need a Sailing level of ${stats.sailing} to operate this cannon.`);
    return;
  }
  if (skills.getCurrentLevel(Skill.RANGED) < stats.ranged) {
    player.sendMessage(`You need a Ranged level of ${stats.ranged} to operate this cannon.`);
    return;
  }
  man(player, boat, owned, loc, stats);
}

function checkAmmunitionOp({ player }) {
  checkAmmunition(player);
}

function resetAmmunitionOp({ player }) {
  resetAmmunition(player);
}

function checkAmmunition(player) {
  const ball = common.ballByType(player.getPacketSender().getVarbit(common.VARBIT.PREFERRED_AMMUNITION));
  player.sendMessage(ball ? `Your preferred ammunition is set to ${common.red(ball.name + "s")}.` : NO_PREFERRED);
}

function resetAmmunition(player) {
  player.getPacketSender().sendVarbit(common.VARBIT.PREFERRED_AMMUNITION, 0);
  player.sendMessage(PREFERRED_RESET);
  refreshAmmo(player);
}

/** A cannonball used on a cannon becomes the preferred one (rsprox: crew-combat). */
function useBall(event) {
  const ball = common.ballByItem(event.itemId);
  if (!ball || !common.cannonAt(event.objectId)) return false;
  event.handled = true;
  event.player.getPacketSender().sendVarbit(common.VARBIT.PREFERRED_AMMUNITION, ball.type);
  event.player.sendMessage(`Your preferred ammunition has been set to ${common.red(ball.name + "s")}.`);
  refreshAmmo(event.player);
  return true;
}

/** Re-sends the ammunition of every cannon on the player's boat. */
function refreshAmmo(player) {
  for (const gunner of gunners.values()) if (gunner.captain === player) sendAmmo(gunner);
}

function forget(player) {
  disengage(player);
  for (const [key, gunner] of [...gunners]) if (gunner.captain === player) gunners.delete(key);
}

function onCargoChanged({ player }) {
  if (player) refreshAmmo(player);
}

function onLogout({ player }) {
  forget(player);
}

/** The cannons' per-tick work, hooked once however often the unit attaches (tests attach again). */
function startTicking(api) {
  if (attached) return;
  attached = true;
  api.core.BoatManager.onAfterTick(tick);
}

function onLeft({ player, boat }) {
  disengage(player);
  for (const [key, gunner] of [...gunners]) if (gunner.boat === boat) gunners.delete(key);
  for (const key of [...orders.keys()]) if (key.startsWith(`${boat.entityIndex}:`)) orders.delete(key);
}

const CANNON_OPS = Object.freeze({ Operate: operate, "Check-ammunition": checkAmmunitionOp, "Reset-ammunition": resetAmmunitionOp });

function attach(api) {
  common.init(api);
  for (const name of CANNON_NAMES) api.onObjectInteraction(name, CANNON_OPS);
  api.onItemOnObject(useBall);
  api.onNpcAttackOption(attackOption);
  api.onCustomEvent("sailing:left", onLeft);
  api.onCustomEvent("sailing:cargo-changed", onCargoChanged);
  api.onPlayerLogout(onLogout);
  startTicking(api);
}

module.exports = attach;
module.exports.ORDER = ORDER;
module.exports.fire = fire;
module.exports.man = man;
module.exports.manByCrew = manByCrew;
module.exports.disengage = disengage;
module.exports.mannedBy = mannedBy;
module.exports.playerAt = playerAt;
module.exports.inReach = inReach;
module.exports.ammoFor = ammoFor;
module.exports.orderOf = orderOf;
module.exports.setOrder = setOrder;
module.exports.holdFire = holdFire;
module.exports.captainTargets = captainTargets;
module.exports.cannonOn = cannonOn;
module.exports.tick = tick;
module.exports._test = {
  gunners, manned, orders, playerMaxHit, crewMaxHit, rollDamage, countedGear, hitChance, keyOf, operate, checkAmmunition,
  resetAmmunition, attackOption, CANNON_NAMES,
  useBall, PROJECTILE, CREW_XP_SHARE, RANGED_XP_PER_DAMAGE,
};
