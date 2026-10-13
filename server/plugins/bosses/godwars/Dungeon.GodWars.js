"use strict";

/**
 * The dungeon itself, as one multi-combat Area: the essence overlay while inside, the way in and
 * out, essence from the gods' followers and the generals' kill counts.
 *
 * - Overlay: `godwars_overlay` at overlay_atmosphere draws the four counters from their varbits.
 * - Essence: one per follower of a god killed (generals and bodyguards count), at most 4,000; it
 *   is kept on logout and gone once the player leaves (cleared as captured, on the way back down).
 * - Aggression: every follower attacks whatever the player's level, unless the player wears
 *   something of its god; the generals and bodyguards attack regardless (Wiki).
 * - Shared chambers: once nobody is left in one, its general and bodyguards heal and their stats
 *   reset (Wiki).
 */
const Common = require("./Common.GodWars");
const Combat = require("./Combat.GodWars");
const Rules = require("./Rules.GodWars");

const TROLL_STRONGHOLD_STAGE_ATTRIBUTE = "quest.troll_stronghold.stage";
const OVERLAY_ATMOSPHERE_UID = (161 << 16) | 1;
const BOULDER_PASSED_TILE = [2898, 3718, 0];
const CRACK_PASSED_TILE = [2902, 3718, 0];

/** Faction key -> players standing in its shared chamber. */
const occupants = new Map(Common.factions.map((faction) => [faction.key, new Set()]));

function openOverlay(player) {
  const sender = player.getPacketSender();
  sender.sendSubInterface(OVERLAY_ATMOSPHERE_UID, Common.data.overlay.group, 1);
  Common.syncEssence(player);
}

function closeOverlay(player) {
  player.getPacketSender().closeSubInterface(OVERLAY_ATMOSPHERE_UID);
}

/** In the dungeon proper or one of its chamber instances. */
function inGodWars(player) {
  return Common.inDungeon(player.getLocation()) || player.getArea()?.isGodWarsInstance === true;
}

/** Heals and resets the general and bodyguards of an empty shared chamber. */
function resetChamber(faction) {
  const ids = new Set([faction.general, ...faction.bodyguards]);
  Common.core.World.getNpcs().forEach((npc) => {
    if (!npc || !ids.has(npc.getId()) || npc.getPrivateArea() || npc.getHitpoints() <= 0) return;
    if (!Common.inBox(faction.room, npc.getLocation().getX(), npc.getLocation().getY(), npc.getLocation().getZ())) return;
    npc.getCombat().reset();
    npc.setHitpoints(npc.getMaxHitpoints());
    npc.setDefenceLevel(npc.getCurrentDefinition().getStats()[2]);
  });
}

function leaveChambers(player, except = null) {
  for (const [key, players] of occupants) {
    if (key === except || !players.delete(player)) continue;
    if (players.size === 0) resetChamber(Common.factionByKey(key));
  }
}

/** Players in a god's shared chamber, for Peek and the Ironman rule. */
function chamberOccupants(faction) {
  return occupants.get(faction.key)?.size ?? 0;
}

let DungeonArea = null;

function dungeonArea() {
  if (DungeonArea) return DungeonArea;
  const { Area, Boundary } = Common.core;
  DungeonArea = class GodWarsDungeon extends Area {
    constructor() {
      const { dungeon } = Common.data;
      super(dungeon.planes.map((z) => new Boundary(dungeon.minX, dungeon.maxX, dungeon.minY, dungeon.maxY, z)));
    }

    getName() {
      return "God Wars Dungeon";
    }

    isMulti() {
      return true;
    }

    postEnter(mobile) {
      if (mobile.isPlayer()) openOverlay(mobile.getAsPlayer());
    }

    postLeave(mobile, logout) {
      if (!mobile.isPlayer()) return;
      const player = mobile.getAsPlayer();
      leaveChambers(player);
      // An instance claims the player before moving them: judge by where they end up.
      if (!logout) Common.later(1, () => player.isRegistered() && !inGodWars(player) && closeOverlay(player));
    }

    process(mobile) {
      if (!mobile.isPlayer()) return;
      const player = mobile.getAsPlayer();
      const faction = Common.factionForRoom(player.getLocation());
      leaveChambers(player, faction?.key ?? null);
      if (!faction) return;
      occupants.get(faction.key).add(player);
      Combat.engage(player, faction, player.getLocalNpcs());
    }

    canAttack(attacker, target, method) {
      return Combat.deniesMelee(attacker, target, method);
    }

    npcAggression(player, npc) {
      const faction = Common.factionForNpc(npc.getId());
      if (!faction) return null;
      if (npc.getId() === faction.general || faction.bodyguards.includes(npc.getId())) return true;
      return Common.godItemCount(player, faction) === 0;
    }
  };
  return DungeonArea;
}

function trollStrongholdStage(player) {
  return Number(player.getAttribute(TROLL_STRONGHOLD_STAGE_ATTRIBUTE)) || 0;
}

function moveBoulder({ player }) {
  const { Skill } = Common.core;
  const skills = player.getSkillManager();
  const result = Rules.canMoveBoulder(
    trollStrongholdStage(player),
    skills.getCurrentLevel(Skill.STRENGTH),
    skills.getCurrentLevel(Skill.AGILITY)
  );
  if (!result.ok) {
    player.sendMessage(result.reason);
    return true;
  }
  player.sendMessage("You roll the boulder aside and slip past.");
  player.smartMove(Common.toLocation(BOULDER_PASSED_TILE), 2);
  return true;
}

function crawlThroughCrack({ player }) {
  if (trollStrongholdStage(player) < Rules.TROLL_STRONGHOLD_DAD_STAGE) {
    player.sendMessage("You need to have helped the Troll Stronghold before venturing further.");
    return true;
  }
  player.sendMessage("You squeeze through the crack in the wall.");
  player.smartMove(Common.toLocation(CRACK_PASSED_TILE), 2);
  return true;
}

/**
 * The hole above the dungeon, as captured: "You climb down the rope." with the ladder animation,
 * the move a tick later; the essence is cleared on the way down. The first time the rope is tied.
 */
function climbDown({ player }) {
  const { entrance } = Common.data;
  const roped = player.getAttribute(Common.ENTRANCE_ROPE_ATTRIBUTE) === true;
  const hasRope = player.getInventory().contains(Common.core.ItemIdentifiers.ROPE);
  const result = Rules.canClimbEntrance(trollStrongholdStage(player), hasRope, roped);
  if (!result.ok) {
    player.sendMessage(result.reason);
    return true;
  }
  if (result.tiesRope) {
    player.getInventory().delete(Common.core.ItemIdentifiers.ROPE, 1);
    player.setAttribute(Common.ENTRANCE_ROPE_ATTRIBUTE, true);
    player.getPacketSender().sendVarbit(entrance.ropeVarbit, 1);
    player.performAnimation(new Common.core.Animation(entrance.climbAnim));
    player.sendMessage("You tie your rope to the hole.");
    return true;
  }
  Common.resetEssence(player);
  player.sendMessage("You climb down the rope.");
  player.performAnimation(new Common.core.Animation(entrance.climbAnim));
  player.getMovementQueue().reset();
  Common.later(1, () => player.isRegistered() && player.moveTo(Common.toLocation(entrance.landing)));
  return true;
}

function climbUp({ player }) {
  const { entrance } = Common.data;
  player.performAnimation(new Common.core.Animation(entrance.climbAnim));
  Common.later(1, () => player.isRegistered() && player.moveTo(Common.toLocation(entrance.surface)));
  return true;
}

/** Essence for the killer; the general's kill count too. */
function creditKill({ killer, npc }) {
  if (!killer?.isPlayer?.() || !npc) return;
  const player = killer.getAsPlayer();
  if (!inGodWars(player)) return;
  const faction = Common.factionForNpc(npc.getId());
  if (!faction) return;
  Common.setEssence(player, faction, Common.getEssence(player, faction) + 1);
  if (npc.getId() === faction.general) {
    Common.addGeneralKill(player, faction, npc.getCurrentDefinition().getName());
  }
}

function syncOnLogin({ player }) {
  const { entrance, crossings } = Common.data;
  const sender = player.getPacketSender();
  // The doors' "Open (private)" option, which OSRS unlocks with the Hard Combat Achievements.
  sender.sendVarbit(Common.data.privateDoorVarbit, 1);
  if (player.getAttribute(Common.ENTRANCE_ROPE_ATTRIBUTE) === true) sender.sendVarbit(entrance.ropeVarbit, 1);
  for (const rope of crossings.saradominRopes) {
    if (player.getAttribute(Common.ropeAttribute(rope.varbit)) === true) sender.sendVarbit(rope.varbit, 1);
  }
  Common.syncKills(player);
  if (inGodWars(player)) openOverlay(player);
}

/** ::essence [amount] [god]: sets one god's essence, or all four (40 when no amount is given). */
function essenceCommand({ player, parts }) {
  const amount = parts[1] === undefined ? Common.data.essence.required : Number(parts[1]);
  const faction = parts[2] ? Common.factionByKey(String(parts[2]).toLowerCase()) : null;
  if (!Number.isFinite(amount) || (parts[2] && !faction)) {
    player.sendMessage("Usage: ::essence [amount] [bandos|armadyl|saradomin|zamorak]");
    return true;
  }
  for (const each of faction ? [faction] : Common.factions) Common.setEssence(player, each, amount);
  player.sendMessage(`${faction ? faction.name : "All gods'"} essence set to ${Math.min(Math.max(0, Math.trunc(amount)), Common.data.essence.max)}.`);
  return true;
}

/** The generals and their bodyguards come back 150 ticks after they die (Wiki). */
function setRespawns() {
  for (const faction of Common.factions) {
    for (const id of [faction.general, ...faction.bodyguards]) {
      Common.core.NpcDefinition.forId(id).setRespawn(Common.data.respawnTicks);
    }
  }
}

function attachDungeon(api) {
  const { entrance } = Common.data;
  for (const faction of Common.factions) {
    api.persistAttribute(Common.essenceAttribute(faction.key));
    api.persistAttribute(Common.killsAttribute(faction.key));
  }
  api.persistAttribute(Common.ENTRANCE_ROPE_ATTRIBUTE);
  api.registerArea(new (dungeonArea())());
  api.onServerStartup(setRespawns);
  api.onObjectFirstClick(entrance.boulder, moveBoulder);
  api.onObjectFirstClick(entrance.crack, crawlThroughCrack);
  api.onObjectFirstClick(entrance.hole, climbDown);
  api.onObjectFirstClick(entrance.rope, climbUp);
  api.onNpcDeath(creditKill);
  api.onPlayerLogin(syncOnLogin);
  api.registerCommand("essence", essenceCommand, Common.core.PlayerRights.ADMINISTRATOR, "Set God Wars essence: ::essence [amount] [god]");
}

module.exports = { attachDungeon, openOverlay, closeOverlay, inGodWars, chamberOccupants };
