/**
 * A challenge (Wiki: TzHaar-Ket-Rak's_Challenges): a private copy of the Inferno arena with as many
 * JalTok-Jads as the challenge's number, fought alone.
 * - Challenges 1 and 2 are open to anyone; 3 and up need TzKal-Zuk beaten, and each needs the one
 *   before it completed.
 * - The entry is staged as recorded (rsprox, data/tzhaar-ket-rak.json): the screen fades as the
 *   challenge is picked, the player lands in the arena 3 ticks later, the screen clears at 6 and
 *   the Jads come at 18, each challenge's on its own tiles.
 * - The Jads fight as the Inferno's (Monsters.Inferno.js), their first attacks a few ticks apart.
 *   Each brings five Yt-HurKot at half health: they walk to it and heal it until drawn off, do
 *   not come again, and go when it dies.
 * - The last Jad down completes it: the completion lines at once, the player back by
 *   TzHaar-Ket-Rak a few ticks later for the reward (Rewards.TzHaarKetRak.js). Dying, the cave
 *   exit or logging out first fails it, with TokKul for any Jads killed. It is a safe activity:
 *   nothing is lost on death.
 */
const Common = require("./Common.TzHaarKetRak");

const CHALLENGE_ATTRIBUTE = "tzhaar-ket-rak:challenge";
const DEFEATED_MESSAGE = "You have been defeated!";

let ChallengeArea = null;
let hooks = { lastJadDown() {}, completed() {}, failed() {}, refused() {} };

class Challenge {
  constructor(player, number) {
    this.player = player;
    this.number = number;
    this.area = new ChallengeArea(this);
    this.jads = [];
    this.spawned = [];
    /** The duration counts from the Jads' arrival, as the recorded durations do. */
    this.startTick = -1;
    this.kills = 0;
    this.endAt = -1;
    /** Set with the completion lines at the last Jad's death; the reward follows on the way out. */
    this.result = null;
    this.over = false;
    /** For Combat Achievements: styles dealt, per Jad and overall, and the inventory kept empty. */
    this.styles = new Map();
    this.nonMelee = false;
    this.emptyInventory = true;
  }

  spawnJads() {
    const { api, data, ids } = Common;
    this.startTick = Common.cycle();
    const layout = data.arena.layouts[this.number - 1];
    for (let index = 0; index < layout.length; index++) {
      const [x, y, face] = layout[index];
      const npc = api.spawnNpc({ id: ids.npcs.jad, x, y, z: 0, owner: this.player, wanderRadius: 0, face });
      if (!npc) continue;
      npc.__skipDefaultRespawn = true;
      npc.__tkrChallenge = this;
      this.spawned.push(npc);
      this.area.add(npc);
      npc.getCombat().setAttackDelay(data.jadFirstAttackTicks + index * data.jadStaggerTicks);
      npc.getCombat().attack(this.player);
      this.jads.push({ npc, healers: [], called: false });
    }
  }

  spawnHealers(entry) {
    const { api, data, ids } = Common;
    const at = entry.npc.getLocation();
    const size = entry.npc.getSize?.() ?? 5;
    const ring = [[-1, -1], [size, -1], [-1, size], [size, size], [Math.floor(size / 2), -1]];
    for (let index = 0; index < data.healers.perJad; index++) {
      const [dx, dy] = ring[index % ring.length];
      const healer = api.spawnNpc({ id: ids.npcs.healer, x: at.getX() + dx, y: at.getY() + dy, z: 0, owner: this.player, wanderRadius: 0 });
      if (!healer) continue;
      healer.__skipDefaultRespawn = true;
      healer.__tkrChallenge = this;
      this.spawned.push(healer);
      this.area.add(healer);
      entry.healers.push(healer);
    }
  }

  /** Yt-HurKot: at half health, once; they heal in melee reach (or a few tiles while fighting). */
  tendHealers(entry) {
    const { core, data } = Common;
    const { npc: jad } = entry;
    entry.healers = entry.healers.filter((healer) => healer.getHitpoints() > 0 && healer.isRegistered());
    const max = jad.getDefinition().getHitpoints();
    if (!entry.called && jad.getHitpoints() <= max / 2) {
      entry.called = true;
      this.spawnHealers(entry);
    }
    const now = Common.cycle();
    for (const healer of entry.healers) {
      const fighting = healer.getCombat().getTarget() != null;
      const distance = healer.calculateDistance(jad);
      if (distance <= data.healers.reach || (fighting && distance <= data.healers.fightReach)) {
        if (now % data.healers.healTicks === 0 && jad.getHitpoints() < max) {
          healer.setMobileInteraction(jad);
          healer.performAnimation(new core.Animation(data.healers.healAnim));
          jad.performGraphic(new core.Graphic(data.healers.healGraphic));
          jad.heal(Math.min(max - jad.getHitpoints(), Common.randomInt(data.healers.healMin, data.healers.healMax)));
        }
      } else if (!fighting) {
        core.PathFinder.calculateWalkRoute(healer, jad.getLocation().getX(), jad.getLocation().getY());
      }
    }
  }

  tick() {
    if (this.over || this.startTick === -1) return;
    const player = this.player;
    if (!inventoryEmpty(player)) this.emptyInventory = false;
    for (const entry of [...this.jads]) {
      if (entry.npc.getHitpoints() <= 0 || !entry.npc.isRegistered()) {
        entry.healers.forEach((healer) => removeNpc(healer));
        this.jads = this.jads.filter((other) => other !== entry);
        this.kills++;
        continue;
      }
      if (entry.npc.getCombat().getTarget() !== player) entry.npc.getCombat().attack(player);
      this.tendHealers(entry);
    }
    if (this.jads.length === 0 && this.endAt === -1) {
      this.endAt = Common.cycle() + Common.data.endTicks;
      hooks.lastJadDown(player, this);
    }
    // A player going down to a last hit in flight is left to the death path, which counts the win.
    if (dying(player)) return;
    if (this.endAt !== -1 && Common.cycle() >= this.endAt) complete(player);
  }

  /** Ticks from the Jads' arrival to the last one's death (or to now). */
  elapsedTicks() {
    if (this.startTick === -1) return 0;
    return (this.endAt === -1 ? Common.cycle() : this.endAt - Common.data.endTicks) - this.startTick;
  }

  dealt(target, style) {
    if (style !== "MELEE") this.nonMelee = true;
    if (!target?.__tkrChallenge || target.getId?.() !== Common.ids.npcs.jad) return;
    if (!this.styles.has(target)) this.styles.set(target, new Set());
    this.styles.get(target).add(style);
  }

  /** Every Jad and healer it spawned, its hits still in flight cancelled with it. */
  destroy() {
    this.over = true;
    const { TaskManager } = Common.core;
    for (const npc of this.spawned) TaskManager.cancelTasks(npc);
    for (const entry of this.jads) entry.healers.forEach((healer) => removeNpc(healer));
    this.area.destroy();
  }

  /** The arena copy without the Inferno's rocky supports (none in the challenges). */
  clearSupports() {
    const { GameObject, ObjectManager } = Common.core;
    for (const [id, x, y] of Common.data.arena.supports) {
      ObjectManager.deregister(new GameObject(id, Common.toLocation([x, y]), 10, 0, this.area), true);
    }
  }
}

function dying(player) {
  return player.isDyingReturn?.() === true || player.getHitpoints?.() <= 0;
}

function inventoryEmpty(player) {
  const items = player.getInventory?.()?.getItems?.() ?? [];
  return items.every((item) => !item || (item.getId?.() ?? -1) < 0 || (item.getAmount?.() ?? 0) <= 0);
}

function removeNpc(npc) {
  if (npc?.isRegistered?.()) Common.api.removeNpc(npc);
}

function defineArea() {
  const { PrivateArea, Boundary } = Common.core;
  const [minX, maxX, minY, maxY] = Common.data.arena.bounds;
  ChallengeArea = class TzHaarKetRakChallenge extends PrivateArea {
    constructor(challenge) {
      super([new Boundary(minX, maxX, minY, maxY, 0)]);
      this.challenge = challenge;
    }

    getName() {
      return "TzHaar-Ket-Rak's Challenge";
    }

    destroy() {
      if (this.isDestroyed?.() === true) return;
      const { World } = Common.core;
      const addQueue = World.getAddNPCQueue();
      const removeQueue = World.getRemoveNPCQueue();
      for (const entity of this.entities ?? []) {
        if (!entity?.isNpc?.()) continue;
        const npc = entity.getAsNpc();
        for (let i = addQueue.indexOf(npc); i !== -1; i = addQueue.indexOf(npc)) addQueue.splice(i, 1);
        if (npc.isRegistered?.() && !removeQueue.includes(npc)) removeQueue.push(npc);
      }
      super.destroy();
    }

    /** The challenge runs on the player's tick. */
    process(mobile) {
      if (mobile === this.challenge.player) this.challenge.tick();
    }

    postLeave(mobile, logout) {
      if (mobile?.isPlayer?.() && mobile === this.challenge.player && !this.challenge.over) {
        fail(mobile, { logout });
      }
      super.postLeave(mobile, logout);
    }

    canTeleport() {
      return null;
    }

    isMulti() {
      return true;
    }
  };
}

function challengeOf(player) {
  const challenge = player?.getAttribute?.(CHALLENGE_ATTRIBUTE);
  return challenge instanceof Challenge && !challenge.over ? challenge : null;
}

/** Out by TzHaar-Ket-Rak, the copy gone. */
function end(player) {
  const challenge = player.getAttribute?.(CHALLENGE_ATTRIBUTE);
  player.setAttribute?.(CHALLENGE_ATTRIBUTE, null);
  if (!(challenge instanceof Challenge)) return null;
  challenge.over = true;
  if (player.getArea?.() === challenge.area) {
    challenge.area.leave(player, false);
    if (player.getArea?.() === challenge.area) player.setArea(null);
  }
  challenge.destroy();
  release(player, challenge);
  Common.closeFade(player);
  player.getCombat?.().reset?.();
  player.moveTo(Common.toLocation(Common.data.outside));
  return challenge;
}

function complete(player, { logout = false } = {}) {
  const challenge = end(player);
  if (!challenge) return;
  if (challenge.result) hooks.completed(player, challenge, { logout });
  else hooks.failed(player, challenge, { logout });
}

/** Out early - unless the last Jad was already down, which still counts as the win. */
function fail(player, { logout = false, died = false } = {}) {
  const challenge = end(player);
  if (!challenge) return;
  if (challenge.result) hooks.completed(player, challenge, { logout });
  else hooks.failed(player, challenge, { logout, died });
}

/** Why the player can't take on challenge n, or null. */
function refusal(player, number) {
  if (number > 1 && Common.completions(player, number - 1) === 0) return "needPrevious";
  if (number >= Common.data.infernoChallenge && !Common.defeatedZuk(player)) return "needZuk";
  return null;
}

function start(player, number) {
  if (challengeOf(player)) return null;
  if (player.getMovementQueue?.()?.isMovementBlocked?.()) return null;
  const reason = refusal(player, number);
  if (reason) {
    hooks.refused(player, number, reason);
    return null;
  }
  const { data } = Common;
  const challenge = new Challenge(player, number);
  player.setAttribute(CHALLENGE_ATTRIBUTE, challenge);
  player.sendMessage(Common.message("enter", { ordinal: data.ordinals[number - 1] }));
  Common.fade(player, true);
  // Held still through the fade, as the Catacombs' fades hold the player.
  player.getMovementQueue?.()?.setBlockMovement(true).reset();
  challenge.staging = true;
  const live = () => challengeOf(player) === challenge;
  Common.later(data.arena.landTicks, () => {
    if (live()) land(player, challenge);
  });
  Common.later(data.arena.fadeInTicks, () => {
    if (!live()) return;
    Common.fade(player, false);
    release(player, challenge);
  });
  Common.later(data.arena.fadeInTicks + data.arena.fadeCloseTicks, () => {
    if (live()) Common.closeFade(player);
  });
  Common.later(data.arena.jadTicks, () => {
    if (live()) challenge.spawnJads();
  });
  return challenge;
}

function release(player, challenge) {
  if (!challenge.staging) return;
  challenge.staging = false;
  player.getMovementQueue?.()?.setBlockMovement(false);
}

/** Into the arena copy, facing south with the landing animation, as recorded. */
function land(player, challenge) {
  const { core, data } = Common;
  const [x, y] = data.arena.player;
  player.moveTo(new core.Location(x, y, 0));
  const current = player.getArea?.();
  if (current && current !== challenge.area) current.leave(player, false);
  challenge.area.enter(player);
  challenge.clearSupports();
  player.setPositionToFace?.(new core.Location(x, y - 1, 0));
  player.performAnimation?.(new core.Animation(data.arena.landSeq));
}

// --- Hooks ---------------------------------------------------------------------------------------

/**
 * A death in here prints "You have been defeated!" instead of "Oh dear, you are dead!", with the
 * usual jingle (rsprox_transcripts/227/00091.txt, 227/04308.txt, 237/01141.txt).
 */
function defeatedLine(event) {
  if (challengeOf(event.player)) event.message = DEFEATED_MESSAGE;
}

/**
 * Death: nothing lost, back outside with the failure line - unless every Jad was already down,
 * which still counts as the win (as the Inferno counts falling after TzKal-Zuk).
 */
function onDeath(event) {
  const challenge = challengeOf(event.player);
  if (!challenge) return;
  event.handled = true;
  fail(event.player, { died: true });
}

function keepItems(event) {
  if (challengeOf(event.player)) event.shouldDrop = false;
}

function noTeleport(event) {
  if (!challengeOf(event.player)) return;
  event.player.sendMessage(Common.data.messages.noTeleport);
  event.allow = false;
}

/** The arena's cave exit (the Inferno's own handler steps aside outside an Inferno run). */
function exitCave({ player }) {
  if (!challengeOf(player)) return false;
  fail(player);
  return true;
}

function leaveWorld({ player }) {
  if (challengeOf(player)) fail(player, { logout: true });
}

function dealt({ player, target, hit }) {
  const challenge = challengeOf(player);
  // CombatType is a numeric enum: its reverse mapping gives the name.
  if (challenge) challenge.dealt(target, String(Common.core.CombatType[hit?.getCombatType?.()] ?? ""));
}

function attach(api, handlers) {
  hooks = { ...hooks, ...handlers };
  defineArea();
  api.onPlayerBeforeDeath(defeatedLine);
  api.onPlayerDeath(onDeath);
  api.onShouldDropItemsOnDeath(keepItems);
  api.onCanTeleport(noTeleport);
  api.onObjectFirstClick(Common.ids.locs.exit, exitCave);
  api.onObjectSecondClick(Common.ids.locs.exit, exitCave);
  api.onPlayerLogout(leaveWorld);
  api.onPlayerDisconnect(leaveWorld);
  api.onPlayerDealtDamage(dealt);
}

module.exports = {
  attach, start, refusal, challengeOf, complete, fail, end, Challenge, inventoryEmpty, CHALLENGE_ATTRIBUTE,
  defeatedLine, onDeath, keepItems, noTeleport, exitCave, leaveWorld, dealt,
  _defineArea: defineArea,
};
