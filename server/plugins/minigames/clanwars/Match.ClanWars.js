/**
 * Wiki-backed legacy-channel LTS, First-to-X kills and timed Most kills: two-minute
 * preparation, safe deaths and jail. Respawning modes permit late entry and jail return.
 * No rewards or inventory snapshots.
 * Uncaptured cleanup policy: withdrawal/disconnect eliminates; both empty cancels without a
 * winner. Landing/wall placement is chosen from the active arena maps, not a recording.
 */
const C = require("./Common.ClanWars");
const Layout = require("./Layout.ClanWars");
const Rules = require("./Rules.ClanWars");
const Viewing = require("./Viewing.ClanWars");
const Restrictions = require("./Restrictions.ClanWars");
const Ranged = require("./Ranged.ClanWars");
const Ghasts = require("./Ghasts.ClanWars");
const PREPARATION_TICKS = 200;
// Wiki15379109 and rev242 enum2339: 60 seconds; engine cycle is 600ms.
const REJOIN_DELAY_TICKS = 100;
// Rev242 varbits4290/4291 are 16 bits; HUD script595 renders this value as "Lots!".
const MAX_HUD_KILLS = 65535;
const active = new Set();
const dying = new Map();
const joining = new Map();
let Arena;

function arenaClass() {
  if (Arena) return Arena;
  Arena = class ClanWarsArena extends C.core.TemplatedInstanceArea {
    constructor(game) {
      super(game.layout.width ?? game.layout.size, game.layout.height ?? game.layout.size);
      this.pluginName = "ClanWars";
      this.game = game;
      const { origin, planes } = game.layout;
      for (const plane of planes) for (let x = 0; x < this.widthChunks; x++) for (let y = 0; y < this.heightChunks; y++) {
        this.setChunk(plane, x, y, { sourceChunkX: origin[0] / 8 + x,
          sourceChunkY: origin[1] / 8 + y, sourcePlane: plane, rotation: 0 });
      }
    }
    at(tile) { return this.tile(tile[0] - this.game.layout.origin[0], tile[1] - this.game.layout.origin[1], tile[2]); }
    getName() { return "Clan Wars"; }
    isMulti() { return true; }
    canAttack(attacker, target, method) {
      if (!attacker.isPlayer() || !target.isPlayer()) return Ghasts.canAttack(this.game, attacker, target, method);
      if (this.game.phase !== "combat" || this.game.expired()
        || attacker.getArea() !== this || target.getArea() !== this) return false;
      if (this.game.rules.specialattacks === 2 && attacker.isSpecialActivated()) return false;
      const a = this.game.fighters.get(attacker), b = this.game.fighters.get(target);
      if (a == null || b == null || a === b) return false;
      return Ranged.canAttack(attacker, this.game.rules, method);
    }
    npcAggression(player, npc) { return Ghasts.aggression(this.game, player, npc); }
    npcAggressionTolerance(player, npc) { return Ghasts.aggression(this.game, player, npc); }
    process(mobile) { if (mobile.isNpc()) Ghasts.registered(this.game, mobile.getAsNpc()); }
    canTeleport() { return false; }
    canTrade() { return false; }
    postLeave(mobile, logout) {
      if (mobile.isPlayer()) this.game.remove(mobile.getAsPlayer(), logout);
      else if (mobile.isNpc()) Ghasts.left(this.game, mobile.getAsNpc());
      this.detach(mobile);
      mobile.setArea(null);
      // Match lifetime is owned by Game, including empty staging and pending safe deaths.
    }
  };
  return Arena;
}

function hud(game, player) {
  C.bit(player, "clanwars_useclansystem", 0);
  C.bit(player, "clanwars_wincondition", game.rules.wincondition);
  C.bit(player, "clanwars_kills_1", Math.min(MAX_HUD_KILLS, game.kills[0]));
  C.bit(player, "clanwars_kills_2", Math.min(MAX_HUD_KILLS, game.kills[1]));
  C.bit(player, "clanwars_timeremaining", game.timeRemaining());
  C.bit(player, "clanwars_myteam", game.members.get(player) + 1);
  C.bit(player, "clanwars_players_1", [...game.fighters.values()].filter((side) => side === 0).length);
  C.bit(player, "clanwars_players_2", [...game.fighters.values()].filter((side) => side === 1).length);
  C.bit(player, "clanwars_accept", 1);
  C.bit(player, "clanwars_countdown", game.phase === "staging" ? Math.max(0, game.starts - C.now()) : 0);
  player.getPacketSender().sendSubInterface(C.uid("toplevel_osrs_stretch:overlay_hud"), C.group("clanwars_hud"), 1);
}

class Game {
  constructor(session) {
    this.rules = Object.freeze({ ...session.rules });
    this.layout = Layout.get(this.rules.arena);
    if (!this.layout) throw new Error("Unsupported Clan Wars arena");
    this.channelKeys = session.channelKeys.slice();
    this.members = new Map();
    this.fighters = new Map();
    this.jailed = new Set();
    this.returnAt = new Map();
    this.viewers = new Set();
    this.kills = [0, 0];
    this.phase = "staging";
    this.starts = C.now() + PREPARATION_TICKS;
    this.ends = null;
    this.area = new (arenaClass())(this);
    this.walls = [];
    const wallId = C.core.CacheDefinitions.getLocId(this.layout.barrier);
    if (wallId == null) throw new Error("Missing Clan Wars barrier");
    // Older layouts keep their original Y line and face 0; the selected layout may use an X line.
    const vertical = this.layout.barrierAxis === "x";
    for (const [start, end] of this.layout.barrierRanges) for (let coordinate = start; coordinate <= end; coordinate++) {
      const at = this.area.at(vertical ? [this.layout.barrierX, coordinate, 0] : [coordinate, this.layout.barrierY, 0]);
      // Solid template trees already close these tiles. Overlaying them would
      // clear shared loc bits when the temporary barrier is deregistered.
      if (this.layout.barrierSkipBlocked && C.core.RegionManager.blocked(at, this.area)) continue;
      const wall = new C.core.GameObject(wallId, at, 10, this.layout.barrierFace ?? 0, this.area);
      // Sylvan's blocked check already built the lazy collision grid. Native
      // registration must now add clipping; Plateau retains its original lazy route.
      C.core.ObjectManager.register(wall, this.layout.barrierSkipBlocked);
      this.walls.push(wall);
    }
    this.task = new (class extends C.core.Task {
      constructor(game) { super(1, false); this.game = game; }
      execute() { if (this.game.phase === "over") this.stop(); else this.game.tick(); }
    })(this);
    C.core.TaskManager.submit(this.task);
  }
  enter(player) {
    const channel = C.channel(player);
    const side = this.channelKeys.indexOf(channel?.key);
    if (side < 0 || !this.canJoin() || dying.has(player) || this.members.has(player)
      || C.matches.has(player) || !C.inLobby(player) || player.getHitpoints() <= 0 || player.busy()) return false;
    if (!this.returnReady(player)) return false;
    if ([...this.members.values()].filter((team) => team === side).length >= Rules.teamCap(this.rules)) {
      player.sendMessage("Your team has reached the agreed fighter cap.");
      return false;
    }
    this.members.set(player, side);
    this.fighters.set(player, side);
    C.matches.set(player, this);
    player.setAttribute(C.IN_MATCH_ATTRIBUTE, true);
    player.getCombat().reset();
    Restrictions.prepare(player, this.rules);
    this.area.enter(player);
    player.moveTo(this.area.at(this.layout.landings[side]));
    player.getPacketSender().sendPlayerOption(1, "Attack", true);
    hud(this, player);
    return true;
  }
  canJoin() {
    return this.phase === "staging" && C.now() < this.starts
      || this.phase === "combat" && Rules.respawns(this.rules) && !this.expired();
  }
  expired() { return this.phase === "combat" && this.ends != null && C.now() >= this.ends; }
  timeRemaining() {
    if (this.phase === "staging") return Rules.timeLimitTicks(this.rules);
    return this.phase === "combat" && this.ends != null ? Math.max(0, this.ends - C.now()) : 0;
  }
  expire() {
    if (!this.expired()) return false;
    // Exact-deadline callbacks do not add kills or channel-leave penalties.
    // This cutoff and an equal-score draw are explicit, uncaptured policies.
    this.finish(this.kills[0] === this.kills[1] ? null : this.kills[0] > this.kills[1] ? 0 : 1);
    return true;
  }
  score(side) {
    if (this.expire() || this.phase !== "combat" || !Rules.respawns(this.rules)) return;
    this.kills[side]++;
    const target = Rules.killTarget(this.rules);
    if (target && this.kills[side] >= target) this.finish(side);
  }
  returnReady(player) {
    const key = player.getLongUsername();
    const until = this.returnAt.get(key);
    if (until != null && C.now() < until) {
      player.sendMessage("You must wait 60 seconds after death before returning to this Clan Wars battle.");
      return false;
    }
    this.returnAt.delete(key);
    return true;
  }
  holdDeath(player, scoreResolved = true) {
    let state = dying.get(player);
    if (!state) {
      state = { game: this, side: this.members.get(player), wasFighter: this.fighters.has(player), scoreResolved };
      dying.set(player, state);
    }
    return state;
  }
  rejoin(player) {
    const view = Viewing.active.get(player);
    if (view?.game === this) Viewing.stop(player, false);
    if (this.phase !== "combat" || this.expired() || !Rules.respawns(this.rules) || !this.jailed.has(player)
      || dying.has(player) || player.getHitpoints() <= 0 || player.busy()
      || player.getArea() !== this.area
      || C.channel(player)?.key !== this.channelKeys[this.members.get(player)] || !this.returnReady(player)) {
      if (view?.game === this && player.getArea() === this.area && this.phase !== "over"
        && !player.isDyingReturn()) player.moveTo(view.location);
      return false;
    }
    const side = this.members.get(player);
    this.jailed.delete(player);
    this.fighters.set(player, side);
    player.getCombat().reset();
    Restrictions.prepare(player, this.rules);
    player.moveTo(this.area.at(this.layout.landings[side]));
    hud(this, player);
    return true;
  }
  channelLeft(player) {
    const side = this.members.get(player);
    if (side == null || this.expire()) return;
    if (this.fighters.has(player)) {
      // Retain a real queued death's eligibility before removing its membership.
      // A counted departure resolves it before score() can finish the match.
      if (player.isDyingReturn()) this.holdDeath(player, this.rules.leavingcc === 0);
      if (this.rules.leavingcc === 0) this.score(1 - side);
    }
    this.remove(player, false);
  }
  tick() {
    if (this.expire()) return;
    Viewing.tick(this);
    for (const player of this.members.keys()) {
      if (C.channel(player)?.key !== this.channelKeys[this.members.get(player)]) this.channelLeft(player);
      if (this.phase === "over") return;
    }
    if (this.phase === "staging" && C.now() >= this.starts) {
      if (!Ghasts.prepare(this)) {
        for (const player of this.members.keys()) player.sendMessage("This Clan Wars battle could not start. Please try a new challenge.");
        return this.finish(null);
      }
      this.phase = "combat";
      const duration = Rules.timeLimitTicks(this.rules);
      this.ends = duration ? C.now() + duration : null;
      for (const wall of this.walls) C.core.ObjectManager.deregister(wall, true);
      this.walls = [];
      for (const player of this.members.keys()) player.sendMessage("The Clan Wars battle has begun.");
    }
    if (this.phase === "combat") {
      if (!Ghasts.reconcile(this)) {
        for (const player of this.members.keys()) player.sendMessage("This Clan Wars battle could not continue. Please try a new challenge.");
        return this.finish(null);
      }
      if (Rules.respawns(this.rules)) {
        // Jail and pending safe deaths retain their roster slot. A temporary lack
        // of living fighters must not end a respawning 1v1 after its first kill.
        const sides = new Set(this.members.values());
        if (sides.size < 2) return this.finish(sides.size ? [...sides][0] : null);
      } else {
        // Wiki/enum928: Kill all loses at zero; Ignore 5 loses at five or fewer.
        // Sample both sides together only in combat (including its first tick).
        // Both-low as a neutral draw and this phase boundary are explicit policies.
        const counts = [0, 0];
        for (const side of this.fighters.values()) counts[side]++;
        const limit = Rules.STRAGGLER_LIMITS[this.rules.stragglers];
        const lost = counts.map((count) => count <= limit);
        if (lost[0] || lost[1]) return this.finish(lost[0] ? lost[1] ? null : 1 : 0);
      }
    }
    for (const player of this.members.keys()) {
      C.bit(player, "clanwars_countdown", this.phase === "staging" ? Math.max(0, this.starts - C.now()) : 0);
      C.bit(player, "clanwars_kills_1", Math.min(MAX_HUD_KILLS, this.kills[0]));
      C.bit(player, "clanwars_kills_2", Math.min(MAX_HUD_KILLS, this.kills[1]));
      C.bit(player, "clanwars_timeremaining", this.timeRemaining());
      C.bit(player, "clanwars_players_1", [...this.fighters.values()].filter((team) => team === 0).length);
      C.bit(player, "clanwars_players_2", [...this.fighters.values()].filter((team) => team === 1).length);
    }
  }
  eliminate(player) { Viewing.stop(player); this.fighters.delete(player); Ghasts.playerLeft(this, player); player.getCombat().reset(); }
  remove(player, logout) {
    if (!this.members.has(player)) return;
    // A lethal hit queues its task before player:dying. Preserve safe-death
    // ownership before any departure deletes membership, including match finish.
    if (player.isDyingReturn() && !dying.has(player)) {
      // Other removal paths retain their existing score outcome; this backup owns safety.
      this.holdDeath(player);
    }
    Viewing.stop(player, false);
    this.eliminate(player);
    this.jailed.delete(player);
    this.members.delete(player);
    C.matches.delete(player);
    player.setAttribute(C.IN_MATCH_ATTRIBUTE, false);
    player.getPacketSender().closeSubInterface(C.uid("toplevel_osrs_stretch:overlay_hud"));
    player.getPacketSender().sendPlayerOption(1, "", true);
    C.bit(player, "clanwars_accept", 0);
    for (const name of ["clanwars_myteam", "clanwars_wincondition", "clanwars_countdown", "clanwars_timeremaining", "clanwars_players_1", "clanwars_players_2", "clanwars_kills_1", "clanwars_kills_2"]) C.bit(player, name, 0);
    // Remove ownership before moving so Area.leave can safely re-enter without recursion.
    this.area.leave(player, logout);
    if (logout) player.setLocation(C.location(C.RETURN));
    else player.moveTo(C.location(C.RETURN));
  }
  finish(winner) {
    if (this.phase === "over") return;
    this.phase = "over";
    Ghasts.stop(this);
    this.returnAt.clear();
    this.task.stop();
    active.delete(this);
    for (const [player, game] of joining) if (game === this) {
      joining.delete(player);
      if (!C.negotiations.has(player) && player.getInterfaceId() === C.group("clanwars_confirm")) {
        player.getPacketSender().sendInterfaceRemoval();
        player.sendMessage("This Clan Wars battle has ended.");
      }
    }
    for (const key of this.channelKeys) if (C.channelGames.get(key) === this) C.channelGames.delete(key);
    const recipients = [...this.members.entries()];
    for (const [player, side] of recipients) {
      this.remove(player, false);
      player.getPacketSender().sendInterface(C.group("clanwars_gameover"));
      player.getPacketSender().sendClientScript(592, winner === side ? 1 : 0,
        winner == null ? "The battle ended without a winner." : winner === side ? "Your team won the battle." : "Your team lost the battle.");
    }
    // Dying players retain safe-death ownership independently; their final callback returns
    // to the lobby even if the match has already ended, with no inventory reconstruction.
    this.area.destroy();
  }
}

function start(session) {
  if (!Rules.validate(session.rules) || session.channelKeys.some((key) => C.channelGames.has(key))) return false;
  const game = new Game(session);
  active.add(game);
  for (const key of game.channelKeys) {
    C.channelGames.set(key, game);
    const query = { key };
    C.api.emitCustomEvent("friends-chat:channel", query);
    for (const player of query.channel?.members ?? []) {
      player.sendMessage("Your chat-channel has agreed a Clan Wars battle. Enter the purple portal within two minutes.");
    }
  }
  return game;
}
function enter({ player }) {
  if (!C.inLobby(player) || C.negotiations.has(player)) return false;
  const game = C.channelGames.get(C.channel(player)?.key);
  if (!game) { player.sendMessage("Your chat-channel has no Clan Wars battle to join."); return true; }
  joining.set(player, game);
  player.getPacketSender().sendInterface(C.group("clanwars_confirm"));
  player.getPacketSender().sendString("Join Clan Wars", C.uid("clanwars_confirm:title"));
  player.getPacketSender().sendClientScript(554, 1, Rules.summary(game.rules));
  return true;
}
function joinClicked(event) {
  const game = joining.get(event.player);
  if (!game || event.groupId !== C.group("clanwars_confirm")) return;
  if (C.negotiations.has(event.player)) {
    joining.delete(event.player);
    return;
  }
  event.handled = true;
  if (!game.canJoin() || !active.has(game)) {
    joining.delete(event.player);
    if (event.player.getInterfaceId() === C.group("clanwars_confirm")) {
      event.player.getPacketSender().sendInterfaceRemoval();
      event.player.sendMessage("You cannot enter this battle now.");
    }
    return;
  }
  if (event.childId !== (C.uid("clanwars_confirm:button") & 65535) || (event.opId ?? event.action) !== 1) return;
  joining.delete(event.player);
  if (event.player.getInterfaceId() !== C.group("clanwars_confirm")) return;
  event.player.getPacketSender().sendInterfaceRemoval();
  if (!game.enter(event.player)) event.player.sendMessage("You cannot enter this battle now.");
}
function joinClosed({ player, interfaceId }) {
  if (interfaceId === C.group("clanwars_confirm")) joining.delete(player);
}
function dyingStarts({ player, killer }) {
  const held = dying.get(player);
  const game = held?.game ?? C.matches.get(player);
  if (!game || !held && !game.members.has(player)) return;
  const state = held ?? game.holdDeath(player, false);
  if (game.members.has(player)) game.eliminate(player);
  if (state.scoreResolved) return;
  state.scoreResolved = true;
  const scoringSide = game.members.get(killer);
  // Use the death task's captured damage owner, before its reset, and require an
  // opposing participant still owned by this match. Unattributed deaths award no guessed kill.
  if (state.wasFighter && scoringSide != null && scoringSide !== state.side) game.score(scoringSide);
}
function keepItems(event) {
  if (C.matches.has(event.player) || dying.has(event.player)) event.shouldDrop = false;
}
function noBones(event) { if (C.matches.has(event.player) || dying.has(event.player)) event.allow = false; }
function died(event) {
  const state = dying.get(event.player);
  if (!state) return;
  state.game.expire();
  dying.delete(event.player);
  // The completed death callback is this implementation's explicit clock anchor.
  // Wiki/cache specify 60 seconds, but not the exact death-animation phase.
  if (state.game.phase !== "over" && state.game.rules.rejoiningdelay === 1) {
    state.game.returnAt.set(event.player.getLongUsername(), C.now() + REJOIN_DELAY_TICKS);
  }
  event.handled = true;
  if (state.game.phase === "over" || !state.game.members.has(event.player)) event.player.moveTo(C.location(C.RETURN));
  else {
    state.game.jailed.add(event.player);
    event.player.moveTo(state.game.area.at(state.game.layout.jails[state.side]));
    hud(state.game, event.player);
  }
}
function leave({ player }) { const game = C.matches.get(player); if (!game) return false; game.remove(player, false); return true; }
function forfeit(event) {
  const game = C.matches.get(event.player);
  if (!game || !Layout.owns(game, event.object, game.layout.exits)) return false;
  return leave(event);
}
function exit(event) {
  const game = C.matches.get(event.player);
  if (!game || !Layout.owns(game, event.object, [game.layout.jailPortal])) return false;
  if (game.jailed.has(event.player) && Rules.respawns(game.rules)) {
    if (!game.rejoin(event.player)) event.player.sendMessage("You cannot rejoin this battle now.");
    return true;
  }
  return leave(event);
}
function channelLeft({ player }) { C.matches.get(player)?.channelLeft(player); }
function gone({ player }) { joining.delete(player); C.matches.get(player)?.remove(player, true); }
function recover({ player }) {
  if (player.getAttribute(C.IN_MATCH_ATTRIBUTE) !== true) return;
  player.setAttribute(C.IN_MATCH_ATTRIBUTE, false);
  player.setLocation(C.location(C.RETURN));
}
function presets(event) { if (C.matches.has(event.player) || dying.has(event.player)) { event.allow = false; event.message = "Leave Clan Wars before loading a preset."; } }
function noPvpRewards(event) {
  if (C.matches.has(event.victim) || dying.has(event.victim)) event.allow = false;
}
function shutdown() { for (const game of [...active]) game.finish(null); }
function attach(api) {
  Ghasts.attach(api);
  api.onInterfaceActionClick(joinClicked);
  api.onCustomEvent("interface:closed", joinClosed);
  api.onCustomEvent("player:dying", dyingStarts);
  api.onCustomEvent("player:death-bones", noBones);
  api.onCustomEvent("presets:can-use", presets);
  api.onCustomEvent("pvp:count-stats", noPvpRewards);
  api.onShouldDropItemsOnDeath(keepItems);
  api.onPlayerDeath(died);
  api.onCustomEvent("friends-chat:left", channelLeft);
  api.onPlayerDisconnect(gone);
  api.onPlayerLogout(gone);
  api.onPlayerLogin(recover);
  api.persistAttribute(C.IN_MATCH_ATTRIBUTE, false);
  api.onServerShutdown(shutdown);
}
module.exports = { start, enter, leave, forfeit, exit, attach, shutdown, active, dying };
