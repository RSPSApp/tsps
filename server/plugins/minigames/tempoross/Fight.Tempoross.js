"use strict";

/**
 * The fight in one cove (captures 552, 1858, 3275; Wiki for the numbers):
 * - intro: the HUD opens 3 ticks after arrival with its first argument true and a bar rising
 *   2 a tick from 130 to 240; then Tempoross surfaces.
 * - surfaced: the storm rises 1 a tick (out of 350, and the fight is lost at 350); cannon
 *   fire drains energy; Tempoross attacks. At 0 energy it submerges.
 * - submerged: the storm is 0; 11 ticks in the spirit pools open and energy starts coming back,
 *   to full in 77 ticks (solo: 35 a tick). Fishing the pools drains essence; 0 essence wins.
 *   Full energy surfaces it again, and after the third time it is enraged: the storm races and
 *   the fight is soon lost.
 * - Tempoross surfaces with `fsb_spawn` (8897) on the first rise and `fsb_whirl_to_ready`
 *   (8901) after a submerge, and submerges with `fsb_ready_to_whirl` (8900). The first enrage
 *   plays `fsb_enraged_transition` (8906), then 10575 with `fsb_enraged_spawn` (8908).
 * Energy and essence are ten times the Wiki's numbers, as the HUD script takes them.
 */

const Shared = require("./Shared.Tempoross");
const Records = require("./Records.Tempoross");
const Spots = require("./Spots.Tempoross");
const Cannons = require("./Cannons.Tempoross");
const Tethers = require("./Tethers.Tempoross");
const Attacks = require("./Attacks.Tempoross");

const { DATA, NPC, VARBIT, SCRIPT, INTERFACE, JINGLE, MUSIC, ANIM } = Shared;
const F = DATA.fight;

const HUD_DELAY = 3;
/** The lobby's Captain Pudi, who greets everyone coming back. */
const CAPTAIN_PUDI = 10583;
const HUD_PERIOD = 2;

/** Linear from the solo value to the 40-player value per player (Wiki, citing Mod Squid). */
function scaled({ solo, full }, players) {
  const n = Math.max(1, Math.min(DATA.lobby.maxPlayers, players));
  const each = solo + ((full - solo) * (n - 1)) / (DATA.lobby.maxPlayers - 1);
  return Math.round(each * n);
}

class Fight {
  constructor(cove) {
    this.cove = cove;
    this.phase = "intro";
    this.ticks = 0;
    this.surfacedAt = -1;
    this.submergedAt = -1;
    this.firstSurfaceTick = -1;
    this.introBar = F.introBar.from;
    this.maxEnergy = 0;
    this.maxEssence = 0;
    this.energy = 0;
    this.essence = 0;
    this.storm = 0;
    this.submerges = 0;
    this.enraged = false;
    this.result = null;
    this.boss = null;
    this.hosts = [];
    this.task = null;
    this.stopped = false;
    this.spots = new Spots.Spots(this);
    this.cannons = new Cannons.Cannons(this);
    this.tethers = new Tethers.Tethers(this);
    this.attacks = new Attacks.Attacks(this);
  }

  get players() {
    return this.cove.players;
  }

  // ------------------------------------------------------------------ setting up

  setUp() {
    this.maxEnergy = scaled(F.energyPerPlayer, this.cove.crew);
    this.maxEssence = scaled(F.essencePerPlayer, this.cove.crew);
    this.energy = this.maxEnergy;
    this.essence = this.maxEssence;
    this.boss = this.cove.spawnNpc(NPC.BOSS_SUBMERGED, DATA.cove.boss);
    for (const host of DATA.cove.hosts) this.hosts.push({ ...host, npc: this.cove.spawnNpc(host.id, host.tile) });
    this.spots.setUp();
    this.cannons.setUp();
    this.tethers.setUp();
    this.attacks.setUp();
    this.task = Shared.repeat(this, 1, () => this.tick());
    Shared.later(this, 1, () => this.hostsSay("Tempoross will surface soon, prepare yourselves!"));
  }

  stop() {
    if (this.stopped) return;
    this.stopped = true;
    this.task?.stop();
    this.attacks.stop();
    this.spots.stop();
    this.cannons.stop();
  }

  // ------------------------------------------------------------------ every tick

  tick() {
    if (this.stopped || this.cove.ended) return false;
    this.ticks += 1;
    if (this.ticks === HUD_DELAY) this.forEachPlayer((player) => this.openHud(player));
    switch (this.phase) {
      case "intro":
        if (this.ticks > HUD_DELAY) this.introBar += F.introBar.step;
        if (this.introBar >= F.introBar.to) this.surface(true);
        break;
      case "surfaced":
        this.storm = Math.min(F.stormMax, this.storm + (this.enraged ? F.enragedStormPerTick : F.stormPerTick));
        this.attacks.tick();
        if (this.storm >= F.stormMax) this.lose();
        break;
      case "submerged":
        if (this.ticks - this.submergedAt > F.regenDelayTicks) {
          this.energy = Math.min(this.maxEnergy, this.energy + this.regenPerTick());
        }
        this.spots.tickSubmerged();
        if (this.energy >= this.maxEnergy) this.surface(false);
        break;
      default:
        break;
    }
    this.spots.tick();
    this.cannons.tick();
    this.attacks.tickFires();
    if (this.ticks >= HUD_DELAY && this.ticks % HUD_PERIOD === 0) this.forEachPlayer((player) => this.sendHud(player));
    return true;
  }

  /**
   * Energy comes back to full in the same time whatever the crew (captured solo: 35 a tick of
   * 2683). A flat 35 left a crew of several with minutes of essence fishing, so it never
   * surfaced again.
   */
  regenPerTick() {
    return Math.ceil(this.maxEnergy / F.regenFullTicks);
  }

  forEachPlayer(action) {
    this.cove.forEachPlayer(action);
  }

  hostsSay(text) {
    for (const host of this.hosts) host.npc?.forceChat(text);
  }

  // ------------------------------------------------------------------ phases

  surface(first) {
    // Captures: the ready form plays 8897 on the first surfacing and 8901 (whirl to ready) when
    // it rises after a submerge. The first enrage plays 8906 on the ready form, then turns into
    // 10575 with 8908 five ticks later; later enraged surfacings are 10575 + 8908 directly.
    const enragedSurface = !first && this.submerges >= F.maxSurfacings;
    if (enragedSurface) {
      this.enraged = true;
      this.cove.message(`<col=${Shared.RED}>Tempoross has gathered too much energy. The storm is out of control!</col>`);
      this.hostsSay("Tempoross has gathered too much energy!");
    }
    this.phase = "surfaced";
    this.surfacedAt = this.ticks;
    if (first) this.firstSurfaceTick = this.ticks;
    this.energy = this.maxEnergy;
    this.storm = 0;
    if (!first && this.enraged) {
      if (this.submerges === F.maxSurfacings) {
        this.setBoss(NPC.BOSS);
        Shared.animate(this.boss, ANIM.BOSS_ENRAGED_TRANSITION);
        Shared.later(this, 5, () => {
          if (this.stopped || this.phase !== "surfaced" || !this.enraged) return;
          this.setBoss(NPC.BOSS_ENRAGED);
          Shared.animate(this.boss, ANIM.BOSS_ENRAGED_SPAWN);
        });
      } else {
        this.setBoss(NPC.BOSS_ENRAGED);
        Shared.animate(this.boss, ANIM.BOSS_ENRAGED_SPAWN);
      }
    } else {
      this.setBoss(NPC.BOSS);
      Shared.animate(this.boss, first ? ANIM.BOSS_SPAWN : ANIM.BOSS_WHIRL_TO_READY);
    }
    this.spots.onSurface();
    this.attacks.onSurface();
    if (!this.enraged) this.hostsSay("Tempoross has surfaced, keep those cannons firing!");
    this.forEachPlayer((player) => this.sendHud(player));
  }

  submerge() {
    if (this.phase !== "surfaced") return;
    this.phase = "submerged";
    this.submergedAt = this.ticks;
    this.submerges += 1;
    this.energy = 0;
    this.storm = 0;
    this.enraged = false;
    this.setBoss(NPC.BOSS_SUBMERGED);
    Shared.animate(this.boss, ANIM.BOSS_READY_TO_WHIRL);
    this.cove.message(`<col=${Shared.CYAN}>Tempoross is vulnerable!</col>`);
    this.hostsSay("Tempoross has submerged, fish from the whirlpools!");
    this.attacks.onSubmerge();
    this.spots.onSubmerge();
    this.forEachPlayer((player) => this.sendHud(player));
  }

  setBoss(id) {
    this.boss?.setNpcTransformationId(id);
  }

  /** Cannon fire landing: raw and crystallised 10 energy, cooked 15 (Wiki). */
  damageEnergy(amount) {
    if (this.phase !== "surfaced") return;
    this.energy = Math.max(0, this.energy - amount);
    if (this.energy <= 0) this.submerge();
  }

  damageEssence(amount) {
    if (this.phase !== "submerged") return;
    this.essence = Math.max(0, this.essence - amount);
    if (this.essence <= 0) this.win();
  }

  /** Attacks stop at or below 10% energy (Wiki). */
  calm() {
    return this.energy <= this.maxEnergy * F.lowEnergyCalm;
  }

  // ------------------------------------------------------------------ points

  addPoints(player, amount) {
    if (this.result || !this.players.has(player)) return;
    const before = Shared.points(player);
    const after = Math.min(DATA.points.max, before + amount);
    player.getPacketSender().sendVarbit(VARBIT.POINTS, after);
    if (before < DATA.points.firstPermit && after >= DATA.points.firstPermit) {
      player.sendMessage("You have earned enough points for a reward permit.");
    }
  }

  // ------------------------------------------------------------------ the end

  win() {
    if (this.result) return;
    this.result = "won";
    this.phase = "over";
    // "Subdued in" counts from Tempoross first surfacing (the captured 3:25.80 matches that).
    const time = this.ticks - Math.max(0, this.firstSurfaceTick);
    this.attacks.clearAll();
    this.setBoss(NPC.BOSS_DRAWING_WATER);
    Shared.animate(this.boss, ANIM.BOSS_DEATH);
    this.spots.onOver();
    for (const host of this.hosts) host.npc?.setNpcTransformationId(host.victory);
    this.hostsSay("Tempoross has retreated to the depths!");
    this.forEachPlayer((player) => this.reward(player, time));
    this.celebrate();
    Shared.later(this, F.victoryTicks, () => this.sailBack(true));
  }

  /**
   * Captured on every win: a tick later the hosts and cannoneers cheer; then the hosts dance
   * (866 or the Scottish 2106) every 5 ticks and each cannoneer cheers again every 5-9 ticks.
   */
  celebrate() {
    const { hostDanceTicks, cannoneerCheerTicks } = F.celebration;
    const crew = this.cannons.crates.map((crate) => ({ npc: crate.cannoneer, next: 1 }));
    let ticks = 0;
    Shared.repeat(this, 1, () => {
      if (this.cove.ended) return false;
      ticks += 1;
      for (const host of this.hosts) {
        if (ticks === 1) Shared.animate(host.npc, ANIM.CHEER);
        else if (ticks % hostDanceTicks === 0) Shared.animate(host.npc, Shared.pick([ANIM.DANCE, ANIM.DANCE_SCOTTISH]));
      }
      for (const member of crew) {
        if (ticks < member.next) continue;
        Shared.animate(member.npc, ANIM.CHEER);
        member.next = ticks + Shared.randomInt(...cannoneerCheerTicks);
      }
      return true;
    });
  }

  reward(player, time) {
    const points = Shared.points(player);
    const earned = Records.permitsFor(points);
    const bests = Records.recordBests(player, time, points);
    if (earned > 0) Records.addPermits(player, earned);
    const kills = Records.addKill(player);
    Shared.stopAction(player);
    player.sendMessage(`<col=${Shared.PINK}>The skies clear as Tempoross retreats to the depths.</col>`);
    player.sendMessage("The Spirit Anglers will ferry you back to the Ruins of Unkah in 20 seconds.");
    player.sendMessage(`Subdued in <col=ef1020>${Records.formatTicks(time)}</col>. Personal best: ${Records.formatTicks(bests.time)}.`);
    player.sendMessage(`Points: <col=ef1020>${points.toLocaleString("en-GB")}</col>. Personal best: ${bests.points.toLocaleString("en-GB")}.`);
    player.sendMessage(`Reward permits: <col=ef1020>${earned}</col>. Total permits: <col=ef1020>${Records.permits(player)}</col>.`);
    player.sendMessage(`Your Tempoross kill count is: <col=ff0000>${kills}</col>.`);
    player.getPacketSender().sendJingle(JINGLE.VICTORY, 0);
    Shared.api().emitCustomEvent("tempoross:subdued", { player, points, permits: earned, ticks: time });
  }

  lose() {
    if (this.result) return;
    this.result = "lost";
    this.phase = "over";
    this.attacks.clearAll();
    this.spots.onOver();
    this.forEachPlayer((player) => {
      Shared.stopAction(player);
      player.getPacketSender().sendJingle(JINGLE.DEFEAT, 0);
      Shared.statement(player, "The force of Tempoross' storm forces the Spirit Anglers to sail back to safety...");
    });
    Shared.later(this, 3, () => this.sailBack(false));
  }

  /** Everyone back to the Ruins of Unkah, and Captain Pudi's word on how it went. */
  sailBack(won) {
    for (const player of [...this.players]) this.sendHome(player, won);
    this.cove.end();
  }

  /** Back on the dock: the victory box (after a win), then Captain Pudi's word on how it went. */
  sendHome(player, won) {
    if (!player.isRegistered()) return;
    player.getPacketSender().sendJingle(JINGLE.BOAT, 0);
    this.cove.leave(player);
    const { DialogueChainBuilder, StatementDialogue, NpcDialogue, EndDialogue } = Shared.core();
    const pudi = won
      ? "Excellent work out there! The seas are safe for a little longer thanks to you!"
      : "Argh, we let that storm grow too fierce... As soon as it's safe we'll 'ead straight back out!";
    const chain = new DialogueChainBuilder();
    if (won) chain.add(new StatementDialogue(0, "Victorious, you sail back to the Ruins of Unkah to prepare for the next encounter..."));
    chain.add(new NpcDialogue(won ? 1 : 0, CAPTAIN_PUDI, pudi), new EndDialogue(won ? 2 : 1));
    player.getDialogueManager().startDialogues(chain);
  }

  // ------------------------------------------------------------------ players

  onLeave(player) {
    Shared.stopAction(player);
    this.tethers.onLeave(player);
    this.closeHud(player);
  }

  // ------------------------------------------------------------------ the HUD

  openHud(player) {
    const sender = player.getPacketSender();
    sender.sendSubInterface(Shared.OVERLAY_ATMOSPHERE_UID, INTERFACE.HUD, 1);
    sender.sendSong(MUSIC.COVE);
    Shared.api().emitCustomEvent("music:unlock-track", { player, trackId: MUSIC.COVE });
    this.sendHud(player);
  }

  closeHud(player) {
    if (!player.isRegistered()) return;
    if (player.getPacketSender().isSubInterfaceOpen(INTERFACE.HUD)) {
      player.getPacketSender().closeSubInterface(Shared.OVERLAY_ATMOSPHERE_UID);
    }
  }

  /** Script 4074: [intro, points, energy, essence, energy max, essence max, storm, 4 sites, 4 fires]. */
  hudArgs(player) {
    const intro = this.phase === "intro";
    const sites = this.tethers.hudFlags();
    const fires = this.attacks.fireFlags();
    return [
      intro ? 1 : 0,
      Shared.points(player),
      intro ? this.introBar : this.energy,
      intro ? 100 : this.essence,
      intro ? F.introBar.to : this.maxEnergy,
      intro ? 100 : this.maxEssence,
      this.storm,
      ...sites,
      ...fires,
    ];
  }

  sendHud(player) {
    if (!player.isRegistered()) return;
    player.getPacketSender().sendClientScript(SCRIPT.HUD_UPDATE, ...this.hudArgs(player));
  }
}

module.exports = { Fight, scaled };
