"use strict";

/**
 * Daimon's Crater as two areas (https://oldschool.runescape.wiki/w/Bounty_Hunter#Fighting):
 *
 * - Fort Daimon, the lobby: safe. A player keeps their target there for 2:00 in all
 *   (bh_lobby_timer), and gets 15 seconds of it back on each return to the arena (1 June 2023).
 * - The arena, the rest of the island: single-way PvP. Teleports are blocked (Teleport to Target
 *   moves the player itself, past these checks), protection prayers can't be used, binding
 *   spells don't stop movement, and fights with players give no combat experience. A player
 *   entering it is immune to rogues for 6 seconds, until they attack someone (1 June 2023).
 *   Bounty Hunter weapons work here.
 *
 * Rogues can attack within five combat levels; assigned targets use the matchmaking range.
 * https://secure.runescape.com/m=news/bounty-hunter-is-back?oldschool=1
 * Phoenix necklaces (29 January 2025) need nothing: the server has no
 * phoenix necklace effect. Messages are our wording.
 */

const Hud = require("./Hud.BountyHunter");
const Targets = require("./Targets.BountyHunter");

const LOBBY_ALLOWANCE_TICKS = 200; // 2:00
const LOBBY_REFUND_TICKS = 25; // 15 seconds
const ROGUE_IMMUNITY_TICKS = 10; // 6 seconds
const ROGUE_LEVEL_RANGE = 5;
const ATTACK_OPTION_SLOT = 1; // the client's first player option, as Castle Wars and Ferox use it
// Prayer head icons of Protect from Melee, Missiles and Magic.
const PROTECTION_HEAD_ICONS = [0, 1, 2];
const COMBAT_SKILLS = ["ATTACK", "STRENGTH", "DEFENCE", "RANGED", "MAGIC", "HITPOINTS"];
// Combat asks canAttack several times per swing, so a refusal is said at most this often.
const REFUSAL_MESSAGE_MS = 1200;
// "Fake drops" in the XP drops setup (varbit 8120; 0 = On, 1 = Off).
const FAKE_DROPS_OFF_VARBIT = 8120;
// The client caches one fake drop per queue slot; script 2091 adds (skill, xp) and script
// 1004 drains the queue when its first argument is 1 (its own stat-transmit path passes 0).
const FAKE_DROP_SCRIPT = 2091;
const FAKE_DROP_RENDER_SCRIPT = 1004;
const XP_DROPS_INTERFACE = 122;
// Script 993 (122:0's onLoad) installs 1004 on 122:2 with these ten fixed arguments: the
// source widget, eight drop-panel components, and the number of drop layers (cache enum 1163).
// 1004's fake path reads only this prefix; its real path is followed by each skill's XP baseline.
const FAKE_DROP_RENDER_ARGS = [
  (XP_DROPS_INTERFACE << 16) | 0, // 122:0, the interface the listener runs on
  (XP_DROPS_INTERFACE << 16) | 2,
  (XP_DROPS_INTERFACE << 16) | 4,
  (XP_DROPS_INTERFACE << 16) | 9,
  (XP_DROPS_INTERFACE << 16) | 10,
  (XP_DROPS_INTERFACE << 16) | 11,
  (XP_DROPS_INTERFACE << 16) | 16,
  (XP_DROPS_INTERFACE << 16) | 17,
  (XP_DROPS_INTERFACE << 16) | 25,
  7, // the seven drop layers (cache enum 1163)
];
// The skills whose XP script 1004 compares, in the order the client stores their baselines.
// The fake path only needs the Hitpoints slot to be non-zero, but the call mirrors the
// listener's own arguments so it stays valid if the client script ever looks at the rest.
const XP_DROPS_SKILL_ORDER = [0, 2, 4, 6, 1, 3, 5, 16, 15, 17, 12, 20, 14, 13, 10, 7, 11, 8, 9, 18, 19, 22, 21, 23];

let api;
let core;
let bh;
const refusalSaidAt = new WeakMap();

function isPlayer(mobile) {
  return mobile?.isPlayer?.() === true;
}

function cycle() {
  return core.World.getProcessCycle();
}

function boundary(box) {
  return new core.Boundary(box.minX, box.maxX, box.minY, box.maxY, 0);
}

/**
 * The arena box less the lobby, as the strips south, north, west and east of it. An actor keeps
 * its area while a boundary still holds it, so a lobby inside the arena's box would never be
 * entered from the arena.
 */
function arenaBoundaries(arena, lobby) {
  return [
    { ...arena, maxY: lobby.minY - 1 },
    { ...arena, minY: lobby.maxY + 1 },
    { ...arena, maxX: lobby.minX - 1, minY: lobby.minY, maxY: lobby.maxY },
    { ...arena, minX: lobby.maxX + 1, minY: lobby.minY, maxY: lobby.maxY },
  ].map(boundary);
}

function refuseTeleport(player) {
  player.sendMessage("You can't teleport out of Bounty Hunter.");
  return false;
}

/** Leaving the crater altogether - not just stepping between lobby and arena - ends the pair. */
function leftCrater(player, logout) {
  if (logout) {
    Targets.clearTarget(player, "logout");
    return;
  }
  Targets.clearTarget(player, "left");
  Hud.sync(player);
}

// ---------------------------------------------------------------------------
// Lobby
// ---------------------------------------------------------------------------

function enterLobby(player) {
  bh.lobby.add(player);
  Hud.sendLobbyTimer(player, bh.lobbyTicks.get(player) ?? 0);
  api.emitCustomEvent("bounty-hunter:entered-lobby", { player });
  Hud.sync(player);
}

function leaveLobby(player, logout) {
  bh.lobby.delete(player);
  if (logout || !bh.isArenaTile(player.getLocation())) leftCrater(player, logout);
}

function lobbyTick(player) {
  if (bh.targetOf(player)) {
    const ticks = (bh.lobbyTicks.get(player) ?? 0) + 1;
    bh.lobbyTicks.set(player, ticks);
    if (ticks >= LOBBY_ALLOWANCE_TICKS) {
      Targets.clearTarget(player, "left");
      player.sendMessage("You spent too long in the lobby and lost your target.");
    }
  }
  Hud.sync(player);
}

// ---------------------------------------------------------------------------
// Arena
// ---------------------------------------------------------------------------

function enterArena(player) {
  bh.arena.add(player);
  bh.immuneUntil.set(player, cycle() + ROGUE_IMMUNITY_TICKS);
  Hud.sendImmunity(player, ROGUE_IMMUNITY_TICKS);
  const ticks = Math.max(0, (bh.lobbyTicks.get(player) ?? 0) - LOBBY_REFUND_TICKS);
  bh.lobbyTicks.set(player, ticks);
  Hud.sendLobbyTimer(player, ticks);
  for (const prayer of core.PrayerHandler.PROTECTION_PRAYERS) core.PrayerHandler.deactivatePrayer(player, prayer);
  if (player.isPlayerBot?.() !== true) player.getPacketSender().sendPlayerOption(ATTACK_OPTION_SLOT, "Attack", true);
  Targets.remindPenalty(player);
  api.emitCustomEvent("bounty-hunter:entered-arena", { player });
  Hud.sync(player);
}

function leaveArena(player, logout) {
  bh.arena.delete(player);
  bh.immuneUntil.delete(player);
  api.emitCustomEvent("bounty-hunter:left-arena", { player });
  if (logout) {
    leftCrater(player, true);
    return;
  }
  if (player.isPlayerBot?.() !== true) player.getPacketSender().sendPlayerOption(ATTACK_OPTION_SLOT, "", false);
  Hud.sendImmunity(player, 0);
  Targets.remindPenalty(player);
  if (!bh.isLobbyTile(player.getLocation())) leftCrater(player, false);
}

function arenaTick(player) {
  // ponytail: a bind is lifted on the arena's next tick rather than never landing, so a frozen
  // player stops for up to a tick; a generic "can freeze" core hook would make it exact.
  const timers = player.getTimers();
  if (timers.has(core.TimerKey.FREEZE)) timers.cancel(core.TimerKey.FREEZE);
  const immuneUntil = bh.immuneUntil.get(player);
  if (immuneUntil !== undefined && cycle() >= immuneUntil) {
    bh.immuneUntil.delete(player);
    Hud.sendImmunity(player, 0);
  }
  Hud.sync(player);
}

function refuse(attacker, message) {
  const now = Date.now();
  if (now - (refusalSaidAt.get(attacker) ?? 0) >= REFUSAL_MESSAGE_MS) {
    refusalSaidAt.set(attacker, now);
    attacker.sendMessage(message);
  }
  return false;
}

function canAttackInArena(attacker, target) {
  if (!isPlayer(attacker) || !isPlayer(target)) return null;
  if (!bh.inArena(attacker) || !bh.inArena(target)) return false;
  const assignedTarget = bh.targetOf(attacker) === target;
  const levels = Math.abs(attacker.getSkillManager().getCombatLevel() - target.getSkillManager().getCombatLevel());
  if (!assignedTarget && levels > ROGUE_LEVEL_RANGE) return refuse(attacker, "Your level difference is too great.");
  if (bh.targetOf(target) !== attacker && cycle() < (bh.immuneUntil.get(target) ?? 0)) {
    return refuse(attacker, "That player has only just entered the arena.");
  }
  return true;
}

/** Attacking a player ends the attacker's rogue immunity; canAttack is only asked. */
function endImmunity({ attacker, target }) {
  if (isPlayer(target) && bh.inArena(attacker) && bh.immuneUntil.delete(attacker)) Hud.sendImmunity(attacker, 0);
}

function createAreas() {
  class BountyHunterLobby extends core.Area {
    postEnter(mobile) {
      if (isPlayer(mobile)) enterLobby(mobile);
    }

    postLeave(mobile, logout) {
      if (isPlayer(mobile)) leaveLobby(mobile, logout);
    }

    process(mobile) {
      if (isPlayer(mobile)) lobbyTick(mobile);
    }

    canAttack(attacker, target) {
      return isPlayer(attacker) && isPlayer(target) ? false : null;
    }

    canTeleport(player) {
      return refuseTeleport(player);
    }
  }

  class BountyHunterArena extends core.Area {
    postEnter(mobile) {
      if (isPlayer(mobile)) enterArena(mobile);
    }

    postLeave(mobile, logout) {
      if (isPlayer(mobile)) leaveArena(mobile, logout);
    }

    process(mobile) {
      if (isPlayer(mobile)) arenaTick(mobile);
    }

    canAttack(attacker, target) {
      return canAttackInArena(attacker, target);
    }

    canTeleport(player) {
      return refuseTeleport(player);
    }
  }

  return [
    new BountyHunterLobby([boundary(bh.CRATER.lobby)]),
    new BountyHunterArena(arenaBoundaries(bh.CRATER.arena, bh.CRATER.lobby)),
  ];
}

// ---------------------------------------------------------------------------
// Rules that core asks of everyone; each is one set lookup for players elsewhere.
// ---------------------------------------------------------------------------

function disableProtectionPrayers(event) {
  if (!bh.inArena(event.player) || !PROTECTION_HEAD_ICONS.includes(event.prayer?.hint)) return;
  event.disabled = true;
  event.message = "You can't use protection prayers in Bounty Hunter.";
}

/** Client skill id -> the server's Skill, built once (Construction and Hunter swap ids). */
let skillsByClientId = null;
/** Players whose queued fake drops are waiting for the end of the current XP batch. */
const pendingFakeDrops = new Set();

function skillForClientId(clientId) {
  if (!skillsByClientId) {
    skillsByClientId = new Map(core.Skill.values().map((skill) => [skill.getClientId(), skill]));
  }
  return skillsByClientId.get(clientId);
}

/**
 * A blocked hit still shows what it would have paid. Each skill is queued with script 2091;
 * the render (script 1004) waits for a microtask so every skill the same hit awards is in the
 * queue together, letting the client's Group XP drops setting combine them into one counter.
 * 1004 asks the interface's own listener for every skill's XP baseline, so the server sends the
 * same table the cache would (https://oldschool.runescape.wiki/w/Bounty_Hunter#Fighting).
 */
function showFakeExperienceDrop(player, skill, experience) {
  if (player.getAttribute(core.XPDROPS_ENABLED_ATTRIBUTE) !== true) return;
  const sender = player.getPacketSender();
  if (sender.getVarbit(FAKE_DROPS_OFF_VARBIT) !== 0) return;
  const amount = Math.floor(experience * (core.GameConstants?.EXPERIENCE_MULTIPLIER ?? 1));
  if (amount <= 0) return;
  sender.sendClientScript(FAKE_DROP_SCRIPT, skill.getClientId(), amount);
  // addExperience calls for one hit are synchronous, so the microtask runs after the last one.
  if (pendingFakeDrops.has(player)) return;
  pendingFakeDrops.add(player);
  queueMicrotask(() => {
    pendingFakeDrops.delete(player);
    renderFakeDrops(player);
  });
}

function renderFakeDrops(player) {
  const xps = XP_DROPS_SKILL_ORDER.map((clientId) => {
    const ordered = skillForClientId(clientId);
    return ordered ? player.getSkillManager().getExperience(ordered) : 0;
  });
  player.getPacketSender()
    .sendClientScript(FAKE_DROP_RENDER_SCRIPT, 1, ...FAKE_DROP_RENDER_ARGS, ...xps);
}

function noPvpCombatExperience(event) {
  if (!bh.inArena(event.player) || !COMBAT_SKILLS.some((name) => core.Skill[name] === event.skill)) return;
  if (!isPlayer(event.player.getCombat().getTarget())) return;
  event.allow = false;
  showFakeExperienceDrop(event.player, event.skill, event.experience);
}

/** Noted for the exit gates: a player can't leave right after a special attack (7 June 2023). */
function noteSpecialAttack({ attacker, target }) {
  if (isPlayer(target) && bh.inArena(attacker) && attacker.isSpecialActivated?.()) bh.lastSpecialAt.set(attacker, cycle());
}

function allowWeapons(request) {
  if (bh.inArena(request.attacker) && bh.inArena(request.target)) request.allowed = true;
}

function allowLootKeys(request) {
  if (bh.isArenaTile(request.killer.getLocation()) && bh.isArenaTile(request.victim.getLocation())) request.allowed = true;
}

/** Respawning changes the destination, not the crater's dangerous-death rules. */
function respawnInLobby(event) {
  const player = event.player;
  if (event.handled || player.isPlayerBot?.() === true) return;
  const location = player.getLocation();
  if (!bh.isArenaTile(location) && !bh.isLobbyTile(location)) return;
  player.moveTo(new core.Location(bh.CRATER.lobbyArrival.x, bh.CRATER.lobbyArrival.y, 0));
  api.getAreaManager().process(player);
  event.handled = true;
}

function registerAreas() {
  for (const area of createAreas()) api.registerArea(area);
}

module.exports = function attachArea(pluginApi, state) {
  api = pluginApi;
  core = pluginApi.core;
  bh = state;
  registerAreas();
  api.onPrayerDisabled(disableProtectionPrayers);
  api.onCanGainExperience(noPvpCombatExperience);
  api.onAttackTiming(noteSpecialAttack);
  api.onCombatHitResolved(endImmunity);
  api.onCustomEvent("bounty-hunter:weapon-area", allowWeapons);
  api.onCustomEvent("loot-keys:eligible-kill", allowLootKeys);
  api.onCustomEvent("player:respawn", respawnInLobby);
};

Object.assign(module.exports, { _test: { canAttackInArena, endImmunity, arenaBoundaries, lobbyTick, LOBBY_ALLOWANCE_TICKS,
  noPvpCombatExperience, showFakeExperienceDrop, FAKE_DROPS_OFF_VARBIT, FAKE_DROP_RENDER_ARGS } });
