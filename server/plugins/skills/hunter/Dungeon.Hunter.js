"use strict";

const C = require("./Context.Hunter"), { H } = C;

/**
 * Moss lizards (Neypotzli's Earthbound Cavern), as rsprox capture 1693 (ticks 2151-2186) and the
 * Wiki (level 20, a rope, 90% of the Hunter level in xp, up to 90) show them:
 * - Trap on a rock sets up the first half of a trap; Trap on the rock next to it finishes the trap
 *   between the two (that rock is then the first half of the next one). The rope is not used up.
 * - Rustle on a bush spooks up to three lizards, which run to the trap sites. One that reaches a set
 *   trap is caught three ticks later and leaves a raw moss lizard on the trap.
 * The trap sites are on the map (pmoon_trap_1..3): the server only drives their varbits, which both
 * spots share. Estimates: how long a trap stays set, how long a bush rests, and the odds of the extra
 * lizards.
 */
const LIZARD_SPOTS = [
  { rocks: [[1377, 9682], [1379, 9680], [1381, 9680], [1383, 9678]], sites: [[1378, 9681], [1380, 9680], [1382, 9679]], bushes: [[1380, 9676], [1380, 9684]] },
  { rocks: [[1388, 9709], [1390, 9707], [1392, 9707], [1394, 9705]], sites: [[1389, 9708], [1391, 9707], [1393, 9706]], bushes: [[1391, 9703], [1391, 9711]] },
];
const SITE_LOCS = [52994, 52995, 52996]; // pmoon_trap_1..3
const SITE_VARBITS = [9871, 9872, 9873]; // pmoon_lizard_trap_set_1..3
const SITE_CLEAR = 0, SITE_SET = 1, SITE_TRIGGERED = 2;
const LIZARD_LEVEL = 20;
const TRAP_ANIM = 9401; // human_pickuptable_walkmerge
const TRIGGER_ANIM = 11065; // pmoon_lizard_trap_trigger
const TRAPPED_ANIM = 11066; // moss_lizard_trapped
const FIRST_HALF_SOUND = 1774, FINISH_SOUND = 7924, RUSTLE_SOUND = 7925, TRIGGER_SOUND = 606;
const TRAP_TICKS = 100;
const BUSH_TICKS = 10;
const SPOOK_TICKS = 2; // the message, then the first lizard; one more each tick after
// Arrival is seen on the tick after the step onto the site, so this is the capture's 3 from that step.
const CATCH_TICKS = 2;
const LOST_TICKS = 20;
const EXTRA_LIZARD = [0.1, 0.8]; // the chance of each extra lizard, level 20 to 99
const FAR = 32;
const IGNORE_CLIPPING_FLAG = "movement:ignore-clipping";

/** player -> { half, sites: [{ spot, due, triggered }], bushes, lizards } */
const hunts = new Map();

function bats() {
  const I = H.core.ItemIdentifiers, N = H.core.NpcIdentifiers;
  return [
    [N.GUANIC_BAT, 1, 5, I.RAW_GUANIC_BAT_0_],
    [N.PRAEL_BAT, 15, 9, I.RAW_PRAEL_BAT_1_],
    [N.GIRAL_BAT, 30, 13, I.RAW_GIRAL_BAT_2_],
    [N.PHLUXIA_BAT, 45, 17, I.RAW_PHLUXIA_BAT_3_],
    [N.KRYKET_BAT, 60, 21, I.RAW_KRYKET_BAT_4_],
    [N.MURNG_BAT, 75, 25, I.RAW_MURNG_BAT_5_],
    [N.PSYKK_BAT, 90, 29, I.RAW_PSYKK_BAT_6_],
  ];
}

function catchBat({ player, npc, npcId }) {
  const def = bats().find(b => b[0] === npcId);
  if (!def) return false;
  const I = H.core.ItemIdentifiers;
  const weapon = player.getEquipment().get(H.core.Equipment.WEAPON_SLOT).getId();
  if (![I.BUTTERFLY_NET, I.MAGIC_BUTTERFLY_NET].includes(weapon)) {
    player.sendMessage("You need an equipped butterfly net to catch bats."); return true;
  }
  if (!C.available(npc) || !C.nearby(player, npc) || !C.requireLevel(player, def[1])) return true;
  const token = { player };
  H.reserved.set(npc, token);
  const cancel = () => { if (H.reserved.get(npc) === token) H.reserved.delete(npc); };
  if (!C.begin(player, 2, C.ANIM.NET, () => {
    cancel();
    if (!C.available(npc) || !C.nearby(player, npc) || !C.requireLevel(player, def[1])
      || player.getEquipment().get(H.core.Equipment.WEAPON_SLOT).getId() !== weapon) return;
    if (!C.exchange(player, [], [[def[3], 1]])) { player.getInventory().full(); return; }
    C.xp(player, def[2], "raid-bat", npcId);
    C.hide(npc, 10);
  }, cancel)) cancel();
  return true;
}

function huntOf(player) {
  let hunt = hunts.get(player);
  if (!hunt) {
    hunt = { half: null, sites: [null, null, null], bushes: new Map(), lizards: [] };
    hunts.set(player, hunt);
    H.players.add(player);
  }
  return hunt;
}

/** The spot and index of the rock or bush standing on `location`. */
function placeOf(kind, location) {
  for (let spot = 0; spot < LIZARD_SPOTS.length; spot++) {
    const index = LIZARD_SPOTS[spot][kind].findIndex(([x, y]) => location.getX() === x && location.getY() === y);
    if (index >= 0) return { spot, index };
  }
  return null;
}

function sound(player, id) {
  player.getPacketSender().sendSound(id, 1, 0);
}

function setSite(player, site, state) {
  player.getPacketSender().sendVarbit(SITE_VARBITS[site], state);
}

function rock({ player, object }) {
  if (object.getId() !== H.core.ObjectIdentifiers.ROCK_167) return false;
  const place = placeOf("rocks", object.getLocation());
  if (!place) return false;
  if (!C.nearby(player, object) || !C.requireLevel(player, LIZARD_LEVEL)) return true;
  if (!player.getInventory().contains(H.core.ItemIdentifiers.ROPE)) {
    player.sendMessage("You need a rope to set a trap between the rocks.");
    return true;
  }
  // The trap goes up a tick after arriving (capture).
  C.begin(player, 1, null, () => setHalf(player, object, place), undefined, { reset: false });
  return true;
}

function setHalf(player, object, { spot, index }) {
  const hunt = huntOf(player);
  player.setPositionToFace(object.getLocation());
  player.performAnimation(new H.core.Animation(TRAP_ANIM));
  const half = hunt.half;
  if (half && half.spot === spot && Math.abs(half.index - index) === 1) {
    const site = Math.min(half.index, index);
    if (hunt.sites[site]?.spot !== spot) {
      hunt.sites[site] = { spot, due: H.tick + TRAP_TICKS, triggered: false };
      setSite(player, site, SITE_SET);
      player.sendMessage("You finish setting up the trap.");
      sound(player, FINISH_SOUND);
    }
  }
  hunt.half = { spot, index };
  player.sendMessage("You set up the first half of the trap.");
  sound(player, FIRST_HALF_SOUND);
}

function rustle({ player, object }) {
  if (object.getId() !== H.core.ObjectIdentifiers.BUSH_63) return false;
  const place = placeOf("bushes", object.getLocation());
  if (!place) return false;
  if (!C.nearby(player, object) || !C.requireLevel(player, LIZARD_LEVEL)) return true;
  C.begin(player, 1, null, () => spook(player, object, place), undefined, { reset: false });
  return true;
}

function spook(player, bush, { spot, index }) {
  const hunt = huntOf(player);
  const key = `${spot}:${index}`;
  if ((hunt.bushes.get(key) ?? 0) > H.tick) {
    player.sendMessage("This bush has been shaken too recently.");
    return;
  }
  hunt.bushes.set(key, H.tick + BUSH_TICKS);
  player.setPositionToFace(bush.getLocation());
  player.performAnimation(new H.core.Animation(TRAP_ANIM));
  sound(player, RUSTLE_SOUND);
  const count = lizardCount(player);
  if (count === 2) player.sendMessage("Your hunting knowledge allows you to spook another lizard!");
  if (count === 3) player.sendMessage("Your hunting knowledge allows you to spook more lizards!");
  // From the east end (capture: sites 3, 2, 1), the player's own traps first.
  const own = (site) => Number(hunt.sites[site]?.spot === spot);
  const order = [2, 1, 0].sort((a, b) => own(b) - own(a));
  order.slice(0, count).forEach((site, i) => hunt.lizards.push({ spot, site, bush: index, spawnAt: H.tick + SPOOK_TICKS + i }));
}

function lizardCount(player) {
  const [low, high] = EXTRA_LIZARD;
  const share = Math.max(0, Math.min(1, (C.level(player) - LIZARD_LEVEL) / (99 - LIZARD_LEVEL)));
  const chance = low + (high - low) * share;
  return 1 + Number(Math.random() < chance) + Number(Math.random() < chance);
}

/** The lizard leaves the bush and runs for its trap site, seen by this player only. */
function release(player, lizard) {
  const [x, y] = LIZARD_SPOTS[lizard.spot].bushes[lizard.bush];
  const npc = H.api.spawnNpc({ id: H.core.NpcIdentifiers.MOSS_LIZARD, x, y, z: 0, wanderRadius: 0, owner: player, ownerOnly: true });
  if (!npc) return false;
  if (player.getPrivateArea()) npc.setArea(player.getPrivateArea());
  npc.__skipDefaultRespawn = true;
  npc.setScriptedMovement(true);
  npc.setFlag(H.core.NPC.WALK_THROUGH_ENTITIES_FLAG, true);
  npc.setFlag(IGNORE_CLIPPING_FLAG, true);
  npc.setMovementSteps(2);
  const [tx, ty] = LIZARD_SPOTS[lizard.spot].sites[lizard.site];
  lizard.target = new H.core.Location(tx, ty, 0);
  npc.setPositionToFace(lizard.target);
  lizard.npc = npc;
  lizard.lostAt = H.tick + LOST_TICKS;
  return true;
}

/** One lizard's tick; false once it is done with. */
function advance(player, hunt, lizard) {
  if (!lizard.npc) return H.tick < lizard.spawnAt || release(player, lizard);
  const { npc, target } = lizard;
  if (!npc.isRegistered() || H.tick >= lizard.lostAt) return false;
  if (lizard.arrivedAt == null) {
    if (!npc.getLocation().equals(target)) {
      if (npc.getMovementQueue().size() === 0) npc.getMovementQueue().addSteps(target.clone());
      return true;
    }
    lizard.arrivedAt = H.tick;
    // No trap here: it is gone a tick after it gets there.
    return hunt.sites[lizard.site]?.spot === lizard.spot;
  }
  if (lizard.caughtAt != null) {
    if (H.tick <= lizard.caughtAt) return true;
    land(player, hunt, lizard);
    return false;
  }
  const trap = hunt.sites[lizard.site];
  if (trap?.spot !== lizard.spot || trap.triggered) return false;
  if (H.tick >= lizard.arrivedAt + CATCH_TICKS) trigger(player, trap, lizard);
  return true;
}

function trigger(player, trap, lizard) {
  trap.triggered = true;
  lizard.caughtAt = H.tick;
  const { target } = lizard;
  lizard.npc.performAnimation(new H.core.Animation(TRAPPED_ANIM));
  setSite(player, lizard.site, SITE_TRIGGERED);
  player.getPacketSender().sendObjectAnimation(
    { getId: () => SITE_LOCS[lizard.site], getLocation: () => target, getType: () => 10, getFace: () => 0 },
    new H.core.Animation(TRIGGER_ANIM),
  );
  player.getPacketSender().sendAreaSound(TRIGGER_SOUND, target.getX(), target.getY(), target.getZ(), 1, 0, 8);
}

function land(player, hunt, lizard) {
  hunt.sites[lizard.site] = null;
  setSite(player, lizard.site, SITE_CLEAR);
  C.drop(player, [[H.core.ItemIdentifiers.RAW_MOSS_LIZARD, 1]], lizard.target);
  C.xp(player, Math.min(90, C.level(player) * 0.9), "moss-lizard", H.core.NpcIdentifiers.MOSS_LIZARD);
}

function dismiss(lizard) {
  if (lizard.npc?.isRegistered?.()) H.api.removeNpc(lizard.npc);
}

/** Leaving the lizards behind (or logging out) takes the traps and lizards with it. */
function remove(player) {
  const hunt = hunts.get(player);
  if (!hunt) return;
  hunts.delete(player);
  for (const lizard of hunt.lizards) dismiss(lizard);
  if (!player.isRegistered()) return;
  hunt.sites.forEach((trap, site) => { if (trap) setSite(player, site, SITE_CLEAR); });
}

function cleanup({ player }) { remove(player); }

function near(player) {
  const here = player.getLocation();
  return here.getZ() === 0 && LIZARD_SPOTS.some(({ rocks: [[x, y]] }) => Math.max(Math.abs(here.getX() - x), Math.abs(here.getY() - y)) <= FAR);
}

function process() {
  for (const [player, hunt] of hunts) {
    if (!C.active(player) || !near(player)) { remove(player); continue; }
    hunt.sites.forEach((trap, site) => {
      if (!trap || trap.triggered || H.tick < trap.due) return;
      hunt.sites[site] = null;
      setSite(player, site, SITE_CLEAR);
    });
    for (const lizard of [...hunt.lizards]) {
      if (advance(player, hunt, lizard)) continue;
      dismiss(lizard);
      hunt.lizards.splice(hunt.lizards.indexOf(lizard), 1);
    }
  }
}

function use(event) {
  if (event.itemId !== H.core.ItemIdentifiers.ROPE || event.objectId !== H.core.ObjectIdentifiers.ROCK_167) return;
  event.handled = true;
  rock(event);
}

module.exports = { bats, catchBat, rock, rustle, use, cleanup, process, LIZARD_SPOTS };
