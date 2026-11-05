/**
 * Scurrius' lair in the Varrock Sewers, as captured (docs/scurrius.md):
 * - the broken bars: "Climb-through (normal)" into the public lair with its 1500-hitpoint
 *   Scurrius, "Climb-through (private)" into an instance of the player's own with the 500-hitpoint
 *   one, both asking first until "Yes, and don't ask again." (varbit 9589); "Peek" counts the
 *   players inside;
 * - the sewage water: "Cross" (with a thinking emote) or "Quick-escape" back out;
 * - each way through fades out, moves the player and fades back in, with the lair's song (Oh
 *   Rats!) inside and the sewers' (Scape Cave) outside, and leaving keeps the player out for
 *   about 15 seconds ("You are exhausted after climbing over the broken bars...");
 * - no fires in the lair (Wiki), and a death there leaves the grave beside Historian Aldo;
 * - the boss health HUD shows the room's Scurrius while the player is inside;
 * - Scurrius appears with his spawn animation and attacks four ticks later; a kill brings the
 *   next one 30 ticks after he is gone (Wiki respawn, captured 29-30).
 *
 * The lair is an Area (players in it only); a private instance is a PrivateArea over the same
 * tiles, and leaving it (the exit, a teleport, death, logging out) ends it with its NPCs.
 */
const Common = require("./Common.Scurrius");
const Fight = require("./Fight.Scurrius");

const { ANIM, MUSIC, SOUND } = Common;

/** Cache varbit rat_boss_enter_warning: 1 skips the question at the bars. */
const WARNING_VARBIT = 9589;
const SKIP_WARNING_ATTRIBUTE = "scurrius:skip-warning";
/** Set while the player is in a private instance, so a login there puts them outside. */
const INSTANCE_ATTRIBUTE = "scurrius:in-instance";
/** Generic engine flag: a scripted arena keeps its NPC on its target however far it moves from spawn. */
const NO_RETREAT_FLAG = "combat:no-retreat";

const BUSY_VARBIT = 12393;
const MINIMAP_STATE_VARBIT = 6719;
const MINIMAP_OFF = 2;
const OVERLAY_ATMOSPHERE_UID = (161 << 16) | 1;
const FADE_OVERLAY = 174;
const FADE_SCRIPT = 948;
const FADE_CYCLES = 50;

/** Cache sequences: human_reachforladder at the bars, emote_think at the water. */
const CLIMB_ANIM = 828;
const THINK_ANIM = 857;

/**
 * Captured timings, in ticks from the action: the fade out, the minimap off, the move, the fade
 * back in (with the song and the HUD), and the overlay closed.
 */
const ENTER_STEPS = Object.freeze({ minimap: 1, move: 3, fadeIn: 4, close: 6 });
const CROSS_STEPS = Object.freeze({ minimap: 1, move: 2, fadeIn: 4, close: 6 });
const ESCAPE_STEPS = Object.freeze({ minimap: 1, move: 2, fadeIn: 4, close: 6 });

/** Captured (three recordings): after the move out, the bars refuse the player for 26 ticks (Wiki: about 15 seconds). */
const REENTRY_TICKS = 26;
/** When the player last came out over the sewage water (game tick). */
const LEFT_AT_ATTRIBUTE = "scurrius:left-at";
/** Wiki: graves of deaths in the lair appear next to Historian Aldo (tile estimated). */
const GRAVE_TILE = Object.freeze({ x: 3276, y: 9871, z: 0 });
const DAMP_MESSAGE = "It's far too damp for you to light a fire here.";

/** Captured: the first attack (and the boss HUD) comes four ticks after the spawn. */
const ARM_TICKS = 4;
/** Captured (live, rev 241): the next Scurrius 29 ticks after the last one is gone, in 5 of 5 kills. */
const RESPAWN_TICKS = 29;
/** Captured: the HUD starts fading 4 ticks after he is gone (and clears 4 ticks after that). */
const HUD_LINGER_TICKS = 4;
/** Captured questions at the bars. */
const ENTER_PROMPT = {
  normal: "Are you sure you want to climb through the broken bars? (normal)",
  private: "Are you sure you want to climb through the broken bars? (private)",
};

let api = null;
let core = null;
let LairArea = null;
let InstanceArea = null;
let lair = null;
/** The public lair's boss (null while it respawns). */
let publicBoss = null;
/** player -> { npc, current } for each HUD on show. */
const huds = new Map();

function fade(player, out) {
  const args = out ? [0, 255, 0, 0, FADE_CYCLES] : [0, 0, 0, 255, FADE_CYCLES];
  player.getPacketSender().sendSubInterface(OVERLAY_ATMOSPHERE_UID, FADE_OVERLAY, 1, { postScripts: [{ scriptId: FADE_SCRIPT, args }] });
}

/** The captured way through: fade, minimap off, move, fade in; `arrive` runs on the fade in. */
function travel(player, steps, to, { anim = null, sound = null, onMove = null, arrive = null } = {}) {
  const sender = player.getPacketSender();
  const movement = player.getMovementQueue();
  movement.reset().setBlockMovement(true);
  if (anim != null) player.performAnimation(new core.Animation(anim));
  if (sound != null) sender.sendSound(sound, 1, 0);
  sender.sendVarbit(BUSY_VARBIT, 1);
  hideHud(player);
  fade(player, true);
  const alive = () => player.isRegistered?.() !== false;
  Common.later(steps.minimap, () => alive() && sender.sendVarbit(MINIMAP_STATE_VARBIT, MINIMAP_OFF));
  Common.later(steps.move, () => {
    if (!alive()) return;
    player.moveTo(Common.location(to));
    onMove?.();
  });
  Common.later(steps.fadeIn, () => {
    if (!alive()) return;
    movement.setBlockMovement(false);
    sender.sendVarbit(MINIMAP_STATE_VARBIT, 0).sendVarbit(BUSY_VARBIT, 0);
    fade(player, false);
    arrive?.();
  });
  Common.later(steps.close, () => alive() && sender.closeSubInterface(OVERLAY_ATMOSPHERE_UID));
}

// ------------------------------------------------------------------ the HUD

function bossFor(player) {
  const area = player.getPrivateArea?.() ?? null;
  return area instanceof InstanceArea ? area.boss : publicBoss;
}

function hudValues(player, npc) {
  return { player, npcId: npc.getId(), current: Math.max(0, npc.getHitpoints()), maximum: npc.getDefinition().getHitpoints() };
}

/** Keeps the player's HUD on their room's Scurrius; called each tick they are inside. */
function syncHud(player) {
  const npc = bossFor(player);
  const shown = huds.get(player);
  const now = core.World.getProcessCycle();
  const alive = npc != null && npc.isRegistered?.() !== false && !player.getMovementQueue().isMovementBlocked();
  if (!alive) {
    if (!shown) return;
    shown.goneAt ??= now;
    if (npc != null || now - shown.goneAt >= HUD_LINGER_TICKS) hideHud(player, true);
    return;
  }
  if (now < (npc.__scurriusArmedAt ?? 0)) return;
  if (!shown || shown.npc !== npc) {
    const values = hudValues(player, npc);
    huds.set(player, { npc, current: values.current });
    api.emitCustomEvent("boss-hud:show", values);
    return;
  }
  const current = Math.max(0, npc.getHitpoints());
  if (current === shown.current) return;
  shown.current = current;
  api.emitCustomEvent("boss-hud:update", { player, current });
}

function hideHud(player, fadeOut = false) {
  if (!huds.delete(player)) return;
  api.emitCustomEvent("boss-hud:hide", fadeOut ? { player } : { player, fade: false, afterTicks: 0 });
}

// --------------------------------------------------------------- the bosses

/** The public lair's Scurrius: one at a time, however its respawn is reached. */
const PUBLIC_UNIQUE_KEY = "scurrius:public";

function spawnBoss(id, area) {
  const [x, y, z] = Common.SPAWN_TILE;
  const unique = area ? undefined : PUBLIC_UNIQUE_KEY;
  const npc = api.spawnNpc({ id, x, y, z, wanderRadius: 0, unique });
  if (!npc) return null;
  npc.setFace(core.Direction.SOUTH);
  npc.__skipDefaultRespawn = true;
  npc.__scurriusArmedAt = core.World.getProcessCycle() + ARM_TICKS;
  npc.setMultiCombat?.(true);
  // The public lair is a scripted arena, like a God Wars chamber: Scurrius fights the room,
  // not the few tiles open-world hunting covers. Between feeding rounds he swipes from melee
  // reach, so the spawn aggression range would otherwise drop a player still in the room.
  // A private instance is already exempt as a PrivateArea. Exits and the death/respawn cycle
  // keep their own handling: a player who leaves stops being a valid target, and no-retreat
  // never overrides target validity or the unreachable-target release.
  if (!area) npc.setFlag(NO_RETREAT_FLAG, true);
  if (area) {
    area.add(npc);
    area.boss = npc;
  }
  Fight.reset(npc);
  npc.performAnimation(new core.Animation(ANIM.spawn));
  return npc;
}

function spawnPublicBoss() {
  publicBoss = spawnBoss(Common.PUBLIC_ID, null) ?? publicBoss;
}

/** A kill: the next Scurrius 30 ticks after this one is gone. */
function onBossDeath({ npc }) {
  if (!Common.isScurrius(npc)) return;
  const area = npc.getPrivateArea?.() ?? null;
  if (area instanceof InstanceArea) {
    if (area.boss !== npc) return;
    area.boss = null;
    area.respawn = Common.later(RESPAWN_TICKS, () => {
      if (area.isDestroyed?.() !== true && area.getPlayers().length > 0) spawnBoss(Common.SOLO_ID, area);
    });
    return;
  }
  if (npc !== publicBoss) return;
  publicBoss = null;
  Common.later(RESPAWN_TICKS, spawnPublicBoss);
}

/** He (and his rats) go for anyone in the room, once he has finished appearing. */
function aggressive(player, npc) {
  if (Common.isRat(npc)) return true;
  if (!Common.isScurrius(npc)) return null;
  return core.World.getProcessCycle() >= (npc.__scurriusArmedAt ?? 0);
}

// ---------------------------------------------------------------- the areas

function defineAreas() {
  const { Area, PrivateArea, Boundary } = core;
  const boundary = () => new Boundary(Common.LAIR.minX, Common.LAIR.maxX, Common.LAIR.minY, Common.LAIR.maxY, 0);

  LairArea = class ScurriusLair extends Area {
    constructor() {
      super([boundary()]);
    }

    getName() {
      return "Scurrius' Lair";
    }

    isMulti() {
      return true;
    }

    process(mobile) {
      if (mobile.isPlayer?.()) syncHud(mobile.getAsPlayer());
    }

    postLeave(mobile) {
      if (mobile.isPlayer?.()) hideHud(mobile.getAsPlayer());
    }

    npcAggression(player, npc) {
      return aggressive(player, npc);
    }
  };

  InstanceArea = class ScurriusInstance extends PrivateArea {
    constructor(owner) {
      super([boundary()]);
      this.owner = owner;
      this.boss = null;
      this.respawn = null;
    }

    getName() {
      return "Scurrius' Lair";
    }

    isMulti() {
      return true;
    }

    process(mobile) {
      if (mobile.isPlayer?.()) syncHud(mobile.getAsPlayer());
    }

    npcAggression(player, npc) {
      return aggressive(player, npc);
    }

    /** Leaving, teleporting, dying or logging out ends the instance. */
    postLeave(mobile, logout) {
      if (mobile.isPlayer?.()) {
        const player = mobile.getAsPlayer();
        hideHud(player);
        player.setAttribute(INSTANCE_ATTRIBUTE, logout === true);
      }
      super.postLeave(mobile, logout);
      if (this.getPlayers().length === 0 || this.isDestroyed?.()) this.respawn?.stop();
    }
  };
}

// ------------------------------------------------------------- the entrance

function skipsWarning(player) {
  return player.getAttribute(SKIP_WARNING_ATTRIBUTE) === true;
}

function enter(player, mode) {
  player.getPacketSender().sendInterfaceRemoval();
  const solo = mode === "private";
  let instance = null;
  travel(player, ENTER_STEPS, Common.INSIDE_TILE, {
    anim: CLIMB_ANIM,
    sound: SOUND.climb,
    onMove: () => {
      if (!solo) return;
      // The instance and its Scurrius appear with the move, as captured.
      instance = new InstanceArea(player);
      instance.enter(player);
      player.setAttribute(INSTANCE_ATTRIBUTE, true);
      spawnBoss(Common.SOLO_ID, instance);
    },
    arrive: () => player.getPacketSender().sendSong(MUSIC.lair),
  });
}

/** Captured countdown: whole seconds left, rounded down, and "another second" for the last one. */
function exhaustedText(ticksLeft) {
  const seconds = Math.floor(ticksLeft * 0.6);
  return seconds <= 1
    ? "You are exhausted after climbing over the broken bars. Please wait for another second."
    : `You are exhausted after climbing over the broken bars. Please wait for another ${seconds} seconds.`;
}

function climbThrough(player, mode) {
  const leftAt = Number(player.getAttribute(LEFT_AT_ATTRIBUTE));
  const ticksLeft = Number.isFinite(leftAt) ? leftAt + REENTRY_TICKS - core.World.getProcessCycle() : 0;
  if (ticksLeft > 0) {
    player.sendMessage(exhaustedText(ticksLeft));
    return;
  }
  if (skipsWarning(player)) {
    enter(player, mode);
    return;
  }
  api.sendMultiChatboxPrompt(
    player,
    ENTER_PROMPT[mode],
    "Yes.", () => enter(player, mode),
    "Yes, and don't ask again.", () => {
      player.setAttribute(SKIP_WARNING_ATTRIBUTE, true);
      player.getPacketSender().sendVarbit(WARNING_VARBIT, 1);
      enter(player, mode);
    },
    "No.", () => player.getPacketSender().sendInterfaceRemoval(),
  );
}

function climbNormal({ player }) {
  climbThrough(player, "normal");
  return true;
}

function climbPrivate({ player }) {
  climbThrough(player, "private");
  return true;
}

/** Captured with nobody inside; the count follows the other bosses' Peek lines. */
function peekText(count) {
  if (count === 0) return "There are no adventurers through the broken bars.";
  return count === 1 ? "There is 1 adventurer through the broken bars." : `There are ${count} adventurers through the broken bars.`;
}

function peek({ player }) {
  const count = lair.getPlayers().filter((other) => Common.inLair(other.getLocation())).length;
  const { DialogueChainBuilder, StatementDialogue } = core;
  player.getDialogueManager().startDialogues(new DialogueChainBuilder().add(new StatementDialogue(0, peekText(count))));
  return true;
}

// ---------------------------------------------------------------- the exit

function leave(player, steps, anim) {
  travel(player, steps, Common.OUTSIDE_TILE, {
    anim,
    sound: anim != null ? SOUND.climb : null,
    onMove: () => player.setAttribute(LEFT_AT_ATTRIBUTE, core.World.getProcessCycle()),
    arrive: () => player.getPacketSender().sendSong(MUSIC.sewers),
  });
}

function refuseFire(request) {
  if (!Common.inLair(request.location)) return;
  request.allowed = false;
  request.message = DAMP_MESSAGE;
}

function graveBesideAldo(request) {
  if (Common.inLair(request.location)) request.tile = { ...GRAVE_TILE };
}

function cross({ player }) {
  leave(player, CROSS_STEPS, THINK_ANIM);
  return true;
}

function quickEscape({ player }) {
  leave(player, ESCAPE_STEPS, null);
  return true;
}

/** The warning's setting, and a player who logged out in an instance put back outside. */
function onLogin({ player }) {
  if (skipsWarning(player)) player.getPacketSender().sendVarbit(WARNING_VARBIT, 1);
  if (player.getAttribute(INSTANCE_ATTRIBUTE) === true) {
    player.setAttribute(INSTANCE_ATTRIBUTE, false);
    if (Common.inLair(player.getLocation())) player.moveTo(Common.location(Common.OUTSIDE_TILE));
  }
}

function attach(pluginApi) {
  api = pluginApi;
  core = pluginApi.core;
  defineAreas();
  lair = new LairArea();
  pluginApi.persistAttribute(SKIP_WARNING_ATTRIBUTE, false);
  pluginApi.persistAttribute(INSTANCE_ATTRIBUTE, false);
  pluginApi.registerArea(lair);
  pluginApi.onServerStartup(spawnPublicBoss);
  pluginApi.onPlayerLogin(onLogin);
  pluginApi.onNpcDeath(onBossDeath);
  pluginApi.onObjectInteraction("Broken bars", {
    "Climb-through (normal)": climbNormal,
    "Climb-through (private)": climbPrivate,
    "Peek (normal)": peek,
  });
  pluginApi.onObjectInteraction("Sewage water", { Cross: cross, "Quick-escape": quickEscape });
  pluginApi.onCustomEvent("firemaking:can-light", refuseFire);
  pluginApi.onCustomEvent("gravestones:grave-location", graveBesideAldo);
}

module.exports = {
  attach,
  get publicBoss() { return publicBoss; },
  _test: {
    WARNING_VARBIT, SKIP_WARNING_ATTRIBUTE, INSTANCE_ATTRIBUTE, ENTER_PROMPT, huds,
    REENTRY_TICKS, RESPAWN_TICKS, HUD_LINGER_TICKS, LEFT_AT_ATTRIBUTE, GRAVE_TILE, DAMP_MESSAGE, exhaustedText, refuseFire, graveBesideAldo,
    peekText, climbThrough, enter, cross, quickEscape, onLogin, onBossDeath, spawnPublicBoss, spawnBoss,
    syncHud, aggressive,
    instanceClass: () => InstanceArea,
    lair: () => lair,
  },
};
