/**
 * A Soul Wars match, as recorded (rsprox 227/00079, 234/03277; soul-wars.json):
 * - the arena is an instance copied from its template; the teams (balanced by combat level) start
 *   in their bases with the team varbits, capes, HUD 375, its timer (client script 370) and the
 *   game music, "The game of Soul Wars has begun!" and the Nomad's "The time is now! Crush their
 *   souls!";
 * - 1,500 ticks, "Time remaining: ..." every 250; five avatar kills ends it two ticks on;
 * - the end: "The red team was victorious!", the varbits back, the game's items gone, the lobby,
 *   its music and the end screen (435) with the player's figures and Zeal.
 * Inferred: a team with nobody left loses at once (both empty: no winner).
 * Wiki: on time, more kills wins and equal kills is a draw; Zeal's caps (40 a loss, 50 a draw, 60
 * a win, full only with 10:15 played). Calibrated: how the contributions make Zeal (each a share of
 * its cap, soul-wars.json `zeal`).
 * The other units hook in: `onTick(fn(game))`, `onStart(fn(game))`, `onEnd(fn(game))`.
 */
const Common = require("./Common.SoulWars");

/** The worn cape's slot (Equipment.CAPE_SLOT). */
const CAPE_SLOT = 1;
const ARENA_PLANES = 4;
const tickHooks = [];
const startHooks = [];
const endHooks = [];
/**
 * Saved while the player is in a game, so a save made mid-game (shutdown, `saveall`, a tick error, any requested
 * save) is recovered at login: the game's items go and the player is put in the lobby, as leaving does.
 */
const IN_GAME_ATTRIBUTE = "soul-wars-in-game";
/** The match in play (one a world, as live). */
let current = null;

let AreaClass = null;

function areaClass() {
  if (AreaClass) return AreaClass;
  const { TemplatedInstanceArea } = Common.core;
  AreaClass = class SoulWarsArena extends TemplatedInstanceArea {
    constructor(game) {
      const { chunk, size } = Common.data.arena;
      super(size[0], size[1]);
      this.game = game;
      this.origin = [chunk[0] * 8, chunk[1] * 8];
      // Every plane: the bridges onto the obelisk's island are marked on the plane above (a
      // plane-0-only copy leaves them as the water under them).
      for (let z = 0; z < ARENA_PLANES; z++) {
        for (let x = 0; x < size[0]; x++) {
          for (let y = 0; y < size[1]; y++) {
            this.setChunk(z, x, y, { sourceChunkX: chunk[0] + x, sourceChunkY: chunk[1] + y, sourcePlane: z, rotation: 0 });
          }
        }
      }
    }

    getName() {
      return "Soul Wars";
    }

    isMulti() {
      return true;
    }

    allowSummonPet() {
      return false;
    }

    /** No follower comes in either (Wiki: Soul Wars): a following pet waits outside. */
    barsFollowers() {
      return true;
    }

    /** The instance's copy of a template tile. */
    at([x, y, z]) {
      return this.tile(x - this.origin[0], y - this.origin[1], z ?? 0);
    }

    /** The template tile an instance tile copies. */
    templateOf(location) {
      return [location.getX() - this.getBaseX() + this.origin[0], location.getY() - this.getBaseY() + this.origin[1], location.getZ()];
    }

    canAttack(attacker, target) {
      return this.game.canAttack(attacker, target);
    }

    npcAggression(player, npc) {
      return this.game.aggressive(player, npc);
    }

    canTeleport() {
      return false;
    }

    /** Logging out mid-game saves the player in the lobby, never on the instance's tiles. */
    postLeave(mobile, logout) {
      const player = mobile.isPlayer?.() ? mobile.getAsPlayer?.() ?? mobile : null;
      if (player) {
        this.game.left(player, logout);
        if (logout) player.setLocation?.(Common.toLocation(Common.data.lobby.afterGame));
      }
      super.postLeave(mobile, logout);
    }
  };
  return AreaClass;
}

class Game {
  constructor(players) {
    this.area = new (areaClass())(this);
    this.teams = new Map();
    this.members = { blue: new Set(), red: new Set() };
    this.starters = { blue: 0, red: 0 };
    this.kills = { blue: 0, red: 0 };
    this.stats = new Map();
    this.elapsed = 0;
    this.over = false;
    this.npcs = new Set();
    this.balance(players);
  }

  /** Teams by combat level: strongest first, each to the smaller side, else the weaker one. */
  balance(players) {
    const combat = (player) => player.getSkillManager().getCombatLevel?.() ?? 3;
    const sorted = [...players].sort((a, b) => combat(b) - combat(a));
    const strength = { blue: 0, red: 0 };
    for (const player of sorted) {
      const { blue, red } = this.members;
      const side = blue.size !== red.size ? (blue.size < red.size ? "blue" : "red") : (strength.blue <= strength.red ? "blue" : "red");
      this.members[side].add(player);
      this.teams.set(player, side);
      strength[side] += combat(player);
    }
    this.starters = { blue: this.members.blue.size, red: this.members.red.size };
  }

  teamOf(player) {
    return this.teams.get(player) ?? null;
  }

  players() {
    return [...this.teams.keys()];
  }

  statsOf(player) {
    if (!this.stats.has(player)) this.stats.set(player, { kills: 0, areas: 0, damage: 0, fragments: 0, bones: 0 });
    return this.stats.get(player);
  }

  spawn(id, tile) {
    const npc = Common.core.NPC.create(id, this.area.at(tile));
    npc.__skipDefaultRespawn = true;
    npc.__soulWars = this;
    this.area.add(npc);
    Common.core.World.getAddNPCQueue().push(npc);
    this.npcs.add(npc);
    return npc;
  }

  despawn(npc) {
    if (!npc) return;
    this.npcs.delete(npc);
    Common.core.World.getRemoveNPCQueue().push(npc);
  }

  start() {
    current = this;
    for (const player of this.players()) this.enter(player);
    for (const hook of startHooks) hook(this);
    Common.every(() => this.tick());
  }

  /** Recorded start: varbits, the cape, the base, the HUD and timer, the music, the lines. */
  enter(player) {
    const team = this.teamOf(player);
    const { data } = Common;
    Common.varbit(player, "multiway_indicator", 1);
    Common.varbit(player, "soul_wars_team", Common.TEAM_VALUE[team]);
    for (const place of ["obelisk", "east_gy", "west_gy"]) Common.varbit(player, `soul_wars_${place}_alignment`, Common.ALIGNMENT.neutral);
    Common.varbit(player, "soul_wars_entered_game", 1);
    Common.varbit(player, "pvp_area_client", 1);
    Common.addVarp(player, "total_games", 1);
    const equipment = player.getEquipment();
    const capeSlot = CAPE_SLOT;
    player.setAttribute(IN_GAME_ATTRIBUTE, true);
    equipment.setItem?.(capeSlot, new Common.core.Item(data.items.capes[team], 1));
    equipment.refreshItems?.();
    player.getUpdateFlag?.().flag?.(Common.core.Flag?.APPEARANCE);
    const [x, y] = data.bases[team];
    this.area.enter(player);
    player.moveTo(this.area.at([x + Common.randomInt(-1, 1), y + Common.randomInt(-1, 1), 0]));
    const sender = player.getPacketSender();
    sender.sendSubInterface(Common.component("toplevel_osrs_stretch:overlay_hud"), Common.core.CacheDefinitions.getInterfaceId("soul_wars_game"), 1);
    sender.sendInterfaceScript(370, [data.gameTicks + 1]);
    sender.sendSong?.(data.music.game);
    player.sendMessage(Common.message("begun"));
    Common.varbit(player, "soul_wars_activity_value", data.activity.max);
    this.statsOf(player);
  }

  canAttack(attacker, target) {
    for (const hook of attackRules) {
      const allowed = hook(this, attacker, target);
      if (allowed !== undefined && allowed !== null) return allowed;
    }
    return null;
  }

  aggressive(player, npc) {
    for (const hook of aggressionRules) {
      const allowed = hook(this, player, npc);
      if (allowed !== undefined && allowed !== null) return allowed;
    }
    return null;
  }

  tick() {
    if (this.over) return false;
    this.elapsed++;
    const { gameTicks, timeEvery } = Common.data;
    const left = gameTicks - this.elapsed;
    if (left > 0 && left % timeEvery === 0) {
      const text = Common.message("time", { time: `${Math.floor(left / 100)}:${String(Math.round((left % 100) * 0.6)).padStart(2, "0")}` });
      for (const player of this.players()) player.sendMessage(text);
    }
    for (const hook of tickHooks) hook(this);
    if (this.over) return false;
    // Inferred: a side with nobody left concedes (no game without one); none left, nobody wins.
    const empty = Common.TEAMS.filter((team) => this.members[team].size === 0);
    if (empty.length) {
      this.finish(empty.length === 2 ? null : Common.other(empty[0]));
      return false;
    }
    this.hud();
    if (left <= 0) this.finish(this.kills.blue === this.kills.red ? null : this.kills.blue > this.kills.red ? "blue" : "red");
    return !this.over;
  }

  /** HUD 375's texts, every tick as recorded. */
  hud() {
    for (const player of this.players()) {
      for (const team of Common.TEAMS) {
        Common.text(player, `soul_wars_game:${team}_kills`, `${this.kills[team]}/${Common.data.killsToWin}`);
        const avatar = this.avatars?.[team];
        Common.text(player, `soul_wars_game:${team}_health`, avatar?.alive ? `${Math.ceil((100 * avatar.npc.getHitpoints()) / Common.data.avatarHp)}%` : "-");
        Common.text(player, `soul_wars_game:${team}_strength`, avatar?.alive ? `${Math.round(avatar.strength)}%` : "-");
      }
    }
  }

  /** An avatar fell: the kill, and five ends the match two ticks on (recorded). */
  scored(team) {
    this.kills[team]++;
    if (this.kills[team] >= Common.data.killsToWin && !this.ending) {
      this.ending = true;
      Common.later(Common.data.endDelay, () => this.finish(team));
    }
  }

  zealFor(player, result) {
    const { zeal } = Common.data;
    const stats = this.statsOf(player);
    const share = Object.entries(zeal.caps).reduce((sum, [key, cap]) => sum + Math.min(1, (stats[key] ?? 0) / cap), 0);
    const time = Math.min(1, this.elapsed / zeal.fullTicks);
    return Math.max(1, Math.round(zeal[result] * Math.min(1, share / zeal.sharesForFull) * time));
  }

  finish(winner) {
    if (this.over) return;
    this.over = true;
    if (current === this) current = null;
    for (const hook of endHooks) hook(this);
    for (const player of this.players()) {
      const team = this.teamOf(player);
      if (winner) player.sendMessage(Common.message("won", { colour: Common.COLOURS[winner], team: winner }));
      else player.sendMessage(Common.message("draw"));
      // A side that never had anyone (a lowered minimum, everyone gone) makes no real game.
      const real = this.starters.blue > 0 && this.starters.red > 0;
      const result = !real ? null : !winner ? "draw" : winner === team ? "win" : "loss";
      this.release(player, result);
    }
    for (const npc of [...this.npcs]) this.despawn(npc);
    if (!this.area.isDestroyed?.()) this.area.destroy?.();
  }

  /** Out to the lobby: the varbits back, the game's items gone, Zeal paid and the end screen. */
  release(player, result) {
    const { data } = Common;
    this.teams.delete(player);
    for (const team of Common.TEAMS) this.members[team].delete(player);
    Common.varbit(player, "soul_wars_team", 0);
    Common.varbit(player, "soul_wars_played_game", 1);
    Common.varbit(player, "pvp_area_client", 0);
    Common.varbit(player, "multiway_indicator", 0);
    clearGameItems(player);
    const sender = player.getPacketSender();
    sender.closeSubInterface?.(Common.component("toplevel_osrs_stretch:overlay_hud"));
    if (player.getArea?.() === this.area) this.area.leave(player, false);
    player.moveTo(Common.toLocation(data.lobby.afterGame));
    sender.sendSong?.(data.music.lobby);
    if (!result) return;
    const first = Common.getVarp(player, "zeal") === 0;
    const award = { player, minigame: "soul-wars", points: this.zealFor(player, result) };
    Common.api.emitCustomEvent("minigame:points", award);
    const zeal = award.points;
    Common.addVarp(player, "zeal", zeal);
    const tokens = Common.addVarp(player, "zeal_tokens", zeal);
    if (result === "win") Common.addVarp(player, "total_wins", 1);
    player.sendMessage(first ? Common.message("zealFirst", { zeal }) : Common.message("zeal", { zeal, tokens }));
    this.endScreen(player, zeal, tokens);
  }

  endScreen(player, zeal, tokens) {
    const stats = this.statsOf(player);
    const sender = player.getPacketSender();
    sender.sendSubInterface(Common.component("toplevel_osrs_stretch:mainmodal"), Common.core.CacheDefinitions.getInterfaceId("soul_wars_game_end"), 0);
    const set = (name, value) => Common.text(player, `soul_wars_game_end:${name}`, value);
    set("players_killed_text", stats.kills);
    set("areas_captured_text", stats.areas);
    set("avatar_damage_text", stats.damage);
    set("obelisk_sacrifices_text", stats.fragments);
    set("bones_buried_text", stats.bones);
    set("zeal_earnt_text", zeal);
    set("lifetime_zeal_text", Common.getVarp(player, "zeal"));
    set("zeal_tokens_text", tokens);
    set("blue_players_text", this.starters.blue);
    set("red_players_text", this.starters.red);
    set("blue_score_text", this.kills.blue);
    set("red_score_text", this.kills.red);
  }

  /** Left the arena some other way (logout, removal): no Zeal. */
  left(player) {
    if (!this.teams.has(player) || this.over) return;
    this.teams.delete(player);
    for (const team of Common.TEAMS) this.members[team].delete(player);
    clearGameItems(player);
  }

  /** Removed mid-game (inactivity): to the lobby without Zeal. */
  remove(player) {
    if (!this.teams.has(player)) return;
    this.release(player, null);
  }
}

/** Every Soul Wars item goes when a game ends or is left (Wiki: bandages vanish; recorded: cleared slots). */
function clearGameItems(player) {
  player.setAttribute(IN_GAME_ATTRIBUTE, false);
  const { items } = Common.data;
  const ids = [items.fragment, items.bones, items.bandages, ...items.potions, items.capes.blue, items.capes.red];
  const inventory = player.getInventory();
  for (const id of ids) {
    const amount = inventory.getAmount(id);
    if (amount > 0) inventory.delete(id, amount);
  }
  const equipment = player.getEquipment();
  const capeSlot = CAPE_SLOT;
  const cape = equipment.getItems?.()[capeSlot];
  if (cape && (cape.getId() === items.capes.blue || cape.getId() === items.capes.red)) {
    equipment.setItem?.(capeSlot, new Common.core.Item(-1, 0));
    equipment.refreshItems?.();
  }
  inventory.refreshItems?.();
}

/** Logged in from a mid-game save with no game to return to: the game's items go and the lobby, as leaving does. */
function recoverOnLogin({ player }) {
  if (player.getAttribute(IN_GAME_ATTRIBUTE) !== true || current?.teams.has(player)) return;
  clearGameItems(player);
  player.moveTo(Common.toLocation(Common.data.lobby.afterGame));
}

function attachMatch(api) {
  api.persistAttribute(IN_GAME_ATTRIBUTE, false);
  api.onPlayerLogin(recoverOnLogin);
}

const attackRules = [];
const aggressionRules = [];

module.exports = {
  Game,
  get current() {
    return current;
  },
  gameOf(player) {
    return current?.teams.has(player) ? current : null;
  },
  reset() {
    current?.finish(null);
    current = null;
  },
  onTick: (hook) => tickHooks.push(hook),
  onStart: (hook) => startHooks.push(hook),
  onEnd: (hook) => endHooks.push(hook),
  onAttackRule: (hook) => attackRules.push(hook),
  onAggressionRule: (hook) => aggressionRules.push(hook),
  clearGameItems,
  attachMatch,
  IN_GAME_ATTRIBUTE,
};
