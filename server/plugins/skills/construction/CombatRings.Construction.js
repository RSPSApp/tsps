"use strict";

const { api, Animation, CombatType, Equipment, EquipPacketListener, Location, Skill } = require("./Core.Construction");
const Ids = require("./Ids.Construction");
const House = require("./House.Construction");

// Combat room rings (rsprox captures, Wiki): Climb-over on the ropes plays
// human_get_over_combatring_nogloves (redgloves/bluegloves when wearing boxing gloves) and moves
// the player a tile across. The boxing ring refuses "You can't wear weapons or armour in the boxing
// ring (except boxing gloves).", the fencing ring "You can't wear any armour in the fencing ring.";
// the combat ring and the ranging pedestals' barrier (Walk-through) take anything. Players inside
// the same ring can fight, and a player beaten there is put outside it at full health with their
// items (Wiki). Racks offer "What do you want to take?" with gloves, wooden sword and shield and the
// pugel by tier. The balance beam: "Climbing on to beam." (balance_beam_getup, wields the pugel:
// "You must have a pugel stick to fight on the balance beam.", "You must free your hands so you can
// wield the pugel stick.") only at an end ("You should get on the balance beam at one end."), and
// Get-down plays balance_beam_jumpoff and takes the pugel off. Pugel blows knock the other player
// off instead of hurting; how often, and the defeat and knock-off messages, are this server's.
const RED_GLOVES = Ids.obj("poh_boxing_gloves_red");
const BLUE_GLOVES = Ids.obj("poh_boxing_gloves_blue");
const WOODEN_SWORD = Ids.obj("poh_wooden_sword");
const WOODEN_SHIELD = Ids.obj("poh_wooden_shield");
const PUGEL = Ids.obj("poh_pugel");
const HOUSE_ONLY_ITEMS = [RED_GLOVES, BLUE_GLOVES, WOODEN_SWORD, WOODEN_SHIELD, PUGEL];
const CLIMB = {
  none: Ids.seq("human_get_over_combatring_nogloves"), [RED_GLOVES]: Ids.seq("human_get_over_combatring_redgloves"),
  [BLUE_GLOVES]: Ids.seq("human_get_over_combatring_bluegloves"),
};
const BEAM_GET_UP = Ids.seq("balance_beam_getup");
const BEAM_FALL_OFF = Ids.seq("balance_beam_falloff");
const BEAM_JUMP_OFF = Ids.seq("balance_beam_jumpoff");
const KNOCK_OFF_CHANCE = 1 / 3;
const BEAM_REACH = 3; // end to end
// Each ring's rope (or barrier) locs and the locs of the tiles inside it.
const RINGS = {
  BOXING_RING: {
    ropes: ["poh_boxing_ringwall_white", "poh_boxing_ringwall_corner", "poh_boxing_ringwall_red", "poh_boxing_ringwall_blue"].map(Ids.loc),
    inside: ["poh_boxing_ring_mat_corner", "poh_boxing_ring_mat_middle", "poh_boxing_ring_mat_side"].map(Ids.loc), rule: "boxing",
  },
  FENCING_RING: {
    ropes: [Ids.loc("poh_fencing_ringwall")],
    inside: ["poh_fencing_ring_mat_side", "poh_fencing_ring_mat_corner", "poh_fencing_ring_mat_middle"].map(Ids.loc), rule: "fencing",
  },
  COMBAT_RING: { ropes: [Ids.loc("poh_combat_ringwall")], inside: ["poh_combat_mat_corner", "poh_combat_mat_side", "poh_combat_mat_middle"].map(Ids.loc) },
  RANGING_PEDESTALS: { ropes: [Ids.loc("poh_magic_circle_wall")], inside: [Ids.loc("poh_magic_circle_mat")] },
};
const BEAM_ENDS = [Ids.loc("poh_balancebeam_endl"), Ids.loc("poh_balancebeam_endr")];
const BEAM_MIDDLE = Ids.loc("poh_balancebeam_middle");
const RACKS = {
  GLOVE_RACK: [["Red boxing gloves", RED_GLOVES], ["Blue boxing gloves", BLUE_GLOVES]],
  WEAPONS_RACK: [["Red boxing gloves", RED_GLOVES], ["Blue boxing gloves", BLUE_GLOVES], ["Wooden sword", WOODEN_SWORD], ["Wooden shield", WOODEN_SHIELD]],
  EXTRA_WEAPONS_RACK: [["Red boxing gloves", RED_GLOVES], ["Blue boxing gloves", BLUE_GLOVES], ["Wooden sword", WOODEN_SWORD], ["Wooden shield", WOODEN_SHIELD], ["Pugel stick", PUGEL]],
};

const tileKey = (x, y, z) => `${x},${y},${z}`;

/** The ring a drawn loc belongs to, by id. */
function ringOfLoc(id) {
  return Object.values(RINGS).find(ring => ring.ropes.includes(id) || ring.inside.includes(id)) ?? null;
}

/** Tiles inside rings and on the beam, each with the ring (or "beam") they belong to. */
function fightTiles(house) {
  const tiles = new Map();
  for (const object of house.furnitureObjects) {
    const at = object.getLocation();
    const ring = ringOfLoc(object.getId());
    if (ring?.inside.includes(object.getId())) tiles.set(tileKey(at.getX(), at.getY(), at.getZ()), { ring, room: house.getRoomPositionAt({ x: at.getX(), y: at.getY(), z: at.getZ() }) });
    if (BEAM_ENDS.includes(object.getId()) || object.getId() === BEAM_MIDDLE) tiles.set(tileKey(at.getX(), at.getY(), at.getZ()), { ring: "beam", room: house.getRoomPositionAt({ x: at.getX(), y: at.getY(), z: at.getZ() }) });
  }
  return tiles;
}

function fightTileOf(house, player) {
  const at = player.getLocation();
  return fightTiles(house).get(tileKey(at.getX(), at.getY(), at.getZ())) ?? null;
}

function sameFight(a, b) {
  return a && b && a.ring === b.ring && a.room?.x === b.room?.x && a.room?.y === b.room?.y && a.room?.plane === b.room?.plane;
}

function worn(player) {
  return player.getEquipment().getItems().map((item, slot) => ({ id: item?.getId?.() ?? -1, slot })).filter(item => item.id > 0);
}

function allowedIn(player, rule) {
  if (rule === "boxing" && worn(player).some(item => item.id !== RED_GLOVES && item.id !== BLUE_GLOVES)) {
    player.sendMessage("You can't wear weapons or armour in the boxing ring (except boxing gloves).");
    return false;
  }
  if (rule === "fencing" && worn(player).some(item => item.slot !== Equipment.WEAPON_SLOT && item.slot !== Equipment.AMMUNITION_SLOT)) {
    player.sendMessage("You can't wear any armour in the fencing ring.");
    return false;
  }
  return true;
}

function climbOver(event) {
  const player = event.player;
  const house = House.houseFor(player);
  const ring = house && ringOfLoc(event.objectId);
  if (!ring || !ring.ropes.includes(event.objectId)) return false;
  const tiles = fightTiles(house);
  const here = player.getLocation();
  const inside = tiles.get(tileKey(here.getX(), here.getY(), here.getZ()))?.ring === ring;
  const { x, y, z } = event.location;
  let to;
  if (inside) {
    to = new Location(x, y, z);
  } else {
    const steps = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
    const step = steps.find(([dx, dy]) => tiles.get(tileKey(x + dx, y + dy, z))?.ring === ring);
    if (!step) return true;
    if (!allowedIn(player, ring.rule)) return true;
    to = new Location(x + step[0], y + step[1], z);
  }
  const gloves = player.getEquipment().getItems()[Equipment.HANDS_SLOT]?.getId?.();
  player.performAnimation(new Animation(CLIMB[gloves] ?? CLIMB.none));
  player.moveTo(to);
  return true;
}

/** Instance.canAttack: players in the same ring, or both on the beam, may fight. */
function canFight(attacker, target, house) {
  if (!attacker?.isPlayer?.() || !target?.isPlayer?.()) return null;
  const a = fightTileOf(house, attacker.getAsPlayer());
  const b = fightTileOf(house, target.getAsPlayer());
  return a || b ? sameFight(a, b) : null;
}

/** onPlayerBeforeDeath: losing a ring fight puts the player outside it, healed, with their items. */
function beatenInRing(event) {
  const player = event.player;
  const house = House.houseFor(player);
  const fight = house && fightTileOf(house, player);
  if (!fight) return;
  event.preventDeath = true;
  player.getCombat().reset();
  player.getSkillManager().setCurrentLevel(Skill.HITPOINTS, player.getSkillManager().getMaxLevel(Skill.HITPOINTS), true);
  player.moveTo(outsideOf(house, player.getLocation()));
  player.sendMessage("You have been defeated. Better luck next time!");
}

/** The nearest tile beyond the ring's ropes. */
function outsideOf(house, at) {
  const tiles = fightTiles(house);
  for (let radius = 1; radius < 7; radius++) {
    for (let dx = -radius; dx <= radius; dx++) for (let dy = -radius; dy <= radius; dy++) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) !== radius) continue;
      const x = at.getX() + dx, y = at.getY() + dy;
      if (tiles.has(tileKey(x, y, at.getZ()))) continue;
      const near = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([sx, sy]) => tiles.has(tileKey(x + sx, y + sy, at.getZ())));
      if (!near) return new Location(x, y, at.getZ());
    }
  }
  return at;
}

function searchRack(event) {
  const player = event.player;
  const house = House.houseFor(player);
  const furniture = house?.getFurnitureAt(event.location, event.objectId, event.object?.getType() ?? 10);
  const items = furniture && RACKS[furniture.buildableKey];
  if (!items) return false;
  api.sendMultiChatboxPrompt(player, "What do you want to take?", ...items.flatMap(([label, itemId]) => [label, () => {
    if (player.getInventory().getFreeSlots() === 0) return player.sendMessage("You don't have enough inventory space.");
    player.getInventory().adds(itemId, 1);
  }]));
  return true;
}

function standOnBeam(event) {
  const player = event.player;
  if (!House.houseFor(player)) return false;
  if (event.objectId === BEAM_MIDDLE) return player.sendMessage("You should get on the balance beam at one end."), true;
  const items = player.getEquipment().getItems();
  const wielded = items[Equipment.WEAPON_SLOT]?.getId?.() === PUGEL;
  if (!wielded && !player.getInventory().contains(PUGEL)) {
    player.sendMessage("You must have a pugel stick to fight on the balance beam.");
    return true;
  }
  const hands = [Equipment.WEAPON_SLOT, Equipment.SHIELD_SLOT].some(slot => (items[slot]?.getId?.() ?? -1) > 0);
  if (!wielded && hands) {
    player.sendMessage("You must free your hands so you can wield the pugel stick.");
    return true;
  }
  player.sendMessage("Climbing on to beam.");
  if (!wielded) EquipPacketListener.equip(player, PUGEL, player.getInventory().getSlotForItemId(PUGEL), player.getInventory().constructor.INTERFACE_ID);
  player.performAnimation(new Animation(BEAM_GET_UP));
  player.moveTo(new Location(event.location.x, event.location.y, event.location.z));
  return true;
}

function offBeam(player, house, animation) {
  player.performAnimation(new Animation(animation));
  player.getCombat().reset();
  if (player.getEquipment().getItems()[Equipment.WEAPON_SLOT]?.getId?.() === PUGEL) EquipPacketListener.unequip(player, Equipment.WEAPON_SLOT);
  player.moveTo(outsideOf(house, player.getLocation()));
}

/**
 * onObjectRoute: the beam is fenced off by invisible walls, so Stand-on walks to the tile past
 * its end, and the beam's other options act from where the player stands on it.
 */
function routeToBeam(event) {
  if (!BEAM_ENDS.includes(event.objectId) && event.objectId !== BEAM_MIDDLE) return;
  const house = House.houseFor(event.player);
  if (!house) return;
  const at = event.object.getLocation();
  const x = at.getX(), y = at.getY(), z = at.getZ();
  if (!BEAM_ENDS.includes(event.objectId) || fightTileOf(house, event.player)) {
    const here = event.player.getLocation();
    event.destination = { x: here.getX(), y: here.getY(), z: here.getZ() };
    return;
  }
  const tiles = fightTiles(house);
  const step = [[1, 0], [-1, 0], [0, 1], [0, -1]].find(([dx, dy]) => tiles.has(tileKey(x + dx, y + dy, z)));
  if (step) event.destination = { x: x - step[0], y: y - step[1], z };
}

function getDown(event) {
  const house = House.houseFor(event.player);
  if (!house || !fightTileOf(house, event.player)) return false;
  offBeam(event.player, house, BEAM_JUMP_OFF);
  return true;
}

/** onCombatHitDamage: pugel blows on the beam don't hurt; a landed one may knock the other off. */
function pugelBlow(event) {
  const { attacker, target } = event;
  if (!attacker?.isPlayer?.() || !target?.isPlayer?.()) return;
  const house = House.houseFor(attacker.getAsPlayer());
  if (!house || fightTileOf(house, attacker.getAsPlayer())?.ring !== "beam") return;
  event.damage.setDamage(0);
  event.hit.experience = false;
  if (!event.accurate || Math.random() >= KNOCK_OFF_CHANCE) return;
  const victim = target.getAsPlayer();
  offBeam(victim, house, BEAM_FALL_OFF);
  victim.sendMessage("You have been knocked off the balance beam!");
  attacker.getAsPlayer().sendMessage(`You knock ${victim.getUsername()} off the balance beam!`);
}

/** onCombatAttackDistance: players at the two ends of the beam can reach each other. */
function beamReach(event) {
  const { attacker, target } = event;
  if (event.combatType !== CombatType.MELEE || !attacker?.isPlayer?.() || !target?.isPlayer?.()) return;
  const house = House.houseFor(attacker.getAsPlayer());
  if (house && fightTileOf(house, attacker.getAsPlayer())?.ring === "beam") event.distance = Math.max(event.distance, BEAM_REACH);
}

/** House.leftHouse: the combat room's gloves, wooden weapons and pugels stay in the house. */
function leftCombatRoom(player) {
  for (const [slot, item] of player.getEquipment().getItems().entries()) {
    if (HOUSE_ONLY_ITEMS.includes(item?.getId?.())) player.getEquipment().deleteAtSlot(slot, item.getAmount());
  }
  for (const itemId of HOUSE_ONLY_ITEMS) {
    const amount = player.getInventory().getAmount(itemId);
    if (amount) player.getInventory().delete(itemId, amount);
  }
}

function allowBountyHunterWeapons(event) {
  const house = House.houseFor(event.attacker);
  if (!house || House.houseFor(event.target) !== house) return;
  const from = fightTileOf(house, event.attacker);
  const to = fightTileOf(house, event.target);
  if (from?.ring === RINGS.COMBAT_RING && sameFight(from, to)) event.allowed = true;
}

function attachCombatRings(api) {
  api.onObjectInteraction("Boxing ring", { "Climb-over": climbOver });
  api.onObjectInteraction("Fencing ring", { "Climb-over": climbOver });
  api.onObjectInteraction("Combat ring", { "Climb-over": climbOver });
  api.onCustomEvent("bounty-hunter:weapon-area", allowBountyHunterWeapons);
  api.onObjectInteraction("Magic barrier", { "Walk-through": climbOver });
  api.onObjectInteraction("Glove Rack", { Search: searchRack });
  api.onObjectInteraction("Weapons Rack", { Search: searchRack });
  api.onObjectInteraction("Balance beam", { "Stand-on": standOnBeam, "Get-down": getDown });
  api.onObjectRoute(routeToBeam);
  api.onPlayerBeforeDeath(beatenInRing);
  api.onCombatHitDamage(pugelBlow);
  api.onCombatAttackDistance(beamReach);
}

Object.assign(module.exports, { attachCombatRings, canFight, leftCombatRoom });
