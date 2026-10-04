"use strict";

/**
 * One player's run of delves against the Doom of Mokhaiotl.
 *
 * Capture (delve 1):
 * - Jumping the gap fades out, copies the map square into an instance and puts the player at
 *   (1311, 9559) with "Delve level: 1". The gap behind them becomes 57290 (Exit, Quick-exit).
 * - The Doom surfaces once the player moves: at (1309, 9571), anim 12418 with graphic 3372.
 *   That tick sets varp 4805 to the cycle and opens the boss HUD (varp 1683 = 14707, varbits
 *   6099/6100 its hitpoints, 12401 = 1, script 2376 then 2887 to fade it in). Its headbar is 20.
 * Wiki:
 * - The Doom doesn't appear until the player exits the prompt, moves or prays.
 * - Beaten, it burrows down and leaves a burrow hole: Investigate shows the rewards so far
 *   (claim and leave), Descend follows it to the next delve.
 * - Claiming, dying or teleporting out resets the delve level to 1; dying after the first
 *   delve loses the run's rewards. Death returns the player to the lobby.
 * Guesses, to check against a deeper capture: the Doom's death animation and graphic
 *   (dom_despawn), the burrow hole's place (where the Doom was) and how long it takes to
 *   appear, where descending puts the player (back at the arrival tile), the completion message.
 */

const Shared = require("./DoomShared");
const Delves = require("./DoomDelves");
const Boss = require("./DoomBoss");
const Hazards = require("./DoomHazards");
const { AcidPools } = require("./DoomAcid");
const { ShieldPhase } = require("./DoomShield");
const { BurrowPhase } = require("./DoomBurrow");
const Loot = require("./DoomLoot");
const Records = require("./DoomRecords");
const HolyWater = require("./DoomHolyWater");

const ATTR = { RUN: "doom:run", UNCLAIMED: "doom:unclaimed", ...Records.ATTR };

const ANIM = { EMERGE: 12418, DESPAWN: 12422 };
const GFX = { EMERGE: 3372, DESPAWN: 3377 };
const HEALTH_BAR = { id: 20, width: 120 };
/** Capture: the burrow hole opens 5 ticks after the Doom's death (loc anim 12477), and the Doom goes at 7. */
const HOLE_DELAY = 5;
const BOSS_GONE = 7;
const HOLE_ANIM = 12477;
const DESCENT_TEXT = "You jump further into the burrow...";
const MUSIC = 828;
const GAP_ROTATION = 1;

/** The boss HUD (interface 303), as the capture opens it. */
const HUD = {
  openScript: 2376,
  fadeInScript: 2887,
  fadeOutScript: 2889,
  components: [0, 2, 4, 5, 8, 10, 20, 13, 14, 15, 9, 6, 7, 11, 18, 19, 16, 17, 3].map((child) => (303 << 16) | child),
  fadeComponents: [5, 8, 6, 7, 9, 11, 13, 14, 15, 20, 18, 19, 16, 17].map((child) => (303 << 16) | child),
  hp: (303 << 16) | 5,
  /** The bar's back, sliding and remaining parts, and their colours (15-bit RGB, capture). */
  colourComponents: [13, 14, 15].map((child) => (303 << 16) | child),
  colours: [25600, 576, 800],
  shieldColours: [132, 623, 853],
  updateScript: 2102,
  /** cc_deleteall on hpbar_hud:container (capture, at each delve change). */
  clearScript: 2249,
  container: (303 << 16) | 1,
  updateComponents: [5, 20, 13, 14, 15, 8, 9, 18, 19, 16, 17].map((child) => (303 << 16) | child),
};

const runs = new Map();
let ArenaClass = null;

function arenaClass() {
  if (ArenaClass) return ArenaClass;
  const { PrivateArea, Boundary } = Shared.core();
  const { ARENA, DEEP_ARENA } = Shared;
  ArenaClass = class DoomArena extends PrivateArea {
    /** Delve 1's arena (beside the lobby) and the deeper square delves 2+ are fought in. */
    constructor() {
      super([ARENA, DEEP_ARENA].map((box) => new Boundary(box.minX, box.maxX, box.minY, box.maxY, box.z)));
      this.run = null;
    }

    getName() {
      return "Doom of Mokhaiotl";
    }

    isMulti() {
      return true;
    }

    allowSummonPet() {
      return false;
    }

    /** Teleporting out or logging out ends the run (Wiki: the delve level resets). */
    postLeave(mobile, logout) {
      if (mobile.isPlayer?.() && this.run?.player === mobile.getAsPlayer()) {
        this.run.end(logout ? "logout" : "left", { fromArea: true });
      }
      super.postLeave(mobile, logout);
    }
  };
  return ArenaClass;
}

function savePlayer(player) {
  try {
    Shared.core().GameConstants.PLAYER_PERSISTENCE?.save(player);
  } catch (error) {
    console.warn("[doom] save failed", error);
  }
}

function formatTicks(ticks) {
  const seconds = ticks * 0.6;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${(seconds % 60).toFixed(2).padStart(5, "0")}`;
}

class DoomRun {
  constructor(player, { random = Math.random } = {}) {
    this.player = player;
    this.random = random;
    this.area = new (arenaClass())();
    this.area.run = this;
    this.level = 0;
    this.stage = "waiting";
    this.boss = null;
    this.hole = null;
    this.ticks = 0;
    this.levelStart = 0;
    this.runTicks = 0;
    this.arrivedAt = null;
    this.task = null;
    /** Levels completed this run, the loot so far, and whether this delve's loot has a unique. */
    this.completed = [];
    this.loot = [];
    this.uniqueWaiting = false;
    this.startedAt = 1;
    this.immuneUntil = 0;
    this.hazards = new Hazards.HazardSet(this);
    this.attacks = new Boss.AttackCycle(this);
    this.acid = new AcidPools(this);
    this.shield = new ShieldPhase(this);
    this.burrow = new BurrowPhase(this);
    runs.set(player, this);
  }

  get delve() {
    return Delves.delve(this.level);
  }

  /** From delve 2 the run is in the deeper square (capture). */
  get deep() {
    return this.level >= 2;
  }

  /** A delve-1 tile in the square this delve is fought in. */
  tile(tile) {
    return Shared.shift(tile, this.deep);
  }

  // ---------------------------------------------------------------- arriving

  /** Over the gap: into the instance at delve 1. */
  enter() {
    const player = this.player;
    savePlayer(player);
    player.setAttribute(ATTR.RUN, true);
    this.area.enter(player);
    this.place(Shared.TILES.ARRIVAL);
    this.placeExit();
    this.task = Shared.repeat(this, 1, () => this.tick());
    this.startLevel(1);
  }

  /** Capture: the gap behind the player becomes 57290 (Exit, Quick-exit). */
  placeExit() {
    const { GameObject, ObjectManager } = Shared.core();
    this.exit = new GameObject(Shared.OBJECT.GAP_EXIT, Shared.loc(Shared.TILES.GAP), 10, GAP_ROTATION, this.area);
    ObjectManager.register(this.exit, true);
  }

  place(tile) {
    const player = this.player;
    player.getMovementQueue().reset();
    player.moveTo(Shared.loc(tile));
    this.arrivedAt = player.getLocation().clone();
  }

  startLevel(level) {
    this.level = level;
    this.stage = "waiting";
    this.attacks.reset();
    this.resetHud();
    const sender = this.player.getPacketSender();
    sender.sendVarbit(Shared.VARBIT.MISSED_ORBS, this.hazards.charge);
    this.player.sendMessage(`<col=ef1020>Delve level: ${level}</col>`);
  }

  /** The Doom surfaces once the prompt is gone, or the player moves or prays (Wiki). */
  readyToEmerge() {
    const { PrayerHandler } = Shared.core();
    const player = this.player;
    if (!player.getLocation().equals(this.arrivedAt)) return true;
    if (PrayerHandler.OVERHEAD_PRAYERS.some((prayer) => PrayerHandler.isActivated(player, prayer))) return true;
    // Capture: the gap and every descent leave a prompt up ("You jump further into the burrow...").
    return !player.getDialogueManager().isActive?.();
  }

  emerge() {
    const { Animation } = Shared.core();
    const boss = this.spawnNpc(Shared.NPC.DOOM, this.tile(Shared.TILES.BOSS));
    if (!boss) {
      this.end("left");
      return;
    }
    this.boss = boss;
    const hp = this.delve.hp;
    boss.setMaxHitpoints(hp);
    boss.setHitpoints(hp);
    boss.setHealthBar?.(HEALTH_BAR);
    boss.setFlag?.("combat:no-retaliate");
    boss.setFlag?.("interaction:keep");
    boss.getMovementQueue().setBlockMovement(true);
    boss.performAnimation(new Animation(ANIM.EMERGE));
    boss.performGraphic(Shared.gfx(GFX.EMERGE));
    boss.setMobileInteraction?.(this.player);
    this.stage = "fight";
    this.levelStart = this.ticks;
    this.attacks.begin();
    this.acid.levelStarted();
    const sender = this.player.getPacketSender();
    // Capture: the level's start cycle, the level (0-based), and the last level's time cleared.
    sender.sendConfig(Shared.VARP.LEVEL_START, Shared.cycle())
      .sendConfig(Shared.VARP.CURRENT_LEVEL, this.level - 1)
      .sendConfig(Shared.VARP.LAST_DURATION, 0);
    sender.sendSong?.(MUSIC);
    this.showHud();
  }

  spawnNpc(id, tile) {
    const npc = Shared.api().spawnNpc({ id, x: tile.x, y: tile.y, z: 0, wanderRadius: 0 });
    if (!npc) return null;
    npc.__skipDefaultRespawn = true;
    npc.__doomRun = this;
    this.area.add(npc);
    return npc;
  }

  removeNpc(npc) {
    if (!npc) return;
    if (npc.isRegistered?.()) Shared.api().removeNpc(npc);
  }

  // ---------------------------------------------------------------- the loop

  tick() {
    if (this.stage === "ended") return false;
    this.ticks++;
    if (this.stage === "waiting") {
      if (this.readyToEmerge()) this.emerge();
      return true;
    }
    if (this.stage !== "fight") return true;
    const boss = this.boss;
    if (!boss || !boss.isRegistered?.() || boss.getHitpoints() <= 0) return true;
    // Its attacks are scripted: keep it from regenerating as if out of combat.
    boss.getCombat().getLastAttack?.().reset?.();
    // Capture: burrowed, it isn't locked on; it faces tiles now and then (DoomBurrow).
    if (this.attacks.phase !== "burrow" && boss.getInteractingMobile?.() !== this.player) boss.setMobileInteraction?.(this.player);
    this.hazards.tick();
    this.acid.tick();
    if (this.player.getHitpoints() > 0) this.attacks.tick();
    this.updateHud();
    return true;
  }

  /** Damage from the fight rather than a blow: debris, larvae, shockwaves, the beam. */
  hurt(amount, mask = "RED") {
    // Wiki: a short grace as the Doom burrows, when nothing it does can hurt.
    if (this.stage !== "fight" || this.ticks < this.immuneUntil) return;
    Shared.damage(this.player, amount, mask);
  }

  /** Capture: the Doom's heal shows as a heal hitsplat (6). */
  heal(amount) {
    const boss = this.boss;
    if (!boss || boss.getHitpoints() <= 0) return;
    boss.heal(amount);
    boss.showHitsplat?.(amount, { mine: Shared.SPLAT.HEAL, others: Shared.SPLAT.HEAL });
    this.updateHud();
  }

  /**
   * Capture: the HUD's bar is recoloured (303:13-15) blue while the shield is up and back after,
   * then script 2102 redraws it.
   */
  hudColours(shielded, redraw = true) {
    const sender = this.player.getPacketSender();
    const colours = shielded ? HUD.shieldColours : HUD.colours;
    HUD.colourComponents.forEach((component, index) => sender.sendInterfaceColour?.(component, colours[index]));
    if (redraw) sender.sendInterfaceScript(HUD.updateScript, [...HUD.updateComponents, 1]);
  }

  // ---------------------------------------------------------------- the HUD

  /**
   * Capture: as the Doom surfaces, the HUD's varps, its bar colours, then 2376 with `hp` still
   * hidden (see resetHud) - only then does 2377 lay the bar out (2246, 2101) and fade it in. A
   * finished fade-out leaves the parts at 255 and 2887 does nothing when told to start from where
   * they already are, so it is also faded in from 254 (as the Gemstone Crab's HUD).
   */
  showHud() {
    const sender = this.player.getPacketSender();
    this.updateHud();
    this.hudColours(false, false);
    sender.sendInterfaceScript(HUD.openScript, HUD.components);
    sender.sendInterfaceScript(HUD.fadeInScript, [...HUD.fadeComponents, 254]);
  }

  /** Capture: jumping the gap and each descent hide the HUD's `hp` and empty its container. */
  resetHud() {
    const sender = this.player.getPacketSender();
    sender.sendInterfaceDisplayState(HUD.hp, true);
    sender.sendInterfaceScript(HUD.clearScript, [HUD.container]);
  }

  /** The HUD shows the shield's points while it is up (Wiki: the bar turns blue then). */
  updateHud(force = false) {
    const boss = this.boss;
    if (!boss) return;
    const shielded = this.shield.up;
    const hp = shielded ? this.shield.hudPoints() : Math.max(0, boss.getHitpoints());
    const npc = shielded ? Shared.NPC.DOOM_SHIELDED
      : boss.getId() === Shared.NPC.DOOM_BURROWED ? Shared.NPC.DOOM_BURROWED : Shared.NPC.DOOM;
    if (!force && hp === this.hudHp && npc === this.hudNpc) return;
    this.hudHp = hp;
    this.hudNpc = npc;
    this.player.getPacketSender()
      .sendConfig(Shared.VARP.HUD_NPC, npc)
      .sendVarbit(Shared.VARBIT.HUD_HP, hp)
      .sendVarbit(Shared.VARBIT.HUD_MAX, shielded ? 500 : boss.getMaxHitpoints())
      .sendVarbit(Shared.VARBIT.HUD_BOSS, 1);
  }

  hideHud(fade = true) {
    const sender = this.player.getPacketSender();
    if (fade) sender.sendInterfaceScript(HUD.fadeOutScript, [...HUD.fadeComponents, 0]);
    sender.sendConfig(Shared.VARP.HUD_NPC, -1)
      .sendVarbit(Shared.VARBIT.HUD_HP, 0)
      .sendVarbit(Shared.VARBIT.HUD_MAX, 0)
      .sendVarbit(Shared.VARBIT.HUD_BOSS, 0);
    this.hudHp = undefined;
    this.hudNpc = undefined;
  }

  // ---------------------------------------------------------------- a delve won

  /** The Doom is beaten: it goes down, its hazards with it, and the burrow hole opens. */
  defeated() {
    if (this.stage !== "fight") return;
    const { Animation } = Shared.core();
    const boss = this.boss;
    this.stage = "burrowing";
    this.attacks.stop();
    this.shield.stop();
    this.burrow.stop();
    this.hazards.levelEnded();
    boss.setHitpointsLocked?.(false);
    boss.setNpcTransformationId?.(-1);
    boss.setHitpoints(0);
    boss.performAnimation(new Animation(ANIM.DESPAWN));
    boss.performGraphic(Shared.gfx(GFX.DESPAWN));
    if (HolyWater.punishKill(this)) HolyWater.launch(this, boss);
    this.punishedAt = undefined;
    this.player.getCombat().reset?.();
    const ticks = this.ticks - this.levelStart;
    this.runTicks += ticks;
    this.completed.push({ level: this.level, ticks });
    this.announce(ticks);
    const { items, unique } = Loot.roll(this.level, this.random);
    Loot.merge(this.loot, items);
    this.uniqueWaiting = unique;
    this.hideHud();
    const tile = Shared.tileOf(boss);
    Shared.later(this, HOLE_DELAY, () => this.openHole(tile));
    Shared.later(this, BOSS_GONE, () => {
      if (this.boss === boss) this.boss = null;
      this.removeNpc(boss);
    });
  }

  /**
   * Capture: "Delve level: 1 duration: 0:53.40. Personal best: 0:40.80" and "Total duration:
   * 0:53.40", with varps 4807 (all delves), 4808+ (this level's completions), 4798 (the level,
   * 0-based), 4804 (its ticks) and 4803 (the run's ticks). Guess: a new best's wording.
   */
  announce(ticks) {
    const player = this.player;
    const key = Records.levelKey(this.level);
    const best = Records.personal(player).best[key];
    Records.completed(player, this.level, ticks, this.startedAt === 1 && this.level === 8 ? this.runTicks : 0);
    const red = (text) => `<col=ef1020>${text}</col>`;
    const bestText = best > 0 && best <= ticks ? `. Personal best: ${red(formatTicks(best))}` : ` (new personal best)`;
    player.sendMessage(`Delve level: ${this.level} duration: ${red(formatTicks(ticks))}${bestText}`);
    player.sendMessage(`Total duration: ${red(formatTicks(this.runTicks))}`);
    const mine = Records.personal(player);
    const total = Object.values(mine.completions).reduce((sum, value) => sum + value, 0);
    player.getPacketSender()
      .sendConfig(Shared.VARP.TOTAL_LEVELS, total)
      .sendConfig(Shared.VARP.LEVEL_COMPLETIONS + Math.min(this.level, 9) - 1, mine.completions[key] ?? 0)
      .sendConfig(Shared.VARP.LAST_LEVEL, this.level - 1)
      .sendConfig(Shared.VARP.LAST_DURATION, ticks)
      .sendConfig(Shared.VARP.TOTAL_DURATION, this.runTicks);
  }

  openHole(tile) {
    if (this.stage !== "burrowing") return;
    const { Animation, GameObject, ObjectManager } = Shared.core();
    this.hole = new GameObject(Shared.OBJECT.BURROW_HOLE, Shared.loc(tile), 10, 0, this.area);
    ObjectManager.register(this.hole, true);
    this.player.getPacketSender().sendObjectAnimation?.(this.hole, new Animation(HOLE_ANIM));
    this.stage = "hole";
  }

  closeHole() {
    if (!this.hole) return;
    Shared.core().ObjectManager.deregister(this.hole, true);
    this.hole = null;
  }

  /** Wiki: descending with a unique waiting asks first. */
  askToDescend() {
    if (this.stage !== "hole") return;
    if (!this.uniqueWaiting) {
      this.descend();
      return;
    }
    Shared.options(this.player, "You have a unique reward waiting. Risk it and delve deeper?",
      "Yes, delve deeper.", () => this.descend(),
      "No.", () => {});
  }

  /** The burrow hole's Descend: after the Doom, to the next delve. */
  descend() {
    if (this.stage !== "hole") return;
    this.stage = "descending";
    const wasDeep = this.deep;
    Shared.statement(this.player, DESCENT_TEXT);
    Shared.fadeMove(this.player, () => {
      if (this.stage !== "descending") return;
      this.closeHole();
      this.hazards.descended(this.level + 1, !wasDeep);
      this.level++;
      this.place(this.tile(Shared.TILES.DESCENT));
      this.startLevel(this.level);
    });
  }

  /** Claim & Leave: the loot goes to the claiming screen (and the lobby's chest), and the run is over but for leaving. */
  claim() {
    if (this.stage !== "hole") return;
    this.keepLoot();
    this.stage = "claimed";
  }

  /** The run's loot joins what the lobby's chest holds. */
  keepLoot() {
    if (this.loot.length === 0) return;
    const player = this.player;
    const pile = Array.isArray(player.getAttribute(ATTR.UNCLAIMED)) ? player.getAttribute(ATTR.UNCLAIMED).map((item) => ({ ...item })) : [];
    player.setAttribute(ATTR.UNCLAIMED, Loot.merge(pile, this.loot));
    this.loot = [];
  }

  /**
   * Wiki: dying after descending loses the run's loot; leaving any other way without claiming
   * leaves it in the lobby's chest.
   */
  settleLoot(reason) {
    if (this.loot.length === 0) return;
    if (reason === "death" && this.stage !== "hole") {
      this.loot = [];
      this.player.sendMessage("The loot you had earned is lost.");
      return;
    }
    this.keepLoot();
    this.player.sendMessage("Your unclaimed loot waits in the chest in the lobby.");
  }

  // ---------------------------------------------------------------- leaving

  /** The gap's Exit: a question first while there is something to lose. */
  askToExit() {
    if ((this.stage === "waiting" && this.level === 1 && this.loot.length === 0) || this.stage === "claimed") {
      this.end("exit");
      return;
    }
    Shared.options(this.player, "Are you sure you want to leave? Your delve level will be reset.",
      "Yes.", () => this.end("exit"),
      "No.", () => {});
  }

  /**
   * The instance's locs stay on the client after the run (nothing rebuilds the region), so
   * the player is shown the lobby's gap again and the run's rocks and hole taken away.
   */
  restoreView() {
    const { GameObject } = Shared.core();
    const sender = this.player.getPacketSender();
    for (const object of [this.hole, ...this.hazards.rocks]) {
      if (object) sender.sendObjectRemoval(object);
    }
    sender.sendObject(new GameObject(Shared.OBJECT.GAP, Shared.loc(Shared.TILES.GAP), 10, GAP_ROTATION, null));
  }

  /**
   * Ends the run. `claimed` and `exit` walk out to the lobby; a death, teleport or logout has
   * already moved the player (or will on login).
   */
  end(reason, { fromArea = false } = {}) {
    if (this.stage === "ended") return;
    this.stage = "ended";
    this.task?.stop?.();
    runs.delete(this.player);
    const player = this.player;
    player.setAttribute(ATTR.RUN, null);
    this.settleLoot(reason);
    if (reason === "claimed" || reason === "exit" || reason === "death") this.restoreView();
    this.attacks.stop();
    this.shield.stop();
    this.burrow.stop();
    this.hazards.cleared();
    this.acid.clear();
    this.closeHole();
    this.removeNpc(this.boss);
    this.boss = null;
    this.hideHud(false);
    this.resetHud();
    player.getPacketSender().sendVarbit(Shared.VARBIT.MISSED_ORBS, 0).sendConfig(Shared.VARP.CURRENT_LEVEL, 0);
    if (!fromArea && player.getArea?.() === this.area) this.area.leave(player, reason === "logout");
    if (!this.area.isDestroyed()) this.area.destroy();
    if (reason === "claimed" || reason === "exit") {
      Shared.fadeMove(player, () => player.moveTo(Shared.loc(Shared.TILES.LOBBY_GAP)));
    }
  }
}

function runOf(player) {
  return runs.get(player) ?? null;
}

function start(player, options) {
  if (runOf(player)) return runOf(player);
  const run = new DoomRun(player, options);
  run.enter();
  return run;
}

module.exports = { ATTR, DoomRun, runOf, start, formatTicks };
