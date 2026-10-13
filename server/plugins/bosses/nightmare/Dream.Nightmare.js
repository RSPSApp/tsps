/**
 * The Nightmare's dream: an instance copied from the arena (Common.data.instance), as captured.
 *
 * The Nightmare's own is shared: the first player to Disturb her sleeping body starts it and its
 * countdown, and anyone else may join until she wakes (Wiki); then it is closed until the fight
 * ends. Phosani's is the player's own, through the Pool of Nightmares. The trip in, as captured: a
 * warning and "Are you sure you wish to begin?" (skipped after "Yes, and don't ask again."), then
 * the player falls asleep behind a fade, wakes in the dream three ticks later, and the message
 * box waits for them. The barriers lead out the same way ("You pull yourself out of the dream.").
 *
 * Leaving any way - the barrier, a teleport, death, logging out - takes the player out of the
 * dream; the last one out ends it. A death wakes the player by the Pool of Nightmares, and their
 * items stay with Shura or Sister Senga (Retrieval.Nightmare).
 */
const Common = require("./Common.Nightmare");

/** Every dream there is, and The Nightmare's shared one while it takes players. */
const dreams = new Set();
let shared = null;

let AreaClass = null;

function areaClass() {
  if (AreaClass) return AreaClass;
  const { TemplatedInstanceArea } = Common.core;
  AreaClass = class NightmareDream extends TemplatedInstanceArea {
    constructor() {
      const { width, height } = Common.data.instance;
      super(width, height);
      this.dream = null;
    }

    getName() {
      return this.dream?.phosani ? "Phosani's Nightmare" : "The Nightmare";
    }

    isMulti() {
      return true;
    }

    allowSummonPet() {
      return false;
    }

    /** Everything spawned for the fight goes with it. */
    destroy() {
      if (this.isDestroyed()) return;
      for (const entity of [...this.entities]) {
        if (!entity.isNpc?.()) continue;
        this.detach(entity);
        Common.api.removeNpc(entity);
      }
      super.destroy();
    }

    /** A player logging out is put back in the sanctuary before they're saved. */
    postLeave(mobile, logout) {
      const dream = this.dream;
      const player = mobile.isPlayer?.() ? mobile.getAsPlayer() : null;
      if (player && dream?.players.has(player)) {
        if (logout) player.setLocation(Common.toLocation(dream.exitTile()));
        dream.removePlayer(player);
      }
      super.postLeave(mobile, logout);
    }

    process(mobile) {
      if (mobile.isPlayer?.()) this.dream?.fight?.processPlayer(mobile.getAsPlayer());
    }
  };
  return AreaClass;
}

class Dream {
  constructor(phosani) {
    this.phosani = phosani;
    this.area = new (areaClass())();
    this.area.dream = this;
    this.players = new Set();
    this.fight = null;
    this.ended = false;
    this.copyArena();
    dreams.add(this);
  }

  copyArena() {
    const { sourceChunkX, sourceChunkY, width, height } = Common.data.instance;
    for (let plane = 0; plane < 4; plane++) {
      for (let x = 0; x < width; x++) {
        for (let y = 0; y < height; y++) {
          this.area.setChunk(plane, x, y, { sourceChunkX: sourceChunkX + x, sourceChunkY: sourceChunkY + y, sourcePlane: plane, rotation: 0 });
        }
      }
    }
  }

  /** The dream's copy of an arena tile. */
  tile([x, y, z]) {
    const { sourceChunkX, sourceChunkY } = Common.data.instance;
    return this.area.tile(x - sourceChunkX * Common.CHUNK, y - sourceChunkY * Common.CHUNK, z ?? Common.data.arena.plane);
  }

  /** The arena tile a dream tile copies, as [x, y]. */
  arenaTile(location) {
    const { sourceChunkX, sourceChunkY } = Common.data.instance;
    return [location.getX() - this.area.getBaseX() + sourceChunkX * Common.CHUNK, location.getY() - this.area.getBaseY() + sourceChunkY * Common.CHUNK];
  }

  exitTile() {
    return this.phosani ? Common.data.lobby.phosaniExit : Common.data.lobby.exit;
  }

  /** Players in the dream who are still alive and in it. */
  present() {
    return [...this.players].filter((player) => player.isRegistered() && player.getArea?.() === this.area);
  }

  /** An NPC of the dream's, gone with it. */
  spawn(id, tile, { face = 0 } = {}) {
    const at = this.tile(tile);
    // No owner: an owned NPC may only be fought by its owner, and The Nightmare's dream is shared.
    const npc = Common.api.spawnNpc({ id, x: at.getX(), y: at.getY(), z: at.getZ(), wanderRadius: 0, face });
    if (!npc) return null;
    npc.__skipDefaultRespawn = true;
    npc.__nightmareDream = this;
    this.area.add(npc);
    return npc;
  }

  addPlayer(player) {
    this.players.add(player);
    player.setAttribute(Common.INSIDE_ATTRIBUTE, true);
  }

  removePlayer(player) {
    if (!this.players.delete(player)) return;
    player.setAttribute(Common.INSIDE_ATTRIBUTE, null);
    const sender = player.getPacketSender();
    sender.sendVarbit(Common.data.varbits.multiway, 0);
    if (this.phosani) sender.sendVarbit(Common.data.varbits.inPhosani, 0);
    this.fight?.playerLeft(player);
    if (this.players.size === 0) this.end();
  }

  end() {
    if (this.ended) return;
    this.ended = true;
    dreams.delete(this);
    if (shared === this) shared = null;
    this.fight?.stop();
    this.fight = null;
    if (!this.area.isDestroyed()) this.area.destroy();
  }

  /** Whether more players may come into this dream. */
  joinable() {
    return !this.ended && !this.phosani && (!this.fight || this.fight.state === "waiting");
  }
}

const dreamOf = (player) => {
  for (const dream of dreams) if (dream.players.has(player)) return dream;
  return null;
};

// ------------------------------------------------------------------ the trip in and out

/**
 * The captured trip: asleep behind a fade where they stand, moved in on the third tick and
 * woken, the fade lifting a tick later and the message box waiting to be continued.
 */
function pullIn(player, dream) {
  const { entry, varbits } = Common.data;
  const sender = player.getPacketSender();
  const message = dream.phosani ? entry.phosaniPulled : entry.pulled;
  player.getMovementQueue().reset();
  sender.sendVarbit(varbits.busy, 1);
  sender.sendVarbit(dream.phosani ? varbits.phosaniFirstEntry : varbits.firstEntry, 1);
  require("./Sanctuary.Nightmare").enteredDream(player, dream.phosani);
  if (dream.phosani) sender.sendVarbit(varbits.inPhosani, 1);
  player.performAnimation(Common.animation(entry.sleepAnim));
  Common.sounds(player, [entry.sleepSound]);
  Common.fade(player, entry.fadeOut);
  Common.core.StatementDialogue.send(player, message, false);
  Common.later(1, () => player.isRegistered() && sender.sendVarbit(varbits.minimap, 2));
  Common.later(entry.moveTicks, () => {
    if (!player.isRegistered() || dream.ended) return;
    dream.addPlayer(player);
    dream.area.enter(player);
    player.moveTo(dream.tile(Common.data.arena.arrival));
    player.performAnimation(Common.animation(entry.wakeAnim));
    Common.later(1, () => {
      if (!player.isRegistered()) return;
      sender.sendVarbit(varbits.multiway, 1);
      sender.sendVarbit(varbits.minimap, 0);
      Common.sounds(player, [entry.wakeSound]);
      Common.fade(player, entry.fadeIn);
      Common.api.emitCustomEvent("music:unlock-track", { player, trackId: Common.data.music.fight });
      const { DialogueChainBuilder, StatementDialogue, ActionDialogue } = Common.core;
      player.getDialogueManager().startDialogues(new DialogueChainBuilder().add(
        new StatementDialogue(0, message),
        new ActionDialogue(1, { execute: () => player.getPacketSender().sendInterfaceRemoval() }),
      ));
      Common.later(1, () => {
        if (!player.isRegistered()) return;
        sender.sendVarbit(varbits.busy, 0);
        Common.closeFade(player);
      });
      dream.fight?.playerArrived(player);
    });
  });
}

/** "Yes, and don't ask again." remembers the answer (`skipKey`). */
function confirm(player, warning, { question, options }, skipKey, proceed) {
  if (player.getAttribute(skipKey)) {
    proceed();
    return;
  }
  const { DialogueChainBuilder, StatementDialogue, ActionDialogue } = Common.core;
  const ask = () => Common.api.sendMultiChatboxPrompt(player, question,
    options[0], () => proceed(),
    options[1], () => {
      player.setAttribute(skipKey, true);
      proceed();
    },
    options[2], () => player.getPacketSender().sendInterfaceRemoval());
  if (!warning) {
    ask();
    return;
  }
  player.getDialogueManager().startDialogues(new DialogueChainBuilder().add(
    new StatementDialogue(0, warning),
    new ActionDialogue(1, { execute: ask }),
  ));
}

/** Out by the barrier (or at the end of a fight): the captured portal overlay, then the lobby. */
function leave(player) {
  const dream = dreamOf(player);
  if (!dream) return;
  const { leave: out, varbits } = Common.data;
  const sender = player.getPacketSender();
  player.getMovementQueue().reset();
  sender.sendVarbit(varbits.busy, 1);
  sender.sendVarbit(varbits.minimap, 2);
  Common.sounds(player, [out.sound]);
  sender.sendSubInterface((161 << 16) | 1, out.portalOverlay, 1, {
    postScripts: [{ scriptId: out.portalScript, args: [(out.portalOverlay << 16) | 1, (out.portalOverlay << 16) | 2, ...out.portalArgs] }],
  });
  Common.core.StatementDialogue.send(player, out.message, false);
  Common.later(out.moveTicks, () => {
    if (!player.isRegistered()) return;
    const tile = dream.exitTile();
    player.moveTo(Common.toLocation(tile));
    dream.removePlayer(player);
    player.performAnimation(Common.animation(Common.data.entry.wakeAnim));
    sender.sendVarbit(varbits.minimap, 0);
    sender.sendSong(Common.data.music.lobby);
    Common.later(1, () => {
      if (!player.isRegistered()) return;
      sender.sendClientScript(out.portalRemoveScript, (out.portalOverlay << 16) | 1, (out.portalOverlay << 16) | 2, ...out.portalRemoveArgs);
      sender.sendVarbit(varbits.busy, 0);
      sender.sendInterfaceRemoval();
    });
  });
}

// ------------------------------------------------------------------ hooks

/** Disturb on her sleeping body: into The Nightmare's shared dream. */
function disturb(event) {
  const { player, npc } = event;
  if (npc?.__nightmareFight) return require("./Fight.Nightmare").disturbBody(event);
  if (dreamOf(player)) return true;
  if (shared && !shared.joinable()) {
    player.sendMessage(Common.data.entry.inProgress);
    return true;
  }
  const { entry } = Common.data;
  confirm(player, entry.warning, entry, Common.SKIP_WARNING_ATTRIBUTE, () => {
    player.getPacketSender().sendInterfaceRemoval();
    if (shared && !shared.joinable()) {
      player.sendMessage(entry.inProgress);
      return;
    }
    if (!shared) {
      shared = new Dream(false);
      require("./Fight.Nightmare").open(shared);
    }
    pullIn(player, shared);
  });
  return true;
}

/** Drink-from on the Pool of Nightmares: into Phosani's dream, the player's own. */
function drinkFromPool(player) {
  if (dreamOf(player)) return;
  const { entry } = Common.data;
  confirm(player, entry.phosaniWarning, entry, Common.PHOSANI_SKIP_WARNING_ATTRIBUTE, () => {
    player.getPacketSender().sendInterfaceRemoval();
    if (dreamOf(player)) return;
    const dream = new Dream(true);
    require("./Fight.Nightmare").open(dream);
    pullIn(player, dream);
  });
}

/** The barriers: Pass-through once she sleeps, Escape during the fight (asked first). */
function passBarrier({ player }) {
  const dream = dreamOf(player);
  if (!dream) return false;
  confirm(player, null, Common.data.leave, Common.SKIP_LEAVE_WARNING_ATTRIBUTE, () => leave(player));
  return true;
}

/** A player saved inside (the server stopped while they were in) comes back in the sanctuary. */
function recoverOnLogin({ player }) {
  if (!player.getAttribute(Common.INSIDE_ATTRIBUTE) || dreamOf(player)) return;
  player.setAttribute(Common.INSIDE_ATTRIBUTE, null);
  player.moveTo(Common.toLocation(Common.data.lobby.exit));
}

/** A death in the dream wakes the player by the Pool of Nightmares (Wiki, August 2025). */
function wakeByPool(event) {
  const dream = dreamOf(event.player);
  if (!dream) return;
  const { player } = event;
  player.moveTo(Common.toLocation(Common.data.lobby.respawn));
  dream.removePlayer(player);
  require("./Retrieval.Nightmare").announce(player);
  event.handled = true;
}

function attachDream(api) {
  api.persistAttribute(Common.INSIDE_ATTRIBUTE);
  api.persistAttribute(Common.SKIP_WARNING_ATTRIBUTE);
  api.persistAttribute(Common.PHOSANI_SKIP_WARNING_ATTRIBUTE);
  api.persistAttribute(Common.SKIP_LEAVE_WARNING_ATTRIBUTE);
  api.onPlayerLogin(recoverOnLogin);
  api.onNpcInteraction("The Nightmare", { Disturb: disturb });
  api.onObjectInteraction("Energy Barrier", { "Pass-through": passBarrier, Escape: passBarrier });
  api.onPlayerDeath(wakeByPool);
}

module.exports = { attachDream, dreamOf, drinkFromPool, leave, Dream };
