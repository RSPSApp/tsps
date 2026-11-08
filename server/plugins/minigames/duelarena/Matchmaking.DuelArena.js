"use strict";

/**
 * PvP Arena ranked 1v1 Duels, as captured (rsprox 20261107T115758, 115923, 121755, 122426,
 * 122509; world 578):
 * - recruiting is for the Emir's Arena: outside it (and in a staging area) Find and Sign up say
 *   "This isn't a very suitable place for recruitment."; leaving it signed up or invited:
 *   "This isn't a suitable place for PvP Arena recruitment, so you will be removed from the
 *   recruitment group." (captured as a fight took a signed-up player away; the arena's extent,
 *   the Duel Arena's zone, is inferred);
 * - the Grouping tab's PvP Arena button (76:2) shows the side panel (762). Find (`right`) asks
 *   "Official 1v1 Tournaments group | Official 1v1 Duels group | Join an unofficial tournament |
 *   Cancel"; Sign up (`left`) puts the player in the Duels group (pvpa_affinitystatus 3); Find
 *   again leaves it (1), invitation and all. In a staging area: "This isn't a very suitable
 *   place for recruitment.";
 * - two signed-up players are invited (the closest ranks): each pays 15 rank up front
 *   (pvpa_upfront_paid) and hears "A Duel awaits you! Come to the staging area, upstairs in the
 *   Arena hospital." with the PvP Arena popup; "Your Duel is still waiting..." every 10 ticks
 *   and the popup every 20, until they go up the staging area steps (or the side panel's
 *   world hop button). An invitation ignored for 566 ticks lapses: out of the group, the 15
 *   kept, not a word;
 * - upstairs (a copy of the staging room for the pair): pvpa_owed_join_refund, the staging HUD
 *   (766), "When you are ready, please use the option in the supply chest..." and a timer from
 *   299. Once both are up, each gets the 15 back and stakes what a loss would cost (Rank: 25
 *   between equal ranks). The chest shows the week's build (battletype 1006, "You cannot alter
 *   the build for this ranked fight."); its top button readies (pvpa_stagingarea_iamready);
 *   both ready, or the timer run out with both up, and the fight starts (Battle);
 * - a win returns the stake with the gain: "Congratulations! Your victory has increased your
 *   ranking by N, and has earned you P Arena Reward Points."; a loss (a death, a forfeit) keeps
 *   it: "Your defeat has decreased your ranking by N, but has earned you 12 Arena Reward
 *   Points."; the staging steps down ask "Abandon the fight | Cancel", and abandoning keeps it
 *   with no points;
 * - the opponent not coming: "The Duel has been cancelled because the opponent took too long to
 *   arrive.", the 15 back, out of the hospital.
 * Inferred: abandoning gives the opponent back their stake and "The Duel has been cancelled
 * because the opponent left."; a logout while invited is a no-show, upstairs an abandon; a
 * player left alone upstairs when the invitation lapses is cancelled as above; a draw (the time
 * limit, a shutdown) gives both their stakes back.
 */
const Common = require("./Common.DuelArena");
const Loadouts = require("./Loadouts.DuelArena");
const Battle = require("./Battle.DuelArena");
const Rank = require("./Rank.DuelArena");
const Group = require("./Group.DuelArena");

const GROUPING_GROUP = 76;
const OPEN_CHILD = 2;
const SIDEPANEL = "pvp_arena_sidepanel";
const SIDEOPTIONS = "pvp_arena_sideoptions";
const STAGING_HUD = "pvp_arena_stagingarea_hud";
const OVERLAY_HUD = "toplevel_osrs_stretch:overlay_hud";
const OVERLAY_ATMOSPHERE = "toplevel_osrs_stretch:overlay_atmosphere";
const FADE_OVERLAY = "fade_overlay";
const FADE_SCRIPT = 948;
const FADE_CYCLES = 15;
/** pvpa_affinitystatus: 1 no group signed up to, 3 signed up (captured). */
const NO_GROUP = 1;
const SIGNED_UP = 3;
const FIGHT_OPTION = 1;

let pluginApi;
/** Players signed up to the Duels group (sign-up order); Group keeps who's looking at it. */
const signedUp = new Map();
/** Player -> their match, from the invitation until they're out of it. */
const matchOf = new Map();
let pairing = false;
/** Whether a player stands in the Emir's Arena (DuelArena.plugin.js's duel zone), the only suitable place to recruit. */
let inArena = () => true;

const data = () => Common.data.ranked;
const uid = (name) => Common.component(name);
const clicked = (event, name) => ((event.groupId << 16) | event.childId) === uid(name);

// ---------------------------------------------------------------- the staging area

let StagingClass = null;

function stagingClass() {
  if (StagingClass) return StagingClass;
  const { TemplatedInstanceArea } = Common.core;
  StagingClass = class PvpArenaStagingArea extends TemplatedInstanceArea {
    constructor(match) {
      const { chunk: [cx, cy], size: [w, h], planes } = data().staging;
      super(w, h);
      this.match = match;
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
      return "PvP Arena staging area";
    }

    at([x, y, z]) {
      return this.tile(x - this.origin[0], y - this.origin[1], z ?? 0);
    }

    canAttack() {
      return false;
    }

    canTeleport() {
      return false;
    }

    canTrade() {
      return false;
    }

    postLeave(mobile, logout) {
      const player = Common.asPlayer(mobile);
      if (player) this.match.leftStaging(player, logout);
      // A logout in a fade tick must never save on the staging copy.
      if (player && logout) {
        const [x, y, z] = data().staging.out;
        player.setLocation(new Common.core.Location(x, y, z));
      }
      super.postLeave(mobile, logout);
    }
  };
  return StagingClass;
}

// ---------------------------------------------------------------- a match

class Match {
  constructor(players) {
    this.players = players;
    this.build = Rank.weeklyBuild();
    this.elapsed = 0;
    this.arrived = new Set();
    this.ready = new Set();
    this.stakes = new Map();
    this.taken = new Map();
    this.gains = new Map();
    this.swapped = false;
    this.timeLeft = null;
    this.area = null;
    this.state = "invited";
    this.leaving = new Set();
    this.lossLine = null;
  }

  opponentOf(player) {
    return this.players.find((p) => p !== player) ?? null;
  }

  invite() {
    for (const player of this.players) {
      matchOf.set(player, this);
      signedUp.delete(player);
      const before = Rank.rank(player);
      Rank.addRank(player, -data().upfront);
      // The rank floor can take less than the 15: only that comes back.
      this.taken.set(player, before - Rank.rank(player));
      Common.varbit(player, "pvpa_upfront_paid", 1);
      Common.varbit(player, "pvpa_invitation_fightworld", data().world);
      Group.invited(player);
      player.sendMessage(Common.message("rankedInvited"));
      popup(player, "rankedInvitedPopup");
    }
    Common.every(() => this.tick());
  }

  tick() {
    if (this.state === "over" || this.state === "fighting") return false;
    this.elapsed++;
    const { remindEvery, popupEvery, inviteTicks, timerEvery } = data();
    for (const player of this.players) {
      if (this.arrived.has(player)) continue;
      if (!inArena(player)) {
        unsuitable(player);
        return false;
      }
      if (this.elapsed % remindEvery === 0) player.sendMessage(Common.message("rankedWaiting"));
      if (this.elapsed % popupEvery === 0) popup(player, "rankedWaitingPopup");
    }
    if (this.timeLeft != null) {
      this.timeLeft = Math.max(0, this.timeLeft - 1);
      if (this.timeLeft % timerEvery === 0) for (const player of this.arrived) this.sendTime(player);
      if (this.timeLeft === 0) {
        if (this.arrived.size === this.players.length) this.fight();
        else this.lapse();
        return false;
      }
    }
    if (this.elapsed >= inviteTicks && this.arrived.size < this.players.length) {
      this.lapse();
      return false;
    }
    return true;
  }

  sendTime(player) {
    Common.varbit(player, "pvpa_stagingarea_timeremaining", this.timeLeft ?? 0);
  }

  /** Up the steps (or the side panel's world hop): the pair's staging area. */
  arrive(player, landing) {
    if (this.arrived.has(player) || this.state !== "invited") return;
    if (!this.area) this.area = new (stagingClass())(this);
    this.arrived.add(player);
    Group.leave(player);
    Common.varbit(player, "pvpa_owed_join_refund", 1);
    Common.varbit(player, "pvpa_stagingarea_iamready", 0);
    Common.varbit(player, "pvpa_affinitystatus", NO_GROUP);
    Common.varbit(player, "pvpa_invitation_fightworld", 0);
    this.area.enter(player);
    player.moveTo(this.area.at(landing));
    player.sendMessage(Common.message("readyHint"));
    const sender = player.getPacketSender();
    sender.sendSubInterface(uid(OVERLAY_HUD), Common.interfaceId(STAGING_HUD), 1);
    sender.sendPlayerOption(FIGHT_OPTION, "", false);
    if (this.timeLeft == null) this.timeLeft = data().stagingTicks;
    this.sendTime(player);
    if (this.arrived.size === this.players.length) this.swap();
  }

  /** Both up: the up-front 15 back, and the stake a loss would cost taken instead. */
  swap() {
    if (this.swapped) return;
    this.swapped = true;
    const ranks = new Map(this.players.map((p) => [p, Rank.rank(p) + (this.taken.get(p) ?? data().upfront)]));
    for (const player of this.players) {
      const other = this.opponentOf(player);
      const stake = Rank.stakeAgainst(ranks.get(player), ranks.get(other));
      this.stakes.set(player, stake);
      this.gains.set(player, Rank.gainAgainst(ranks.get(player), ranks.get(other)));
      const before = Rank.rank(player);
      Rank.addRank(player, data().upfront - stake);
      this.taken.set(player, (this.taken.get(player) ?? 0) - (Rank.rank(player) - before));
      Common.varbit(player, "pvpa_owed_join_refund", 0);
      Common.varbit(player, "pvpa_upfront_paid", 0);
    }
  }

  toggleReady(player) {
    if (!this.arrived.has(player) || this.state !== "invited") return;
    if (this.ready.has(player)) this.ready.delete(player);
    else this.ready.add(player);
    Common.varbit(player, "pvpa_stagingarea_iamready", this.ready.has(player) ? 1 : 0);
    if (this.ready.size === this.players.length && this.arrived.size === this.players.length) this.fight();
  }

  fight() {
    if (this.state !== "invited") return;
    this.state = "fighting";
    for (const player of this.players) {
      Loadouts.lockBuild(player, null);
      player.getPacketSender().sendInterfaceRemoval();
      player.getPacketSender().closeSubInterface(uid(OVERLAY_HUD));
      Common.varbit(player, "pvpa_stagingarea_iamready", 0);
    }
    if (!Battle.start(this.players, this.build, this.mode())) {
      // A character still put aside, or a fight already on: nobody loses anything.
      this.state = "invited";
      this.refundAll();
      for (const player of [...this.arrived]) this.sendOut(player);
      this.end();
    }
  }

  /** Battle's ranked fight: the rank and points at the result and the loser's line on leaving. */
  mode() {
    return {
      label: "Ranked",
      participation: Common.RANKED_PARTICIPATION_ATTRIBUTE,
      wins: Common.RANKED_WINS_ATTRIBUTE,
      won: (fight, winner, loser) => this.won(winner, loser),
      drawn: () => this.refundAll(),
      left: (fight, player) => this.leftFight(player),
    };
  }

  won(winner, loser) {
    const gain = this.gains.get(winner) ?? 0;
    Rank.addRank(winner, (this.stakes.get(winner) ?? 0) + gain);
    const points = Rank.winPoints(winner);
    Rank.addPoints(winner, points);
    winner.sendMessage(Common.message("rankedWon", { rank: gain, points }));
    if (loser) {
      Rank.addPoints(loser, data().lossPoints);
      Rank.endStreak(loser);
      this.lossLine = { player: loser, text: Common.message("rankedLost", { rank: this.stakes.get(loser) ?? 0, points: data().lossPoints }) };
    }
  }

  leftFight(player) {
    if (this.lossLine?.player === player) {
      player.sendMessage(this.lossLine.text);
      this.lossLine = null;
    }
    this.leaving.add(player);
    if (this.players.every((p) => this.leaving.has(p))) this.end();
  }

  refundAll() {
    for (const player of this.players) {
      const stake = this.stakes.get(player);
      if (stake) Rank.addRank(player, stake);
    }
    this.stakes.clear();
  }

  /** The invitation ran out (or the timer, someone missing): no-shows keep paying, the rest are let go. */
  lapse() {
    for (const player of this.players) {
      if (this.arrived.has(player)) this.cancelFor(player, "opponentLate");
      else this.noShow(player);
    }
    this.end();
  }

  /** Captured: out of the group, the 15 kept, not a word. */
  noShow(player) {
    Group.leave(player);
    Common.varbit(player, "pvpa_affinitystatus", NO_GROUP);
    Common.varbit(player, "pvpa_invitation_fightworld", 0);
    Common.later(4, () => Common.varbit(player, "pvpa_upfront_paid", 0));
  }

  /** Called off for someone who did nothing wrong: what they paid back, and out of the hospital. */
  cancelFor(player, reason) {
    Rank.addRank(player, this.taken.get(player) ?? 0);
    this.taken.delete(player);
    this.stakes.delete(player);
    Group.leave(player);
    Common.varbit(player, "pvpa_owed_join_refund", 0);
    Common.varbit(player, "pvpa_upfront_paid", 0);
    Common.varbit(player, "pvpa_affinitystatus", NO_GROUP);
    Common.varbit(player, "pvpa_invitation_fightworld", 0);
    player.sendMessage(Common.message(reason));
    if (this.arrived.has(player)) {
      // Out of the hospital as they joined it from the panel: faded, moved, shown.
      this.forget(player);
      fadeThen(player, () => this.sendOut(player));
    }
  }

  /** Abandon the fight (the staging steps down, or a logout upstairs). */
  abandon(player, logout = false) {
    if (this.state !== "invited" || !this.arrived.has(player)) return;
    const other = this.opponentOf(player);
    if (this.swapped) {
      Rank.endStreak(player);
      player.sendMessage(Common.message("rankedAbandoned", { rank: this.stakes.get(player) ?? 0 }));
      this.stakes.delete(player);
    }
    if (!logout) this.sendOut(player);
    else {
      // The save takes them outside the hospital, never onto the staging copy.
      this.forget(player);
      const [x, y, z] = data().staging.out;
      player.setLocation(new Common.core.Location(x, y, z));
    }
    if (other) this.cancelFor(other, "opponentLeft");
    this.end();
  }

  /** Withdrawn (Find while invited) or logged out before going up: a no-show; the other is let go. */
  withdraw(player) {
    if (this.state !== "invited" || this.arrived.has(player)) return;
    this.noShow(player);
    const other = this.opponentOf(player);
    if (other) this.cancelFor(other, "opponentLate");
    this.end();
  }

  sendOut(player) {
    this.forget(player);
    const [x, y, z] = data().staging.out;
    player.moveTo(new Common.core.Location(x, y, z));
    if (this.area && player.getArea() === this.area) this.area.leave(player, false);
  }

  forget(player) {
    this.leaving.add(player);
    this.arrived.delete(player);
    this.ready.delete(player);
    Loadouts.lockBuild(player, null);
    Common.varbit(player, "pvpa_stagingarea_iamready", 0);
    player.getPacketSender().closeSubInterface(uid(OVERLAY_HUD));
  }

  /** Left the staging copy: to the fight (nothing to do), out by our own exits, or a logout. */
  leftStaging(player, logout) {
    if (this.state === "fighting" || this.leaving.has(player)) return;
    if (logout) this.abandon(player, true);
    else this.abandon(player);
  }

  end() {
    if (this.state === "over") return;
    this.state = "over";
    for (const player of this.players) if (matchOf.get(player) === this) matchOf.delete(player);
    for (const player of this.players) Loadouts.lockBuild(player, null);
  }
}

function popup(player, key) {
  pluginApi.emitCustomEvent("notification:show", { player, title: Common.message("popupTitle"), text: Common.message(key) });
}

/**
 * Captured (the side panel's join button): the screen fades to black (fade_overlay, script 948
 * from 0 to 255 over 15 cycles), the player is moved the next tick, and the overlay goes the
 * tick after, showing them where they've arrived.
 */
function fadeThen(player, move) {
  const sender = player.getPacketSender();
  sender.sendSubInterface(uid(OVERLAY_ATMOSPHERE), Common.interfaceId(FADE_OVERLAY), 1,
    { postScripts: [{ scriptId: FADE_SCRIPT, args: [0, 255, 0, 0, FADE_CYCLES] }] });
  Common.later(1, () => {
    if (player.isRegistered?.() === false) return;
    move();
    Common.later(1, () => sender.closeSubInterface(uid(OVERLAY_ATMOSPHERE)));
  });
}

// ---------------------------------------------------------------- signing up and pairing

function busy(player) {
  return Battle.fightFor(player) != null || player.getHitpoints() <= 0 || player.isDying
    || player.getDueling?.().inDuel?.() || matchOf.has(player);
}

/** Sign up: the group answers a tick later ("Requesting..."), and pairing goes on. */
function signUp(player) {
  if (signedUp.has(player) || matchOf.has(player)) return;
  Group.join(player, () => {
    signedUp.set(player, Common.core.World.getProcessCycle());
    Common.varbit(player, "pvpa_affinitystatus", SIGNED_UP);
    ensurePairing();
  });
}

/** Out of the Emir's Arena while signed up or invited (captured line): out of the group. */
function unsuitable(player) {
  player.sendMessage(Common.message("leftArena"));
  leaveGroup(player);
}

function leaveGroup(player) {
  const match = matchOf.get(player);
  if (match) match.withdraw(player);
  signedUp.delete(player);
  Group.leave(player);
  Common.varbit(player, "pvpa_affinitystatus", NO_GROUP);
}

/** Every few ticks: each waiting player, oldest first, with the closest rank still waiting. */
function pairUp() {
  const waiting = [...signedUp.keys()].filter((p) => p.isRegistered?.() !== false && !busy(p));
  const used = new Set();
  for (const player of waiting) {
    if (used.has(player)) continue;
    let best = null;
    for (const other of waiting) {
      if (other === player || used.has(other)) continue;
      if (!best || Math.abs(Rank.rank(other) - Rank.rank(player)) < Math.abs(Rank.rank(best) - Rank.rank(player))) best = other;
    }
    if (!best) continue;
    used.add(player);
    used.add(best);
    new Match([player, best]).invite();
  }
  if (signedUp.size === 0) pairing = false;
  return pairing;
}

function ensurePairing() {
  if (pairing) return;
  pairing = true;
  let ticks = 0;
  Common.every(() => {
    for (const player of [...signedUp.keys()]) if (!inArena(player)) unsuitable(player);
    if (signedUp.size === 0) pairing = false;
    return ++ticks % data().pairEvery === 0 ? pairUp() : pairing;
  });
}

// ---------------------------------------------------------------- the side panel

function mountPanel(player) {
  Common.varbit(player, "pvpa_affinitystatus", signedUp.has(player) || matchOf.has(player) ? SIGNED_UP : NO_GROUP);
}

function openPvpArena(event) {
  if (event.groupId !== GROUPING_GROUP || event.childId !== OPEN_CHILD || (event.opId ?? event.action) !== 1) return;
  event.handled = true;
  pluginApi.emitCustomEvent("side-channels:replace-grouping", {
    player: event.player, group: Common.interfaceId(SIDEPANEL), onMount: () => mountPanel(event.player),
  });
}

function upstairs(player) {
  return matchOf.get(player)?.arrived.has(player) === true;
}

/** Find: the groups (only the Duels group plays here). */
function find(player) {
  pluginApi.sendMultiChatboxPrompt(player, Common.message("findTitle"),
    Common.message("groupTournaments"), () => player.sendMessage(Common.message("noTournaments")),
    Common.message("groupDuels"), () => Group.view(player),
    Common.message("groupUnofficial"), () => player.sendMessage(Common.message("noTournaments")),
    "Cancel", () => {});
}

function sidePanelButton(event) {
  const { player } = event;
  if (clicked(event, `${SIDEPANEL}:close`)) {
    pluginApi.emitCustomEvent("side-channels:replace-grouping", { player, group: null });
  } else if (clicked(event, `${SIDEPANEL}:right`)) {
    if (signedUp.has(player) || (matchOf.has(player) && !upstairs(player))) leaveGroup(player);
    else if (upstairs(player) || !inArena(player)) player.sendMessage(Common.message("noRecruiting"));
    else find(player);
  } else if (clicked(event, `${SIDEPANEL}:left`)) {
    const canSignUp = !signedUp.has(player) && !matchOf.has(player) && Group.viewing(player);
    if (canSignUp && !inArena(player)) player.sendMessage(Common.message("noRecruiting"));
    else if (canSignUp) signUp(player);
    else player.getPacketSender().sendInterface(Common.interfaceId(SIDEOPTIONS));
  } else if (clicked(event, `${SIDEPANEL}:worldhop`)) {
    const match = matchOf.get(player);
    if (!match || match.arrived.has(player)) return;
    event.handled = true;
    fadeThen(player, () => match.arrive(player, data().staging.landings.pvpa_stagingarea_entry));
    return;
  } else if (clicked(event, `${SIDEOPTIONS}:com_3`)) {
    player.getPacketSender().sendInterfaceRemoval();
  } else return;
  event.handled = true;
}

// ---------------------------------------------------------------- the hospital's steps and chests

function stepsUp(landingName) {
  return ({ player }) => {
    const match = matchOf.get(player);
    if (!match || match.state !== "invited" || match.arrived.has(player)) {
      player.sendMessage(Common.message("noInvitation"));
      return true;
    }
    match.arrive(player, data().staging.landings[landingName]);
    return true;
  };
}

function stepsDown({ player }) {
  const match = matchOf.get(player);
  if (!match?.arrived.has(player)) return false;
  pluginApi.sendMultiChatboxPrompt(player, Common.message("abandonTitle"),
    "Abandon the fight", () => match.abandon(player),
    "Cancel", () => {});
  return true;
}

function stagingChest({ player }) {
  const match = matchOf.get(player);
  if (!match?.arrived.has(player)) return false;
  Loadouts.lockBuild(player, match.build);
  Loadouts.openChest({ player }, data().battletype);
  return true;
}

/** The chest's top button: ready, or not ready any more. */
function readyButton({ player }) {
  const match = matchOf.get(player);
  if (!match?.arrived.has(player)) return false;
  match.toggleReady(player);
  return true;
}

function gone({ player }) {
  signedUp.delete(player);
  Group.forget(player);
  const match = matchOf.get(player);
  if (!match || match.state !== "invited") return;
  if (match.arrived.has(player)) match.abandon(player, true);
  else match.withdraw(player);
}

function shutdown() {
  for (const match of new Set(matchOf.values())) {
    if (match.state !== "invited") continue;
    // The world stopping is nobody's fault: whatever was paid comes back.
    for (const player of match.players) {
      const upstairs = match.arrived.has(player);
      match.cancelFor(player, "opponentLate");
      // The save runs before the next tick: move them out now, not in the fade.
      if (upstairs) match.sendOut(player);
    }
    match.end();
  }
}

const stagingSteps = ["pvpa_stagingarea_entry", "pvpa_stagingarea_entry02"];

function attach(api, options = {}) {
  pluginApi = api;
  if (options.inArena) inArena = options.inArena;
  Rank.attachRank(api);
  api.persistAttribute(Common.RANKED_PARTICIPATION_ATTRIBUTE, 0);
  api.persistAttribute(Common.RANKED_WINS_ATTRIBUTE, 0);
  api.onInterfaceActionClick(openPvpArena);
  api.onInterfaceActionClick(sidePanelButton);
  // By gameval id, not name: both pairs of steps are "Staging area steps".
  for (const name of stagingSteps) api.onObjectFirstClick([Common.locId(name)], stepsUp(name));
  api.onObjectFirstClick([Common.locId("pvpa_stagingarea_exit"), Common.locId("pvpa_stagingarea_exit02")], stepsDown);
  api.onObjectSecondClick([Common.locId("pvpa_stagingarea_exit"), Common.locId("pvpa_stagingarea_exit02")], stepsDown);
  api.onObjectFirstClick([Common.locId("pvpa_stagingarea_supplies_chest")], stagingChest);
  api.onInterfaceActionButton(Common.component(`${Loadouts.SUPPLIES}:top`), readyButton);
  api.onPlayerDisconnect(gone);
  api.onPlayerLogout(gone);
  api.onServerShutdown(shutdown);
}

module.exports = {
  attach, signedUp, matchOf, Match,
  _test: { pairUp, signUp, leaveGroup, find, stopPairing: () => { pairing = false; } },
};
