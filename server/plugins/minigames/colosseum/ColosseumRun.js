"use strict";

/**
 * One player's run of the Colosseum: the arena, Minimus between waves, the intermission
 * screen, the waves and how a run ends.
 *
 * Capture (lobby to the start of wave 1):
 * - Arriving: the player lands at (1824, 3094) and walks north to (1824, 3104), a tile short of
 *   Minimus, who (12808) appears at (1824, 3106) with anim 10862 and says "A [rank]
 *   approaches!", then "Let me know when you want to begin." three ticks later. The seated
 *   Sol Heredit (12827) waits at (1823, 3123) on a blocking loc, and the arena is multi-way.
 * - Start-wave opens interface 865 (script 4931: the waves done and the three modifier keys
 *   offered); its buttons 15-17 pick one (varbit 9788) and 41 confirms. Confirming sets varp 4135
 *   to the modifier's Glory, the modifier's tier varbit, and the wave starts five ticks later:
 *   the highest-wave varbit, the start time (varp 4133) and the "Wave: 1" message, with the trio
 *   and the shaman playing anim 10861 as they appear.
 * Offline_Scape (from its captures): Minimus reappears one tile north of the player after each
 * wave, and the wave-cleared message.
 */

const Shared = require("./ColosseumShared");
const Waves = require("./ColosseumWaves");
const Enemies = require("./Enemies.Colosseum");
const Effects = require("./ModifierEffects.Colosseum");
const Hazards = require("./ColosseumHazards");
const Sol = require("./SolHeredit.Colosseum");
const Rewards = require("./Rewards.Colosseum");
const { ModifierSet, byKey } = require("./ColosseumModifiers");

const ATTR_RUN = "colosseum:run";
const WAVE_START_DELAY = 5;
/** Sol Heredit's death animation plays out before the chest appears. */
const SOL_DEATH_TICKS = 5;
const SECOND_GREETING_DELAY = 3;
const MINIMUS_SPAWN_ANIM = 10862;
const HUMAN_SPAWN_ANIM = 10861;
const OP1 = 1 << 1;
/** Interface 865's clickable lists (capture: if_setevents on open). */
const INTERMISSION_EVENTS = [[8, 0, 3], [39, 0, 3], [34, 0, 26], [37, 0, 30]];

const runs = new Map();
let ArenaClass = null;

function arenaClass() {
  if (ArenaClass) return ArenaClass;
  const { PrivateArea, Boundary } = Shared.core();
  ArenaClass = class ColosseumArena extends PrivateArea {
    constructor() {
      const { minX, maxX, minY, maxY } = Shared.ARENA;
      super([new Boundary(minX, maxX, minY, maxY, 0)]);
      this.run = null;
    }

    getName() {
      return "Fortis Colosseum";
    }

    isMulti() {
      return true;
    }

    allowSummonPet() {
      return false;
    }

    /** Leaving the arena any way but through Minimus (a teleport, a logout) ends the run. */
    postLeave(mobile, logout) {
      if (mobile.isPlayer?.() && this.run?.player === mobile.getAsPlayer()) {
        this.run.end(logout ? "logout" : "teleported", { fromArea: true });
      }
      super.postLeave(mobile, logout);
    }
  };
  return ArenaClass;
}

function cycle() {
  return Shared.core().World.getProcessCycle();
}

function savePlayer(player) {
  try {
    Shared.core().GameConstants.PLAYER_PERSISTENCE?.save(player, "colosseum");
  } catch (error) {
    console.warn("[colosseum] save failed", error);
  }
}

function freeTile(area, x, y) {
  const { RegionManager } = Shared.core();
  return (RegionManager.getClipping(x, y, 0, area) & 0x1280100) === 0;
}

class ColosseumRun {
  constructor(player, { random = Math.random } = {}) {
    this.player = player;
    this.random = random;
    this.area = new (arenaClass())();
    this.area.run = this;
    this.modifiers = new ModifierSet();
    /** Waves cleared so far; the next wave is this + 1. */
    this.wave = 0;
    this.stage = "intermission";
    this.offered = [];
    this.npcs = new Set();
    this.waveStart = 0;
    this.waveTicks = 0;
    this.reinforced = false;
    this.minimus = null;
    this.sol = null;
    this.timer = null;
    /** The modifiers' swarms, orb and totems: never counted towards clearing a wave. */
    this.hazards = new Set();
    this.bees = [];
    this.solarflare = null;
    this.totems = new Map();
    this.sand = new Map();
    this.doomStacks = 0;
    this.waveDamage = 0;
    /** Wave 12: Sol Heredit's fight, and the gladiators' barricade. */
    this.solFight = null;
    this.barricade = [];
    /** The loot so far, this run's Glory, and whether an enemy has hurt the player this wave. */
    this.loot = null;
    this.glory = 0;
    this.hitByEnemy = false;
    this.chest = null;
    runs.set(player, this);
  }

  // ---------------------------------------------------------------- arrival

  /** Into the arena: Sol on his seat, Minimus to greet, and the run's vars cleared. */
  enter() {
    const player = this.player;
    savePlayer(player);
    player.setAttribute(ATTR_RUN, true);
    this.resetVars();
    Rewards.start(this);
    this.area.enter(player);
    player.moveTo(Shared.loc(Shared.ARENA_START));
    // Capture: from the next tick the player walks up to Minimus, stopping a tile short.
    Shared.later(this, 1, () => {
      if (this.stage === "intermission" && this.wave === 0) {
        Shared.core().PathFinder.calculateWalkRoute(player, Shared.ARRIVAL_WALK.x, Shared.ARRIVAL_WALK.y);
      }
    });
    this.seatSol();
    this.spawnMinimus(Shared.MINIMUS_START);
    const rank = Shared.rankOf(player);
    this.minimus?.forceChat(`A ${rank} approaches!`);
    Shared.later(this, SECOND_GREETING_DELAY, () => this.minimus?.forceChat("Let me know when you want to begin."));
    this.timer = Shared.repeat(this, 1, () => this.tick());
  }

  resetVars() {
    const sender = this.player.getPacketSender();
    sender.sendConfig(Shared.VARP.WAVE_START_TIME, 0)
      .sendConfig(Shared.VARP.WAVE_DAMAGE_TAKEN, 0)
      .sendConfig(Shared.VARP.LAST_MODIFIER_GLORY, 0)
      .sendVarbit(Shared.VARBIT.SELECTED_MODIFIER, 0);
    this.modifiers.sync(this.player);
  }

  spawnNpc(id, { x, y }, options = {}) {
    const npc = Shared.api().spawnNpc({ id, x, y, z: 0, wanderRadius: 0, ...options });
    if (!npc) return null;
    npc.__skipDefaultRespawn = true;
    npc.__colosseumRun = this;
    this.area.add(npc);
    return npc;
  }

  seatSol() {
    const { GameObject, ObjectManager } = Shared.core();
    this.sol = this.spawnNpc(Shared.NPC.SOL_SEATED, Shared.SOL_SEAT);
    this.sol?.setFlag?.("combat:no-retaliate");
    ObjectManager.register(new GameObject(Shared.OBJECT.SOL_SEAT_BLOCKER, Shared.loc(Shared.SOL_SEAT), 10, 0, this.area), true);
  }

  spawnMinimus(tile) {
    const { Animation } = Shared.core();
    this.removeMinimus();
    this.minimus = this.spawnNpc(Shared.NPC.MINIMUS_ARENA, tile);
    this.minimus?.performAnimation(new Animation(MINIMUS_SPAWN_ANIM));
  }

  removeMinimus() {
    if (!this.minimus) return;
    this.area.detach(this.minimus);
    Shared.api().removeNpc(this.minimus);
    this.minimus = null;
  }

  /** Minimus reappears a tile north of the player, or beside them if that is blocked. */
  minimusTileNearPlayer() {
    const at = this.player.getLocation();
    for (const [dx, dy] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
      const x = at.getX() + dx;
      const y = at.getY() + dy;
      if (freeTile(this.area, x, y)) return { x, y };
    }
    return { x: at.getX(), y: at.getY() + 1 };
  }

  // ---------------------------------------------------------------- intermission

  /** Minimus's Start-wave: the intermission screen with three modifiers to choose from. */
  openIntermission() {
    if (this.stage !== "intermission") return;
    const player = this.player;
    const sender = player.getPacketSender();
    this.offered = this.modifiers.offer(this.wave + 1, this.random);
    this.modifiers.sync(player);
    sender.sendVarbit(Shared.VARBIT.SELECTED_MODIFIER, 0);
    const values = Rewards.intermission(this);
    sender.sendInterface(Shared.INTERFACE.INTERMISSION);
    // The waves done, the offer, then the loot's value so far, the next wave's and the last
    // wave's (capture).
    sender.sendClientScript(Shared.SCRIPT.INTERMISSION_INIT, this.wave, ...this.offered, ...values, 0);
    for (const [component, from, to] of INTERMISSION_EVENTS) {
      sender.sendInterfaceFlagsRange((Shared.INTERFACE.INTERMISSION << 16) | component, from, to, OP1);
    }
  }

  /**
   * A modifier button: the selection (varbit 9788), then the screen's own redraws - 4934 for
   * the three buttons' highlight and 4932 for Continue - as its click script 4938 runs them.
   */
  selectModifier(choice) {
    if (this.stage !== "intermission" || choice < 1 || choice > this.offered.length) return;
    this.player.getPacketSender()
      .sendVarbit(Shared.VARBIT.SELECTED_MODIFIER, choice)
      .sendClientScript(Shared.SCRIPT.INTERMISSION_BUTTONS, ...this.offered, this.wave)
      .sendClientScript(Shared.SCRIPT.INTERMISSION_CONTINUE, this.wave);
  }

  /** Continue: the picked modifier is taken and the next wave starts five ticks later. */
  confirm() {
    if (this.stage !== "intermission") return false;
    const sender = this.player.getPacketSender();
    const choice = sender.getVarbit(Shared.VARBIT.SELECTED_MODIFIER);
    const key = this.offered[choice - 1];
    if (key == null) return false;
    this.modifiers.add(key);
    this.modifiers.sync(this.player);
    Effects.picked(this);
    sender.sendConfig(Shared.VARP.LAST_MODIFIER_GLORY, byKey(key)?.glory ?? 0)
      .sendVarbit(Shared.VARBIT.SELECTED_MODIFIER, 0)
      .sendInterfaceRemoval();
    this.removeMinimus();
    this.stage = "starting";
    Shared.later(this, WAVE_START_DELAY, () => this.startWave());
    return true;
  }

  // ---------------------------------------------------------------- waves

  startWave() {
    if (this.stage !== "starting") return;
    const player = this.player;
    const wave = this.wave + 1;
    this.stage = "wave";
    this.waveStart = cycle();
    this.waveTicks = 0;
    this.reinforced = false;
    this.waveDamage = 0;
    this.hitByEnemy = false;
    const sender = player.getPacketSender();
    if (wave > sender.getVarbit(Shared.VARBIT.HIGHEST_WAVE)) sender.sendVarbit(Shared.VARBIT.HIGHEST_WAVE, wave);
    sender.sendConfig(Shared.VARP.WAVE_START_TIME, this.waveStart).sendConfig(Shared.VARP.WAVE_DAMAGE_TAKEN, 0);
    player.sendMessage(`<col=ef1020>Wave: ${wave}</col>`);
    if (wave === Shared.FINAL_WAVE) {
      Sol.begin(this);
      return;
    }
    const npcs = Waves.startingNpcs(wave, this.modifiers, this.random);
    for (const spawn of Waves.placeWave(npcs, player, this.random)) this.spawnEnemy(spawn);
    Hazards.waveStarted(this);
  }

  spawnEnemy({ id, x, y, offset }) {
    const { Animation } = Shared.core();
    const npc = this.spawnNpc(id, { x, y });
    if (!npc) return null;
    if (offset) npc.__colosseumOffset = offset;
    const ids = Waves.ids();
    if (Waves.isFremennik(id) || id === ids.shaman) npc.performAnimation(new Animation(HUMAN_SPAWN_ANIM));
    this.npcs.add(npc);
    Enemies.onSpawn(npc);
    npc.getCombat().attack(this.player);
    return npc;
  }

  tick() {
    if (this.stage === "ended") return false;
    if (this.stage !== "wave") return true;
    this.waveTicks++;
    for (const npc of [...this.npcs]) {
      if (npc.getHitpoints() <= 0 || !npc.isRegistered()) {
        this.npcs.delete(npc);
        Hazards.enemyDied(this, npc, Enemies.kindOf(npc.getId()));
        continue;
      }
      const target = npc.getCombat().getTarget();
      if (!target || !target.isRegistered?.()) npc.getCombat().attack(this.player);
    }
    Enemies.tendWarband(this);
    Enemies.tendMinotaurs(this, this.waveTicks);
    Effects.tick(this);
    Hazards.tick(this);
    Sol.tick(this);
    // Wiki: a wave cleared inside 40 seconds ends there; otherwise reinforcements arrive.
    if (this.npcs.size === 0) {
      this.completeWave();
      return true;
    }
    if (!this.reinforced && this.waveTicks >= Waves.REINFORCEMENT_TICKS) {
      this.reinforced = true;
      const npcs = Waves.reinforcements(this.wave + 1, this.modifiers);
      for (const spawn of Waves.placeReinforcements(npcs, this.player, this.random)) this.spawnEnemy(spawn);
    }
    return true;
  }

  /**
   * Damage dealt by the run rather than through a combat blow: sky javelins, swarms, sand,
   * explosions, and Sol Heredit's attacks. `fromEnemy` costs the wave's no-damage Glory.
   */
  hurt(amount, mask = "RED", fromEnemy = false) {
    const { HitDamage, HitMask } = Shared.core();
    if (amount <= 0 || this.stage === "ended") return;
    this.player.getCombat().getHitQueue().addPendingDamage([new HitDamage(amount, HitMask[mask])]);
    Effects.damageTaken(this, amount, fromEnemy);
  }

  completeWave() {
    this.wave++;
    this.stage = "intermission";
    Rewards.waveCompleted(this);
    Hazards.waveEnded(this);
    Effects.waveCompleted(this);
    if (this.wave >= Shared.FINAL_WAVE) {
      this.defeatedSol();
      return;
    }
    const seconds = this.waveTicks * 0.6;
    const minutes = Math.floor(seconds / 60);
    const rest = (seconds % 60).toFixed(2).padStart(5, "0");
    this.player.sendMessage(`Wave ${this.wave} completed! Duration: <col=ef1020>${minutes}:${rest}</col>`);
    this.spawnMinimus(this.minimusTileNearPlayer());
  }

  /** Sol Heredit is beaten: once he has fallen, the hazards go and the chest comes out. */
  defeatedSol() {
    Sol.defeated(this);
    this.stage = "won";
    Shared.later(this, SOL_DEATH_TICKS, () => this.finish());
  }

  /** The run is over with its loot: Glory is kept, and the chest appears with Minimus. */
  finish() {
    if (this.stage === "ended" || this.stage === "finished") return;
    this.stage = "finished";
    Rewards.keepGlory(this);
    Hazards.cleared(this);
    Rewards.bringOutChest(this);
  }

  // ---------------------------------------------------------------- leaving

  /**
   * Minimus's Leave: straight out before wave 1 or once the chest is out; between waves a
   * warning, as the transcript has it, and then the chest.
   */
  askToLeave() {
    const player = this.player;
    if (this.stage === "finished" || (this.stage === "intermission" && this.wave === 0)) {
      Shared.options(player, "Are you sure you wish to leave?", "Yes.", () => this.end("left"), "No.", () => {});
      return;
    }
    if (this.stage !== "intermission") return;
    const { DialogueChainBuilder, NpcDialogue, ActionDialogue } = Shared.core();
    player.getDialogueManager().startDialogues(new DialogueChainBuilder().add(
      new NpcDialogue(0, Shared.NPC.MINIMUS_ARENA, "Leaving now will forfeit your run, with you only being rewarded the items you have earned so far."),
      new ActionDialogue(1, {
        execute: () => Shared.options(player, "Are you sure you wish to leave early?", "Yes.", () => this.finish(), "No.", () => {}),
      }),
    ));
  }

  /**
   * Ends the run. `left` (through Minimus) walks out to the lobby with stats restored; a death,
   * teleport or logout has already moved the player (or will on login) and loses the loot.
   * Dying keeps the run's Glory; teleporting or logging out doesn't (Wiki).
   */
  end(reason, { fromArea = false } = {}) {
    if (this.stage === "ended") return;
    this.stage = "ended";
    this.timer?.stop?.();
    runs.delete(this.player);
    const player = this.player;
    player.setAttribute(ATTR_RUN, null);
    if (reason === "death") {
      Sol.playerDied(this);
      Rewards.keepGlory(this);
    }
    if (reason !== "left") Rewards.lost(this);
    Rewards.removeChest(this);
    for (const npc of [...this.npcs]) Shared.api().removeNpc(npc);
    this.npcs.clear();
    Hazards.cleared(this);
    Sol.cleared(this);
    Effects.ended(this);
    this.removeMinimus();
    if (this.sol) Shared.api().removeNpc(this.sol);
    const sender = player.getPacketSender();
    sender.sendVarbit(Shared.VARBIT.SELECTED_MODIFIER, 0);
    if (!fromArea && player.getArea?.() === this.area) this.area.leave(player, reason === "logout");
    if (!this.area.isDestroyed()) this.area.destroy();
    if (reason === "left") {
      Shared.fadeMove(player, () => {
        player.moveTo(Shared.loc(Shared.LOBBY_RESPAWN));
        restoreStats(player);
      });
    }
  }
}

/** Leaving through Minimus restores every stat to its level, boosts included (Wiki). */
function restoreStats(player) {
  const { Skill } = Shared.core();
  const skills = player.getSkillManager();
  for (const skill of Skill.values()) skills.setCurrentLevel(skill, skills.getMaxLevel(skill), true);
}

function runOf(player) {
  return runs.get(player) ?? null;
}

function start(player, options) {
  if (runOf(player)) return runOf(player);
  const run = new ColosseumRun(player, options);
  run.enter();
  return run;
}

module.exports = { ATTR_RUN, ColosseumRun, runOf, start };
