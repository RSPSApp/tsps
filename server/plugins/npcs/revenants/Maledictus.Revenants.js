/**
 * The Revenant maledictus (https://oldschool.runescape.wiki/w/Revenant_maledictus), from an OSRS
 * capture of a full fight (docs/revenants.md):
 *
 * - Spawning: each revenant kill adds its combat level to a world total, and the boss appears
 *   when a roll out of SPAWN_RATE lands under it (the Wiki's mechanic; the rate itself is not
 *   published, so ours is a guess). Then 45 minutes without one (Wiki); it stays 10 minutes.
 * - It is multi-combat in the singles-plus caves and attacks every player in range: a standard
 *   Ranged spike (2033) and, every 2-3 standard attacks, one of three specials: Ice (freeze if
 *   you stay on your tile), Blood (damage if you stay, healing it half) and an air surge
 *   exploding over a 5x5 area.
 * - Loot: the top damage dealer gets an ancient emblem or totem and two rolls on the revenant
 *   dragon's table (and Forinthry surge with an amulet of avarice); everyone else who hurt it
 *   gets a blighted super restore and two blighted food, under them.
 */
const { rollDrops } = require("./Drops.Revenants");
const { MALEDICTUS_ID, inCaves } = require("./Data.Revenants");
const Avarice = require("./Avarice.Revenants");

const ID = MALEDICTUS_ID;
const NAME = "Revenant maledictus";
const SPAWN_RATE = 10_000; // ours (Near-Reality's): the Wiki's "flat spawn rate" isn't published
const COOLDOWN_MS = 45 * 60_000;
const LIFETIME_TICKS = 1000; // 10 minutes
const RANGE = 15;
const HINT_RANGE = 64;

/** The Wiki's eleven chambers; tiles from Near-Reality, checked walkable (the capture: 3213,10098). */
const SPAWNS = [
  { x: 3173, y: 10190, hint: "north" }, // cyclops and demons
  { x: 3235, y: 10200, hint: "north" }, // dragons
  { x: 3214, y: 10191, hint: "north" }, // northern imps
  { x: 3243, y: 10171, hint: "middle" }, // hellhounds, the old ruins
  { x: 3250, y: 10142, hint: "middle" }, // eastern pyrefiends
  { x: 3173, y: 10153, hint: "middle" }, // western pyrefiends
  { x: 3206, y: 10161, hint: "middle" }, // dark beasts
  { x: 3222, y: 10129, hint: "middle" }, // northern orks
  { x: 3213, y: 10094, hint: "south" }, // southern orks
  { x: 3159, y: 10113, hint: "south" }, // southern demons
  { x: 3185, y: 10116, hint: "south" }, // outside the southern demons
];

const ANIM = { standard: 9282, surge: 9277, ice: 9278, blood: 9279 }; // blood: the cache's _attack_heal
const STANDARD = { projectile: 2033, delay: 30, end: 90, startHeight: 100, endHeight: 12, angle: 10, progress: 32, impact: 474, sound: 488 };
const ICE = { tileGraphic: 382, tileSound: 177, sound: 487, impact: 2035, impactSound: 168, freezeTicks: 10 };
const BLOOD = { tileGraphic: 382 }; // not captured: the ice spell's tile marker (Near-Reality's)
const SURGE = { projectile: 1456, delay: 58, end: 150, startHeight: 125, endHeight: 8, progress: 208, sound: 483, centre: 134, blast: 2034, blastSound: 223, landTicks: 5 };
const SURGE_MAX = [25, 17, 9]; // by distance from the centre: "up to 25, less near the edges" (ours)
const SPECIAL_LAND_TICKS = 3;
const EMBLEM = 21807;
const TOTEM = 21810;
const BLIGHTED_RESTORE = 24598;
const BLIGHTED_FOOD = [24589, 24592, 24595]; // manta ray, anglerfish, karambwan

const state = { total: 0, quietUntil: 0, boss: null, area: null };
const attackState = new WeakMap();
const damagers = new WeakMap();

function createMaledictus(api, core, { inCaves, surge }) {
  const { Location, Graphic, Animation, Projectile, PendingHit, CombatFactory, CombatMethod, CombatType, HitDamage, HitMask, Sounds, TimerKey } = core;

  const players = () => [...core.World.getPlayers()].filter((p) => p && p.isRegistered?.() !== false);
  const inRange = (boss) => players().filter((p) => p.getHitpoints() > 0 && p.getLocation().isWithinDistance(Projectile.centreOf(boss), RANGE) && inCaves(p.getLocation()));
  const areaSound = (at, id, delay = 0, radius = 10) => Sounds.playAreaSound({ soundId: id, x: at.getX(), y: at.getY(), level: at.getZ(), delay, radius });
  const mapGraphic = (viewer, graphic, at) => viewer.getPacketSender().sendGlobalGraphic(graphic, at);

  /** Carries a fixed style for hits that land after the boss has moved on to its next attack. */
  class StyleCarrier extends CombatMethod {
    constructor(type) {
      super();
      this.style = type;
    }

    type() {
      return this.style;
    }

    hits() {
      return [];
    }
  }
  const MAGIC_HIT = new StyleCarrier(CombatType.MAGIC);

  function later(ticks, action) {
    core.TaskManager.submit(new (class extends core.Task {
      constructor() {
        super(ticks, null, false);
      }

      execute() {
        this.stop();
        action();
      }
    })());
  }

  /** Ice and Blood: marked on each player's tile; whoever is still there 3 ticks later is hit. */
  function tileSpell(boss, targets, spell) {
    for (const player of targets) {
      const tile = player.getLocation().clone();
      mapGraphic(player, new Graphic(spell === "ice" ? ICE.tileGraphic : BLOOD.tileGraphic), tile);
      if (spell === "ice") areaSound(tile, ICE.tileSound, 0, 1);
      later(SPECIAL_LAND_TICKS, () => {
        if (boss.getHitpoints() <= 0 || !player.getLocation().equals(tile)) return;
        const hit = new PendingHit(boss, player, MAGIC_HIT, 0);
        CombatFactory.addPendingHit(hit);
        if (spell === "blood") {
          boss.heal(Math.floor(hit.getTotalDamage() / 2));
          return;
        }
        player.sendMessage("You have been frozen in place by the Revenant Maledictus' attack!");
        player.performGraphic(new Graphic(ICE.impact));
        player.getPacketSender().sendSound(ICE.impactSound, 1, 10);
        if (!player.getTimers().has(TimerKey.FREEZE)) {
          player.getTimers().registers(TimerKey.FREEZE, ICE.freezeTicks);
          player.getMovementQueue().reset();
        }
      });
    }
  }

  /** The 5x5 air surge: the centre at once, the diagonals 15 cycles later, the edge 30. */
  function airSurge(boss, targets) {
    const victim = targets[Math.floor(Math.random() * targets.length)];
    if (!victim) return;
    const centre = victim.getLocation().clone();
    const from = Projectile.centreOf(boss);
    areaSound(from, SURGE.sound, SURGE.delay);
    new Projectile(from, centre, null, SURGE.projectile, SURGE.delay, SURGE.end, SURGE.startHeight, SURGE.endHeight, boss.getPrivateArea())
      .withProgress(SURGE.progress).sendProjectile();
    later(SURGE.landTicks, () => {
      for (const viewer of players()) {
        if (!viewer.getLocation().isWithinDistance(centre, 15)) continue;
        mapGraphic(viewer, new Graphic(SURGE.centre, 0, 30), centre);
        mapGraphic(viewer, new Graphic(SURGE.centre, 30, 30), centre);
        for (let dx = -2; dx <= 2; dx++) {
          for (let dy = -2; dy <= 2; dy++) {
            const ring = Math.max(Math.abs(dx), Math.abs(dy));
            if (ring === 0 || (Math.abs(dx) === 2 && Math.abs(dy) === 2)) continue;
            mapGraphic(viewer, new Graphic(SURGE.blast, ring === 1 ? 15 : 30, 30), centre.transform(dx, dy));
          }
        }
      }
      [0, 15, 30].forEach((delay) => areaSound(centre, SURGE.blastSound, delay));
      for (const player of inRange(boss)) {
        const ring = Math.max(Math.abs(player.getLocation().getX() - centre.getX()), Math.abs(player.getLocation().getY() - centre.getY()));
        if (ring > 2) continue;
        const damage = Math.floor(Math.random() * (SURGE_MAX[ring] + 1));
        player.getCombat().getHitQueue().addPendingDamage([new HitDamage(damage, HitMask.RED)]);
      }
    });
  }

  /** Two or three standard attacks between specials; never the same special twice running. */
  function nextAttack(boss) {
    let s = attackState.get(boss);
    if (!s) attackState.set(boss, (s = { untilSpecial: 0, last: null }));
    if (s.untilSpecial > 0) {
      s.untilSpecial--;
      return "standard";
    }
    const choices = ["ice", "surge", "blood"].filter((special) => special !== s.last);
    s.last = choices[Math.floor(Math.random() * choices.length)];
    s.untilSpecial = 2 + Math.floor(Math.random() * 2);
    return s.last;
  }

  class MaledictusCombat extends CombatMethod {
    constructor() {
      super();
      this.attack = "standard";
      this.targets = [];
    }

    type() {
      return CombatType.RANGED;
    }

    attackDistance() {
      return RANGE;
    }

    start(boss, target) {
      this.targets = inRange(boss);
      if (!this.targets.includes(target)) this.targets.push(target);
      this.attack = nextAttack(boss);
      boss.performAnimation(new Animation(ANIM[this.attack], this.attack === "surge" ? 30 : 0));
      const from = Projectile.centreOf(boss);
      if (this.attack === "standard") {
        areaSound(from, STANDARD.sound);
        for (const player of this.targets) {
          new Projectile(from, player.getLocation(), player, STANDARD.projectile, STANDARD.delay, STANDARD.end, STANDARD.startHeight, STANDARD.endHeight, boss.getPrivateArea())
            .withAngle(STANDARD.angle).withProgress(STANDARD.progress).sendProjectile();
          player.performGraphic(new Graphic(STANDARD.impact, STANDARD.end, 16));
        }
      } else if (this.attack === "surge") {
        airSurge(boss, this.targets);
      } else {
        if (this.attack === "ice") areaSound(from, ICE.sound);
        tileSpell(boss, this.targets, this.attack);
      }
    }

    hits(boss) {
      if (this.attack !== "standard") return [];
      return this.targets.map((player) => new PendingHit(boss, player, this, SPECIAL_LAND_TICKS));
    }
  }

  // ---------------------------------------------------------------- spawning

  function hintArrows() {
    const boss = state.boss;
    if (!boss || boss.getHitpoints() <= 0) return;
    for (const player of players()) {
      const at = player.getLocation();
      if (!inCaves(at) || !at.isWithinDistance(boss.getLocation(), HINT_RANGE)) continue;
      if (at.isWithinDistance(boss.getLocation(), 15)) player.getPacketSender().sendEntityHint(boss);
      else player.getPacketSender().sendPositionalHint(Projectile.centreOf(boss));
    }
    later(2, hintArrows);
  }

  function clearHints() {
    for (const player of players()) {
      if (inCaves(player.getLocation())) player.getPacketSender().clearHintArrow();
    }
  }

  function spawn(at = SPAWNS[Math.floor(Math.random() * SPAWNS.length)]) {
    const boss = api.spawnNpc({ id: ID, x: at.x, y: at.y, z: 0 });
    if (!boss) return null;
    boss.setMultiCombat(true);
    boss.__skipDefaultRespawn = true;
    state.boss = boss;
    state.total = 0;
    state.quietUntil = Date.now() + COOLDOWN_MS;
    for (const player of players()) {
      if (inCaves(player.getLocation())) player.sendMessage(`<col=ef1020>A superior revenant has been awoken in the ${at.hint} of the caves..`);
    }
    hintArrows();
    later(LIFETIME_TICKS, () => {
      if (state.boss !== boss || boss.getHitpoints() <= 0) return;
      api.removeNpc(boss);
      state.boss = null;
      clearHints();
    });
    return boss;
  }

  /** Every revenant kill feeds the world total; the boss appears when a roll lands under it. */
  function onRevenantKilled(combatLevel, random = Math.random) {
    if (state.boss || Date.now() < state.quietUntil) return false;
    state.total += combatLevel;
    if (random() * SPAWN_RATE >= state.total) return false;
    return spawn() != null;
  }

  // ---------------------------------------------------------------- death and loot

  function rememberDamagers({ npc }) {
    if (npc?.getId?.() !== ID) return;
    damagers.set(npc, npc.getCombat().getRecentDamagerEntries());
  }

  function announce(watchers, player, itemId, amount) {
    const name = core.ItemDefinition.forId(itemId).getName();
    const what = amount > 1 ? `${amount} x ${name}` : name;
    const line = `<col=005f00>${player.getUsername()} received a drop: ${what}</col> <col=106f10>(${NAME})</col>`;
    for (const watcher of watchers) watcher.sendMessage(line);
  }

  function give(watchers, player, itemId, amount, noted = false) {
    const noteId = core.ItemDefinition.forId(itemId).getNoteId();
    const id = noted && noteId >= 0 ? noteId : itemId;
    const stackable = noted || core.ItemDefinition.forId(id).isStackable();
    const where = player.getLocation().clone();
    if (stackable) core.ItemOnGroundManager.registerLocation(player, new core.Item(id, amount), where);
    else for (let i = 0; i < amount; i++) core.ItemOnGroundManager.registerLocation(player, new core.Item(id, 1), where);
    announce(watchers, player, itemId, amount);
  }

  function dropLoot({ npc }) {
    if (npc?.getId?.() !== ID) return;
    if (state.boss === npc) state.boss = null;
    clearHints();
    const entries = (damagers.get(npc) ?? []).sort((a, b) => b.damage - a.damage);
    damagers.delete(npc);
    attackState.delete(npc);
    if (!entries.length) return;
    const watchers = entries.map((e) => e.player);
    const [top, ...rest] = watchers;
    give(watchers, top, Math.random() < 0.5 ? EMBLEM : TOTEM, 1);
    for (let roll = 0; roll < 2; roll++) {
      for (const drop of rollDrops({ npcId: 7940, combat: 135, skulled: top.isSkulled(), random: Math.random }).slice(1)) {
        give(watchers, top, drop.itemId, drop.amount, drop.noted);
      }
    }
    surge.grant(top);
    for (const player of rest) {
      give(watchers, player, BLIGHTED_RESTORE, 1);
      give(watchers, player, BLIGHTED_FOOD[Math.floor(Math.random() * BLIGHTED_FOOD.length)], 2);
    }
  }

  return { MaledictusCombat, onRevenantKilled, spawn, rememberDamagers, dropLoot, nextAttack };
}

let maledictus = null;

/** Called by the revenant loot for every revenant killed in the caves. */
function onRevenantKilled(combatLevel) {
  maledictus?.onRevenantKilled(combatLevel);
}

function dropLoot(event) {
  if (event.npcId === ID) maledictus.dropLoot(event);
}

/** ::maledictus - spawns the Revenant maledictus here (testing; the natural spawn is rare). */
function spawnHere({ player }) {
  const at = player.getLocation();
  maledictus.spawn({ x: at.getX(), y: at.getY(), hint: "middle" });
}

module.exports = function attachMaledictus(api) {
  maledictus = createMaledictus(api, api.core, { inCaves, surge: Avarice });
  api.registerNpcCombatMethodProvider([ID], maledictus.MaledictusCombat, { singleton: false });
  api.onNpcBeforeDeath(maledictus.rememberDamagers);
  api.onNpcDeath(dropLoot);
  api.registerCommand("maledictus", spawnHere, api.core.PlayerRights.DEVELOPER, "Spawn the Revenant maledictus here");
};

Object.assign(module.exports, { createMaledictus, onRevenantKilled, ID, SPAWNS, SPAWN_RATE, state });
