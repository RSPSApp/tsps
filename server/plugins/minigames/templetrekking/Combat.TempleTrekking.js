/**
 * The combat events: ghasts, giant snails, swamp snakes, vampyre juvinates, nail beasts and (at
 * Mort'ton) shades. Three, four or five monsters (by the follower's difficulty) of the route's
 * tier appear in a room, give the player a moment to stand between them and the follower, then
 * go for one or the other. Each kill is worth the route's kill points; the success path opens
 * once all are dead.
 *
 * - Ghasts are hidden: they rot the player's food or hit the follower until a filled druid
 *   pouch is used on them, which shows them and makes them attackable (Wiki).
 * - Juvinates only take damage from silver weapons or a wearer of Efaritay's aid (Wiki).
 * - A swamp snake leaves its body to skin with a knife, or bones if the follower hurt it (Wiki).
 *
 * The follower stands its ground, hits back at whatever hits it and eats from the backpack when
 * hurt; if it dies the trek has failed.
 */
const Common = require("./Common.TempleTrekking");
const Trek = require("./Trek.TempleTrekking");
const Followers = require("./Followers.TempleTrekking");

/** Ticks before a monster picks a target: live gives "a few seconds" (shades go at once). */
const GRACE_TICKS = [3, 7];
const SHADE_GRACE_TICKS = [1, 2];
/** Hidden ghasts swing every 8 ticks (Wiki: Ghast attack speed). */
const GHAST_TICKS = 8;
const STUCK_TICKS = 3;
/** Ticks a held-up monster spends stepping round before it goes for the other target. */
const NUDGE_TICKS = 4;
const GHAST_MAX_HITS = [4, 8, 12];
const GHAST_REVEAL_MESSAGE = "The druid pouch makes the ghast visible.";
const SNAKE_CORPSE = 5618;
const SNAKE_HIDES = [2, 5];
/** Wiki: big bones, 2-3 nails, a long bone at 1/400 and a curved bone at 1/5012.5. */
const NAIL_BEAST_DROPS = { bigBones: 532, nails: 10937, nails2to3: [2, 3], longBone: [10976, 400], curvedBone: [10977, 5012.5] };
const SKIN_ANIMATION = 3747;

function tierIndex(trek) {
  return Common.data.routes[trek.route].tier - 1;
}

/** Template tiles of the room's spawn box the monster fits on. */
function spawnTiles(trek, box, size) {
  const { RegionManager } = Common.core;
  const tiles = [];
  for (let x = box[0]; x <= box[2]; x++) {
    for (let y = box[1]; y <= box[3]; y++) {
      let free = true;
      for (let dx = 0; dx < size && free; dx++) {
        for (let dy = 0; dy < size && free; dy++) {
          if (RegionManager.blocked(trek.area.at([x + dx, y + dy, 0]), trek.area)) free = false;
        }
      }
      if (free) tiles.push([x, y, 0]);
    }
  }
  return tiles;
}

function combatRoom(trek, key) {
  const { rooms } = Common.data;
  if (key === "shades") return rooms.shades;
  return eventRoom(trek, key);
}

/** One of the route's rooms the captures show the event in, or any of the route's rooms. */
function eventRoom(trek, key) {
  const pool = Common.data.rooms[Common.data.routes[trek.route].rooms];
  const known = Common.data.events[key].rooms ?? [];
  const captured = pool.filter((room) => known.includes(room.key));
  return Common.randomOf(captured.length ? captured : pool);
}

function spawnBox(trek, room) {
  const { spawn } = room.spec;
  return Array.isArray(spawn) ? spawn : spawn[trek.direction];
}

/** Starts a combat event: the monsters in the room's spawn box. */
function startCombat(trek, room) {
  const event = Common.data.events[room.key];
  const tier = tierIndex(trek);
  const id = event.npcs[tier];
  const count = trek.difficulty.monsters;
  const size = Common.core.NpcDefinition.forId(id)?.getSize?.() ?? 1;
  const tiles = spawnTiles(trek, spawnBox(trek, room), size);
  room.total = count;
  // Footprints never overlap: big monsters spawned on top of each other block each other's
  // every step for good.
  const taken = [];
  const clear = ([x, y]) => taken.every(([tx, ty]) => x + size <= tx || tx + size <= x || y + size <= ty || ty + size <= y);
  for (let i = 0; i < count; i++) {
    const free = tiles.filter(clear);
    if (!free.length) break;
    const tile = Common.randomOf(free);
    taken.push(tile);
    const npc = trek.spawn(id, tile);
    if (!npc) continue;
    npc.__trekMonster = true;
    npc.__trekReadyAt = trek.tickCount + Common.randomInt(...(room.key === "shades" ? SHADE_GRACE_TICKS : GRACE_TICKS));
    room.monsters.add(npc);
  }
  if (room.key === "shades" && trek.direction === "ramble") {
    // Towards Burgh the shades' room is walked backwards: Escape sits on the north path.
    for (const [x, y, face] of room.spec.north) trek.setLoc(Common.data.locs.templetrek_swamp_fail_path, [x, y, 0], 22, face);
  }
}

/** The target a monster goes for: the follower or the player, at random. */
function pickTarget(trek) {
  const follower = trek.npc?.isRegistered?.() && trek.npc.getHitpoints() > 0 ? trek.npc : null;
  if (!follower) return trek.player;
  return Math.random() < 0.5 ? follower : trek.player;
}

function hiddenGhast(trek, npc) {
  return Common.data.events.ghasts.npcs.includes(npc.getId()) && !npc.__trekRevealed;
}

function foodSlots(player) {
  const slots = [];
  const items = player.getInventory().getItems();
  for (let slot = 0; slot < items.length; slot++) {
    const item = items[slot];
    if (item && item.getId() > 0 && Common.core.ItemDefinition.forId(item.getId())?.getActions?.()?.includes?.("Eat")) slots.push(slot);
  }
  return slots;
}

/** A hidden ghast's swing: at the player it rots food (or misses); at the follower it hurts. */
function ghastSwing(trek, npc, target) {
  const { Animation, HitDamage, HitMask, Item } = Common.core;
  npc.setPositionToFace(target.getLocation());
  if (target === trek.player) {
    const slots = foodSlots(trek.player);
    if (slots.length && Math.random() < 0.5) {
      const slot = Common.randomOf(slots);
      trek.player.getInventory().setItem(slot, new Item(Common.data.items.rotten_food, 1));
      trek.player.getInventory().refreshItems();
      trek.player.sendMessage("You feel something attacking your backpack, and smell a terrible stench.");
    } else {
      trek.player.sendMessage("An attacking ghast just misses you.");
    }
    return;
  }
  const damage = Common.randomInt(0, GHAST_MAX_HITS[tierIndex(trek)]);
  npc.performAnimation(new Animation(npc.getDefinition().getAttackAnim()));
  target.getCombat().getHitQueue().addPendingDamage([new HitDamage(damage, damage > 0 ? HitMask.RED : HitMask.BLUE)]);
}

/** Whether `npc` (of any size) stands next to `target`. */
function nextTo(npc, target) {
  const size = npc.getSize?.() ?? npc.getDefinition().getSize();
  const at = npc.getLocation();
  const to = target.getLocation();
  const dx = Math.max(0, at.getX() - to.getX(), to.getX() - (at.getX() + size - 1));
  const dy = Math.max(0, at.getY() - to.getY(), to.getY() - (at.getY() + size - 1));
  return Math.max(dx, dy) <= 1;
}

function tickHiddenGhast(trek, npc) {
  const target = npc.__trekTarget;
  if (!target || (target.isNpc?.() && target.getHitpoints() <= 0)) {
    npc.__trekTarget = pickTarget(trek);
    return;
  }
  if (!nextTo(npc, target)) {
    npc.setFollowing(target);
    return;
  }
  if ((npc.__trekSwingAt ?? 0) > trek.tickCount) return;
  npc.__trekSwingAt = trek.tickCount + GHAST_TICKS;
  ghastSwing(trek, npc, target);
}

function tickCombat(trek, room) {
  for (const npc of room.monsters) {
    if (!npc.isRegistered?.() || npc.getHitpoints() <= 0 || npc.isDyingFunction?.()) continue;
    if (trek.tickCount < npc.__trekReadyAt) continue;
    if (hiddenGhast(trek, npc)) {
      tickHiddenGhast(trek, npc);
      continue;
    }
    const combat = npc.getCombat();
    const current = combat.getTarget?.();
    if (current && !stuck(npc, current)) continue;
    if (current && npc.__trekStuckTicks < STUCK_TICKS + NUDGE_TICKS && nudge(npc, current)) continue;
    const target = current ? otherTarget(trek, current) : pickTarget(trek);
    npc.__trekTarget = target;
    npc.__trekStuckTicks = 0;
    combat.attack(target);
  }
}

/**
 * Monsters walk straight at their target (OSRS's naive pathing) and can be held up behind the
 * follower or a tree; one that hasn't moved or reached for a while goes for the other.
 */
function stuck(npc, target) {
  const { CombatFactory, CombatRange } = Common.core;
  const at = npc.getLocation();
  const moved = npc.__trekLastX !== at.getX() || npc.__trekLastY !== at.getY();
  npc.__trekLastX = at.getX();
  npc.__trekLastY = at.getY();
  if (moved || CombatRange.canReach(npc, CombatFactory.getMethod(npc), target)) {
    npc.__trekStuckTicks = 0;
    return false;
  }
  npc.__trekStuckTicks = (npc.__trekStuckTicks ?? 0) + 1;
  return npc.__trekStuckTicks >= STUCK_TICKS;
}


/**
 * A big monster held up on its way in (a 3x3 snake can't fit where it means to go) takes a
 * step that brings it closer, along x or y, before giving up on its target.
 */
function nudge(npc, target) {
  const { RegionManager } = Common.core;
  const at = npc.getLocation();
  const to = target.getLocation();
  const size = npc.getSize();
  const dx = to.getX() < at.getX() ? -1 : to.getX() > at.getX() + size - 1 ? 1 : 0;
  const dy = to.getY() < at.getY() ? -1 : to.getY() > at.getY() + size - 1 ? 1 : 0;
  for (const [sx, sy] of [[dx, 0], [0, dy], [dx, dy]]) {
    if (sx === 0 && sy === 0) continue;
    if (!RegionManager.canMove(at.getX(), at.getY(), at.getX() + sx, at.getY() + sy, at.getZ(), size, size, npc.getPrivateArea())) continue;
    npc.getCombat().preserveMovementForTicks(1);
    npc.getMovementQueue().walkStep(sx, sy);
    return true;
  }
  return false;
}

function otherTarget(trek, current) {
  const follower = trek.npc?.isRegistered?.() && trek.npc.getHitpoints() > 0 ? trek.npc : null;
  return current === trek.player && follower ? follower : trek.player;
}

/** One of the trek's monsters died: points, and the way on once they all have. */
function monsterDied(trek, npc) {
  const room = trek.room;
  if (!room || Common.data.events[room.key].kind !== "combat" || !room.monsters.has(npc)) return;
  room.monsters.delete(npc);
  room.kills++;
  trek.addPoints(Common.data.routes[trek.route].killPoints);
  if (room.monsters.size === 0) completeCombat(trek, room);
}

function completeCombat(trek, room) {
  room.complete = true;
  if (room.key === "shades" && trek.direction === "ramble") {
    for (const [x, y, face] of room.spec.south) trek.setLoc(Common.data.locs.templetrek_swamp_success_path, [x, y, 0], 22, face);
  }
}

// ------------------------------------------------------------------ hooks

function beforeDeath(event) {
  const npc = event.npc;
  const trek = npc?.__templeTrek;
  if (!trek || trek.ended) return;
  if (npc === trek.npc) {
    trek.followerHp = 0;
    trek.followerDied();
    return;
  }
  monsterDied(trek, npc);
}

/** Damage to the follower and from it is remembered (the snakes' bones). */
function hitResolved({ attacker, target }) {
  const trek = attacker?.__templeTrek;
  if (trek && attacker === trek.npc && target?.__trekMonster) target.__trekHurtByFollower = true;
}

/** Juvinates are hurt by silver only, or by anyone wearing Efaritay's aid. */
function silverOnly({ npc, hit }) {
  if (!npc?.__templeTrek || !Common.data.events.vampyres.npcs.includes(npc.getId())) return;
  const attacker = hit?.getAttacker?.();
  if (!attacker?.isPlayer?.()) return;
  const { Equipment } = Common.core;
  const equipment = attacker.getEquipment();
  const silver = Common.data.items.silverWeapons;
  const weapon = equipment.getItems()[Equipment.WEAPON_SLOT]?.getId?.();
  const ammo = equipment.getItems()[Equipment.AMMUNITION_SLOT]?.getId?.();
  const ring = equipment.getItems()[Equipment.RING_SLOT]?.getId?.();
  if (ring === Common.data.items.vampyre_ring || silver.weapons.includes(weapon) || silver.ammo.includes(ammo)) return;
  for (const damage of hit.getHits?.() ?? []) damage.setDamage(0);
  hit.updateTotalDamage?.();
}

/** A filled druid pouch shows a hidden ghast, which then turns on the player. */
function pouchOnGhast(event) {
  const { player, target } = event;
  const trek = Trek.trekOf(player);
  if (!trek?.room || target?.__templeTrek !== trek || !hiddenGhast(trek, target)) return;
  event.handled = true;
  const { items, events } = Common.data;
  if (event.itemId !== items.druid_pouch) {
    player.sendMessage("Nothing interesting happens.");
    return;
  }
  player.getInventory().deleteNumber(items.druid_pouch, 1);
  if (!player.getInventory().contains(items.druid_pouch)) player.getInventory().adds(items.druid_pouch_empty, 1);
  const visible = events.ghasts.visible[events.ghasts.npcs.indexOf(target.getId())];
  target.setNpcTransformationId(visible);
  target.__trekRevealed = true;
  target.setFollowing(null);
  player.sendMessage(GHAST_REVEAL_MESSAGE);
  target.getCombat().attack(player);
}

/** A swamp snake leaves its body to skin, or bones if the follower hurt it (Wiki). */
function snakeRemains(event) {
  const { npc, player } = event;
  const trek = npc?.__templeTrek;
  if (!trek || !Common.data.events.snakes.npcs.includes(npc.getId())) return;
  event.handled = true;
  if (npc.__trekHurtByFollower) {
    Common.api.getItemOnGroundManager().registerLocation(player, new Common.core.Item(Common.data.items.bones, 1), npc.getLocation());
    return;
  }
  if (trek.area && !trek.area.isDestroyed()) trek.spawn(SNAKE_CORPSE, trek.area.templateOf(npc.getLocation()));
}

/** Nail beasts have no table in the Wiki dump: their drops, from the Wiki. */
function nailBeastDrops({ killer, npc }) {
  if (!npc?.__templeTrek || !killer?.isPlayer?.() || !Common.data.events.nailBeasts.npcs.includes(npc.getId())) return;
  const { Item } = Common.core;
  const ground = Common.api.getItemOnGroundManager();
  const drop = (itemId, amount) => ground.registerLocation(killer, new Item(itemId, amount), npc.getLocation());
  drop(NAIL_BEAST_DROPS.bigBones, 1);
  drop(NAIL_BEAST_DROPS.nails, Common.randomInt(...NAIL_BEAST_DROPS.nails2to3));
  if (Math.random() < 1 / NAIL_BEAST_DROPS.longBone[1]) drop(NAIL_BEAST_DROPS.longBone[0], 1);
  if (Math.random() < 1 / NAIL_BEAST_DROPS.curvedBone[1]) drop(NAIL_BEAST_DROPS.curvedBone[0], 1);
}

function skinSnake(event) {
  const { player, npc } = event;
  const trek = Trek.trekOf(player);
  if (!trek || npc?.__templeTrek !== trek || npc.getId() !== SNAKE_CORPSE) return false;
  if (!player.getInventory().contains(Common.data.items.knife)) {
    player.sendMessage("You need a knife to skin the snake.");
    return true;
  }
  player.performAnimation(new Common.core.Animation(SKIN_ANIMATION));
  trek.despawn(npc);
  player.getInventory().adds(Common.data.items.templetrek_swamp_snake_hide, Common.randomInt(...SNAKE_HIDES));
  return true;
}

function feed(trek) {
  if (trek.room) Followers.feedFromPack(trek);
}

function attachCombat(api) {
  const impl = { room: (trek) => null, start: startCombat, tick: tickCombat };
  for (const key of ["ghasts", "snails", "snakes", "vampyres", "nailBeasts", "shades"]) {
    Trek.registerEvent(key, { ...impl, room: (trek) => combatRoom(trek, key) });
  }
  Trek.onTick(feed);
  api.onNpcBeforeDeath(beforeDeath);
  api.onNpcHitModify(silverOnly);
  api.onCombatHitResolved(hitResolved);
  api.onItemOnNpc(pouchOnGhast);
  api.onCustomEvent("npc-drops:generated", snakeRemains);
  api.onNpcDeath(nailBeastDrops);
  api.onNpcInteraction("Swamp snake", { Skin: skinSnake });
}

module.exports = { attachCombat, eventRoom, monsterDied, pickTarget, spawnTiles };
