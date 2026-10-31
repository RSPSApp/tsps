/**
 * A Last Man Standing game, as captured (rsprox 20261026T161730, eight competitive games):
 * - the arena is a copy of one of the two islands (Wiki: 50% each), the whole of it on planes
 *   0-2; every player arrives somewhere on it with the chosen build's load-out (Stash keeps
 *   their own things), "Last Man Standing mode: <build>", the LMS music, the PvP icons, the
 *   game overlay (328) on overlay_atmosphere and "Fight" as the player option;
 *   varbits br_ingame, br_active_map_player (1 Desert Island, 2 Wild Varrock) and
 *   br_active_build_player (0 Max/Med, 1 Zerker, 2 1 Def Pure);
 * - everyone counts down overhead "12..." to "1..." every two ticks, then "GO!" and "The fight
 *   for survival has begun!"; attacking before then: "The game has not started yet!" (spam);
 * - the overlay shows "N / 24" survivors, the kills ("Safe" before the start) and the fog, every
 *   tick; br_timedisplay counts up every 50 ticks;
 * - a death: "Oh dear, you are dead!" after "Good effort!" (top 9) or "You must make a more
 *   valiant effort for a reward.", the death song and jingle, the lobby; then the rank line and
 *   the points; the last one alive: "You are victorious!";
 * - Wiki: single combat, 20 seconds unattackable after a kill, unlimited prayer and run, no
 *   Rapid Restore, Rapid Heal, Protect Item, Retribution, Redemption, Smite or Preserve; the game
 *   ends after 20 minutes; logging out or taking a Desert Island rowboat forfeits (the attacker
 *   gets the kill); Casual changes no rank or points; High Stakes pays 7,500,000 and 2,500,000 to
 *   the first two and a free next game to 3rd-5th.
 * The other units hook in: onStart(fn(game)), onTick(fn(game)), onEnd(fn(game)),
 * onKill(fn(game, killer, victim)), onDeath(fn(game, victim, where)).
 */
const Common = require("./Common.LastManStanding");
const Stash = require("./Stash.LastManStanding");
const Loadouts = require("./Loadouts.LastManStanding");
const Profile = require("./Profile.LastManStanding");

const startHooks = [];
const tickHooks = [];
const endHooks = [];
const killHooks = [];
const deathHooks = [];
/** Games in play, and which game each player is in. */
const games = new Set();
const gameOfPlayer = new Map();
/** Deaths that began in a game end there, whatever happens meanwhile. */
const dying = new Map();
const PVP_ICONS = "pvp_icons";
const RUNE_POUCH = "br_rune_replacement";
/** The client's first player option, as Castle Wars, Bounty Hunter and Ferox use it. */
const ATTACK_OPTION_SLOT = 1;
/** Client script 6541: the build's name across the screen on arrival (captured). */
const BUILD_BANNER_SCRIPT = 6541;
/** How far apart players start, at least. */
const SPAWN_SPREAD = 7;
const DISABLED_PRAYERS = ["RAPID_RESTORE", "RAPID_HEAL", "PROTECT_ITEM", "RETRIBUTION", "REDEMPTION", "SMITE", "PRESERVE"];

let AreaClass = null;

function areaClass() {
  if (AreaClass) return AreaClass;
  const { TemplatedInstanceArea } = Common.core;
  AreaClass = class LastManStandingArena extends TemplatedInstanceArea {
    constructor(game, map) {
      const [cx, cy] = map.chunk;
      const [w, h] = map.size;
      super(w, h);
      this.game = game;
      this.origin = [cx * 8, cy * 8];
      for (let z = 0; z < map.planes; z++) {
        for (let x = 0; x < w; x++) {
          for (let y = 0; y < h; y++) {
            this.setChunk(z, x, y, { sourceChunkX: cx + x, sourceChunkY: cy + y, sourcePlane: z, rotation: 0 });
          }
        }
      }
    }

    getName() {
      return "Last Man Standing";
    }

    isMulti() {
      return false;
    }

    allowSummonPet() {
      return false;
    }

    /** The instance's copy of a source tile. */
    at([x, y, z]) {
      return this.tile(x - this.origin[0], y - this.origin[1], z ?? 0);
    }

    /** The source tile an instance tile copies. */
    templateOf(location) {
      return [location.getX() - this.getBaseX() + this.origin[0], location.getY() - this.getBaseY() + this.origin[1], location.getZ()];
    }

    canAttack(attacker, target) {
      return this.game.canAttack(attacker, target);
    }

    canTeleport() {
      return false;
    }

    /** Logging out mid-game forfeits, and saves the player in the lobby, never on the copy. */
    postLeave(mobile, logout) {
      const player = Common.asPlayer(mobile);
      if (player && logout) {
        this.game.forfeit(player, true);
        player.setLocation(lobbyTile());
      }
      super.postLeave(mobile, logout);
    }
  };
  return AreaClass;
}

function lobbyTile() {
  const [x, y] = Common.pick(Common.data.lobby.afterGame);
  return new Common.core.Location(x, y, 0);
}

/** Wiki: the same build for everyone, more likely the more of them prefer it. */
function chooseBuild(players) {
  const votes = [1, 1, 1];
  for (const player of players) votes[Profile.preferredBuild(player)] += 1;
  let roll = Math.random() * votes.reduce((a, b) => a + b, 0);
  for (let build = 0; build < votes.length; build++) {
    roll -= votes[build];
    if (roll < 0) return build;
  }
  return 0;
}

class Game {
  constructor(players, mode = Common.data.modes.find((candidate) => candidate.key === "competitive")) {
    this.mode = mode;
    this.map = Common.pick(Common.data.maps);
    this.build = chooseBuild(players);
    this.area = new (areaClass())(this, this.map);
    this.players = new Set(players);
    this.alive = new Set(players);
    this.total = players.length;
    this.kills = new Map();
    this.immuneUntil = new Map();
    this.elapsed = 0;
    this.begun = false;
    this.over = false;
    this.zone = Common.pick(this.map.safezones);
  }

  /** Ticks since "The fight for survival has begun!" (negative while counting down). */
  get clock() {
    const { countdownFrom, countdownEvery } = Common.data.timing;
    return this.elapsed - (countdownFrom * countdownEvery + 1);
  }

  start() {
    games.add(this);
    const tiles = this.spawnTiles();
    let index = 0;
    for (const player of this.players) this.enter(player, tiles[index++ % tiles.length]);
    for (const hook of startHooks) hook(this);
    Common.every(() => this.tick());
  }

  /** Plane-0 tiles beside the island's chests: open ground spread over the whole map. */
  spawnTiles() {
    const chest = Common.locId("br_loot_chest_closed");
    const [w, h] = this.map.size;
    const spots = [];
    for (let x = 0; x < w; x++) {
      for (let y = 0; y < h; y++) {
        for (const object of this.area.getChunkObjects(0, x, y)) {
          if (object.getId() === chest) spots.push(object.getLocation());
        }
      }
    }
    this.chestSpots = spots;
    // Chests stand in groups: one spot a group, so nobody starts beside someone else.
    const tiles = [];
    for (const spot of spots.sort(() => Math.random() - 0.5)) {
      if (tiles.some((tile) => Math.max(Math.abs(tile.getX() - spot.getX()), Math.abs(tile.getY() - spot.getY())) < SPAWN_SPREAD)) continue;
      const tile = this.openTileNear(spot, 3);
      if (tile) tiles.push(tile);
    }
    // More players than spots: the rest start a little further from the same chests.
    for (let i = 0; tiles.length < this.players.size && spots.length && i < this.players.size * 4; i++) {
      const tile = this.openTileNear(Common.pick(spots), 8);
      if (tile && !tiles.some((other) => Math.max(Math.abs(other.getX() - tile.getX()), Math.abs(other.getY() - tile.getY())) < 4)) tiles.push(tile);
    }
    return tiles.length ? tiles : [this.area.at([...this.zone.centre, 0])];
  }

  /** A walkable tile within `range` of a location on the copy, or null. */
  openTileNear(location, range) {
    const { Location } = Common.core;
    for (let attempt = 0; attempt < 20; attempt++) {
      const x = location.getX() + Common.randomInt(-range, range);
      const y = location.getY() + Common.randomInt(-range, range);
      if (Common.standable(x, y, location.getZ(), this.area)) return new Location(x, y, location.getZ());
    }
    return null;
  }

  enter(player, tile) {
    gameOfPlayer.set(player, this);
    this.kills.set(player, 0);
    Stash.save(player);
    Loadouts.equip(player, this.build);
    player.getCombat?.().reset?.();
    const sender = player.getPacketSender();
    Common.varbit(player, "br_ingame", 1);
    Common.varbit(player, "br_active_map_player", this.map.id);
    Common.varbit(player, "br_active_build_player", this.build);
    Common.varbit(player, "pvp_area_client", 1);
    player.sendMessage(Common.message("mode", { build: Loadouts.buildName(this.build) }));
    this.area.enter(player);
    player.moveTo(tile);
    sender.sendSong(Common.data.music.game);
    sender.closeSubInterface(Common.component("toplevel_osrs_stretch:overlay_hud"));
    sender.sendSubInterface(Common.component("toplevel_osrs_stretch:pvp_icons"), Common.interfaceId(PVP_ICONS), 1);
    sender.sendInterfaceDisplayState(Common.component("pvp_icons:icon_container"), false);
    for (const hidden of ["pvp_icons:pvpw_safe", "pvp_icons:wildernesslevel", "pvp_icons:pvp"]) sender.sendInterfaceDisplayState(Common.component(hidden), true);
    sender.sendSubInterface(Common.component("toplevel_osrs_stretch:overlay_atmosphere"), Common.interfaceId("br_overlay"), 1);
    sender.sendPlayerOption(ATTACK_OPTION_SLOT, "Fight", true);
    // Captured: the build's name drawn across the screen as the player arrives.
    sender.sendInterfaceScript(BUILD_BANNER_SCRIPT, [Loadouts.buildName(this.build)]);
  }

  canAttack(attacker, target) {
    const a = Common.asPlayer(attacker);
    const t = Common.asPlayer(target);
    if (!a || !t) return null;
    if (!this.alive.has(a) || !this.alive.has(t)) return false;
    if (!this.begun) {
      Common.spam(a, Common.message("notStarted"));
      return false;
    }
    if ((this.immuneUntil.get(t) ?? 0) > this.elapsed || (this.immuneUntil.get(a) ?? 0) > this.elapsed) return false;
    return true;
  }

  tick() {
    if (this.over) return false;
    this.elapsed++;
    const { countdownFrom, countdownEvery, timeDisplayEvery, gameTicks } = Common.data.timing;
    // The countdown: every player says the number, two ticks apart (captured).
    // Nobody moves until "GO!" (captured: a click before it only gets "I can't reach that!").
    if (!this.begun) for (const player of this.alive) player.getMovementQueue().setBlockMovement(true).reset();
    if (!this.begun && this.elapsed % countdownEvery === 1) {
      const left = countdownFrom - Math.floor(this.elapsed / countdownEvery);
      for (const player of this.alive) player.forceChat(left > 0 ? `${left}...` : "GO!");
      if (left <= 0) {
        this.begun = true;
        for (const player of this.alive) {
          player.getMovementQueue().setBlockMovement(false);
          player.sendMessage(Common.message("begun"));
        }
      }
    }
    if (this.begun && this.clock % timeDisplayEvery === 0) {
      for (const player of this.alive) Common.varbit(player, "br_timedisplay", this.clock / timeDisplayEvery + 1);
    }
    for (const hook of tickHooks) hook(this);
    if (this.over) return false;
    for (const player of this.alive) keepPrayer(player);
    this.hud();
    if (this.begun && this.alive.size <= 1) this.finish();
    else if (this.clock >= gameTicks) this.finish();
    return !this.over;
  }

  /** The overlay's three lines, every tick as captured. */
  hud() {
    const survivors = `${this.alive.size} / ${this.total}`;
    for (const player of this.alive) {
      Common.text(player, "br_overlay:survivor_count", survivors);
      Common.text(player, "br_overlay:kill_count", this.begun ? String(this.kills.get(player) ?? 0) : "Safe");
      Common.text(player, "br_overlay:fog_status", this.fogStatus?.(player) ?? "Safe");
    }
  }

  /** A player died here: the killer's reward, the drops, then out to the lobby. */
  died(player, killer) {
    if (!this.alive.has(player)) return;
    const place = this.alive.size;
    this.alive.delete(player);
    const where = player.getLocation().clone();
    for (const hook of deathHooks) hook(this, player, where, killer);
    if (killer && killer !== player && this.alive.has(killer)) this.credit(killer, player);
    this.release(player, place, "dead");
  }

  /** A kill: the count, 20 seconds' safety and the other units' rewards (key, resupply). */
  credit(killer, victim) {
    const count = (this.kills.get(killer) ?? 0) + 1;
    this.kills.set(killer, count);
    Common.varbit(killer, "br_killcount", count);
    Common.add(killer, Common.ATTRIBUTES.kills, 1);
    this.immuneUntil.set(killer, this.elapsed + Common.data.timing.unattackableAfterKill);
    for (const hook of killHooks) hook(this, killer, victim);
  }

  /**
   * Logged out or rowed away: a forfeit without rewards, one of the day's three in a ranked mode;
   * whoever was fighting them gets the kill (Wiki).
   */
  forfeit(player, logout = false) {
    if (!this.alive.has(player)) return;
    const attacker = Common.asPlayer(player.getCombat?.().getAttacker?.());
    this.alive.delete(player);
    if (attacker && this.alive.has(attacker)) this.credit(attacker, player);
    if (this.mode.ranked && this.begun) require("./Lobby.LastManStanding").forfeited(player);
    this.release(player, null, logout ? "logout" : "forfeit");
  }

  finish() {
    if (this.over) return;
    this.over = true;
    games.delete(this);
    const [winner] = this.alive;
    for (const hook of endHooks) hook(this);
    if (winner && this.begun && this.alive.size === 1) {
      this.alive.delete(winner);
      this.release(winner, 1, "won");
    }
    // The time ran out: everyone left shares the place they're in.
    const place = this.alive.size;
    for (const player of [...this.alive]) {
      this.alive.delete(player);
      this.release(player, place, "time");
    }
    Common.later(2, () => {
      if (!this.area.isDestroyed()) this.area.destroy();
    });
  }

  /** Back to the lobby: their own things, the varbits, the overlays; then the results. */
  release(player, place, how) {
    gameOfPlayer.delete(player);
    this.immuneUntil.delete(player);
    const sender = player.getPacketSender();
    if (how === "dead") {
      player.sendMessage(Common.message(place <= 9 ? "goodEffort" : "valiant"));
      player.sendMessage(Common.message("dead"));
    } else if (how === "won") {
      player.sendMessage(Common.message("victorious"));
    }
    for (const name of ["br_ingame", "br_killcount", "br_saferadius", "br_safecoord_x", "br_safecoord_z", "br_timedisplay", "br_fog_damagecount", "pvp_area_client"]) {
      Common.varbit(player, name, 0);
    }
    sender.sendPlayerOption(ATTACK_OPTION_SLOT, "", false);
    sender.sendEntityHintRemoval(false);
    sender.closeSubInterface(Common.component("toplevel_osrs_stretch:overlay_atmosphere"));
    sender.closeSubInterface(Common.component("toplevel_osrs_stretch:pvp_icons"));
    clearCombat(player);
    player.getMovementQueue().setBlockMovement(false);
    Common.core.PrayerHandler.deactivatePrayers(player);
    Stash.restore(player);
    if (how !== "logout") {
      if (player.getArea() === this.area) this.area.leave(player, false);
      player.moveTo(lobbyTile());
    }
    // Captured: a death plays its song and jingle, and the lobby's song follows a tick later.
    if (how === "dead") {
      sender.sendSong(Common.data.music.death);
      sender.sendJingle(Common.data.jingles.death);
      Common.later(1, () => sender.sendSong(Common.data.music.lobby));
    } else {
      sender.sendSong(Common.data.music.lobby);
    }
    Common.add(player, Common.ATTRIBUTES.games, 1);
    if (how === "won") Common.add(player, Common.ATTRIBUTES.wins, 1);
    if (how !== "forfeit" && how !== "logout" && this.mode.ranked) {
      for (const [delay, line] of results(this, player, place, how)) Common.later(delay, () => player.sendMessage(line));
    }
    require("./Lobby.LastManStanding").openOverlay(player);
  }
}

/**
 * What a fight leaves on a player: hits still queued (Combat.reset does not clear them), poison,
 * venom and freeze. Cleared before their own things come back, as DuelArena's end does, so an
 * arena hit cannot land on them once they are in the lobby.
 */
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

/**
 * Wiki's rank and points rules. Captured: the rank (varp br_rank) changes as the player arrives in
 * the lobby; "Your rank has increased!" follows a tick later after a death (two after a win), and
 * the points line a tick after that.
 */
function results(game, player, place, how = "dead") {
  const lines = [];
  const kills = game.kills.get(player) ?? 0;
  const before = Common.rankOf(player);
  const change = Common.rankChange(place);
  if (change !== 0) Profile.setRank(player, before + change);
  const first = how === "won" ? 2 : 1;
  if (change !== 0) lines.push([first, Common.message(change > 0 ? "rankUp" : "rankDown")]);
  lines.push([first + 1, pointsLine(game, player, place, kills)]);
  stakes(game, player, place);
  return lines;
}

/** The points line, paying them as it goes. */
function pointsLine(game, player, place, kills) {
  const total = Common.points(player);
  if (game.clock < Common.data.timing.minTicksForPoints) return Common.message("tooShort", { total });
  const earned = kills > 0 ? pointsFor(place, kills) : 0;
  if (earned <= 0) return Common.message("noPoints", { total });
  const after = Common.add(player, Common.POINTS_ATTRIBUTE, earned);
  return Common.message("earned", { points: earned, s: earned === 1 ? "" : "s", total: after });
}

/** Wiki: High Stakes pays the first two into the reward chest, and the next three play free. */
function stakes(game, player, place) {
  const { prizes, freeEntryPlaces } = game.mode;
  if (!prizes) return;
  const Coffer = require("./Coffer.LastManStanding");
  if (prizes[place - 1]) Coffer.award(player, prizes[place - 1]);
  else if (place >= freeEntryPlaces[0] && place <= freeEntryPlaces[1]) Coffer.grantFreeEntry(player);
}

function pointsFor(place, kills) {
  const { places, kills: bonus } = Common.data.points;
  const forPlace = places.find(([upTo]) => place <= upTo)?.[1] ?? 0;
  const forKills = bonus.find(([atLeast]) => kills >= atLeast)?.[1] ?? 0;
  return forPlace + forKills;
}

function gameOf(player) {
  return gameOfPlayer.get(player) ?? null;
}

// ---------------------------------------------------------------- hooks

/** Captured: the verdict and "Oh dear, you are dead!" come together as the player reaches the lobby. */
function dyingStarts(event) {
  const game = gameOf(event.player);
  if (!game) return;
  dying.set(event.player, game);
  event.announce = false;
}

function died(event) {
  const player = event.player;
  const game = dying.get(player) ?? gameOf(player);
  dying.delete(player);
  if (!game) return;
  event.handled = true;
  const killer = Common.asPlayer(event.killer) ?? Common.asPlayer(player.getCombat?.().getKiller?.(true));
  // Out of the game while dying (it ended): the line the core left to us.
  if (!game.alive.has(player)) player.sendMessage(Common.message("dead"));
  game.died(player, killer);
}

function keepItems(event) {
  if (gameOf(event.player) || dying.has(event.player)) event.shouldDrop = false;
}

function noExperience(event) {
  if (gameOf(event.player)) event.allow = false;
}

function prayerDisabled(event) {
  const game = gameOf(event.player);
  if (!game) return;
  const { PrayerData } = Common.core;
  const disabled = DISABLED_PRAYERS.some((name) => PrayerData[name] === event.prayer);
  if (!disabled) return;
  event.disabled = true;
  event.messageBox = true;
  event.message = Common.message("prayerDisabled", { prayer: event.prayer.getPrayerName() ?? "That prayer" });
}

/** Wiki: every prayer the build qualifies for can be used, whatever the account unlocked. */
function bypassPrayerUnlocks(event) {
  if (gameOf(event.player)) event.bypass = true;
}

/** Wiki: run energy never runs out in a game. */
function noDrain(entity, amount) {
  return gameOf(Common.asPlayer(entity)) ? 0 : amount;
}

/**
 * Wiki: prayer never runs out in a game. The core's prayer drain has no hook (its drain
 * modifiers are for attacks that drain prayer), so the drain counter is cleared each tick.
 */
function keepPrayer(player) {
  const { Skill } = Common.core;
  const skills = player.getSkillManager();
  player.setPrayerPointDrain(0);
  if (skills.getCurrentLevel(Skill.PRAYER) < skills.getMaxLevel(Skill.PRAYER)) skills.setCurrentLevel(Skill.PRAYER, skills.getMaxLevel(Skill.PRAYER), true);
}

/** Desert Island's rowboats (Forfeit): out of the game after the barrier's question (inferred). */
function rowAway({ player }) {
  const game = gameOf(player);
  if (!game) return false;
  Common.api.sendMultiChatboxPrompt(player, Common.message("forfeit"), "Yes.", () => game.forfeit(player), "No.", () => {});
  return true;
}

/**
 * The game's rune pouch (br_rune_replacement): Wiki, it "gives access to" the load-out's spells,
 * so in a game it covers every rune a spell is short of, and never runs out (inferred).
 */
function pouchCovers(player, missingItems) {
  if (!gameOf(player) || !player.getInventory().contains(Common.objId(RUNE_POUCH))) return false;
  return missingItems.every((item) => / rune$/.test(Common.core.CacheDefinitions.getItem(item.getId())?.name ?? ""));
}

function pouchSpends() {}

function attachMatch(api) {
  api.registerSpellRuneSource({ check: pouchCovers, consume: pouchSpends });
  api.onObjectFirstClick([Common.locId("br_boat_forfeit")], rowAway);
  api.onPlayerBeforeDeath(dyingStarts);
  api.onPlayerDeath(died);
  api.onShouldDropItemsOnDeath(keepItems);
  api.onCanGainExperience(noExperience);
  api.onPrayerDisabled(prayerDisabled);
  api.onCustomEvent("prayer:unlocks-bypass", bypassPrayerUnlocks);
  api.registerRunEnergyDrainModifier(noDrain);
}

module.exports = {
  attachMatch,
  Game,
  gameOf,
  games,
  pointsFor,
  results,
  chooseBuild,
  pouchCovers,
  onStart: (hook) => startHooks.push(hook),
  onTick: (hook) => tickHooks.push(hook),
  onEnd: (hook) => endHooks.push(hook),
  onKill: (hook) => killHooks.push(hook),
  onDeath: (hook) => deathHooks.push(hook),
};
