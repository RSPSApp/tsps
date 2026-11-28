/**
 * The way into and out of the Moons' arenas (docs/moons-of-peril.md), as captured:
 * - Statue, Use: "You are about to enter a dangerous area." and "Continue anyway?" (unless the
 *   player said not to ask again), then the portal overlay in the Moon's colours with sound 7928,
 *   and two ticks later the move onto the glyph that is up (or the special's own start tile).
 * - Stairs, Quick-escape / Escape: used from across the arena, no walk up to them (capture: from 8
 *   tiles). The HUD goes, the portal overlay, and two ticks later the antechamber by the monolith
 *   (1441, 9637, 1).
 * The arenas are shared rooms (not instances), multi-combat. Logging out or dying inside puts the
 * player in the antechamber; a grave from a death there is left there too.
 */
const Common = require("./Common.MoonsOfPeril");
const Cycle = require("./Cycle.MoonsOfPeril");
const Curses = require("./Curses.MoonsOfPeril");
const { Fight } = require("./Fight.MoonsOfPeril");
const Kill = require("./Kill.MoonsOfPeril");
const Scoreboard = require("./Scoreboard.MoonsOfPeril");

const QUEST = "perilous_moons";
const ALREADY_SUBDUED = (name) => `You have already subdued the ${name}. Claim your reward from the Lunar Chest first.`;
const NOT_YET = "You need to have completed Perilous Moons to face the Moons.";

const areas = new Map();

/** How far off the exit stairs can be used from: the usual approach range (the capture's 8 is within it). */
const STAIRS_RANGE = 10;

function areaClass(moon) {
  const { Area, Boundary } = Common.core;
  return class MoonArea extends Area {
    constructor() {
      const [x1, x2, y1, y2] = Common.data.moons[moon].area;
      super([new Boundary(x1, x2, y1, y2, Common.data.moons[moon].tile[2])]);
      this.moon = moon;
    }

    getName() {
      return `${Common.data.moons[moon].name}'s arena`;
    }

    isMulti() {
      return true;
    }

    postEnter(mobile) {
      if (!mobile.isPlayer?.()) return;
      const player = mobile.getAsPlayer();
      player.setAttribute(Common.INSIDE_ATTRIBUTE, true);
      begin(player, moon);
    }

    postLeave(mobile, logout) {
      if (!mobile.isPlayer?.()) return;
      const player = mobile.getAsPlayer();
      const arena = Cycle.arenaOf(moon);
      arena?.fights.get(player)?.end({ quiet: logout });
      player.setAttribute(Common.INSIDE_ATTRIBUTE, false);
      if (logout) player.setLocation(Common.location(Common.data.exit));
    }

    canAttack(attacker, target) {
      const arena = Cycle.arenaOf(moon);
      if (attacker?.isNpc?.() && attacker.getAsNpc().__moonArena) return true;
      if (!target?.isNpc?.() || target.getAsNpc().__moonArena !== arena) return null;
      const fight = attacker?.isPlayer?.() ? arena.fights.get(attacker.getAsPlayer()) : null;
      return Boolean(fight?.canHit());
    }

    npcAggression(player, npc) {
      return npc?.__moonArena ? false : null;
    }
  };
}

/** A fight for a player who is in the arena and has not subdued this Moon yet. */
function begin(player, moon) {
  const arena = Cycle.arenaOf(moon);
  if (!arena || arena.fights.has(player) || Common.isDead(player, moon)) return;
  const fight = new Fight(arena, player);
  arena.fights.set(player, fight);
  fight.begin();
}

// ------------------------------------------------------------------ the statues

function canFace(player, moon) {
  const request = { player, key: QUEST, complete: false };
  Common.api.emitCustomEvent("quest:is-complete", request);
  if (request.complete) return true;
  const during = { player, moon, allow: false };
  Common.api.emitCustomEvent("moons-of-peril:can-enter", during);
  return during.allow === true;
}

function moonOfStatue(objectId) {
  return Common.MOONS.find((moon) => Common.data.moons[moon].statue === objectId) ?? null;
}

function useStatue({ player, objectId }) {
  const moon = moonOfStatue(objectId);
  if (!moon) return false;
  const spec = Common.data.moons[moon];
  if (!canFace(player, moon)) {
    player.sendMessage(NOT_YET);
    return true;
  }
  if (Common.isDead(player, moon)) {
    player.sendMessage(ALREADY_SUBDUED(spec.name));
    return true;
  }
  if (player.getAttribute(Common.NO_WARNING_ATTRIBUTE) === true) {
    enter(player, moon);
    return true;
  }
  warn(player, moon);
  return true;
}

function warn(player, moon) {
  const { StatementDialogue, OptionDialogue, DialogueChainBuilder } = Common.core;
  const { entry } = Common.data;
  player.getDialogueManager().startDialogues(new DialogueChainBuilder().add(
    new StatementDialogue(0, entry.warning),
    new OptionDialogue(1, {
      executeOption(option) {
        player.getPacketSender().sendInterfaceRemoval();
        // One-based (DialogueManager.handleResume): 1 enter, 2 enter and stop asking, 3 don't.
        const index = Number(option);
        if (index === 2) player.setAttribute(Common.NO_WARNING_ATTRIBUTE, true);
        if (index === 1 || index === 2) enter(player, moon);
      },
    }, ...entry.options).setTitle(entry.question),
  ));
}

/** Where a player lands: the special's start tile while one runs, else the glyph that is up. */
function arrival(arena) {
  const where = arena.position();
  const running = arena.specialFor(where);
  const tile = running?.special?.landing?.(arena, running.offset);
  if (tile) return tile;
  const focus = arena.circleNow(where) ?? arena.next(where.index).focus;
  return Common.tileAt(arena.moon, Common.data.glyphs[focus]);
}

function enter(player, moon) {
  const arena = Cycle.arenaOf(moon);
  if (!arena) return;
  const spec = Common.data.moons[moon];
  player.getMovementQueue().reset();
  Common.varbit(player, "focus", arena.focus());
  Common.closeHud(player);
  Common.portal(player, spec.portal);
  Common.later(Common.data.portal.moveTicks, () => {
    if (!player.isRegistered()) return;
    player.moveTo(arrival(arena));
    Common.closePortal(player);
  });
}

// ------------------------------------------------------------------ the stairs

function arenaOfPlayer(player) {
  for (const moon of Common.MOONS) {
    if (areas.get(moon)?.hasMember(player)) return Cycle.arenaOf(moon);
  }
  return null;
}

function leaveByStairs({ player, objectId }) {
  const arena = arenaOfPlayer(player);
  if (!arena || arena.spec.stairs !== objectId) return false;
  player.getMovementQueue().reset();
  const fight = arena.fights.get(player);
  if (fight?.killed) return true;
  fight?.end();
  Common.closeHud(player);
  Common.portal(player, Common.data.portal.leave);
  Common.later(Common.data.portal.moveTicks, () => {
    if (!player.isRegistered()) return;
    player.moveTo(Common.location(Common.data.exit));
    Common.closePortal(player);
  });
  return true;
}

function approachStairs(event) {
  if (Common.MOONS.some((moon) => Common.data.moons[moon].stairs === event.objectId)) event.approachRange = STAIRS_RANGE;
}

// ------------------------------------------------------------------ hits on the Moon

/** A player's hit on a Moon comes off their own fight; the shared Moon keeps its health. */
function hitMoon({ npc, hit }) {
  const arena = Cycle.arenaOfNpc(npc);
  if (!arena) return;
  const attacker = hit?.getAttacker?.();
  const fight = attacker?.isPlayer?.() ? arena.fights.get(attacker.getAsPlayer()) : null;
  if (!fight || !fight.canHit()) {
    for (const part of hit.getHits()) part.setDamage(0);
    hit.updateTotalDamage();
    return;
  }
  const damage = Curses.onPlayerHit(fight, hit);
  const sound = arena.spec.hitSound;
  if (sound) Common.sound(fight.player, sound);
  fight.damage(damage);
  // Every hitsplat, a miss too, shows the hitter's own Moon on the head bar.
  fight.showHeadBar();
}

// ------------------------------------------------------------------ logging in, dying

/** A player saved inside an arena comes back in the antechamber. */
function recoverOnLogin({ player }) {
  Common.sendDead(player);
  if (player.getAttribute(Common.INSIDE_ATTRIBUTE) !== true) return;
  player.setAttribute(Common.INSIDE_ATTRIBUTE, false);
  player.moveTo(Common.location(Common.data.exit));
}

function endOnDeath({ player }) {
  const arena = arenaOfPlayer(player);
  if (arena) Scoreboard.died(player);
  arena?.fights.get(player)?.end();
}

/** A grave from a death in an arena is left in the antechamber (Wiki: outside the arena). */
function graveOutside(request) {
  if (!request?.player || !arenaOfPlayer(request.player)) return;
  const [x, y, z] = Common.data.exit;
  request.tile = { x, y, z };
}

function attachArena(api) {
  api.persistAttribute(Common.DEAD_ATTRIBUTE, 0);
  api.persistAttribute(Common.INSIDE_ATTRIBUTE, false);
  api.persistAttribute(Common.NO_WARNING_ATTRIBUTE, false);
  for (const moon of Common.MOONS) {
    const area = new (areaClass(moon))();
    areas.set(moon, area);
    api.registerArea(area);
  }
  api.onObjectInteraction("Statue", { Use: useStatue });
  api.onObjectInteraction("Stairs", { "Quick-escape": leaveByStairs, Escape: leaveByStairs });
  api.onObjectRoute(approachStairs);
  api.onNpcHitModify(hitMoon);
  api.onPlayerLogin(recoverOnLogin);
  api.onPlayerLogin(Kill.resendKills);
  api.onPlayerDeath(endOnDeath);
  api.onCustomEvent("gravestones:grave-location", graveOutside);
}

module.exports = { attachArena, enter, arenaOfPlayer, areas, approachStairs };
