/**
 * Private fights: Pass (private) on the Ancient Barrier, as captured (docs/nex.md):
 * - "Select an option": start a private fight (the owner's friends can join it), join one, or not.
 * - Starting warns of the unsafe death and the altar being the way out ("Yes, and don't ask again."
 *   hides it from then on, varbit 13183), then the God Wars fader; a tick later the chamber is
 *   rebuilt as an instance with the player at its door, varbit godwars_instance 1 and the barrier
 *   at 2 (3 during the fight). The safe room's door, chests, plaque, scoreboard and anvil are
 *   lifeless copies there.
 * - Joining asks whose fight; the owner must have the player as a friend, and no fight may be on
 *   ("The fight with Nex is already in progress...").
 * - Nex appears 54 ticks after the instance is built and 36-38 ticks after each kill.
 * - Wiki: it costs 100,000 coins and needs the Hard Combat Achievements. It lasts while anyone is
 *   in it (not captured).
 */
const Common = require("./Common.Nex");
const Fight = require("./Fight.Nex");

const COINS = 995;
const CHUNK = 8;
const PLANES = 4;

/** Owner -> their private chamber. */
const instances = new Map();

let AreaClass = null;

function areaClass() {
  if (AreaClass) return AreaClass;
  const { TemplatedInstanceArea } = Common.core;
  AreaClass = class NexInstance extends TemplatedInstanceArea {
    constructor(owner) {
      const { width, height } = Common.data.instance;
      super(width, height);
      this.owner = owner;
      this.isGodWarsArea = true;
      this.instance = null;
    }

    getName() {
      return "Nex (private)";
    }

    isMulti() {
      return true;
    }

    allowSummonPet() {
      return false;
    }

    canAttack(attacker, target) {
      return require("./Chamber.Nex").canAttackIn(attacker, target);
    }

    postEnter(mobile) {
      super.postEnter(mobile);
      if (!mobile.isPlayer()) return;
      const player = mobile.getAsPlayer();
      require("../godwars/Dungeon.GodWars").openOverlay(player);
      this.instance?.sync(player);
    }

    postLeave(mobile, logout) {
      super.postLeave(mobile, logout);
      if (!mobile.isPlayer()) return;
      this.instance?.removePlayer(mobile.getAsPlayer(), logout);
    }

    destroy() {
      if (this.isDestroyed()) return;
      for (const entity of [...this.entities]) {
        if (!entity.isNpc?.()) continue;
        this.detach(entity);
        Common.api.removeNpc(entity);
      }
      super.destroy();
    }
  };
  return AreaClass;
}

class Instance {
  constructor(owner) {
    this.owner = owner;
    this.area = new (areaClass())(owner);
    this.area.instance = this;
    this.players = new Set();
    this.fight = null;
    this.pendingSpawn = null;
    this.ended = false;
    this.copyChamber();
    this.silenceCopies();
  }

  copyChamber() {
    const { chunkX, chunkY, width, height } = Common.data.instance;
    for (let plane = 0; plane < PLANES; plane++) {
      for (let x = 0; x < width; x++) {
        for (let y = 0; y < height; y++) {
          this.area.setChunk(plane, x, y, { sourceChunkX: chunkX + x, sourceChunkY: chunkY + y, sourcePlane: plane, rotation: 0 });
        }
      }
    }
  }

  /** The safe room's objects are their option-less copies in here (captured). */
  silenceCopies() {
    const { GameObject, ObjectManager } = Common.core;
    const noops = Common.data.objects.instanceNoops;
    for (const object of this.allObjects()) {
      const noop = noops[String(object.getId())];
      if (!noop) continue;
      ObjectManager.deregister(object, true);
      ObjectManager.register(new GameObject(noop, object.getLocation(), object.getType(), object.getFace(), this.area), true);
    }
  }

  allObjects() {
    const { width, height } = Common.data.instance;
    const objects = [];
    for (let x = 0; x < width; x++) {
      for (let y = 0; y < height; y++) objects.push(...this.area.getChunkObjects(0, x, y));
    }
    return objects;
  }

  /** The instance's copy of a real tile. */
  tile([x, y, z]) {
    const { chunkX, chunkY } = Common.data.instance;
    return this.area.tile(x - chunkX * CHUNK, y - chunkY * CHUNK, z ?? 0);
  }

  /** The real tile an instance tile copies, as [x, y]. */
  real(location) {
    const { chunkX, chunkY } = Common.data.instance;
    return [location.getX() - this.area.getBaseX() + chunkX * CHUNK, location.getY() - this.area.getBaseY() + chunkY * CHUNK];
  }

  inChamber(location) {
    if (location.getZ() !== 0 || !this.area.contains(location)) return false;
    const [x, y] = this.real(location);
    const { box } = Common.data.chamber;
    return x >= box.minX && x <= box.maxX && y >= box.minY && y <= box.maxY;
  }

  present() {
    return [...this.players].filter((player) => player.isRegistered() && player.getHitpoints() > 0 && this.area.hasMember(player) && this.inChamber(player.getLocation()));
  }

  /** The arena a fight runs in. */
  arena() {
    return {
      area: this.area,
      tile: (tile) => this.tile(tile),
      real: (location) => this.real(location),
      inChamber: (location) => this.inChamber(location),
      players: () => this.present(),
      spawn: (id, tile) => this.spawnAt(id, this.tile(tile)),
      spawnAt: (id, location) => this.spawnAt(id, location),
      ended: (fight, killed) => this.fightEnded(fight, killed),
    };
  }

  spawnAt(id, location) {
    if (this.area.isDestroyed()) return null;
    const npc = Common.api.spawnNpc({ id, x: location.getX(), y: location.getY(), z: location.getZ(), wanderRadius: 0 });
    if (!npc) return null;
    npc.__skipDefaultRespawn = true;
    this.area.add(npc);
    return npc;
  }

  /** The barrier's state and the instance varbit, for one player. */
  sync(player) {
    const { varbits, barrierStates, instance } = Common.data;
    const sender = player.getPacketSender();
    sender.sendVarbit(instance.instanceVarbit, 1);
    sender.sendVarbit(varbits.barrier, this.fight ? barrierStates.fighting : barrierStates.idle);
  }

  addPlayer(player) {
    this.players.add(player);
    player.setAttribute(Common.INSTANCE_ATTRIBUTE, true);
  }

  removePlayer(player, logout) {
    if (!this.players.delete(player)) return;
    player.setAttribute(Common.INSTANCE_ATTRIBUTE, false);
    this.fight?.playerLeft(player);
    const { varbits, barrierStates, instance } = Common.data;
    if (logout) {
      player.setLocation(Common.toLocation(Common.data.prison.entryRoom));
    } else {
      player.getPacketSender().sendVarbit(instance.instanceVarbit, 0);
      player.getPacketSender().sendVarbit(varbits.barrier, barrierStates.prison);
    }
    if (this.players.size === 0) this.end();
  }

  scheduleSpawn(ticks) {
    if (this.fight || this.pendingSpawn || this.ended) return;
    const at = {};
    this.pendingSpawn = at;
    Common.later(ticks, () => {
      if (this.pendingSpawn !== at) return;
      this.pendingSpawn = null;
      if (this.ended || this.fight || this.present().length === 0) return;
      this.fight = Fight.open(this.arena());
      if (this.fight.stopped) this.fight = null;
      for (const player of this.players) this.sync(player);
    });
  }

  fightEnded(fight, killed) {
    if (this.fight !== fight) return;
    this.fight = null;
    if (killed) require("./Chamber.Nex").recordKill(fight.endTick - fight.startedTick());
    for (const player of this.players) if (player.isRegistered()) this.sync(player);
    if (killed && !this.ended) this.scheduleSpawn(Common.data.chamber.respawnTicks);
  }

  end() {
    if (this.ended) return;
    this.ended = true;
    for (const player of [...this.players]) if (player.isRegistered() && this.area.hasMember(player)) player.moveTo(Common.toLocation(Common.data.prison.altarExit));
    this.pendingSpawn = null;
    if (instances.get(this.owner) === this) instances.delete(this.owner);
    this.fight?.end(false);
    this.fight = null;
    if (!this.area.isDestroyed()) this.area.destroy();
  }
}

function instanceOf(player) {
  for (const instance of instances.values()) if (instance.players.has(player)) return instance;
  return null;
}

// ------------------------------------------------------------------ the way in

/**
 * Into an instance: the God Wars fader where they stand, the rebuilt chamber a tick later (captured).
 * `resolve()` gives the instance on that tick (a new one is only built and paid for then), or null.
 */
function bringIn(player, resolve) {
  const { instance: spec, chamber } = Common.data;
  player.getMovementQueue().reset();
  player.getPacketSender().sendInterfaceRemoval();
  player.getPacketSender().sendClientScript(spec.faderScript, 1, 1, 1, (spec.fader[0] << 16) | spec.fader[1]);
  Common.later(1, () => {
    if (!player.isRegistered()) return;
    const instance = resolve();
    if (!instance || instance.ended) return;
    instance.addPlayer(player);
    instance.area.enter(player);
    player.moveTo(instance.tile(chamber.entry));
    player.getPacketSender().sendSong(Common.data.music.silence);
    instance.scheduleSpawn(Common.data.chamber.firstSpawnTicks);
  });
}

function hasHardTier(player) {
  const request = { player, tier: "Hard", unlocked: null };
  Common.api.emitCustomEvent("combat-achievements:tier", request);
  return request.unlocked !== false;
}

function start(player) {
  const texts = Common.data.prisonTexts;
  const { cost } = Common.data.instance;
  if (!hasHardTier(player)) {
    Common.statement(player, texts.caShort);
    return;
  }
  if (player.getInventory().getAmount(COINS) < cost) {
    Common.statement(player, texts.costShort.replace("[cost]", cost.toLocaleString("en-US")));
    return;
  }
  confirm(player, () => bringIn(player, () => {
    if (player.getInventory().getAmount(COINS) < cost || instanceOf(player)) return null;
    player.getInventory().delete(COINS, cost);
    // An old instance still holding friends carries on without its owner.
    instances.delete(player);
    const instance = new Instance(player);
    instances.set(player, instance);
    return instance;
  }));
}

/** The captured warning and "Are you sure you wish to begin?", unless "don't ask again" was picked. */
function confirm(player, proceed) {
  const texts = Common.data.prisonTexts;
  const { varbits } = Common.data;
  if (player.getAttribute(Common.SKIP_WARNING_ATTRIBUTE) === true) {
    proceed();
    return;
  }
  const [question, yes, never, no] = texts.confirm;
  const { DialogueChainBuilder, StatementDialogue, ActionDialogue } = Common.core;
  const ask = () => Common.api.sendMultiChatboxPrompt(player, question,
    yes, () => proceed(),
    never, () => {
      player.setAttribute(Common.SKIP_WARNING_ATTRIBUTE, true);
      player.getPacketSender().sendVarbit(varbits.barrierWarningHidden, 1);
      proceed();
    },
    no, () => player.getPacketSender().sendInterfaceRemoval());
  player.getDialogueManager().startDialogues(new DialogueChainBuilder().add(
    new StatementDialogue(0, texts.warning),
    new ActionDialogue(1, { execute: ask }),
  ));
}

function isFriendOf(owner, player) {
  const { Misc } = Common.core;
  const encoded = Misc.stringToLong(player.getUsername());
  return owner.getRelations().getFriendList().some((friend) => String(friend) === String(encoded));
}

function join(player) {
  const texts = Common.data.prisonTexts;
  player.setEnteredSyntaxAction({
    execute: (name) => {
      const owner = Common.core.World.getPlayerByName(String(name ?? "").trim());
      const instance = owner ? instances.get(owner) : null;
      if (!instance || instance.ended) {
        Common.statement(player, texts.noFight);
        return;
      }
      if (owner !== player && !isFriendOf(owner, player)) {
        Common.statement(player, texts.notFriend);
        return;
      }
      if (instance.fight) {
        Common.statement(player, texts.inProgress);
        return;
      }
      confirm(player, () => bringIn(player, () => {
        if (instance.ended) return null;
        if (!instance.fight) return instance;
        Common.statement(player, texts.inProgress);
        return null;
      }));
    },
  });
  player.getPacketSender().sendEnterInputPrompt(texts.joinPrompt);
}

/** Pass (private): start one, join one, or neither (captured menu). */
function passPrivate({ player }) {
  const texts = Common.data.prisonTexts;
  if (instanceOf(player) || require("./Chamber.Nex").fightFor(player)) {
    Common.statement(player, texts.exitOnlyAltar);
    return true;
  }
  const [startText, joinText, nothing] = texts.privateMenu;
  Common.api.sendMultiChatboxPrompt(player, "Select an option",
    startText, () => start(player),
    joinText, () => join(player),
    nothing, () => player.getPacketSender().sendInterfaceRemoval());
  return true;
}

/** Saved inside an instance (the server stopped): back in the entry room. */
function recoverOnLogin({ player }) {
  const { varbits } = Common.data;
  if (player.getAttribute(Common.SKIP_WARNING_ATTRIBUTE) === true) player.getPacketSender().sendVarbit(varbits.barrierWarningHidden, 1);
  if (!player.getAttribute(Common.INSTANCE_ATTRIBUTE) || instanceOf(player)) return;
  player.setAttribute(Common.INSTANCE_ATTRIBUTE, false);
  player.moveTo(Common.toLocation(Common.data.prison.entryRoom));
}

/** The altar's Teleport from an instance: out to the safe room's door, the instance left behind. */
function leave(player) {
  const instance = instanceOf(player);
  if (!instance) return false;
  player.moveTo(Common.toLocation(Common.data.prison.altarExit));
  return true;
}

function attachInstance(api) {
  api.persistAttribute(Common.SKIP_WARNING_ATTRIBUTE, false);
  api.persistAttribute(Common.INSTANCE_ATTRIBUTE, false);
  api.onPlayerLogin(recoverOnLogin);
}

module.exports = { attachInstance, passPrivate, instanceOf, leave, Instance, get instances() { return instances; } };
