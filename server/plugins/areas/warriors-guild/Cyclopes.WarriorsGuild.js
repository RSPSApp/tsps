/**
 * Warriors' Guild: the cyclopes. Kamfreena's room on the top floor and Lorelai's in the basement
 * each need 100 tokens to enter, take 10 on the way in and 10 a minute after that, and give a
 * minute's grace once they run out; an Attack (or max) cape lets its wearer in for free (Wiki).
 * Top-floor cyclopes drop the next defender after the best one the player had when they walked
 * in (1/50); basement cyclopes, behind Lorelai's door that a rune defender unlocks, drop the
 * dragon defender (1/100). The guild's cyclopes and animated armour only take melee damage.
 */
const Guild = require("./Common.WarriorsGuild");
const Animator = require("./Animator.WarriorsGuild");

const ENTRY_TOKENS = 100;
const TOKENS_PER_MINUTE = 10;
const MINUTE_TICKS = 100;
const DEFENDER_CHANCE = 50;
const DRAGON_DEFENDER_CHANCE = 100;
const EARNED_ATTRIBUTE = "warriors-guild:defender";
const LORELAI_ATTRIBUTE = "warriors-guild:basement-unlocked";

/** Kamfreena's double door on the top floor (west edge of x 2847) and her lobby beside it. */
const TOP_DOORS = { x: 2847, ys: [3540, 3541], z: 2 };
const TOP_LOBBY = { minX: 2838, maxX: 2846, minY: 3537, maxY: 3542 };
/** Lorelai's door (east edge of x 2911) and the ladders between the back yard and her lobby. */
const BASEMENT_DOOR = { x: 2911, y: 9968, z: 0 };
const BASEMENT_ROOM = [{ minX: 2905, maxX: 2941, minY: 9957, maxY: 9965 }, { minX: 2912, maxX: 2941, minY: 9966, maxY: 9974 }];
const LADDER_DOWN = { at: [2833, 3542, 0], to: [2907, 9968, 0], animation: 827 };
const LADDER_UP = { at: [2906, 9968, 0], to: [2834, 3542, 0], animation: 828 };

const METALS = ["bronze", "iron", "steel", "black", "mithril", "adamant", "rune"];
const DRAGON_TIER = METALS.length;

let api;
/** Defender ids by tier (bronze 0 ... rune 6, dragon and better 7). */
let TIERS = new Map();
let DEFENDERS = [];
let TOP_CYCLOPES = new Set();
let BASEMENT_CYCLOPES = new Set();
let MELEE_ONLY = new Set();

/** player -> { room: "top"|"basement", tier, ticks, graceTicks, free, arriving } for whoever is inside. */
const inside = new Map();

function buildIds() {
  const Items = Guild.core.ItemIdentifiers;
  const Npcs = Guild.core.NpcIdentifiers;
  DEFENDERS = METALS.map((metal) => Items[`${metal.toUpperCase()}_DEFENDER`]);
  TIERS = new Map(DEFENDERS.map((id, tier) => [id, tier]));
  TIERS.set(Items.RUNE_DEFENDER_T_, 6);
  for (const id of [Items.DRAGON_DEFENDER, Items.DRAGON_DEFENDER_T_, Items.AVERNIC_DEFENDER]) TIERS.set(id, DRAGON_TIER);
  TOP_CYCLOPES = new Set([10, 11, 12, 13, 14, 15].map((n) => Npcs[`CYCLOPS_${n}`]));
  BASEMENT_CYCLOPES = new Set([2, 3, 4, 5, 6, 7].map((n) => Npcs[`CYCLOPS_${n}`]));
  MELEE_ONLY = new Set([...TOP_CYCLOPES, ...BASEMENT_CYCLOPES, ...Animator.ANIMATED_ARMOUR_IDS()]);
}

/** The best defender the player owns anywhere (carried, worn or banked), or -1. */
function ownedTier(player) {
  let best = -1;
  const containers = [player.getInventory(), player.getEquipment(), ...player.getBanks()];
  for (const [id, tier] of TIERS) {
    if (tier > best && containers.some((container) => container?.getAmount(id) > 0)) best = tier;
  }
  return best;
}

function carriedTier(player) {
  let best = -1;
  for (const [id, tier] of TIERS) {
    if (tier > best && (player.getInventory().contains(id) || player.getEquipment().contains(id))) best = tier;
  }
  return best;
}

function earnedTier(player) {
  const tier = player.getAttribute(EARNED_ATTRIBUTE);
  return Number.isInteger(tier) ? tier : -1;
}

function remember(player, tier) {
  if (tier > earnedTier(player)) player.setAttribute(EARNED_ATTRIBUTE, tier);
}

function inTopRoom(location) {
  const x = location.getX();
  const y = location.getY();
  return location.getZ() === 2 && x >= 2838 && x <= 2877 && y >= 3534 && y <= 3557
    && !(x <= TOP_LOBBY.maxX && y <= TOP_LOBBY.maxY);
}

function inBasementRoom(location) {
  return location.getZ() === 0 && BASEMENT_ROOM.some((box) => location.getX() >= box.minX && location.getX() <= box.maxX
    && location.getY() >= box.minY && location.getY() <= box.maxY);
}

function tokens(player) {
  return player.getInventory().getAmount(Guild.ITEMS.TOKEN);
}

function enter(player, room, door, to, tier) {
  const free = Guild.wearsAttackCape(player);
  if (!free) player.getInventory().deleteNumber(Guild.ITEMS.TOKEN, TOKENS_PER_MINUTE);
  // `arriving` covers the walk through the door before the room checks start.
  inside.set(player, { room, tier, ticks: 0, graceTicks: -1, free, arriving: 3 });
  Guild.crossDoor(player, door, to);
}

// --- Kamfreena's room.

function kamfreenaWelcome(player, owned) {
  if (owned === -1) return earnedTier(player) === -1 ? "first-time-entering-the-door" : "entering-the-door-after-losing-every-defender";
  if (owned === DRAGON_TIER) return "showing-kamfreena-defenders-when-opening-the-door-to-the-cyclopes-with-a-dragon-defender";
  if (owned === 6) return "showing-kamfreena-defenders-when-opening-the-door-to-the-cyclopes-with-a-rune-defender";
  return "attempting-to-enter-the-room-while-owning-a-defender";
}

function useTopDoor({ player, object, location }) {
  if (location.z !== TOP_DOORS.z || location.x !== TOP_DOORS.x || !TOP_DOORS.ys.includes(location.y)) return false;
  const leaving = player.getLocation().getX() >= TOP_DOORS.x;
  if (leaving) {
    Guild.crossDoor(player, object, Guild.tile(TOP_DOORS.x - 1, player.getLocation().getY(), 2));
    return true;
  }
  if (!Guild.wearsAttackCape(player) && tokens(player) < ENTRY_TOKENS) {
    Guild.npcSays(player, Guild.NPCS.KAMFREENA,
      "You don't have enough Warrior Guild Tokens to enter the cyclopes enclosure yet, collect at least 100 then come back.");
    return true;
  }
  const owned = ownedTier(player);
  Guild.playTranscript(api, player, Guild.NPCS.KAMFREENA, kamfreenaWelcome(player, owned));
  remember(player, owned);
  // The cyclopes drop the defender after the best one owned, up to rune.
  enter(player, "top", object, Guild.tile(TOP_DOORS.x, player.getLocation().getY(), 2), Math.min(owned + 1, 6));
  return true;
}

function showKamfreena(event) {
  if (event.target?.getId() !== Guild.NPCS.KAMFREENA) return;
  event.handled = true;
  const tier = TIERS.get(event.itemId);
  if (tier === undefined) {
    Guild.playTranscript(api, event.player, Guild.NPCS.KAMFREENA, "using-any-other-on-her");
    return;
  }
  remember(event.player, tier);
  const variant = tier === DRAGON_TIER
    ? "showing-kamfreena-defenders-showing-kamfreena-a-dragon-defender"
    : `showing-kamfreena-defenders-showing-kamfreena-a-${METALS[tier]}-defender`;
  Guild.playTranscript(api, event.player, Guild.NPCS.KAMFREENA, variant);
}

// --- Lorelai's basement.

function climbLadder({ player, location }) {
  const ladder = [LADDER_DOWN, LADDER_UP].find(({ at }) => location.x === at[0] && location.y === at[1] && location.z === at[2]);
  if (!ladder) return false;
  player.performAnimation(new Guild.core.Animation(ladder.animation));
  Guild.later(player, 1, () => player.moveTo(Guild.tile(...ladder.to)));
}

function basementUnlocked(player) {
  return player.getAttribute(LORELAI_ATTRIBUTE) === true;
}

function unlockBasement(player) {
  player.setAttribute(LORELAI_ATTRIBUTE, true);
}

function hasRuneDefender(player) {
  return carriedTier(player) >= 6;
}

function useBasementDoor({ player, object, location }) {
  if (location.x !== BASEMENT_DOOR.x || location.y !== BASEMENT_DOOR.y || location.z !== BASEMENT_DOOR.z) return false;
  if (player.getLocation().getX() > BASEMENT_DOOR.x) {
    Guild.crossDoor(player, object, Guild.tile(BASEMENT_DOOR.x, BASEMENT_DOOR.y, 0));
    return true;
  }
  if (!basementUnlocked(player)) {
    if (!hasRuneDefender(player)) {
      // ponytail: Near-Reality's lines; the Wiki transcript has none for a locked door.
      Guild.npcSays(player, Guild.NPCS.LORELAI,
        "You need to prove your worth to me before I let you pass through those doors.",
        "Until you show me a rune defender, you can't pass.");
      return true;
    }
    unlockBasement(player);
    Guild.playTranscript(api, player, Guild.NPCS.LORELAI,
      "standard-dialogue-attempting-to-open-the-basement-door-to-the-cyclopes-room-before-first-talking-to-lorelai-but-with-the-player-having-a-rune-defender-in-inventory");
  }
  if (!Guild.wearsAttackCape(player) && tokens(player) < ENTRY_TOKENS) {
    Guild.npcSays(player, Guild.NPCS.LORELAI,
      "You don't have enough Warrior Guild Tokens to enter the cyclopes enclosure yet, collect at least 100 then come back.");
    return true;
  }
  enter(player, "basement", object, Guild.tile(BASEMENT_DOOR.x + 1, BASEMENT_DOOR.y, 0), DRAGON_TIER);
  return true;
}

function lorelaiCondition({ player, npcId, text }) {
  if (npcId !== Guild.NPCS.LORELAI) return null;
  switch (text) {
    case "If the player has not shown her a rune defender:": return !basementUnlocked(player);
    case "If the player has already show her a rune defender:": return basementUnlocked(player);
    case "If the player does not have a rune defender:": return !hasRuneDefender(player);
    case "If the player has a rune defender:": return hasRuneDefender(player);
    default: return null;
  }
}

/** "Very well, I've unlocked the door..." follows the rune defender being shown. */
function lorelaiUnlocks({ player, npcId, text }) {
  if (npcId === Guild.NPCS.LORELAI && text === "If the player has a rune defender:") unlockBasement(player);
}

function showLorelai(event) {
  if (event.target?.getId() !== Guild.NPCS.LORELAI) return;
  const tier = TIERS.get(event.itemId);
  if (tier === undefined || tier < 6) return;
  event.handled = true;
  let variant = "standard-dialogue-using-a-dragon-defender-on-lorelai";
  if (tier === 6) {
    variant = basementUnlocked(event.player)
      ? "standard-dialogue-using-a-rune-defender-on-lorelai-after-already-unlocking-the-room"
      : "standard-dialogue-using-a-rune-defender-on-lorelai-before-unlocking-the-room";
    unlockBasement(event.player);
  }
  Guild.playTranscript(api, event.player, Guild.NPCS.LORELAI, variant);
}

// --- Time in the rooms.

function host(room) {
  return room === "top" ? Guild.NPCS.KAMFREENA : Guild.NPCS.LORELAI;
}

function exitTile(room) {
  return room === "top" ? Guild.tile(TOP_DOORS.x - 1, TOP_DOORS.ys[0], 2) : Guild.tile(BASEMENT_DOOR.x, BASEMENT_DOOR.y, 0);
}

function spendTime({ player }) {
  const state = inside.get(player);
  if (!state) return;
  if (state.arriving > 0) {
    state.arriving--;
    return;
  }
  const location = player.getLocation();
  if (!(state.room === "top" ? inTopRoom(location) : inBasementRoom(location))) {
    inside.delete(player);
    return;
  }
  if (state.free) return;
  if (state.graceTicks >= 0) {
    if (--state.graceTicks < 0) {
      inside.delete(player);
      player.moveTo(exitTile(state.room));
      Guild.playTranscript(api, player, host(state.room), "after-running-out-of-tokens-in-the-room-if-the-player-does-not-leave-the-room-after-100-ticks");
    }
    return;
  }
  if (++state.ticks % MINUTE_TICKS !== 0) return;
  if (tokens(player) >= TOKENS_PER_MINUTE) {
    player.getInventory().deleteNumber(Guild.ITEMS.TOKEN, TOKENS_PER_MINUTE);
    player.sendMessage(`${TOKENS_PER_MINUTE} of your tokens crumble away.`);
  }
  if (tokens(player) < TOKENS_PER_MINUTE) {
    state.graceTicks = MINUTE_TICKS;
    Guild.playTranscript(api, player, host(state.room), "after-running-out-of-tokens-in-the-room");
  }
}

/** Whoever came in on their cape keeps it on while they stay. */
function keepCapeOn(event) {
  const state = inside.get(event.player);
  if (!state?.free || event.slot !== Guild.core.Equipment.CAPE_SLOT) return;
  event.allow = false;
  Guild.playTranscript(api, event.player, host(state.room), "attempting-to-take-off-the-attack-cape-or-max-cape-while-in-the-room");
}

function leaveRooms({ player }) {
  inside.delete(player);
}

// --- Defender drops.

function dropDefenders({ player, npc, npcId, drops }) {
  const top = TOP_CYCLOPES.has(npcId);
  if (!top && !BASEMENT_CYCLOPES.has(npcId)) return;
  // The exported table lists every defender as a plain drop; which one drops depends on the killer.
  for (let i = drops.length - 1; i >= 0; i--) if (TIERS.has(drops[i].itemId)) drops.splice(i, 1);
  const state = inside.get(player);
  if (!state || state.room !== (top ? "top" : "basement") || npc.getLocation().getZ() !== player.getLocation().getZ()) return;
  const Items = Guild.core.ItemIdentifiers;
  if (top && Guild.random(1, DEFENDER_CHANCE) === 1) drops.push({ itemId: DEFENDERS[state.tier], amount: 1 });
  if (!top && Guild.random(1, DRAGON_DEFENDER_CHANCE) === 1) drops.push({ itemId: Items.DRAGON_DEFENDER, amount: 1 });
}

/** Ranged and magic do nothing to the guild's cyclopes and animated armour. */
function meleeOnly({ npc, hit }) {
  if (!MELEE_ONLY.has(npc.getId())) return;
  const { CombatType } = Guild.core;
  if (hit.getCombatType() === CombatType.RANGED || hit.getCombatType() === CombatType.MAGIC) hit.setTotalDamage(0);
}

module.exports = function attachCyclopes(pluginApi) {
  api = pluginApi;
  buildIds();
  api.persistAttribute(EARNED_ATTRIBUTE);
  api.persistAttribute(LORELAI_ATTRIBUTE);
  api.onObjectInteraction("Door", { Open: useTopDoor });
  api.onObjectInteraction("Door", { Open: useBasementDoor });
  api.onObjectInteraction("Ladder", { "Climb-down": climbLadder, "Climb-up": climbLadder });
  api.onItemOnNpc(showKamfreena);
  api.onItemOnNpc(showLorelai);
  api.onNpcDialogueCondition(lorelaiCondition);
  api.onCustomEvent("npc-dialogue:condition", lorelaiUnlocks);
  api.onPlayerProcess(spendTime);
  api.onCanUnequip(keepCapeOn);
  api.onPlayerLogout(leaveRooms);
  api.onCustomEvent("npc-drops:roll", dropDefenders);
  api.onNpcHitModify(meleeOnly);
};
