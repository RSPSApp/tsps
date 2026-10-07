"use strict";

/**
 * Path of Apmeken, Test of Companionship: eleven waves of baboons while one player at a time
 * holds Apmeken's Sight. The sighted player sees which vents are about to erupt or which
 * roof supports are failing; the rest of the party fixes them with neutralising potions and
 * hammers from the supply crates, or the whole room pays for it.
 * Wiki: https://oldschool.runescape.wiki/w/Path_of_Apmeken#Puzzle_room
 */

const Shared = require("./ToaShared");
const Raid = require("./ToaRaid");

const SPAWNS = [{ x: 3800, y: 5288 }, { x: 3808, y: 5288 }, { x: 3816, y: 5288 }, { x: 3816, y: 5272 }, { x: 3808, y: 5272 }, { x: 3800, y: 5272 }];
const VENTS = [{ x: 3800, y: 5284 }, { x: 3816, y: 5284 }, { x: 3816, y: 5276 }, { x: 3800, y: 5276 }];
const ROOF_SKULLS = [{ x: 3804, y: 5288 }, { x: 3812, y: 5288 }, { x: 3812, y: 5272 }, { x: 3804, y: 5272 }];
const ROOFS = [{ x: 3803, y: 5289 }, { x: 3811, y: 5289 }, { x: 3811, y: 5269 }, { x: 3803, y: 5269 }];
const BARRIER_BASE = { x: 3820, y: 5279 };

const ROOF = 45494;
const ROOF_DAMAGED = 45495;
const VENOM_POOL = 45493;
const HAMMER_CRATE = 45497;
const POTION_CRATE = 45498;
const BARRIER = 45135;

const GRAPHIC = { SIGHT_GRANTED: 2132, SIGHT_LOST: 2133, SENSE_NORTH: 2134, SENSE_SOUTH: 2135, VENT: 2138, ROOF: 2139, THRALL: 2017, EXPLODE_BODY: 2249, EXPLODE_FIRE: 131 };
const ANIMATION = { REPAIR: 3676, POUR: 2295, TAKE: 827, MELEE: 9742, RANGED: 9745, MAGIC: 9746, SUMMON: 9747, EXPLODE: 9756 };
const PROJECTILE = { RANGED: 2242, MAGIC: 2247 };
const SOUND = { CYCLE: 6574, DONE: 2655, REPAIR: 938, VENT: 6569, POUR: 2401, TAKE: 2582, THRALL: 100, EXPLODE: 156 };

const WAVE_COUNT = 11;
const PUNISHMENT = 22;
const VENOM_DAMAGE = 6;
const VENOM_POOL_TICKS = 29;
const BABOON_POINTS = 1.2;

function waves(I) {
  const MELEE = I.BABOON_BRAWLER;
  const RANGED = I.BABOON_THROWER;
  const MAGE = I.BABOON_MAGE;
  const MELEE2 = I.BABOON_BRAWLER_2;
  const RANGED2 = I.BABOON_THROWER_2;
  const MAGE2 = I.BABOON_MAGE_2;
  const SHAMAN = I.BABOON_SHAMAN;
  const VOLATILE = I.VOLATILE_BABOON;
  const CURSED = I.CURSED_BABOON;
  return {
    special: [SHAMAN, VOLATILE, CURSED],
    waves: [
      [MELEE, MELEE], [RANGED, MAGE], [MELEE, MELEE, SHAMAN], [MELEE, MELEE, -1], [RANGED, RANGED, VOLATILE],
      [MAGE, MAGE, CURSED], [RANGED2, RANGED2, -1, -1, -1], [MAGE2, MAGE2, -1, -1, -1], [MELEE2, MELEE2, -1, -1, -1],
      [MELEE2, RANGED2, -1, -1, -1], [SHAMAN, SHAMAN, VOLATILE, VOLATILE, VOLATILE],
    ],
    extra: [MELEE, MAGE, MELEE, MAGE, MELEE, RANGED, MELEE2, MAGE2, RANGED2, MAGE2, CURSED],
  };
}

class ApmekenPuzzleRoom extends Raid.Room {
  build() {
    this.wave = 0;
    this.waveDelay = 6;
    this.critical = 0;
    this.baboons = new Set();
    this.sight = null;
    this.cycleTicks = 2;
    this.cycles = 0;
    this.specialTicks = 50;
    this.special = Shared.random(0, 1);
    this.required = 0;
    this.active = false;
    this.switchSight = false;
    this.done = [false, false, false, false];
    this.pools = new Map();
    this.roofTicks = 0;
  }

  onComplete() {
    for (const player of this.challengePlayers()) player.setVenomed?.(false);
    this.clearPools();
    for (let y = 0; y < 2; y++) this.setObject(-1, { x: BARRIER_BASE.x, y: BARRIER_BASE.y + y, z: 0 }, 10);
    const { ItemIdentifiers } = Shared.core();
    for (const player of this.roomPlayers()) {
      player.getInventory().delete(ItemIdentifiers.NEUTRALISING_POTION, 10000);
      player.getInventory().delete(ItemIdentifiers.HAMMER, 28);
    }
    this.setSight(null);
  }

  onReset() {
    for (const baboon of this.baboons) this.despawn(baboon);
    this.clearPools();
    this.resetRoofs();
    this.setSight(null);
    this.build();
  }

  clearPools() {
    for (const pool of this.pools.values()) this.setObject(-1, pool, 10);
    this.pools.clear();
  }

  resetRoofs() {
    for (const tile of ROOFS) this.setObject(ROOF, { ...tile, z: 0 }, 10, 3);
  }

  setSight(player) {
    if (this.sight) this.sight.__toaSight = false;
    this.sight = player;
    if (player) player.__toaSight = true;
    this.raid.refreshHudStates();
    for (const member of this.raid.players) {
      const index = this.raid.players.indexOf(member);
      for (const viewer of this.raid.players) {
        viewer.getPacketSender().sendVarbit(Shared.VARBIT.HUD_PLAYER_SIGHT_BASE + index, member === player ? 1 : 0);
      }
    }
  }

  // -------------------------------------------------------------- tick

  tick() {
    if (!this.isStarted()) return;
    const players = this.challengePlayers();
    if (this.waveDelay > 0 && --this.waveDelay <= 0) this.spawnWave();
    if (this.cycleTicks > 0 && --this.cycleTicks === 0) this.cycle(players);
    for (const pool of this.pools.values()) {
      for (const player of players) {
        if (player.getLocation().getX() !== pool.x || player.getLocation().getY() !== pool.y) continue;
        Shared.damage(player, Math.floor(this.raid.damageFactor(0) * VENOM_DAMAGE) + Shared.random(0, 1));
        player.setVenomed?.(true);
      }
    }
    if (this.roofTicks > 0 && --this.roofTicks <= 0) this.resetRoofs();
    this.tickBaboons(players);
  }

  /** Sight passes on, a hazard is sensed, then the hazard is judged. */
  cycle(players) {
    const sightGone = !this.sight || this.sight.getHitpoints() <= 0 || !this.inChallenge(this.sight);
    if (!this.active && (sightGone || (players.length > 1 && this.switchSight))) {
      this.passSight();
      return;
    }
    if (!this.active) {
      for (const player of players) {
        Shared.sound(player, SOUND.CYCLE);
        if (player !== this.sight) player.sendMessage("<col=0000b2>You sense an issue somewhere in the room.");
      }
      this.required = Math.min(4, players.length);
      this.done.fill(false);
      if (this.special === 0) {
        this.sight.sendMessage("<col=6800bf>You sense some strange fumes coming from holes in the floor.");
        VENTS.forEach((tile, index) => this.sightGraphic(index < 2 ? GRAPHIC.SENSE_NORTH : GRAPHIC.SENSE_SOUTH, tile, 46));
      } else {
        this.sight.sendMessage("<col=6800bf>You sense an issue with the roof supports.");
        ROOF_SKULLS.forEach((tile, index) => this.sightGraphic(index < 2 ? GRAPHIC.SENSE_NORTH : GRAPHIC.SENSE_SOUTH, tile, 96));
      }
      this.cycleTicks = 30;
      this.active = true;
      return;
    }
    const fixed = this.done.filter(Boolean).length >= this.required;
    if (this.special === 0) {
      if (fixed) this.announce(players, "<col=0000b2>Apmeken's Sight guides you into neutralising some dangerous fumes.");
      else this.erupt([0, 1, 2, 3], players);
    } else if (fixed) {
      this.announce(players, "<col=0000b2>Apmeken's Sight guides you into repairing the roof supports.");
    } else {
      this.collapse([0, 1, 2, 3], players);
    }
    if (++this.cycles === (players.length === 2 ? 3 : 2)) {
      this.switchSight = true;
      this.cycleTicks = 30;
    } else {
      this.specialTicks = Math.max(30, this.specialTicks - 1);
      this.cycleTicks = this.specialTicks;
    }
    this.special = Shared.random(0, 1);
    this.active = false;
  }

  passSight() {
    const previous = this.sight;
    if (previous && previous.getHitpoints() > 0 && this.inChallenge(previous)) {
      Shared.sound(previous, SOUND.CYCLE);
      previous.sendMessage("<col=3366ff>You no longer have Apmeken's Sight.");
      previous.performGraphic(Shared.gfx(GRAPHIC.SIGHT_LOST, { height: 180 }));
    }
    const candidates = this.challengePlayers((player) => player !== previous);
    const next = candidates.length > 0 ? Shared.randomOf(candidates) : previous;
    this.setSight(next);
    if (next) next.performGraphic(Shared.gfx(GRAPHIC.SIGHT_GRANTED, { height: 180 }));
    for (const player of this.challengePlayers()) {
      Shared.sound(player, SOUND.CYCLE);
      if (next) player.sendMessage(`<col=3366ff>${player === next ? "You have" : `${Shared.displayName(next)} has`} been granted Apmeken's Sight.`);
    }
    this.cycles = 0;
    this.cycleTicks = 30;
    this.switchSight = false;
  }

  /** Only the sighted player sees the warning skulls. */
  sightGraphic(id, tile, height) {
    this.sight?.getPacketSender().sendGraphic(Shared.gfx(id, { height }), Shared.loc(tile, 0));
  }

  announce(players, message) {
    for (const player of players) player.sendMessage(message);
    if (this.sight) Shared.sound(this.sight, SOUND.DONE);
  }

  erupt(indices, players) {
    for (const player of players) {
      Shared.sound(player, SOUND.VENT);
      player.sendMessage(indices.length === 1
        ? "<col=ff3045>Some toxic fumes errupt out of the hole! There was clearly nothing to neutralise."
        : "<col=ff3045>The fumes filling the room suddenly ignite!");
      Shared.damage(player, Math.floor(this.raid.damageFactor(0) * PUNISHMENT));
    }
    this.roofTicks = 4;
    for (const index of indices) this.graphic(GRAPHIC.VENT, VENTS[index], { delay: 5 });
  }

  collapse(indices, players) {
    for (const player of players) {
      player.performGraphic(Shared.gfx(GRAPHIC.ROOF));
      player.sendMessage(indices.length === 1
        ? "<col=ff3045>Some debris falls on you! The roof support clearly didn't need repairing."
        : "<col=ff3045>Damaged roof supports cause some debris to fall on you!");
      Shared.damage(player, Math.floor(this.raid.damageFactor(0) * PUNISHMENT));
    }
    this.roofTicks = 4;
    for (const index of indices) this.setObject(ROOF_DAMAGED, { ...ROOFS[index], z: 0 }, 10, 3);
  }

  // -------------------------------------------------------------- fixing

  repairRoof(player, object) {
    const location = object.getLocation();
    const index = ROOFS.findIndex((tile) => tile.x === location.getX() && tile.y === location.getY());
    if (index === -1) return;
    const { ItemIdentifiers, Animation } = Shared.core();
    if (!player.getInventory().contains(ItemIdentifiers.HAMMER)) {
      player.sendMessage("You need a hammer to repair this roof support.");
    } else if (!this.active || this.special !== 1) {
      this.collapse([index], [player]);
    } else if (this.done[index]) {
      player.sendMessage("This roof support has already been repaired.");
    } else {
      player.sendMessage("<col=229628>You repair the damaged roof support.");
      player.performAnimation(new Animation(ANIMATION.REPAIR));
      Shared.sound(player, SOUND.REPAIR);
      this.done[index] = true;
    }
  }

  pourPotion(player) {
    const { ItemIdentifiers, Animation } = Shared.core();
    const location = player.getLocation();
    const index = VENTS.findIndex((tile) => tile.x === location.getX() && tile.y === location.getY());
    player.performAnimation(new Animation(ANIMATION.POUR));
    Shared.sound(player, SOUND.POUR);
    player.getInventory().delete(ItemIdentifiers.NEUTRALISING_POTION, 1);
    if (index === -1) {
      player.sendMessage("You pour the potion on the floor, but nothing happens.");
    } else if (!this.active || this.special !== 0) {
      this.erupt([index], [player]);
    } else if (this.done[index]) {
      player.sendMessage("This vent has already been neutralised.");
    } else {
      player.sendMessage("<col=06600c>You neutralise the fumes coming from the hole.");
      this.done[index] = true;
    }
  }

  // -------------------------------------------------------------- baboons

  spawnWave() {
    if (this.wave >= WAVE_COUNT) {
      this.complete();
      return;
    }
    const table = waves(Shared.core().NpcIdentifiers);
    const order = Shared.shuffle(SPAWNS.map((_, index) => index));
    const ids = [...table.waves[this.wave]];
    if (this.teamSize > 1) ids.push(table.extra[this.wave]);
    ids.forEach((id, index) => {
      const spawnIndex = order[index % order.length];
      const npcId = id === -1 ? Shared.randomOf(table.special) : id;
      const baboon = this.spawn(npcId, { ...SPAWNS[spawnIndex], z: 0 }, { points: BABOON_POINTS, face: spawnIndex < 3 ? 6 : 1 });
      if (!baboon) return;
      baboon.__toaBaboon = { kind: kindOf(npcId), thralls: Shared.random(6, 8), thrallTicks: 0, explodeTicks: 0, critical: true };
      if (baboon.__toaBaboon.kind === "cursed") baboon.__toaScripted = true;
      this.baboons.add(baboon);
      this.critical++;
      this.engage(baboon);
    });
    this.wave++;
  }

  engage(baboon) {
    if (baboon.__toaBaboon.kind === "cursed") return;
    const target = Shared.randomOf(this.challengePlayers());
    if (target) baboon.getCombat().attack(target);
  }

  baboonDied(baboon) {
    if (!this.baboons.delete(baboon)) return;
    const required = this.wave <= 3 ? 0 : this.wave <= 9 ? 1 : 2;
    if (baboon.__toaBaboon?.critical && this.wave < WAVE_COUNT && --this.critical === required) this.waveDelay = 4;
    if (this.wave >= WAVE_COUNT && this.baboons.size === 0) this.waveDelay = 4;
  }

  /** Shamans summon thralls, volatile baboons explode, cursed ones wander leaving venom. */
  tickBaboons(players) {
    const { NpcIdentifiers, PathFinder, Animation } = Shared.core();
    for (const baboon of [...this.baboons]) {
      const state = baboon.__toaBaboon;
      if (baboon.getHitpoints() <= 0 || baboon.isRegistered?.() === false) continue;
      if (state.kind !== "cursed" && !baboon.getCombat().getTarget?.() && state.explodeTicks === 0) this.engage(baboon);
      if (state.thrallTicks > 0 && --state.thrallTicks === 0) {
        const tile = this.freeTileAround(baboon.getLocation());
        if (tile) {
          const thrall = this.spawn(NpcIdentifiers.BABOON_THRALL, { x: tile.getX(), y: tile.getY(), z: 0 }, { points: BABOON_POINTS });
          if (thrall) {
            thrall.__toaBaboon = { kind: "thrall", critical: false, explodeTicks: 0, thrallTicks: 0 };
            thrall.performGraphic(Shared.gfx(GRAPHIC.THRALL));
            this.baboons.add(thrall);
            const target = baboon.getCombat().getTarget?.() ?? Shared.randomOf(players);
            if (target) thrall.getCombat().attack(target);
          }
        }
        state.thralls--;
      }
      if (state.explodeTicks > 0) {
        if (--state.explodeTicks === 3) {
          baboon.performAnimation(new Animation(ANIMATION.EXPLODE));
        } else if (state.explodeTicks === 1) {
          this.graphic(GRAPHIC.EXPLODE_FIRE, baboon.getLocation());
          this.graphic(GRAPHIC.EXPLODE_BODY, baboon.getLocation());
          for (const player of players) {
            if (player.getLocation().getDistance(baboon.getLocation()) <= 1) Shared.damage(player, this.maxHit(14) + Shared.random(0, 2));
          }
        } else if (state.explodeTicks <= 0) {
          this.baboonDied(baboon);
          this.despawn(baboon);
        }
      }
      if (state.kind === "cursed") {
        const location = baboon.getLocation();
        if (!VENTS.some((tile) => tile.x === location.getX() && tile.y === location.getY())) this.placePool(location);
        if (baboon.getMovementQueue().size() === 0) {
          const spawn = baboon.getSpawnPosition();
          PathFinder.calculateWalkRoute(baboon, spawn.getX() + Shared.random(-8, 8), spawn.getY() + Shared.random(-8, 8));
        }
      }
    }
  }

  placePool(location) {
    const tileKey = `${location.getX()},${location.getY()}`;
    if (this.pools.has(tileKey)) return;
    const tile = { x: location.getX(), y: location.getY(), z: 0 };
    this.pools.set(tileKey, tile);
    this.setObject(VENOM_POOL, tile, 10, Shared.random(0, 3));
    this.later(VENOM_POOL_TICKS, () => {
      this.pools.delete(tileKey);
      this.setObject(-1, tile, 10);
    });
  }

  freeTileAround(location) {
    const tiles = [];
    for (let dx = -2; dx <= 2; dx++) {
      for (let dy = -2; dy <= 2; dy++) {
        const tile = location.transform(dx, dy);
        if (Shared.floorFree(this.area, tile)) tiles.push(tile);
      }
    }
    return Shared.randomOf(tiles);
  }

  /** One baboon swing, by kind. Returns the hits for the combat engine. */
  baboonAttack(npc, target, method) {
    const { Animation } = Shared.core();
    const state = npc.__toaBaboon;
    const base = npc.getDefinition()?.getMaxHit?.() ?? 4;
    if (state.kind === "volatile") {
      npc.getCombat().reset();
      npc.setUntargetable(true);
      npc.getMovementQueue().setBlockMovement(true);
      state.explodeTicks = 4;
      return [];
    }
    if (state.kind === "shaman" && state.thralls > 0) {
      npc.performAnimation(new Animation(ANIMATION.SUMMON));
      state.thrallTicks = 1;
      return [];
    }
    if (state.kind === "melee" || state.kind === "thrall") {
      npc.performAnimation(new Animation(ANIMATION.MELEE));
      const hit = this.styledHit(npc, target, method, "melee", base, 0);
      if (state.kind === "thrall" && hit.isAccurate()) {
        const { Skill } = Shared.core();
        target.getSkillManager().decreaseCurrentLevel(Skill.PRAYER, 2, 0);
      }
      return [hit];
    }
    if (state.kind === "ranged") {
      npc.performAnimation(new Animation(ANIMATION.RANGED));
      const ticks = Shared.tileProjectile(this.area, npc, target, PROJECTILE.RANGED, { delay: 67, duration: 20, perTile: 4, startHeight: 17, endHeight: 36 });
      return [this.styledHit(npc, target, method, "ranged", base, ticks)];
    }
    npc.performAnimation(new Animation(ANIMATION.MAGIC));
    const ticks = Shared.tileProjectile(this.area, npc, target, PROJECTILE.MAGIC, { delay: 30, duration: 20, perTile: 4, startHeight: 20, endHeight: 34 });
    const hit = this.styledHit(npc, target, method, "magic", base, ticks);
    if (state.kind === "shaman") {
      const { Skill } = Shared.core();
      target.getSkillManager().decreaseCurrentLevel(Skill.PRAYER, hit.getTotalDamage(), 0);
    }
    return [hit];
  }

  graphic(id, tile, options = {}) {
    const viewer = this.roomPlayers()[0];
    if (!viewer) return;
    const location = tile.getX ? tile : Shared.loc({ x: tile.x, y: tile.y, z: 0 });
    Shared.graphicAt(viewer, id, location, options);
  }
}

function kindOf(id) {
  const I = Shared.core().NpcIdentifiers;
  if (id === I.BABOON_BRAWLER || id === I.BABOON_BRAWLER_2) return "melee";
  if (id === I.BABOON_THROWER || id === I.BABOON_THROWER_2) return "ranged";
  if (id === I.BABOON_MAGE || id === I.BABOON_MAGE_2) return "magic";
  if (id === I.BABOON_SHAMAN) return "shaman";
  if (id === I.VOLATILE_BABOON) return "volatile";
  if (id === I.CURSED_BABOON) return "cursed";
  return "thrall";
}

function apmekenRoom(player) {
  const room = Raid.roomOf(player);
  return room instanceof ApmekenPuzzleRoom && !room.destroyed ? room : null;
}

// ------------------------------------------------------------------ hooks

function takeSupplies(event) {
  const room = apmekenRoom(event.player);
  if (!room || (event.objectId !== HAMMER_CRATE && event.objectId !== POTION_CRATE)) return false;
  const { player } = event;
  const { ItemIdentifiers, Animation } = Shared.core();
  const hammer = event.objectId === HAMMER_CRATE;
  const id = hammer ? ItemIdentifiers.HAMMER : ItemIdentifiers.NEUTRALISING_POTION;
  if (player.getInventory().getFreeSlots() < 1 && (hammer || !player.getInventory().contains(id))) {
    player.sendMessage("You need more space in your inventory to do that.");
    return true;
  }
  player.getInventory().adds(id, hammer ? 1 : 100);
  player.sendMessage(`You take ${hammer ? "a hammer." : "some potions."}`);
  player.performAnimation(new Animation(ANIMATION.TAKE));
  Shared.sound(player, SOUND.TAKE);
  return true;
}

function repairRoof(event) {
  const room = apmekenRoom(event.player);
  if (!room || event.objectId !== ROOF) return false;
  room.repairRoof(event.player, event.object);
  return true;
}

function pourPotion({ player }) {
  const room = apmekenRoom(player);
  if (!room) return false;
  room.pourPotion(player);
  return true;
}

function baboonDowned(event) {
  const room = event.npc?.__toaRoom;
  if (room instanceof ApmekenPuzzleRoom && event.npc.__toaBaboon) room.baboonDied(event.npc);
}

module.exports = function registerApmekenPuzzle(api) {
  Shared.bind(api);
  Raid.registerRoom("APMEKEN_PUZZLE", ApmekenPuzzleRoom);
  Raid.registerRaidItems(api.core.ItemIdentifiers.NEUTRALISING_POTION);
  api.onObjectClick([HAMMER_CRATE, POTION_CRATE], 1, takeSupplies);
  api.onObjectClick(ROOF, 1, repairRoof);
  api.onItemAction("Neutralising potion", { Pour: pourPotion });
  api.onNpcBeforeDeath(baboonDowned);
  registerBaboonCombat(api);
};

function registerBaboonCombat(api) {
  const { CombatMethod, CombatType, NpcIdentifiers: I } = api.core;

  class BaboonCombatMethod extends CombatMethod {
    type() {
      return CombatType.MELEE;
    }

    attackDistance(npc) {
      const kind = npc.__toaBaboon?.kind;
      return kind === "melee" || kind === "thrall" || kind === "volatile" ? 1 : 8;
    }

    hits(npc, target) {
      const room = npc.__toaRoom;
      if (!(room instanceof ApmekenPuzzleRoom) || !npc.__toaBaboon) return [];
      return room.baboonAttack(npc, target, Raid.styleMethod(styleOf(npc.__toaBaboon.kind)));
    }
  }

  api.registerNpcCombatMethodProvider([
    I.BABOON_BRAWLER, I.BABOON_THROWER, I.BABOON_MAGE, I.BABOON_BRAWLER_2, I.BABOON_THROWER_2, I.BABOON_MAGE_2,
    I.BABOON_SHAMAN, I.VOLATILE_BABOON, I.BABOON_THRALL,
  ], BaboonCombatMethod);
}

function styleOf(kind) {
  if (kind === "ranged") return "ranged";
  if (kind === "magic" || kind === "shaman") return "magic";
  return "melee";
}
