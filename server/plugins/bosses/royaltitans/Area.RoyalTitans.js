/**
 * One Royal Titans instance per party (1-2 players), entered only through the entrance
 * tunnel (captured): Enter offers Start a fight / Join a fight / Do nothing, Join asks whose
 * fight (they must have you on their friends' list), Quick-start starts your own. Starting or
 * joining shows the unsafe-death warning, then "Are you sure you wish to proceed?" until
 * "Yes, and don't ask again." (varbit royal_titans_enter_warning, 16089). The crawl fades the
 * player into the instance at (2911, 9573) with "In the Pits"; Quick-escape fades them out to
 * (2950, 9574).
 *
 * Join is allowed while both titans are above 450 HP and neither has teleported (docs
 * assumptions 1-2); later the critical-stage box refuses. Leaving (Quick-escape, teleport,
 * death) ends that player's part; an empty instance is destroyed with its NPCs and drops.
 * Logging out keeps the place in a live fight for the relog; deaths are unsafe, with the
 * grave outside the entrance.
 */
const Shared = require("./Shared.RoyalTitans");
const Hud = require("./Hud.RoyalTitans");
const CombatAchievements = require("./CombatAchievements.RoyalTitans");

const SCOREBOARD_INTERFACE = 909;
/** toplevel_mainmodal_open (-1, -1), run before the board as live does: a modal before it (the bank's
 * -2) can leave the main modal stretched, which pulls the board's background to the top. */
const SCRIPT_MAINMODAL_OPEN = 2524;

const SCOREBOARD_COMPONENT = Object.freeze({
  title: 6, pkc: 9, pd: 11, pbt: 13, gkc: 15, gd: 17, gbt: 19,
});
/** minimap_state: hidden only while the screen fades (captured 0 -> 2 -> 0 both ways). */
const MINIMAP_STATE_VARBIT = 6719;
const MINIMAP_HIDDEN = 2;
const MINIMAP_SHOWN = 0;
const MUSIC_IN_THE_PITS = 469;
const OVERLAY_ATMOSPHERE_UID = (161 << 16) | 1;
const FADE_OVERLAY = 174;
const FADE_SCRIPT = 948;
const FADE_CYCLES = 50;
/** meslayer_mode8: the name input live opens for Join. */
const NAME_INPUT_SCRIPT = 109;
const CRAWL_ANIMATION = 2796;
const CRAWL_SOUND = 2454;
const CRAWL_SOUND_LOOPS = 2;
const CRAWL_SOUND_DELAY = 4;
/** Captured fades, in ticks after the click: the move, the fade back in, the overlay closed. */
const ENTRY_TIMING = Object.freeze({ moveTicks: 3, inTicks: 4, closeTicks: 6 });
const EXIT_TIMING = Object.freeze({ moveTicks: 2, inTicks: 4, closeTicks: 6 });

const JOIN_PROMPT = "Whose fight would you like to join? You must be on their friends' list.";
const CONFIRM_TITLE = "Are you sure you wish to proceed?";
/** Join replies the captures don't show [EST]. */
const NO_FIGHT_MESSAGE = "That player isn't fighting the Royal Titans.";
const NOT_FRIENDS_MESSAGE = "You must be on their friends' list to join their fight.";
const FULL_MESSAGE = "That fight is already full.";

/** Set while the player is in an instance, so a login there finds the fight or the outside. */
const INSIDE_ATTRIBUTE = "royal-titans:inside";
const DEATHS_ATTRIBUTE = "royal-titans:deaths";
const SKIP_WARNING_ATTRIBUTE = "royal-titans:skip-warning";

let api = null;
let core = null;
let TitansArea = null;
/** area -> session { area, players, branda, eldric, rows, minions, staticLocs, ... }. */
const sessions = new Map();
/** Server-wide scoreboard numbers since startup (live shows the global totals). */
const world = { kills: 0, deaths: 0, best: 0 };

const { alive, later, tileOf } = Shared;

const toLocation = ([x, y, z]) => new core.Location(x, y, z ?? 0);

/** An authored arena spot as a Location in the session's instance. */
function arenaLocation(area, [x, y, z]) {
  const at = Shared.instanceTile(area, x, y, z ?? 0);
  return new core.Location(at.x, at.y, at.z);
}

function sessionOfPlayer(player) {
  for (const session of sessions.values()) {
    if (session.players.includes(player)) return session;
  }
  return null;
}

function defineAreaClass() {
  class RoyalTitansArea extends core.TemplatedInstanceArea {
    constructor() {
      super(Shared.ARENA_CHUNKS, Shared.ARENA_CHUNKS);
      const { x, y } = Shared.ARENA_SOURCE_CHUNK;
      for (let chunkX = 0; chunkX < Shared.ARENA_CHUNKS; chunkX++) {
        for (let chunkY = 0; chunkY < Shared.ARENA_CHUNKS; chunkY++) {
          this.setChunk(0, chunkX, chunkY, {
            sourceChunkX: x + chunkX, sourceChunkY: y + chunkY, sourcePlane: 0, rotation: 0,
          });
        }
      }
    }

    getName() {
      return "Royal Titans Arena";
    }

    destroy() {
      if (this.isDestroyed()) return;
      const addQueue = core.World.getAddNPCQueue();
      const removeQueue = core.World.getRemoveNPCQueue();
      for (const entity of this.entities) {
        if (!entity.isNpc?.()) continue;
        const npc = entity.getAsNpc();
        for (let index = addQueue.indexOf(npc); index !== -1; index = addQueue.indexOf(npc)) {
          addQueue.splice(index, 1);
        }
        if (npc.isRegistered() && !removeQueue.includes(npc)) removeQueue.push(npc);
      }
      super.destroy();
    }

    process(mobile) {
      if (!mobile.isPlayer()) return;
      const player = mobile.getAsPlayer();
      const session = sessions.get(this);
      if (!session?.players.includes(player)) return;
      ensureEncounter(session);
      CombatAchievements.tick(player, session);
      Hud.tickPlayer(player, session);
      retarget(session);
    }

    postLeave(mobile, logout) {
      if (mobile.isPlayer()) leave(mobile.getAsPlayer(), this, logout);
      super.postLeave(mobile, logout);
    }

    /** Players fight only their own instance's NPCs, and row tiles only with spells. */
    canAttack(attacker, target, method) {
      if (!attacker.isPlayer() || !target.isNpc() || !Shared.isTitanNpc(target.getId())) return null;
      if (attacker.getPrivateArea() !== target.getPrivateArea()) return false;
      if (Shared.isRowHitbox(target.getId())) {
        return require("./Specials.RoyalTitans").rowAttackAllowed(attacker, target, method);
      }
      return null;
    }

    isMulti() {
      return true;
    }
  }
  TitansArea = RoyalTitansArea;
}

/** A titan engages the nearest party member when it has no live one in its sights. */
function retarget(session) {
  if (session.over === true) return;
  for (const npc of [session.branda, session.eldric]) {
    if (!npc || !Shared.isLiveTitan(npc.getId()) || !alive(npc)) continue;
    const target = npc.getCombat().getTarget();
    if (target?.isPlayer() && alive(target) && session.players.includes(target.getAsPlayer())) continue;
    const best = Shared.nearestPlayer(session, tileOf(npc));
    if (best) npc.getCombat().attack(best);
  }
}

function spawnTitan(session, id, tile, faceTile, anim) {
  const { area } = session;
  const npc = core.NPC.create(id, arenaLocation(area, tile));
  npc.__skipDefaultRespawn = true;
  npc.setHitpoints(Shared.MAX_HITPOINTS);
  // No idle wander: every step is a planned walk (Specials.planWalk).
  npc.getMovementCoordinator().setRadius(0);
  // They stand on the lava/ice beside the lane, floor the collision map blocks, and only
  // ever step along their own side of it (Specials.stepTitans).
  npc.setFlag("movement:ignore-clipping");
  npc.setFlag("combat:no-regen");
  // They face across the lane, never the player (Specials.faceAcross).
  npc.setFlag("combat:keep-facing");
  npc.setMultiCombat(true);
  npc.performAnimation(new core.Animation(anim));
  npc.setPositionToFace(arenaLocation(area, faceTile));
  npc.setAttribute(Shared.ENCOUNTER_ATTRIBUTE, session);
  npc.setAttribute(Shared.ARMED_AT_ATTRIBUTE, core.World.getProcessCycle() + Shared.ARM_TICKS);
  npc.setAttribute(Shared.ATTACKS_ATTRIBUTE, 0);
  area.add(npc);
  core.World.getAddNPCQueue().push(npc);
  return npc;
}

/** Both titans spawn together on their captured tiles and facings. */
function spawnEncounter(session) {
  if (session.area.isDestroyed()) return;
  require("./Specials.RoyalTitans").clearStaticLocs(session);
  session.branda = spawnTitan(session, Shared.BRANDA_ID, Shared.BRANDA_SPAWN, Shared.BRANDA_FACE, Shared.BRANDA_ANIMATIONS.spawn);
  session.eldric = spawnTitan(session, Shared.ELDRIC_ID, Shared.ELDRIC_SPAWN, Shared.ELDRIC_FACE, Shared.ELDRIC_ANIMATIONS.spawn);
  Object.assign(session, {
    spawnedAt: core.World.getProcessCycle(), over: false, teleported: false, claimedBy: null, claims: null,
    brandaDown: false, eldricDown: false, respawnAt: 0, corpses: [],
  });
  for (const player of session.players) {
    CombatAchievements.spawned(player, session);
    Hud.showFor(player, session);
  }
  later(Shared.ARM_TICKS, () => retarget(session));
}

/** Keeps the party's fight going: spawn on entry, respawn on the claim-anchored timer.
 * Never respawns mid-fight or into a fresh kill: once over, only past respawnAt. */
function ensureEncounter(session) {
  const titans = [session.branda, session.eldric];
  const pending = titans.some((npc) => npc && !npc.isRegistered() && core.World.getAddNPCQueue().includes(npc));
  if (pending || titans.some((npc) => npc?.isRegistered())) return;
  if (session.over && session.corpses.some((npc) => npc.isRegistered())) return;
  if (session.respawnAt && core.World.getProcessCycle() < session.respawnAt) return;
  spawnEncounter(session);
}

function createSession(owner) {
  const session = {
    area: new TitansArea(), owner, players: [], branda: null, eldric: null,
    spawnedAt: 0, over: false, respawnAt: 0, claimedBy: null, corpses: [],
    rows: new Set(), minions: new Set(), staticLocs: [], tileLocs: new Map(),
    pendingRows: [],
  };
  sessions.set(session.area, session);
  return session;
}

function destroySession(session) {
  sessions.delete(session.area);
  session.area.destroy();
}

/** A player leaves the instance: their Titan Killer streak fails. Logging out keeps the
 * place so a relog lands back in a live fight; the instance dies with its last member. */
function leave(player, area, logout) {
  const session = sessions.get(area);
  if (!session?.players.includes(player)) return;
  CombatAchievements.left(player, session);
  Hud.dropFor(player);
  player.getCombat().getHitQueue().clear();
  if (!logout) {
    session.players = session.players.filter((member) => member !== player);
    player.setAttribute(INSIDE_ATTRIBUTE, false);
  }
  if (!session.players.some((member) => member.isRegistered() && member !== player)) destroySession(session);
}

/** A relog finds the party's live fight again, else lands outside the entrance. */
function recoverOnLogin({ player }) {
  if (player.getAttribute(SKIP_WARNING_ATTRIBUTE) === true) {
    player.getPacketSender().sendVarbit(Shared.ENTER_WARNING_VARBIT, 1);
  }
  if (player.getAttribute(INSIDE_ATTRIBUTE) !== true) return;
  const name = player.getUsername().toLowerCase();
  for (const session of sessions.values()) {
    const index = session.players.findIndex((member) => member.getUsername().toLowerCase() === name);
    if (index === -1) continue;
    session.players[index] = player;
    placeInArena(session, player);
    return;
  }
  player.setAttribute(INSIDE_ATTRIBUTE, false);
  player.moveTo(toLocation(Shared.OUTSIDE_LANDING));
}

/** Deaths in an instance leave the grave outside the entrance. */
function graveOutside(request) {
  if (!sessionOfPlayer(request.player)) return;
  const [x, y, z] = Shared.OUTSIDE_LANDING;
  request.tile = { x, y, z };
}

/** A Giantsoul amulet is kept beyond the kept-item count on a death here (Wiki). */
function keepGiantsoul(event) {
  const { GIANTSOUL_AMULET, GIANTSOUL_AMULET_UNCHARGED_ } = core.ItemIdentifiers;
  const id = event.item?.getId?.();
  if ((id === GIANTSOUL_AMULET || id === GIANTSOUL_AMULET_UNCHARGED_) && sessionOfPlayer(event.player)) event.keep = true;
}

function countDeath({ player }) {
  if (!sessionOfPlayer(player)) return;
  player.setAttribute(DEATHS_ATTRIBUTE, player.getAttribute(DEATHS_ATTRIBUTE) + 1);
  world.deaths += 1;
  CombatAchievements.died(player);
  Hud.dropFor(player);
}

function fade(player, out) {
  const args = out ? [0, 255, 0, 0, FADE_CYCLES] : [0, 0, 0, 255, FADE_CYCLES];
  player.getPacketSender().sendSubInterface(OVERLAY_ATMOSPHERE_UID, FADE_OVERLAY, 1, {
    postScripts: [{ scriptId: FADE_SCRIPT, args }],
  });
}

/** The captured fade: out now, the minimap hidden a tick later, the move, then back in. */
function travel(player, { moveTicks, inTicks, closeTicks }, move, arrive) {
  const sender = player.getPacketSender();
  fade(player, true);
  later(1, () => player.isRegistered() && sender.sendVarbit(MINIMAP_STATE_VARBIT, MINIMAP_HIDDEN));
  later(moveTicks, () => player.isRegistered() && move());
  later(inTicks, () => {
    if (!player.isRegistered()) return;
    sender.sendVarbit(MINIMAP_STATE_VARBIT, MINIMAP_SHOWN);
    fade(player, false);
    arrive?.();
  });
  later(closeTicks, () => player.isRegistered() && sender.closeSubInterface(OVERLAY_ATMOSPHERE_UID));
}

/** Into the session's instance at the arena's north edge. */
function placeInArena(session, player) {
  session.area.enter(player);
  player.moveTo(arenaLocation(session.area, Shared.ARENA_ENTRY));
  player.setAttribute(INSIDE_ATTRIBUTE, true);
  Hud.showFor(player, session);
}

/** The crawl through the tunnel into a fight (a fresh one, or the friend's). */
function crawlInto(session, player) {
  player.getPacketSender().sendInterfaceRemoval();
  player.performAnimation(new core.Animation(CRAWL_ANIMATION));
  player.getPacketSender().sendSoundEffect(CRAWL_SOUND, CRAWL_SOUND_LOOPS, CRAWL_SOUND_DELAY);
  travel(player, ENTRY_TIMING, () => {
    if (session.area.isDestroyed()) return;
    if (!session.players.includes(player)) {
      session.players.push(player);
      // A new instance, or a join, restarts the Titan Killer streak (Wiki).
      CombatAchievements.joined(player, session);
    }
    placeInArena(session, player);
    ensureEncounter(session);
  }, () => {
    api.emitCustomEvent("music:unlock-track", { player, trackId: MUSIC_IN_THE_PITS });
    player.getPacketSender().sendSong(MUSIC_IN_THE_PITS);
  });
}

/** The warning box and the question, unless "don't ask again" was picked. */
function confirmEntry(player, proceed) {
  if (player.getAttribute(SKIP_WARNING_ATTRIBUTE) === true) {
    proceed();
    return;
  }
  const ask = () => api.sendMultiChatboxPrompt(player, CONFIRM_TITLE,
    "Yes.", proceed,
    "Yes, and don't ask again.", () => {
      player.setAttribute(SKIP_WARNING_ATTRIBUTE, true);
      player.getPacketSender().sendVarbit(Shared.ENTER_WARNING_VARBIT, 1);
      proceed();
    },
    "No.", () => player.getPacketSender().sendInterfaceRemoval());
  player.getDialogueManager().startDialogues(new core.DialogueChainBuilder().add(
    new core.StatementDialogue(0, Shared.WARNING_MESSAGE),
    new core.ActionDialogue(1, { execute: ask }),
  ));
}

function startFight(player) {
  confirmEntry(player, () => crawlInto(createSession(player), player));
}

/** Join is open while both titans are fresh: above 450 HP and not yet teleported. */
function joinable(session) {
  if (!session.branda && !session.eldric) return true;
  return [session.branda, session.eldric].every((npc) =>
    alive(npc) && npc.getAttribute(Shared.TELEPORTED_ATTRIBUTE) !== true
    && npc.getHitpoints() >= Shared.JOIN_MIN_HITPOINTS);
}

function joinFriend(player, name) {
  const owner = core.World.getPlayerByName(name.trim());
  const session = owner ? sessionOfPlayer(owner) : null;
  if (!session || session.owner !== owner) {
    player.sendMessage(NO_FIGHT_MESSAGE);
    return;
  }
  if (!owner.getRelations().isFriendWith(player.getUsername())) {
    player.sendMessage(NOT_FRIENDS_MESSAGE);
    return;
  }
  if (session.players.length >= 2) {
    player.sendMessage(FULL_MESSAGE);
    return;
  }
  // "group-pvm:can-start": content may refuse (a Hardcore Group Ironman with an outsider).
  const check = { players: [player, ...session.players], entrant: player, activity: "the Royal Titans", allowed: true, reason: null };
  api.emitCustomEvent("group-pvm:can-start", check);
  if (check.allowed === false) {
    if (check.reason) player.sendMessage(check.reason);
    return;
  }
  if (!joinable(session)) {
    player.getDialogueManager().startDialogues(new core.DialogueChainBuilder().add(
      new core.StatementDialogue(0, Shared.CRITICAL_MESSAGE),
    ));
    return;
  }
  confirmEntry(player, () => crawlInto(session, player));
}

function askWhoseFight(player) {
  player.getPacketSender().sendInterfaceRemoval();
  player.setEnteredSyntaxAction({ execute: (name) => joinFriend(player, String(name)) });
  player.getPacketSender().sendClientScript(NAME_INPUT_SCRIPT, JOIN_PROMPT);
}

function enterMenu({ player }) {
  api.sendMultiChatboxPrompt(player, Shared.MENU_TITLE,
    Shared.MENU_OPTIONS[0], () => startFight(player),
    Shared.MENU_OPTIONS[1], () => askWhoseFight(player),
    Shared.MENU_OPTIONS[2], () => player.getPacketSender().sendInterfaceRemoval());
  return true;
}

function join({ player }) {
  askWhoseFight(player);
  return true;
}

/** Quick-start skips the menu but never the warning: always your own fresh fight. */
function quickStart({ player }) {
  startFight(player);
  return true;
}

/** Inspect only ever hints; Quick-escape leaves (captured). */
function inspectExit({ player }) {
  player.sendMessage(Shared.ESCAPE_HINT);
  return true;
}

function quickEscape({ player }) {
  if (!sessionOfPlayer(player)) return false;
  Hud.dropFor(player);
  travel(player, EXIT_TIMING, () => player.moveTo(toLocation(Shared.OUTSIDE_LANDING)));
  return true;
}

/** The exit tunnel answers from anywhere in the arena (it sits in the wall): route both
 * options onto the player's own tile so they fire at once. */
function exitRoute(event) {
  if (event.objectId !== Shared.EXIT_OBJECT) return;
  const at = event.player.getLocation();
  event.destination = { x: at.getX(), y: at.getY(), z: at.getZ() };
}

function formatBest(ticks) {
  return ticks > 0 ? Shared.formatTicks(ticks) : "-";
}

const number = (value) => Math.max(0, value).toLocaleString("en-US");

/** The statistics board by the tunnel (interface 909, captured fields). */
function readScoreboard({ player }) {
  const uid = (component) => (SCOREBOARD_INTERFACE << 16) | component;
  const sender = player.getPacketSender();
  sender.sendInterfaceScript(SCRIPT_MAINMODAL_OPEN, [-1, -1]);
  sender.sendInterface(SCOREBOARD_INTERFACE);
  sender.sendString("Royal Titans Statistics", uid(SCOREBOARD_COMPONENT.title));
  sender.sendString(number(player.getAttribute(Shared.KILLS_ATTRIBUTE)), uid(SCOREBOARD_COMPONENT.pkc));
  sender.sendString(number(player.getAttribute(DEATHS_ATTRIBUTE)), uid(SCOREBOARD_COMPONENT.pd));
  sender.sendString(formatBest(player.getAttribute(Shared.BEST_TICKS_ATTRIBUTE)), uid(SCOREBOARD_COMPONENT.pbt));
  sender.sendString(number(world.kills), uid(SCOREBOARD_COMPONENT.gkc));
  sender.sendString(number(world.deaths), uid(SCOREBOARD_COMPONENT.gd));
  sender.sendString(formatBest(world.best), uid(SCOREBOARD_COMPONENT.gbt));
  return true;
}

function attach(pluginApi) {
  api = pluginApi;
  core = pluginApi.core;
  defineAreaClass();
  api.persistAttribute(Shared.KILLS_ATTRIBUTE, 0);
  api.persistAttribute(Shared.BEST_TICKS_ATTRIBUTE, 0);
  api.persistAttribute(Shared.STREAK_ATTRIBUTE, 0);
  api.persistAttribute(INSIDE_ATTRIBUTE, false);
  api.persistAttribute(DEATHS_ATTRIBUTE, 0);
  api.persistAttribute(SKIP_WARNING_ATTRIBUTE, false);
  api.onObjectFirstClick(Shared.ENTRANCE_OBJECT, enterMenu);
  api.onObjectSecondClick(Shared.ENTRANCE_OBJECT, join);
  api.onObjectThirdClick(Shared.ENTRANCE_OBJECT, quickStart);
  api.onObjectFirstClick(Shared.EXIT_OBJECT, inspectExit);
  api.onObjectSecondClick(Shared.EXIT_OBJECT, quickEscape);
  api.onObjectFirstClick(Shared.SCOREBOARD_OBJECT, readScoreboard);
  api.onObjectRoute(exitRoute);
  api.onPlayerLogin(recoverOnLogin);
  api.onPlayerDeath(countDeath);
  api.onCustomEvent("gravestones:grave-location", graveOutside);
  api.onShouldKeepItemOnDeath(keepGiantsoul);
}

module.exports = {
  attach, sessions, world, sessionOfPlayer, spawnEncounter,
  _test: { joinable, sessions, keepGiantsoul },
};
