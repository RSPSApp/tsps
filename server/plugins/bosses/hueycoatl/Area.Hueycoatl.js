/**
 * The Hueycoatl's ground (docs/hueycoatl.md, rsprox 837, 3274, 3399, 3400, 4052, 4054):
 *
 * - The public fight is on the world map, an Area over the arena beyond the chain. The chain
 *   (huey_fight_entrance, a multiloc on huey_in_area) offers Climb, Quick-climb and Peek from
 *   the camp: before Taala has explained the fight (varbit huey_intro) she stops the player;
 *   otherwise they land at (1528, 3284) with huey_in_area set and "The Feathered Serpent"
 *   (unlocked, with huey_encountered, the first time). Peek counts the adventurers ascending.
 *   From inside, Climb and Quick-climb lead back to the camp.
 * - The slope (huey_fight_exit_shortcut): Slide warns "Leave the encounter? Your perfect
 *   streak (N) will be lost." (Leave. / Stay.), Quick-slide doesn't; "Weeee!", an exact move
 *   to (1524, 3290) over 100 cycles, "You slide down the slope...", 3 ticks later "... and land
 *   skillfully." with the camp's music.
 * - The meeting flag (Fight-privately) opens "Select an option": a public/friends fight (your
 *   friends may join), a solo fight, join a friend's fight, or cancel. A private fight copies the
 *   camp and the arena into an instance and fades the player in at (1524, 3294); its flag and
 *   rockslide (Leave-group) fade them back. It costs 50,000 coins, or 25,000 with the current
 *   Hard Combat Achievement reward threshold (Wiki).
 * - Deaths are unsafe; the grave is left at the base camp (Wiki). Logging out of a private
 *   fight lands outside it.
 */
const Shared = require("./Shared.Hueycoatl");
const { Session } = require("./Session.Hueycoatl");
const Fight = require("./Fight.Hueycoatl");
const Hud = require("./Hud.Hueycoatl");
const CombatAchievements = require("./CombatAchievements.Hueycoatl");

const TEAM_LIMIT = 20;
const PRIVATE_FEE = 50000;
const HARD_PRIVATE_FEE = 25000;
const COINS = 995;
const MENU_TITLE = "Select an option";
const MENU_OPTIONS = Object.freeze([
  "Start a public/friends fight (based on privacy setting).",
  "Start a solo fight.",
  "Join a public/friends fight.",
  "Cancel.",
]);
const JOIN_PROMPT = "Whose fight would you like to join?";
/** Not captured: our wording [EST]. */
const NO_FEE_MESSAGE = (fee) => `You need ${fee.toLocaleString("en-US")} coins to start a private fight.`;
const NO_FIGHT_MESSAGE = "That player isn't fighting the Hueycoatl.";
const NOT_FRIENDS_MESSAGE = "You must be on their friends list to join their fight.";
const FULL_MESSAGE = "That fight is full.";
const LEAVE_TITLE = (streak) => `Leave the encounter? Your perfect streak (${streak}) will be lost.`;
const TAALA_GATE = "Excuse me, human! Perhaps you shouldn't just go wandering through there without knowing what you're dealing with!";
/** The peek's second line: captured for the respawn; the others are ours [EST]. */
const PEEK_LINES = Object.freeze({
  defeated: "The Hueycoatl has been subdued!",
  body: "The Hueycoatl's body blocks the way up the mountain.",
  head: "The Hueycoatl is fighting at the summit.",
  tail: "The Hueycoatl has shielded itself.",
  "final-pending": "The Hueycoatl has shielded itself.",
  final: "The Hueycoatl's shield has fallen.",
});
/** Back through the chain from the arena lands by it in the camp [EST]. */
const CHAIN_CAMP_SIDE = [1528, 3287];
const SLIDE_SAY = "Weeee!";
const SLOPE_APPROACH = [1519, 3290];
const SLIDE_CYCLES = 100;
const SLIDE_TICKS = 3;
const SLIDE_EAST = 1;
const SLIDE_LOOPS = 2;
const SLIDE_DELAY = 10;
const ENTRY_TICKS = 1;
const MUSIC_UNLOCK_TRACK = Shared.MUSIC.FIGHT;
/** The captured fade into and out of a private fight: out, the minimap hidden, the move, in. */
const OVERLAY_ATMOSPHERE_UID = (161 << 16) | 1;
const FADE_OVERLAY = 174;
const FADE_SCRIPT = 948;
const FADE_CYCLES = 50;
const MINIMAP_HIDDEN = 2;
const MINIMAP_SHOWN = 0;
const TRAVEL = Object.freeze({ minimapTicks: 1, moveTicks: 2, inTicks: 3, closeTicks: 5 });

/** meslayer_mode8: the name input live opens for joining (as the Royal Titans' Join). */
const NAME_INPUT_SCRIPT = 109;
/** The private fight's meeting flag and the rockslide out (captured, loc_add_change on entry). */
const PRIVATE_FLAG_TILE = [1525, 3295];
const PRIVATE_ROCKSLIDE_TILE = [1522, 3295];
const TAALA_INTRO_ATTRIBUTE = "hueycoatl:taala-intro";
const ENCOUNTERED_ATTRIBUTE = "hueycoatl:encountered";

let api = null;
let core = null;
let publicSession = null;
/** Server-wide deaths since startup, for the scoreboard. */
const world = { deaths: 0 };
let InstanceArea = null;

function defineAreas() {
  class HueycoatlArena extends core.Area {
    constructor() {
      super(Shared.ARENA_BOUNDS.map((b) => new core.Boundary(b.minX, b.maxX, b.minY, b.maxY, 0)));
    }

    getName() {
      return "The Hueycoatl";
    }

    isMulti() {
      return true;
    }

    // The fight script owns every attack; source aggression must not start native combat.
    npcAggression() {
      return false;
    }

    postEnter(mobile) {
      if (mobile.isPlayer()) arrived(publicSession, mobile.getAsPlayer());
    }

    postLeave(mobile, logout) {
      if (mobile.isPlayer()) departed(publicSession, mobile.getAsPlayer(), logout);
    }
  }

  class HueycoatlInstance extends core.TemplatedInstanceArea {
    constructor() {
      super(Shared.INSTANCE_CHUNKS.width, Shared.INSTANCE_CHUNKS.height);
      const { x, y } = Shared.INSTANCE_SOURCE_CHUNK;
      for (let chunkX = 0; chunkX < Shared.INSTANCE_CHUNKS.width; chunkX++) {
        for (let chunkY = 0; chunkY < Shared.INSTANCE_CHUNKS.height; chunkY++) {
          this.setChunk(0, chunkX, chunkY, { sourceChunkX: x + chunkX, sourceChunkY: y + chunkY, sourcePlane: 0, rotation: 0 });
        }
      }
    }

    getName() {
      return "The Hueycoatl (private)";
    }

    isMulti() {
      return true;
    }

    // The fight script owns every attack; source aggression must not start native combat.
    npcAggression() {
      return false;
    }

    postLeave(mobile, logout) {
      if (mobile.isPlayer()) departed(this.session, mobile.getAsPlayer(), logout);
      super.postLeave(mobile, logout);
    }

    destroy() {
      if (this.isDestroyed()) return;
      this.session?.dispose();
      Shared.sessions.delete(this.session);
      super.destroy();
    }
  }

  api.registerArea(new HueycoatlArena());
  InstanceArea = HueycoatlInstance;
}

/** A player is in the fight's space (the public arena, or a private fight's instance). */
function arrived(session, player) {
  if (!session) return;
  session.members.add(player);
  if (session.inArena(player)) enteredArena(session, player);
}

/** They reached the arena: the fight's clock for them starts, as does a fresh streak. */
function enteredArena(session, player) {
  const fight = session.fight;
  if (fight && !fight.joinedAt.has(player)) fight.joinedAt.set(player, Fight.now());
  CombatAchievements.started(player);
}

function departed(session, player, logout) {
  if (!session?.members.has(player)) return;
  session.members.delete(player);
  leftArena(session, player);
  if (session.isPrivate()) player.setAttribute(Shared.INSIDE_PRIVATE_ATTRIBUTE, logout === true);
}

/** Out of the arena however they went: the chain's state, the bar, the streak. */
function leftArena(session, player) {
  player.getPacketSender().sendVarbit(Shared.VARBIT.IN_AREA, 0);
  Hud.dropFor(player);
  CombatAchievements.left(player);
  session.fight?.joinedAt.delete(player);
}

/** The session the player's camp belongs to: their private fight's, else the public one. */
function campSession(player) {
  const area = player.getPrivateArea();
  if (area instanceof InstanceArea) return area.session;
  return publicSession;
}

function climbIn(player) {
  const session = campSession(player);
  if (!session) return;
  if (player.getAttribute(TAALA_INTRO_ATTRIBUTE) !== true) {
    api.emitCustomEvent("npc-dialogue:start", {
      player, npcId: Shared.NPC.TAALA, variant: "standard-dialogue-when-trying-to-climb-the-chain-before-speaking",
    });
    return;
  }
  if (session.arenaPlayers().length >= TEAM_LIMIT) {
    player.sendMessage("The mountain is too crowded to climb right now.");
    return;
  }
  Shared.later(ENTRY_TICKS, () => {
    if (!player.isRegistered()) return;
    player.moveTo(session.tile(Shared.ARENA_ENTRY));
    const sender = player.getPacketSender();
    sender.sendVarbit(Shared.VARBIT.IN_AREA, 1);
    sender.sendSong(Shared.MUSIC.FIGHT);
    if (player.getAttribute(ENCOUNTERED_ATTRIBUTE) !== true) {
      player.setAttribute(ENCOUNTERED_ATTRIBUTE, true);
      sender.sendVarbit(Shared.VARBIT.ENCOUNTERED, 1);
      api.emitCustomEvent("music:unlock-track", { player, trackId: MUSIC_UNLOCK_TRACK });
    }
    if (session.isPrivate()) enteredArena(session, player);
  });
}

function leaveVia(player, go) {
  const streak = Shared.counter(player, Shared.STREAK_ATTRIBUTE);
  api.sendMultiChatboxPrompt(player, LEAVE_TITLE(streak),
    "Leave.", go,
    "Stay.", () => player.getPacketSender().sendInterfaceRemoval());
}

function climbOut(player) {
  const session = campSession(player);
  player.getPacketSender().sendInterfaceRemoval();
  player.moveTo(session.tile(CHAIN_CAMP_SIDE));
  player.getPacketSender().sendSong(Shared.MUSIC.CAMP);
  if (session.isPrivate()) leftArena(session, player);
}

function inArena(player) {
  const session = campSession(player);
  return session?.inArena(player) === true;
}

const isChain = (event) => event.objectId === Shared.LOC.CHAIN;
const isSlope = (event) => event.objectId === Shared.LOC.SLOPE;

function climb(event) {
  if (!isChain(event)) return false;
  const { player } = event;
  if (inArena(player)) leaveVia(player, () => climbOut(player));
  else climbIn(player);
  return true;
}

function quickClimb(event) {
  if (!isChain(event)) return false;
  const { player } = event;
  if (inArena(player)) climbOut(player);
  else climbIn(player);
  return true;
}

function peek(event) {
  if (!isChain(event)) return false;
  const { player } = event;
  const session = campSession(player);
  const count = session.arenaPlayers().length;
  const line = PEEK_LINES[session.fight?.phase] ?? PEEK_LINES.body;
  player.getDialogueManager().startDialogues(new core.DialogueChainBuilder().add(
    new core.StatementDialogue(0, `There are ${count} adventurers ascending the mountain.<br>${line}`),
  ));
  return true;
}

function slide(player) {
  const session = campSession(player);
  player.getPacketSender().sendInterfaceRemoval();
  // From the slope's own tile, as captured (the player steps onto it first).
  const start = session.tile(Shared.SLOPE_TOP);
  player.moveTo(start);
  const end = session.tile(Shared.CAMP_LANDING);
  const delta = new core.Location(end.getX() - start.getX(), end.getY() - start.getY(), 0);
  player.forceChat(SLIDE_SAY);
  player.sendMessage(Shared.MESSAGE.SLIDE);
  player.getPacketSender().sendSoundEffect(Shared.SOUND.SLIDE, SLIDE_LOOPS, SLIDE_DELAY);
  core.TaskManager.submit(new core.ForceMovementTask(player, SLIDE_TICKS,
    new core.ForceMovement(start, delta, 0, SLIDE_CYCLES, SLIDE_EAST, Shared.SEQ.SLIDE)));
  if (session.isPrivate()) leftArena(session, player);
  Shared.later(SLIDE_TICKS, () => {
    if (!player.isRegistered()) return;
    player.performAnimation(new core.Animation(-1));
    player.sendMessage(Shared.MESSAGE.LAND);
    player.getPacketSender().sendSoundEffect(Shared.SOUND.LAND, 1, 0);
    player.getPacketSender().sendSong(Shared.MUSIC.CAMP);
  });
}

/** The slope is solid in our map but live players step onto it from any side, the diagonal
 * included (captured): from next to it the slide starts where they stand, else they walk to
 * its west side. */
function slopeRoute(event) {
  if (event.objectId !== Shared.LOC.SLOPE) return;
  const session = campSession(event.player);
  const at = event.player.getLocation();
  const slope = session.tile(Shared.SLOPE_TOP);
  const next = Math.max(Math.abs(at.getX() - slope.getX()), Math.abs(at.getY() - slope.getY())) <= 1;
  const to = next ? at : session.tile(SLOPE_APPROACH);
  event.destination = { x: to.getX(), y: to.getY(), z: to.getZ() };
}

function slideDown(event) {
  if (!isSlope(event)) return false;
  const { player } = event;
  leaveVia(player, () => slide(player));
  return true;
}

function quickSlide(event) {
  if (!isSlope(event)) return false;
  const { player } = event;
  slide(player);
  return true;
}

function fade(player, out) {
  const args = out ? [0, 255, 0, 0, FADE_CYCLES] : [0, 0, 0, 255, FADE_CYCLES];
  player.getPacketSender().sendSubInterface(OVERLAY_ATMOSPHERE_UID, FADE_OVERLAY, 1, {
    postScripts: [{ scriptId: FADE_SCRIPT, args }],
  });
}

/** The captured fade around a move into or out of a private fight. */
function travel(player, move) {
  const sender = player.getPacketSender();
  sender.sendInterfaceRemoval();
  fade(player, true);
  Shared.later(TRAVEL.minimapTicks, () => player.isRegistered() && sender.sendVarbit(Shared.VARBIT.MINIMAP_STATE, MINIMAP_HIDDEN));
  Shared.later(TRAVEL.moveTicks, () => player.isRegistered() && move());
  Shared.later(TRAVEL.inTicks, () => {
    if (!player.isRegistered()) return;
    sender.sendVarbit(Shared.VARBIT.MINIMAP_STATE, MINIMAP_SHOWN);
    fade(player, false);
  });
  Shared.later(TRAVEL.closeTicks, () => player.isRegistered() && sender.closeSubInterface(OVERLAY_ATMOSPHERE_UID));
}

function intoPrivate(player, session) {
  travel(player, () => {
    if (session.area.isDestroyed()) return;
    session.area.enter(player);
    session.members.add(player);
    player.moveTo(session.tile(Shared.PRIVATE_LANDING));
  });
}

/** A new private fight: the camp and the arena copied, the camp's people and a fresh set. */
function createPrivate(player, kind) {
  const inventory = player.getInventory();
  const tier = { player, tier: "Hard" };
  api.emitCustomEvent("combat-achievements:tier", tier);
  const fee = tier.currentThresholdMet === true ? HARD_PRIVATE_FEE : PRIVATE_FEE;
  if (inventory.getAmount(COINS) < fee) {
    player.getPacketSender().sendInterfaceRemoval();
    player.sendMessage(NO_FEE_MESSAGE(fee));
    return;
  }
  inventory.delete(COINS, fee);
  const area = new InstanceArea();
  const session = new Session(area, player, kind);
  area.session = session;
  Shared.sessions.add(session);
  for (const spawn of Shared.LOBBY_SPAWNS) {
    const npc = session.spawnNpc(spawn.id, [spawn.x, spawn.y], { radius: spawn.wanderRadius ?? 2 });
    session.npcs.delete(npc);
    session.lobby.push(npc);
  }
  session.setLoc(PRIVATE_FLAG_TILE, Shared.SCENERY_SHAPE, 0, Shared.LOC.FLAG_PRIVATE);
  session.setLoc(PRIVATE_ROCKSLIDE_TILE, Shared.SCENERY_SHAPE, 0, Shared.LOC.ROCKSLIDE_PRIVATE);
  Fight.newFight(session);
  intoPrivate(player, session);
}

function joinFriend(player, name) {
  const owner = core.World.getPlayerByName(String(name).trim());
  const session = owner ? Shared.sessionOfPlayer(owner) : null;
  if (!session || !session.isPrivate() || session.owner !== owner || session.kind !== "friends") {
    player.sendMessage(NO_FIGHT_MESSAGE);
    return;
  }
  if (!owner.getRelations().isFriendWith(player.getUsername())) {
    player.sendMessage(NOT_FRIENDS_MESSAGE);
    return;
  }
  if (session.members.size >= TEAM_LIMIT) {
    player.sendMessage(FULL_MESSAGE);
    return;
  }
  intoPrivate(player, session);
}

function askWhoseFight(player) {
  player.getPacketSender().sendInterfaceRemoval();
  player.setEnteredSyntaxAction({ execute: (name) => joinFriend(player, name) });
  player.getPacketSender().sendClientScript(NAME_INPUT_SCRIPT, JOIN_PROMPT);
}

function fightPrivately({ player }) {
  api.sendMultiChatboxPrompt(player, MENU_TITLE,
    MENU_OPTIONS[0], () => createPrivate(player, "friends"),
    MENU_OPTIONS[1], () => createPrivate(player, "solo"),
    MENU_OPTIONS[2], () => askWhoseFight(player),
    MENU_OPTIONS[3], () => player.getPacketSender().sendInterfaceRemoval());
  return true;
}

function leaveGroup({ player }) {
  const session = campSession(player);
  if (!session?.isPrivate()) return false;
  travel(player, () => {
    session.area.leave(player, false);
    player.moveTo(new core.Location(...Shared.PRIVATE_LANDING, 0));
  });
  return true;
}

/** A relog: back outside a private fight; the chain's state as their tile says. */
function recoverOnLogin({ player }) {
  if (player.getAttribute(Shared.INSIDE_PRIVATE_ATTRIBUTE) === true) {
    player.setAttribute(Shared.INSIDE_PRIVATE_ATTRIBUTE, false);
    player.moveTo(new core.Location(...Shared.PRIVATE_LANDING, 0));
  }
  if (player.getAttribute(TAALA_INTRO_ATTRIBUTE) === true) player.getPacketSender().sendVarbit(Shared.VARBIT.INTRO, 1);
  if (player.getAttribute(ENCOUNTERED_ATTRIBUTE) === true) player.getPacketSender().sendVarbit(Shared.VARBIT.ENCOUNTERED, 1);
  player.getPacketSender().sendVarbit(Shared.VARBIT.IN_AREA, publicSession?.inArena(player) ? 1 : 0);
}

/** The grave is left at the base camp (Wiki), outside a private fight. */
function graveAtCamp(request) {
  if (!Shared.sessionOfPlayer(request.player)) return;
  const [x, y] = Shared.CAMP_LANDING;
  request.tile = { x, y, z: 0 };
}

function countDeath({ player }) {
  if (!Shared.sessionOfPlayer(player)) return;
  player.setAttribute(Shared.DEATHS_ATTRIBUTE, Shared.counter(player, Shared.DEATHS_ATTRIBUTE) + 1);
  world.deaths += 1;
}

function startPublic() {
  publicSession = new Session(null);
  Shared.sessions.add(publicSession);
  Fight.newFight(publicSession);
}

function attach(pluginApi) {
  api = pluginApi;
  core = pluginApi.core;
  defineAreas();
  api.persistAttribute(Shared.DEATHS_ATTRIBUTE, 0);
  api.persistAttribute(Shared.INSIDE_PRIVATE_ATTRIBUTE, false);
  api.persistAttribute(TAALA_INTRO_ATTRIBUTE, false);
  api.persistAttribute(ENCOUNTERED_ATTRIBUTE, false);
  api.onServerStartup(startPublic);
  api.onObjectInteraction("Chain", { Climb: climb, "Quick-climb": quickClimb, Peek: peek });
  api.onObjectInteraction("Slope", { Slide: slideDown, "Quick-slide": quickSlide });
  api.onObjectRoute(slopeRoute);
  api.onObjectInteraction("Meeting flag", { "Fight-privately": fightPrivately });
  api.onObjectInteraction("Meeting flag (private)", { "Leave-group": leaveGroup });
  api.onObjectInteraction("Rockslide (private)", { "Leave-group": leaveGroup });
  api.onPlayerLogin(recoverOnLogin);
  api.onPlayerDeath(countDeath);
  api.onCustomEvent("gravestones:grave-location", graveAtCamp);
}

module.exports = { attach, world, TAALA_INTRO_ATTRIBUTE, campSession, _test: { PEEK_LINES, get InstanceArea() { return InstanceArea; } } };
