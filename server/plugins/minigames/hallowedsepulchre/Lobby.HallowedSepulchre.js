/**
 * The lobby under Darkmeyer: the Mausoleum Door in and the stairs back out, the stairs down (the Stranger's warning before his tutorial, the
 * recorded entry box and its "don't ask again"), the Mysterious Stranger's tutorial with the five
 * crystal shards, the crystal shards and the Hallowed token, and the obelisks at each floor's end.
 */
const Common = require("./Common.HallowedSepulchre");
const Run = require("./Run.HallowedSepulchre");

const STRANGER_IDS = [9806, 9639, 9640];
const SHARDS_GIVEN = 5;
/** Recorded: a shard's teleport lands 3 ticks after the cast. */
const SHARD_TICKS = 3;

function flag(player, name) {
  return player.getAttribute(Common.data.attributes[name]) === true;
}

function setFlag(player, name, varbitName) {
  player.setAttribute(Common.data.attributes[name], true);
  Common.varbit(player, varbitName, 1);
}

/** The Wiki: no way in without Sins of the Father. */
function questDone(player) {
  const request = { player, key: Common.data.quest, complete: null };
  Common.api.emitCustomEvent("quest:is-complete", request);
  return request.complete === true;
}

/** Climb-down on the lobby stairs. */
function climbDown({ player }) {
  if (Run.runOf(player)) return true;
  if (!questDone(player)) {
    player.sendMessage(Common.message("needQuest"));
    return true;
  }
  if (!flag(player, "tutorial")) {
    // Recorded (1862 T18955): before his tutorial the Stranger stops you going down.
    Common.npcChat(player, 9639, Common.message("strangerWait"));
    return true;
  }
  const { agility } = Common.data.floors[0];
  if (Common.level(player, "AGILITY") < agility) {
    player.sendMessage(Common.message("agilityLevelEnter", { level: agility }));
    return true;
  }
  if (flag(player, "entryCheck")) {
    Run.start(player);
    return true;
  }
  Common.box(player, Common.message("entryWarning"), () => {
    Common.menu(player, Common.message("entryQuestion"), [
      [Common.message("entryYes"), () => { Common.closeChat(player); Run.start(player, 0); }],
      [Common.message("entryAlways"), () => {
        Common.closeChat(player);
        setFlag(player, "entryCheck", "hallowed_entry_check");
        Run.start(player, 0);
      }],
      [Common.message("entryNo"), () => Common.closeChat(player)],
    ]);
  });
  return true;
}

/** The Stranger's tutorial; the first time it ends with five crystal shards. */
function talkTo({ player }) {
  const npc = 9639;
  const lines = Common.message("strangerTalk");
  Common.npcChat(player, npc, lines, () => {
    if (!flag(player, "tutorial")) setFlag(player, "tutorial", "hallowed_tutorial");
    if (flag(player, "shards")) return;
    setFlag(player, "shards", "hallowed_teleports_received");
    player.getInventory().adds(Common.data.items.shard, SHARDS_GIVEN);
    Common.itemBox(player, Common.data.items.shard, Common.message("strangerShards"));
  });
  return true;
}

/** Activate on a crystal shard: back to the lobby, ending a run; outside one the teleport rules apply. */
function activateShard(event) {
  const { player } = event;
  const { Animation, TeleportHandler, TeleportType } = Common.core;
  const run = Run.runOf(player);
  if (!run && !questDone(player)) {
    player.sendMessage(Common.message("needQuest"));
    return true;
  }
  const destination = Common.toLocation(Common.data.lobby.shardTile);
  if (!run && TeleportHandler?.checkReqs && !TeleportHandler.checkReqs(player, destination)) return true;
  player.getInventory().delete(Common.data.items.shard, 1);
  Common.animate(player, "castTeleport");
  Common.graphic(player, "teleportCasting", 92);
  player.getPacketSender().sendSound(Common.data.sounds.shardTeleport, 1, 0);
  player.getMovementQueue().reset();
  Common.later(SHARD_TICKS, () => {
    if (!player.isRegistered?.()) return;
    const current = Run.runOf(player);
    if (current) current.toLobby(Common.data.lobby.shardTile);
    else player.moveTo(destination);
    player.performAnimation(new Animation(-1));
    Common.song(player, "lobby");
  });
  return true;
}

/** Activate on a Hallowed token (Wiki): one more minute, inside and before the timer runs out. */
function activateToken({ player }) {
  const run = Run.runOf(player);
  if (!run) {
    player.sendMessage(Common.message("tokenOutside"));
    return true;
  }
  if (run.expired || run.remaining <= 1) {
    player.sendMessage(Common.message("tokenExpired"));
    return true;
  }
  player.getInventory().delete(Common.data.items.token, 1);
  run.addTime(Common.data.timer.token);
  player.sendMessage(Common.message("tokenUsed"));
  return true;
}

// ------------------------------------------------------------------ obelisks

/** Wearing another god's item (the Wiki: only Saradomin's followers may use the obelisks). */
function faithless(player) {
  const others = /\b(zamorak|guthix|armadyl|bandos|ancient|zaros)/i;
  for (const item of player.getEquipment().getItems?.() ?? []) {
    const name = item?.getId?.() > 0 ? Common.core.CacheDefinitions.getItem(item.getId())?.name : null;
    if (name && others.test(name)) return true;
  }
  return false;
}

/** Activate: recorded +1 pray, +3 the restore (or the refusal). */
function activateObelisk({ player }) {
  if (!Run.runOf(player)) return false;
  Common.later(1, () => Common.animate(player, "pray"));
  Common.later(3, () => {
    if (faithless(player)) {
      player.sendMessage(Common.message("obeliskFaithless"));
      return;
    }
    Common.graphic(player, "obelisk", 92);
    player.getPacketSender().sendSound(Common.data.sounds.obelisk, 1, 0);
    player.setRunEnergy?.(100);
    // The tick only sends energy while it is below full, so the full orb is sent here.
    player.getPacketSender().sendRunEnergy?.();
    player.sendMessage(Common.message("obeliskLoyal"));
  });
  return true;
}

/** Exit: "Are you sure you wish to leave?", then the floor credited if it was finished. */
function exit({ player }, credit = true) {
  const run = Run.runOf(player);
  if (!run) return false;
  if (run.transitioning) return true;
  Common.menu(player, Common.message("exitQuestion"), [
    [Common.message("exitYes"), () => {
      Common.closeChat(player);
      if (Run.runOf(player) === run && !run.transitioning) run.leave(credit && run.paused);
    }],
    [Common.message("exitNo"), () => Common.closeChat(player)],
  ]);
  return true;
}

/** Quick-exit: recorded with no menu, a tick later than Exit's Yes. */
function quickExit({ player }, credit = true) {
  const run = Run.runOf(player);
  if (!run) return false;
  if (run.transitioning) return true;
  run.transitioning = true;
  Common.later(1, () => {
    if (Run.runOf(player) !== run) return;
    run.transitioning = false;
    run.leave(credit && run.paused);
  });
  return true;
}

// ------------------------------------------------------------------ the way in and out

/** Players between the Mausoleum Door and the lobby (or back), so a second click does nothing. */
const passing = new WeakMap();

/** Within a tile of `from` on its plane: not teleported away meanwhile. */
function near(player, at, from) {
  return at.getZ() === from.getZ() && Math.max(Math.abs(at.getX() - from.getX()), Math.abs(at.getY() - from.getY())) <= 1;
}

/**
 * The Mausoleum Door in Darkmeyer (Enter) and the lobby's stairs up (Climb-up), as live
 * (rsprox.net 3050): +2 the fade out, +4 the move (facing north into the lobby, south out of the
 * mausoleum), the fade in 1 tick later going down and 2 going up, the fade closed 2 ticks after
 * that. The music is the area's. No quest check here: the lobby stairs down check Sins of the
 * Father.
 *
 * One task keyed to the player owns the passage, so logging out cancels it. It is checked every
 * tick. It holds movement until its own move and releases it only then (or when it is cancelled where it
 * started). It closes only the fade it opened, so a later fade or overlay stays.
 * Ours: dying, or being moved away by anything else (a teleport, a command) before the move,
 * abandons it there. The hold is given back only while MovementQueue's block generation is still
 * the one it took. A death, TeleportHandler or a cutscene's controls set the lock themselves, and
 * that newer hold stays.
 */
function pass(player, tile, fadeInAt, face) {
  if (passing.has(player)) return true;
  const steps = Common.data.mausoleum;
  const { Task, TaskManager } = Common.core;
  const queue = player.getMovementQueue();
  const from = player.getLocation();
  const landing = Common.toLocation(tile);
  const sender = () => player.getPacketSender();
  const end = fadeInAt + steps.fadeCloseAfter;
  let mount = null;
  let moved = false;
  let locked = true;
  let done = false;

  /** Ours to close only while it is still the one mounted. */
  const closeOwn = () => {
    if (mount) sender().closeSubInterfaceMount(mount);
    mount = null;
  };
  let generation;
  /** The hold is still ours only if nothing has set or cleared it since we took it. */
  const unlock = () => {
    if (locked && queue.getBlockMovementGeneration?.() === generation) queue.setBlockMovement?.(false);
    locked = false;
  };
  const alive = () => player.isRegistered?.() !== false && player.isDyingReturn?.() !== true;
  /** Still where the passage left them: by the door before the move, at the landing after. */
  const inPlace = () => near(player, player.getLocation(), moved ? landing : from);
  const ownFade = () => mount !== null && sender().getSubInterfaceAt?.(mount.targetUid) === mount;

  const task = new (class extends Task {
    constructor() {
      super(1, player, false);
      this.elapsed = 0;
    }
    execute() {
      this.elapsed++;
      if (!alive() || !inPlace()) {
        // Displaced or dying: not moved; our hold goes only if nothing else has taken it since.
        if (player.isRegistered?.() !== false) {
          if (player.isDyingReturn?.() !== true) unlock();
          closeOwn();
        }
        locked = false;
        return this.stop();
      }
      if (this.elapsed === steps.fadeOutAt) mount = Common.fade(player, true);
      if (this.elapsed === steps.moveAt) {
        player.moveTo(landing);
        player.setPositionToFace?.(Common.toLocation([tile[0], tile[1] + face, tile[2]]));
        moved = true;
        unlock();
        passing.delete(player);
      }
      if (this.elapsed === fadeInAt) {
        // A fade or overlay opened over ours since is not overwritten.
        if (!ownFade()) return this.stop();
        mount = Common.fade(player, false);
      }
      if (this.elapsed >= end) {
        closeOwn();
        this.stop();
      }
    }
    stop() {
      super.stop();
      if (done) return;
      done = true;
      if (passing.get(player) === token) passing.delete(player);
      // Cancelled (a logout) before the move: give back the hold if it is still ours.
      if (!moved && alive()) unlock();
    }
  })();
  const token = task;
  passing.set(player, token);
  queue.reset();
  queue.setBlockMovement?.(true);
  generation = queue.getBlockMovementGeneration?.();
  TaskManager.submit(task);
  return true;
}

/** Enter on the Mausoleum Door: down to the lobby. */
function enterMausoleum({ player }) {
  const { lobbyTile, doorFadeInAt } = Common.data.mausoleum;
  return pass(player, lobbyTile, doorFadeInAt, 1);
}

/** Climb-up on the lobby's stairs: back out into Darkmeyer. */
function climbToDarkmeyer({ player }) {
  if (Run.runOf(player)) return false;
  const { darkmeyerTile, stairsFadeInAt } = Common.data.mausoleum;
  return pass(player, darkmeyerTile, stairsFadeInAt, -1);
}

/** The lobby varbits the client needs from login: the Stranger's ops, the entry box, the PBs. */
function restoreVarbits({ player }) {
  if (flag(player, "tutorial")) Common.varbit(player, "hallowed_tutorial", 1);
  if (flag(player, "entryCheck")) Common.varbit(player, "hallowed_entry_check", 1);
  if (flag(player, "shards")) Common.varbit(player, "hallowed_teleports_received", 1);
  const pbs = Common.record(player, "pbs");
  for (const [floor, varbit] of Object.entries(Common.data.pbVarbits)) {
    if (pbs[floor] != null) player.getPacketSender().sendVarbit(varbit, pbs[floor]);
  }
  const chests = player.getAttribute(Common.data.attributes.chests);
  if (chests) Common.varbit(player, "hallowed_normal_chest_count", chests);
}

function attachLobby(api) {
  api.onObjectClick(Common.data.lobby.stairs, 1, climbDown);
  api.onObjectClick(Common.data.mausoleum.door, 1, enterMausoleum);
  api.onObjectClick(Common.data.mausoleum.stairs, 1, climbToDarkmeyer);
  api.onNpcClick(STRANGER_IDS, 1, talkTo);
  api.onItemAction("Hallowed crystal shard", { Activate: activateShard });
  api.onItemAction("Hallowed token", { Activate: activateToken });
  api.onObjectClick(Common.data.obelisk, 1, activateObelisk);
  api.onObjectClick(Common.data.obelisk, 2, (event) => exit(event));
  api.onObjectClick(Common.data.obelisk, 3, (event) => quickExit(event));
  // The stairs back up at each floor's start (hallowed_stairs_return, not recorded): the same
  // way out, crediting nothing.
  api.onObjectClick(Common.data.returnStairs, 1, (event) => exit(event, false));
  api.onObjectClick(Common.data.returnStairs, 2, (event) => quickExit(event, false));
  api.onPlayerLogin(restoreVarbits);
}

module.exports = { attachLobby, faithless };
