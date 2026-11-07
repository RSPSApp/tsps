/**
 * An unranked duel's fight, as captured (rsprox 20261106T111454, 20261107T010112,
 * 20261107T022508, world 578; six fights):
 * - both arrive on a copy of the battle arena (region 13384's chunks, unrotated), one on each
 *   side: "Unranked Duel participation: N", pvpa_battlearea_status 1 and _longbattle 1, the
 *   build's levels and load-out, the PvP Arena HUD (761) on overlay_atmosphere and "Fight" as
 *   the player option;
 * - each counts down overhead from "10" every two ticks, the first a tick after arriving, then
 *   "FIGHT!" and "Combat has begun!"; an attack before then: "The fight has not yet begun.";
 *   the time left (pvpa_stagingarea_timeremaining, _battlearea_timeremaining) counts down from
 *   2000 ticks, sent every two;
 * - a death: both hear "<winner> has won!"; the winner "Unranked Duel wins: w / n", "The fight
 *   is over.", the duel win jingle; the loser dies, is told "Oh dear, you are dead!", stands up
 *   next to their side's portal with their hands empty and pvpa_battlearea_status 2; the
 *   trapdoor is then out of their reach ("I can't reach that!"), the portal takes them out;
 * - the trapdoor (a Gateway, Leave) during a fight: "Stay for the fight | Exit the Duel", then "Are you sure you
 *   wish to quit this Duel?" - quitting hands the opponent the win, who is told so with the wins
 *   line; the trapdoor after the fight takes the winner out;
 * - out: the Emir's Arena by that side's steps, the HUD closed, the varbits back to 0.
 * Not captured: logging out mid-fight (a forfeit, as Legacy Duels count it) and the time
 * running out (both leave, nobody wins); the west side's death tile mirrors the east's.
 */
const Common = require("./Common.DuelArena");
const Stash = require("./Stash.DuelArena");
const Loadouts = require("./Loadouts.DuelArena");

const HUD = "pvp_arena_hud";
const FIGHT_OPTION = 1;
const RUNE_POUCH = "pvpa_rune_replacement";

/** Fights in play, and which fight each player is in (from arrival until they leave). */
const fights = new Set();
const fightOf = new Map();
/** Deaths that began in a fight end there. */
const dying = new Map();
/** Told when a player leaves a fight, so the Emir's Arena menu can come back. */
let onLeft = () => {};

let AreaClass = null;

function areaClass() {
  if (AreaClass) return AreaClass;
  const { TemplatedInstanceArea } = Common.core;
  AreaClass = class PvpArenaBattleArea extends TemplatedInstanceArea {
    constructor(fight) {
      const { chunk: [cx, cy], size: [w, h], planes } = Common.data.arena;
      super(w, h);
      this.fight = fight;
      this.origin = [cx * 8, cy * 8];
      for (let z = 0; z < planes; z++) {
        for (let x = 0; x < w; x++) {
          for (let y = 0; y < h; y++) {
            this.setChunk(z, x, y, { sourceChunkX: cx + x, sourceChunkY: cy + y, sourcePlane: z, rotation: 0 });
          }
        }
      }
    }

    getName() {
      return "PvP Arena";
    }

    isMulti() {
      return false;
    }

    allowSummonPet() {
      return false;
    }

    /** The instance's copy of a template tile. */
    at([x, y], z = 0) {
      return this.tile(x - this.origin[0], y - this.origin[1], z);
    }

    /** The template tile an instance tile copies. */
    templateOf(location) {
      return [location.getX() - this.getBaseX() + this.origin[0], location.getY() - this.getBaseY() + this.origin[1]];
    }

    canAttack(attacker, target) {
      return this.fight.canAttack(attacker, target);
    }

    canTeleport() {
      return false;
    }

    canTrade() {
      return false;
    }

    postLeave(mobile, logout) {
      const player = Common.asPlayer(mobile);
      if (player) this.fight.left(player, logout);
      super.postLeave(mobile, logout);
    }
  };
  return AreaClass;
}

class Fight {
  constructor(players, build) {
    this.players = players;
    this.build = build;
    this.area = new (areaClass())(this);
    this.sides = new Map(players.map((player, index) => [player, index]));
    this.elapsed = 0;
    this.begun = false;
    this.over = false;
    this.winner = null;
    this.timeLeft = Common.data.fight.timeLimit;
    this.toldNotBegun = new Map();
    /** Each player's Emir's Arena tile, by their side's steps: where they leave (and any save puts them). */
    this.exits = new Map(players.map((player) => [player, pick(this.side(player).exits)]));
  }

  opponentOf(player) {
    return this.players.find((p) => p !== player) ?? null;
  }

  side(player) {
    return Common.data.arena.sides[this.sides.get(player) ?? 0];
  }

  begin() {
    fights.add(this);
    for (const player of this.players) this.arrive(player);
    Common.every(() => this.tick());
  }

  arrive(player) {
    fightOf.set(player, this);
    clearCombat(player);
    player.getMovementQueue().reset();
    Common.core.PrayerHandler.deactivatePrayers(player);
    Stash.save(player, this.exits.get(player));
    const count = Common.add(player, Common.PARTICIPATION_ATTRIBUTE, 1);
    player.sendMessage(Common.message("participation", { count }));
    Loadouts.equip(player, this.build);
    Common.varbit(player, "pvp_area_client", 1);
    Common.varbit(player, "pvpa_battlearea_longbattle", 1);
    Common.varbit(player, "pvpa_battlearea_status", 1);
    Common.api.emitCustomEvent("prayer:sync-unlocks", { player });
    const sender = player.getPacketSender();
    sender.sendInterfaceRemoval();
    this.area.enter(player);
    player.moveTo(this.area.at(this.side(player).spawn));
    sender.sendSubInterface(Common.component("toplevel_osrs_stretch:overlay_atmosphere"), Common.interfaceId(HUD), 1);
    sender.sendPlayerOption(FIGHT_OPTION, "Fight", true);
    sender.sendPlayerOption(Loadouts.LOADOUTS_OPTION, "", false);
  }

  tick() {
    if (fights.has(this) === false) return false;
    this.elapsed++;
    const { countFrom, countEvery, timerEvery } = Common.data.fight;
    if (!this.begun) {
      const step = this.elapsed - 1;
      if (step % countEvery !== 0) return true;
      const count = countFrom - step / countEvery;
      for (const player of this.inArena()) player.forceChat(count > 0 ? String(count) : "FIGHT!");
      if (count <= 0) {
        this.begun = true;
        for (const player of this.inArena()) {
          player.sendMessage(Common.message("begun"));
          this.sendTime(player);
        }
      }
      return true;
    }
    if (this.over) return true;
    this.timeLeft = Math.max(0, this.timeLeft - 1);
    if (this.timeLeft % timerEvery === 0) for (const player of this.inArena()) this.sendTime(player);
    if (this.timeLeft === 0) this.timeUp();
    return true;
  }

  sendTime(player) {
    Common.varbit(player, "pvpa_stagingarea_timeremaining", this.timeLeft);
    Common.varbit(player, "pvpa_battlearea_timeremaining", this.timeLeft);
  }

  /** Players still on the arena copy. */
  inArena() {
    return this.players.filter((player) => fightOf.get(player) === this);
  }

  canAttack(attacker, target) {
    const a = Common.asPlayer(attacker);
    const t = Common.asPlayer(target);
    if (!a || !t) return null;
    if (fightOf.get(a) !== this || fightOf.get(t) !== this || this.opponentOf(a) !== t || this.over) return false;
    if (!this.begun) {
      if (this.toldNotBegun.get(a) !== this.elapsed) {
        this.toldNotBegun.set(a, this.elapsed);
        a.sendMessage(Common.message("notBegun"));
      }
      return false;
    }
    return true;
  }

  /** The fight's result: both hear the winner; the winner their record (and, after a death, its end). */
  decide(winner, byDeath) {
    if (this.over) return;
    this.over = true;
    this.winner = winner;
    for (const player of this.inArena()) player.sendMessage(Common.message("won", { name: winner.getDisplayName() }));
    const wins = Common.add(winner, Common.WINS_ATTRIBUTE, 1);
    const count = Common.number(winner, Common.PARTICIPATION_ATTRIBUTE);
    winner.sendMessage(Common.message("wins", { wins, count }));
    if (byDeath) winner.sendMessage(Common.message("over"));
    const sender = winner.getPacketSender();
    sender.sendSong(Common.data.music.silence);
    sender.sendJingle(Common.data.jingles.win);
    clearCombat(winner);
    const loser = this.opponentOf(winner);
    if (loser) clearCombat(loser);
  }

  /** The time ran out: nobody wins, both leave. */
  timeUp() {
    if (this.over) return;
    this.over = true;
    for (const player of this.inArena()) {
      player.sendMessage(Common.message("over"));
      this.exit(player);
    }
  }

  /** A death here: the result as the loser falls, then their stand next to the portal. */
  dyingStarts(player) {
    dying.set(player, this);
    const winner = this.opponentOf(player);
    if (winner && fightOf.get(winner) === this) this.decide(winner, true);
  }

  died(player) {
    if (fightOf.get(player) !== this) return;
    Stash.clear(player);
    Common.varbit(player, "pvpa_battlearea_status", 2);
    player.getPacketSender().sendPlayerOption(FIGHT_OPTION, "", false);
    player.moveTo(this.area.at(this.side(player).dead));
  }

  /** The trapdoor: out after the fight; during it, the forfeit questions. */
  trapdoor(player) {
    if (this.over) {
      if (this.winner === player) this.exit(player);
      else player.sendMessage(Common.message("cantReach"));
      return;
    }
    Common.api.sendMultiChatboxPrompt(player, "Select an option",
      "Stay for the fight", () => {},
      "Exit the Duel", () => Common.api.sendMultiChatboxPrompt(player, Common.message("quitTitle"),
        "Yes", () => this.forfeit(player),
        "No", () => {}));
  }

  /** The spectator portal (Use, Exit): the way out once the fight is over (spectating isn't modelled). */
  portal(player) {
    if (!this.over) {
      this.trapdoor(player);
      return;
    }
    this.exit(player);
  }

  forfeit(player) {
    if (fightOf.get(player) !== this) return;
    const winner = this.opponentOf(player);
    if (!this.over && winner && fightOf.get(winner) === this) this.decide(winner, false);
    this.exit(player);
  }

  /** Back to the Emir's Arena by their side's steps. */
  exit(player) {
    if (fightOf.get(player) !== this) return;
    player.moveTo(Common.location(this.exits.get(player)));
    if (player.getArea() === this.area) this.area.leave(player, false);
  }

  /** Left the copy (an exit, a logout): their own character back, the fight's marks gone. */
  left(player, logout) {
    if (fightOf.get(player) !== this) return;
    if (!this.over) {
      const winner = this.opponentOf(player);
      if (winner && fightOf.get(winner) === this) this.decide(winner, false);
    }
    fightOf.delete(player);
    // A death begun here still ends safe (no drop, no respawn elsewhere) once they're out.
    if (!player.isDying && player.getHitpoints() > 0) dying.delete(player);
    this.toldNotBegun.delete(player);
    clearCombat(player);
    const sender = player.getPacketSender();
    for (const name of ["pvp_area_client", "pvpa_battlearea_status", "pvpa_battlearea_longbattle"]) Common.varbit(player, name, 0);
    sender.sendPlayerOption(FIGHT_OPTION, "", false);
    sender.closeSubInterface(Common.component("toplevel_osrs_stretch:overlay_atmosphere"));
    Common.core.PrayerHandler.deactivatePrayers(player);
    Stash.restore(player);
    if (logout) player.setLocation(Common.location(this.exits.get(player)));
    else Common.api.emitCustomEvent("prayer:sync-unlocks", { player });
    if (this.inArena().length === 0) {
      fights.delete(this);
      Common.later(2, () => {
        if (!this.area.isDestroyed()) this.area.destroy();
      });
    }
    onLeft(player);
  }
}

/** What a fight leaves on a player: queued hits, poison, venom and freeze (as Last Man Standing clears them). */
function pick(list) {
  return list[Math.floor(Math.random() * list.length)];
}

function clearCombat(player) {
  const { TimerKey } = Common.core;
  const combat = player.getCombat();
  combat.reset();
  combat.getHitQueue().clear();
  player.setPoisonDamage(0);
  player.setVenomed(false);
  player.getTimers().cancel(TimerKey.FREEZE);
  player.getTimers().cancel(TimerKey.FREEZE_IMMUNITY);
}

/** A fight for two players, or null when either still has a character put aside. */
function start(players, build) {
  if (players.some((player) => Stash.stashed(player) || fightOf.has(player))) return null;
  const fight = new Fight(players, build);
  fight.begin();
  return fight;
}

function fightFor(player) {
  return fightOf.get(player) ?? null;
}

// ---------------------------------------------------------------- hooks

function dyingStarts(event) {
  const fight = fightOf.get(event.player);
  if (fight) fight.dyingStarts(event.player);
}

function died(event) {
  const fight = dying.get(event.player) ?? fightOf.get(event.player);
  dying.delete(event.player);
  if (!fight) return;
  event.handled = true;
  fight.died(event.player);
}

function keepItems(event) {
  if (fightOf.has(event.player) || dying.has(event.player)) event.shouldDrop = false;
}

function noBones(event) {
  if (fightOf.has(event.player) || dying.has(event.player)) event.allow = false;
}

function noExperience(event) {
  if (fightOf.has(event.player)) event.allow = false;
}

/** The build's prayers, whatever the account unlocked (as Last Man Standing's builds). */
function bypassPrayerUnlocks(event) {
  if (fightOf.has(event.player)) event.bypass = true;
}

function excludePvpStats(event) {
  if ([event.killer, event.victim].some((player) => player && fightOf.has(player))) event.allow = false;
}

/** The fight's rune pouch (pvpa_rune_replacement): the load-out's spells, without runes (inferred). */
function pouchCovers(player, missingItems) {
  if (!fightOf.has(player) || !player.getInventory().contains(Common.objId(RUNE_POUCH))) return false;
  return missingItems.every((item) => / rune$/.test(Common.core.CacheDefinitions.getItem(item.getId())?.name ?? ""));
}

function pouchSpends() {}

function useTrapdoor({ player }) {
  const fight = fightOf.get(player);
  if (!fight) return false;
  fight.trapdoor(player);
  return true;
}

function usePortal({ player }) {
  const fight = fightOf.get(player);
  if (!fight) return false;
  fight.portal(player);
  return true;
}

/** The world stopping: every fight ends with no winner, and everyone's own character comes back. */
function shutdown() {
  for (const fight of [...fights]) {
    fight.over = true;
    for (const player of fight.inArena()) fight.exit(player);
  }
}

function attachBattle(api, { leftFight }) {
  onLeft = leftFight;
  api.persistAttribute(Common.PARTICIPATION_ATTRIBUTE, 0);
  api.persistAttribute(Common.WINS_ATTRIBUTE, 0);
  api.registerSpellRuneSource({ check: pouchCovers, consume: pouchSpends });
  // By gameval id, not name: they're named "Gateway" and "Portal", as many other locs are.
  api.onObjectFirstClick([Common.locId("pvpa_battlearea_trapdoor")], useTrapdoor);
  api.onObjectFirstClick([Common.locId("pvpa_battlearea_spectatorportal")], usePortal);
  api.onObjectSecondClick([Common.locId("pvpa_battlearea_spectatorportal")], usePortal);
  api.onPlayerBeforeDeath(dyingStarts);
  api.onPlayerDeath(died);
  api.onShouldDropItemsOnDeath(keepItems);
  api.onCustomEvent("player:death-bones", noBones);
  api.onCanGainExperience(noExperience);
  api.onCustomEvent("prayer:unlocks-bypass", bypassPrayerUnlocks);
  api.onCustomEvent("pvp:count-stats", excludePvpStats);
  api.onServerShutdown(shutdown);
}

module.exports = { attachBattle, start, fightFor, Fight, _test: { fights, fightOf } };
