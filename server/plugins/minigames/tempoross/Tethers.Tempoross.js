"use strict";

/**
 * The two masts and two totem poles players tether to when a wave comes, and their repairs.
 *
 * Captures: Tether plays `human_bone_sacrifice` with spotanim 1844 and sound 1439 (2 loops);
 * a tick later varbit 11895 takes the site's value (1 north totem, 2 west mast, 3 east mast,
 * 4 south totem) and spotanim 1845 loops every tick; then "You securely tether yourself to the
 * mast." / "...to the totem pole.". Walking: "You must untether yourself to move away."; any
 * other action untethers first ("You untether yourself from the mast.", `human_pickuptable`,
 * spotanim 1846, sound 2247). The wave hits: "...the rope keeps you securely upright as the wave
 * washes over you." (+10 points). Repair: `human_poh_build`, sound 938, "You repair the mast."
 * and without a hammer the mesbox "You need a hammer to repair the mast.".
 * Wiki: a rope or the full spirit angler outfit tethers; each site breaks 15-25% of waves,
 * scaling with the storm; repairing gives 40 points and 4 x Construction level XP.
 */

const Shared = require("./Shared.Tempoross");
const { coveOf } = require("./Cove.Tempoross");

const { DATA, ITEM, VARBIT, ANIM, GFX, SOUND, SCRIPT } = Shared;
const F = DATA.fight;

const TETHER_HEIGHT = 124;
const OUTFIT = ["SPIRIT_ANGLER_HEADBAND", "SPIRIT_ANGLER_TOP", "SPIRIT_ANGLER_WADERS", "SPIRIT_ANGLER_BOOTS"];

class Tethers {
  constructor(fight) {
    this.fight = fight;
    this.cove = fight.cove;
    /** { data, broken, loc } in DATA order. */
    this.sites = [];
    /** player -> { site, task } */
    this.tethered = new Map();
  }

  setUp() {
    for (const data of DATA.cove.tethers) {
      this.sites.push({ data, broken: false, loc: this.cove.templateLoc(data.tile) });
    }
  }

  siteAt(location) {
    const [x, y] = this.cove.templateTile(location);
    return this.sites.find((site) => site.data.tile[0] === x && site.data.tile[1] === y) ?? null;
  }

  /** Script 4074 arguments 7-10: each site whole (1) or broken (0), in the HUD's order. */
  hudFlags() {
    const flags = [1, 1, 1, 1];
    for (const site of this.sites) flags[site.data.hud] = site.broken ? 0 : 1;
    return flags;
  }

  siteOf(player) {
    return this.tethered.get(player)?.site ?? null;
  }

  tether(player, site) {
    const sender = player.getPacketSender();
    Shared.stopAction(player);
    player.getMovementQueue().setBlockMovement(true).reset();
    player.setPositionToFace(site.loc.getLocation());
    Shared.animate(player, ANIM.TETHER);
    Shared.graphic(player, GFX.TETHER, TETHER_HEIGHT);
    sender.sendSound(SOUND.TETHER, 100, 0);
    const entry = { site, task: null };
    this.tethered.set(player, entry);
    Shared.later(player, 1, () => {
      if (this.tethered.get(player) !== entry) return;
      sender.sendVarbit(VARBIT.TETHERED, site.data.varbit);
      entry.task = Shared.repeat(player, 1, () => {
        if (this.tethered.get(player) !== entry || !player.isRegistered()) return false;
        Shared.graphic(player, GFX.TETHER_LOOP, TETHER_HEIGHT);
        return true;
      });
    });
    Shared.later(player, 2, () => {
      if (this.tethered.get(player) === entry) player.sendMessage(`You securely tether yourself to the ${site.data.kind}.`);
    });
  }

  untether(player, { quiet = false } = {}) {
    const entry = this.tethered.get(player);
    if (!entry) return false;
    this.tethered.delete(player);
    player.getMovementQueue().setBlockMovement(false);
    entry.task?.stop();
    if (!player.isRegistered()) return true;
    const sender = player.getPacketSender();
    sender.sendVarbit(VARBIT.TETHERED, 0);
    sender.sendClientScript(SCRIPT.WAVE_HIDE, F.waveOverlayHide);
    if (quiet) return true;
    Shared.animate(player, ANIM.UNTETHER);
    Shared.graphic(player, GFX.UNTETHER, TETHER_HEIGHT);
    sender.sendSound(SOUND.UNTETHER, 100, 0);
    Shared.later(player, 1, () => player.sendMessage(`You untether yourself from the ${entry.site.data.kind}.`));
    return true;
  }

  onLeave(player) {
    this.untether(player, { quiet: true });
  }

  /** Every site rolls to break, 15% at no storm up to 25% at a full one (Wiki). */
  breakSites() {
    const [low, high] = F.tetherBreak;
    const chance = (low + ((high - low) * this.fight.storm) / F.stormMax) / 100;
    for (const site of this.sites) {
      if (site.broken || Math.random() >= chance) continue;
      for (const [player, entry] of this.tethered) {
        if (entry.site === site) this.untether(player, { quiet: true });
      }
      site.broken = true;
      site.loc = this.cove.replaceLoc(site.loc, site.data.broken);
      this.cove.areaSound(SOUND.MAST_BREAK, site.loc.getLocation(), 10);
    }
  }

  repair(player, site) {
    site.broken = false;
    site.loc = this.cove.replaceLoc(site.loc, site.data.loc);
    player.sendMessage(`You repair the ${site.data.kind}.`);
    this.fight.addPoints(player, DATA.points.repair);
    Shared.addXp(player, "CONSTRUCTION", 4 * Shared.baseLevel(player, "CONSTRUCTION"));
  }
}

function hasRope(player) {
  if (player.getInventory().contains(ITEM.ROPE)) return true;
  const { ItemIdentifiers } = Shared.core();
  return OUTFIT.every((name) => player.getEquipment().contains(ItemIdentifiers[name]));
}

/** Any other action in the cove lets go of the rope first, as the captures show. */
function untetherFor(player) {
  coveOf(player)?.fight?.tethers.untether(player);
}

function tetherSite(event) {
  const { player, object } = event;
  const tethers = coveOf(player)?.fight?.tethers;
  const site = tethers?.siteAt(object.getLocation());
  if (!site) return false;
  if (tethers.siteOf(player) === site) return true;
  tethers.untether(player);
  if (site.broken) return true;
  if (!hasRope(player)) {
    player.sendMessage(`You need a rope to tether yourself to the ${site.data.kind}.`);
    return true;
  }
  tethers.tether(player, site);
  return true;
}

function untetherSite(event) {
  const tethers = coveOf(event.player)?.fight?.tethers;
  if (!tethers) return false;
  tethers.untether(event.player);
  return true;
}

function repairSite(event) {
  const { player, object } = event;
  const tethers = coveOf(player)?.fight?.tethers;
  const site = tethers?.siteAt(object.getLocation());
  if (!site) return false;
  untetherFor(player);
  if (!site.broken) return true;
  if (!player.getInventory().contains(ITEM.HAMMER)) {
    Shared.statement(player, `You need a hammer to repair the ${site.data.kind}.`);
    return true;
  }
  Shared.stopAction(player);
  player.setPositionToFace(object.getLocation());
  Shared.animate(player, ANIM.REPAIR);
  player.getPacketSender().sendSound(SOUND.REPAIR, 100, 0);
  Shared.startAction(player, "repair", (ticks) => {
    if (!site.broken) return false;
    if (ticks < 2) return true;
    tethers.repair(player, site);
    return false;
  });
  return true;
}

/** Player -> the cycle a walk was refused on, while tethered. */
const refusedWalkAt = new WeakMap();

/** Walking off while tethered is refused; clicking something else untethers instead. */
function walkWhileTethered(event) {
  const { player } = event;
  if (!coveOf(player)?.fight?.tethers.siteOf(player)) return;
  event.handled = true;
  player.getMovementQueue().reset();
  refusedWalkAt.set(player, Shared.core().World.getProcessCycle());
  player.sendMessage("You must untether yourself to move away.");
}

/**
 * Reject walks before routing; other actions let go before their route can move the player
 * (rsprox 227/00552.txt tick 16915: a crate click untethers, then "You untether yourself from the
 * mast."). A click in the same tick as a refused walk keeps the tether and can't reach (227/01858.txt
 * tick 4744: move_gameclick, the crate, "You must untether yourself to move away.", "I can't reach that!").
 */
function inputWhileTethered(event) {
  const { player } = event;
  if (!coveOf(player)?.fight?.tethers.siteOf(player)) return;
  if (event.packet.type === "move" || event.packet.type === "world_map_click") {
    walkWhileTethered(event);
  } else if (refusedWalkAt.get(player) === Shared.core().World.getProcessCycle()) {
    event.handled = true;
    player.sendMessage("I can't reach that!");
  } else {
    untetherFor(player);
  }
}

function attachTethers(api) {
  api.onObjectInteraction("Mast", { Tether: tetherSite, Untether: untetherSite });
  api.onObjectInteraction("Totem pole", { Tether: tetherSite, Untether: untetherSite });
  api.onObjectInteraction("Damaged mast", { Repair: repairSite });
  api.onObjectInteraction("Damaged totem pole", { Repair: repairSite });
  api.onWalkRoute(walkWhileTethered);
  api.onCustomEvent("player:world-input", inputWhileTethered);
}

module.exports = { Tethers, attachTethers, untetherFor, hasRope };
