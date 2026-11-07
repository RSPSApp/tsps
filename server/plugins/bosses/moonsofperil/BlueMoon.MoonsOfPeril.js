/**
 * The Blue Moon's specials (docs/moons-of-peril.md), as captured; offsets are ticks into the
 * special, data specials.freeze / specials.storm.
 *
 * Weapon Freeze (Full Moon):
 * - 2: three ice blocks rise at the same tiles every time; a stand-in plays the Moon's spell.
 * - 4: "Your weapon freezes over. You're forced to let go!" - the weapon leaves the player's hands
 *   (pmoon_boss_blue_wearprevent) into one random block (pmoon_boss_icicle_state glows it); no weapon
 *   at all costs 3-15 instead (Wiki); a projectile marks the block. The Moon fades at 6 and
 *   leaves at 8.
 * - 8, then every 8: an ice floor rises in one of the captured patterns around the blocks and
 *   strikes 3 ticks later (light damage; Wiki).
 * - Punching the marked block (8 a punch, 72 to break) gives the weapon back: "You retrieve your
 *   weapon from within the cracked ice.", and that block turns to cracked ice
 *   (pmoon_boss_icicle_state); "You've already retrieved your weapon!" after.
 * - 51: the blocks burst; a weapon still inside costs up to 28 (Wiki) and comes back. 55: the Moon
 *   returns. A player who logs out with their weapon frozen gets it back when they log in.
 * Frost Storm (New Moon):
 * - 1: blue fire along the north and south edges; 3: the player is thrown to (+2, -1) as the Moon
 *   casts; 7: both braziers are shrouded (pmoon_boss_blue_brazier_lit_left/right).
 * - From 2: storms cross the arena north to south and back, one tile a tick; one walking into the
 *   player hurts and chills (capture: about 5, +6 cold).
 * - Every 10 ticks the Moon heals 10 for each shrouded brazier (Wiki: five times). Relighting a
 *   brazier takes a cast; the second clears the cold: "Lighting the final brazier fills you with
 *   warmth, removing some of your cold buildup."
 */
const Common = require("./Common.MoonsOfPeril");
const Cycle = require("./Cycle.MoonsOfPeril");
const Curses = require("./Curses.MoonsOfPeril");
const Pieces = require("./Pieces.MoonsOfPeril");

/** A weapon frozen when its owner logged out: { id, amount, meta }. */
const FROZEN_WEAPON_ATTRIBUTE = "moons-of-peril:frozen-weapon";

const freeze = () => Common.data.specials.freeze;
const storm = () => Common.data.specials.storm;

// ------------------------------------------------------------------ the weapon

function takeWeapon(fight) {
  const { Equipment, Item } = Common.core;
  const { player } = fight;
  const equipment = player.getEquipment();
  const weapon = equipment.getItems()[Equipment.WEAPON_SLOT];
  if (!weapon?.isValid?.() || weapon.getId() <= 0) return false;
  // The meta comes back with it: a preset weapon (PvP presets) stays a preset copy, a charged one keeps its charges.
  fight.state.weapon = { id: weapon.getId(), amount: weapon.getAmount(), meta: Item.cloneMeta(weapon.getMeta()) ?? null };
  player.setAttribute(FROZEN_WEAPON_ATTRIBUTE, fight.state.weapon);
  equipment.setItem(Equipment.WEAPON_SLOT, new Item(-1, 0));
  refreshWeapon(player);
  return true;
}

/** Back in the hands if they're empty, else the inventory, else the bank. */
function giveWeapon(player, weapon) {
  if (!weapon) return;
  const { Equipment, Item } = Common.core;
  const item = new Item(weapon.id, weapon.amount ?? 1, weapon.meta ?? undefined);
  const equipment = player.getEquipment();
  const held = equipment.getItems()[Equipment.WEAPON_SLOT];
  if (!held?.isValid?.() || held.getId() <= 0) {
    equipment.setItem(Equipment.WEAPON_SLOT, item);
    refreshWeapon(player);
  } else if (player.getInventory().getFreeSlots() > 0) {
    player.getInventory().add(item);
  } else if (item.isUnbankable?.()) {
    // An unbankable copy (a preset) can't go to the bank: it lands at the player's feet instead.
    player.getInventory().forceAdd(player, item);
  } else {
    player.getBank(0)?.add?.(item);
  }
  player.setAttribute(FROZEN_WEAPON_ATTRIBUTE, null);
}

function refreshWeapon(player) {
  const { WeaponInterfaceManager, Flag } = Common.core;
  player.getEquipment().refreshItems();
  WeaponInterfaceManager.assign(player);
  Common.api.getBonusManager().update(player);
  player.getUpdateFlag().flag(Flag.APPEARANCE);
}

function retrieve(fight) {
  const s = freeze();
  const { player } = fight;
  fight.state.retrieved = true;
  // The broken block turns to "Cracked ice" (pmoon_boss_icicle_state picks it; capture).
  Common.varbit(player, "icicleState", fight.state.target + 1);
  Common.varbit(player, "wearPrevent", 0);
  player.sendMessage(s.retrieveMessage);
  Common.sounds(player, s.retrieveSounds);
  const block = fight.state.blocks?.[fight.state.target];
  if (block?.isRegistered?.()) Common.animate(block, s.crackAnim);
  giveWeapon(player, fight.state.weapon);
  fight.state.weapon = null;
}

// ------------------------------------------------------------------ Weapon Freeze

function freezeStart(fight, offset) {
  fight.state.target = Common.randomInt(0, freeze().blocks.length - 1);
  fight.state.sapped = freeze().blockHp;
  fight.state.blocks = [];
  Common.varbit(fight.player, "wearPrevent", 1);
  Common.varbit(fight.player, "sapped", fight.state.sapped);
  if (offset > freeze().blocksAt) raiseBlocks(fight);
  if (offset > freeze().freezeAt) freezeWeapon(fight);
}

function freezeTick(fight, offset) {
  const s = freeze();
  const { player } = fight;
  if (offset === s.blocksAt) raiseBlocks(fight);
  if (offset === s.freezeAt) freezeWeapon(fight);
  if (offset >= s.wavesFrom && offset <= s.wavesUntil && (offset - s.wavesFrom) % s.every === 0) iceFloor(fight);
  strikeFloor(fight, offset);
  if (offset >= s.selfFrom && (offset - s.selfFrom) % s.every === 0 && offset < s.explodeAt) {
    fight.selfDamage(Math.max(1, Math.round(fight.hp / s.selfDivisor)));
  }
  if (offset === s.explodeAt) {
    for (const block of fight.state.blocks) if (block?.isRegistered?.()) Common.animate(block, s.explodeAnim);
    Common.sound(player, s.explodeSound);
    if (!fight.state.retrieved) {
      fight.hurt(Common.randomInt(1, s.failMax));
      giveWeapon(player, fight.state.weapon);
      fight.state.weapon = null;
      fight.state.retrieved = true;
      Common.varbit(player, "icicleState", 0);
      Common.varbit(player, "wearPrevent", 0);
    }
  }
  if (offset === s.removeAt) Pieces.clear(fight);
}

function raiseBlocks(fight) {
  const s = freeze();
  if (fight.state.blocks.length) return;
  s.blocks.forEach((block, index) => {
    const npc = Pieces.spawnNpc(fight, block.npc, block.tile);
    if (npc) {
      // One more than the punches take, so the last one leaves it standing as cracked ice.
      npc.setMaxHitpoints(s.blockHp + 1);
      npc.setHitpoints(s.blockHp + 1);
      npc.__moonBlock = { index };
    }
    fight.state.blocks.push(npc);
    Pieces.addLoc(fight, block.blocking, block.tile);
    Common.areaSound(fight.player, Common.tileAt(fight.moon, block.tile), [s.blockSound, 0], 10);
  });
}

function freezeWeapon(fight) {
  const s = freeze();
  const { player } = fight;
  if (fight.state.frozen) return;
  fight.state.frozen = true;
  const block = fight.state.blocks[fight.state.target];
  if (!takeWeapon(fight)) {
    fight.hurt(Common.randomInt(s.noWeapon[0], s.noWeapon[1]));
    return;
  }
  player.getPacketSender().sendMessage(s.freezeMessage);
  Common.animate(player, s.freezeAnim);
  player.performGraphic(Common.graphic(s.freezeSpot));
  Common.sound(player, s.freezeSound);
  if (block) {
    Common.projectile(player, player, block, s.freezeProjectile);
    const glow = new Common.core.Animation(s.glowAnim);
    glow.delay = s.freezeProjectile.end;
    block.performAnimation(glow);
  }
}

function iceFloor(fight) {
  const s = freeze();
  const { player } = fight;
  const pattern = Common.pick(s.patterns);
  fight.state.floor = { tiles: pattern, strikeIn: s.strikeTicks };
  for (const [index, spot] of s.waveSpots.entries()) {
    for (const tile of pattern) Common.tileGraphic(player, Common.tileAt(fight.moon, tile), spot, { delay: s.waveDelays[index] });
  }
  for (const block of s.blocks) {
    for (const sound of s.waveSounds) Common.areaSound(player, Common.tileAt(fight.moon, block.tile), sound, 8);
  }
}

function strikeFloor(fight) {
  const floor = fight.state.floor;
  if (!floor || --floor.strikeIn > 0) return;
  fight.state.floor = null;
  const [dx, dy] = Pieces.playerOffset(fight);
  if (!floor.tiles.some(([x, y]) => x === dx && y === dy)) return;
  fight.hurt(Common.randomInt(1, freeze().floorMax));
}

function freezeStop(fight) {
  if (!fight.state.retrieved && fight.state.weapon) {
    giveWeapon(fight.player, fight.state.weapon);
    fight.state.weapon = null;
  }
  Pieces.clear(fight);
  if (fight.player.isRegistered()) {
    Common.varbit(fight.player, "icicleState", 0);
    Common.varbit(fight.player, "wearPrevent", 0);
    Common.varbit(fight.player, "sapped", 0);
  }
}

function freezeShared(arena, offset) {
  const s = freeze();
  if (offset === s.blocksAt) {
    for (const fight of arena.fights.values()) {
      const standIn = Pieces.spawnNpc(fight, Common.data.trackingNpc, [0, 0]);
      standIn?.setMobileInteraction(fight.player);
      standIn?.performGraphic(Common.graphic(s.standInSpot));
      fight.state.standIn = standIn;
    }
  }
  if (offset === s.fadeAt) {
    for (const fight of arena.fights.values()) fight.state.standIn?.performGraphic(Common.graphic(s.fadeSpot));
  }
  if (offset === s.disappearAt) {
    Common.animate(arena.npc, s.disappearAnim);
    for (const fight of arena.fights.values()) Pieces.removeNpc(fight, fight.state.standIn);
  }
  if (offset === s.leaveAt) arena.setHidden(true);
  if (offset === s.backAt) {
    arena.setHidden(false);
    Common.animate(arena.npc, s.appearAnim);
  }
}

/** A punch on a block: the glowing one cracks 8 at a time and gives the weapon back. */
function hitBlock(npc, hit) {
  const marker = npc?.__moonBlock;
  const fight = npc?.__moonFight;
  if (!marker || !fight) return false;
  const s = freeze();
  const parts = hit.getHits();
  const target = hit.getAttacker?.()?.getAsPlayer?.() === fight.player && !fight.state.retrieved && marker.index === fight.state.target;
  // A punch on the marked block is always 8 (capture), shown as one hitsplat; anything else does nothing.
  parts.forEach((part, index) => {
    part.setDamage(target && index === 0 ? s.punch : 0);
    if (target && index === 0) part.setSplatTypes?.(s.punchSplat, s.punchSplat);
  });
  hit.updateTotalDamage();
  if (fight.state.retrieved && hit.getAttacker?.()?.getAsPlayer?.() === fight.player) {
    fight.player.sendMessage(s.retrievedMessage);
    return true;
  }
  if (!target) return true;
  Common.sound(fight.player, s.punchSound);
  fight.state.sapped = Math.max(0, fight.state.sapped - s.punch);
  Common.varbit(fight.player, "sapped", fight.state.sapped);
  if (fight.state.sapped <= 0) retrieve(fight);
  return true;
}

// ------------------------------------------------------------------ Frost Storm

function stormStart(fight, offset) {
  fight.state.storms = [];
  fight.state.shrouded = { left: false, right: false };
  fight.state.relighting = null;
  if (offset > storm().fireAt) addFire(fight);
  if (offset > storm().shroudAt) shroud(fight);
}

function stormTick(fight, offset) {
  const s = storm();
  const { player } = fight;
  if (offset === 0) Common.areaSound(player, Common.tileAt(fight.moon, [2, 2]), [s.startSound, 0], 10);
  if (offset === s.fireAt) addFire(fight);
  if (offset === s.throwAt) Pieces.knockBack(fight, s.throwTile);
  if (offset === s.shroudAt) shroud(fight);
  if (offset >= s.stormsFrom && offset <= s.stormsUntil) spawnStorms(fight);
  moveStorms(fight);
  relight(fight);
  if (offset >= s.healFirst && (offset - s.healFirst) % s.healEvery === 0) {
    const shrouded = Number(fight.state.shrouded.left) + Number(fight.state.shrouded.right);
    fight.heal(shrouded * s.healPer, { splat: true });
  }
}

function addFire(fight) {
  const s = storm();
  if (fight.state.fire) return;
  fight.state.fire = true;
  const [from, to] = s.fireColumns;
  for (const y of s.fireRows) {
    for (let x = from; x <= to; x++) {
      const fromCorner = Math.min(x - from, to - x);
      Pieces.addLoc(fight, s.fire, [x, y], { anim: s.fireAnims[Math.min(fromCorner, s.fireAnims.length - 1)] });
    }
  }
}

function shroud(fight) {
  fight.state.shrouded = { left: true, right: true };
  Common.varbit(fight.player, "brazierLeft", 1);
  Common.varbit(fight.player, "brazierRight", 1);
  Common.sound(fight.player, storm().shroudSound);
}

/** Each column's open span [south, north] in the arena (it is round), read from the map once. */
const spans = new Map();

/** A storm walks on the special's say, not the engine's (as the Nightmare's sleepwalkers do). */
function walkable(npc) {
  npc.getMovementQueue().setBlockMovement(false);
  npc.setScriptedMovement?.(true);
}

function columnSpan(fight, x) {
  if (spans.has(x)) return spans.get(x);
  const { RegionManager } = Common.core;
  const { south, north } = storm();
  const open = (y) => !RegionManager.blocked(Common.tileAt(fight.moon, [x, y]), null);
  let low = south;
  while (low < north && !open(low)) low++;
  let high = north;
  while (high > low && !open(high)) high--;
  const span = high - low >= 2 ? [low, high] : null;
  spans.set(x, span);
  return span;
}

function spawnStorms(fight) {
  const s = storm();
  const count = Math.random() < s.spawnChance[1] ? 2 : Math.random() < s.spawnChance[0] ? 1 : 0;
  for (let i = 0; i < count; i++) {
    const x = Common.randomInt(s.columns[0], s.columns[1]);
    const span = columnSpan(fight, x);
    if (!span) continue;
    const north = Math.random() < 0.5;
    const from = [x, north ? span[1] : span[0]];
    const to = [x, north ? span[0] : span[1]];
    const npc = Pieces.spawnNpc(fight, s.npc, from, { face: to, anim: s.spawnAnim });
    if (!npc) continue;
    walkable(npc);
    Common.areaSound(fight.player, Common.tileAt(fight.moon, from), [s.sound, 0], 10);
    fight.state.storms.push({ npc, to, step: north ? -1 : 1 });
  }
}

/** Storms walk a tile a tick; one that reaches the player hits once. */
function moveStorms(fight) {
  const s = storm();
  const here = Pieces.playerOffset(fight);
  for (const gust of [...fight.state.storms]) {
    const { npc } = gust;
    if (!npc?.isRegistered?.()) {
      fight.state.storms.splice(fight.state.storms.indexOf(gust), 1);
      continue;
    }
    const at = Common.offsetOf(fight.moon, npc.getLocation());
    if (at[1] === gust.to[1] || gust.stuck > 2) {
      Common.animate(npc, s.despawnAnim);
      fight.state.storms.splice(fight.state.storms.indexOf(gust), 1);
      Common.later(1, () => Pieces.removeNpc(fight, npc));
      continue;
    }
    gust.stuck = gust.last === at[1] ? (gust.stuck ?? 0) + 1 : 0;
    gust.last = at[1];
    npc.getMovementQueue().walkStep(0, gust.step);
    if (!gust.hit && at[0] === here[0] && at[1] === here[1]) {
      gust.hit = true;
      fight.hurt(Common.randomInt(1, s.max));
      fight.player.performGraphic(Common.graphic(s.hitSpot.id, { height: s.hitSpot.height }));
      Curses.add(fight, s.cold);
    }
  }
}

function moonOfBrazier(objectId) {
  const { left, right } = storm().braziers;
  if (objectId === left) return "left";
  if (objectId === right) return "right";
  return null;
}

function useBrazier(event) {
  const side = moonOfBrazier(event.objectId);
  if (!side) return;
  event.handled = true;
  const fight = Cycle.arenaOf("blue")?.fights.get(event.player);
  if (!fight || fight.special?.name !== "storm" || !fight.state.shrouded?.[side]) return;
  const s = storm();
  Common.animate(event.player, s.relightAnim);
  Common.sound(event.player, s.relightSound);
  fight.state.relighting = { side, in: s.relightTicks };
}

function relight(fight) {
  const pending = fight.state.relighting;
  if (!pending || --pending.in > 0) return;
  fight.state.relighting = null;
  const s = storm();
  const { player } = fight;
  fight.state.shrouded[pending.side] = false;
  Common.varbit(player, pending.side === "left" ? "brazierLeft" : "brazierRight", 0);
  player.getPacketSender().sendMessage(s.relightMessage);
  if (!fight.state.shrouded.left && !fight.state.shrouded.right) {
    Curses.clear(fight);
    player.sendMessage(s.warmMessage);
  }
}

function stormStop(fight) {
  Pieces.clear(fight);
  fight.state.storms = [];
  if (!fight.player.isRegistered()) return;
  Common.varbit(fight.player, "brazierLeft", 0);
  Common.varbit(fight.player, "brazierRight", 0);
}

function stormShared(arena, offset) {
  const s = storm();
  if (offset !== s.throwAt) return;
  Common.animate(arena.npc, s.castAnim);
  arena.npc.performGraphic(Common.graphic(s.castSpot.id, { delay: s.castSpot.delay, height: s.castSpot.height }));
  for (const fight of arena.fights.values()) {
    for (const target of s.castTargets) Common.projectile(fight.player, arena.centre(), Common.tileAt(arena.moon, target), s.castProjectile);
  }
}

function stormLanding(arena) {
  return Common.tileAt(arena.moon, storm().throwTile);
}

// ------------------------------------------------------------------ hooks

function onHit({ npc, hit }) {
  hitBlock(npc, hit);
}

/** No weapon goes back on while it is frozen. */
function canEquip(event) {
  const { Equipment } = Common.core;
  if (event.slot !== Equipment.WEAPON_SLOT) return;
  const fight = Cycle.arenaOf("blue")?.fights.get(event.player);
  if (!fight?.state.frozen || fight.state.retrieved) return;
  event.allow = false;
  event.player.sendMessage(freeze().equipMessage);
}

/** A weapon frozen at logout comes back at login (Wiki: Eyatlalli keeps it). */
function returnFrozenWeapon({ player }) {
  const weapon = player.getAttribute(FROZEN_WEAPON_ATTRIBUTE);
  if (!weapon?.id) return;
  giveWeapon(player, weapon);
  player.sendMessage(freeze().loginMessage);
}

module.exports = function attachBlueMoon(api) {
  api.persistAttribute(FROZEN_WEAPON_ATTRIBUTE, null);
  Cycle.registerSpecial("freeze", { name: "freeze", start: freezeStart, tick: freezeTick, stop: freezeStop, shared: freezeShared });
  Cycle.registerSpecial("storm", { name: "storm", start: stormStart, tick: stormTick, stop: stormStop, shared: stormShared, landing: stormLanding });
  api.onNpcHitModify(onHit);
  api.onObjectInteraction(useBrazier);
  api.onCanEquip(canEquip);
  api.onPlayerLogin(returnFrozenWeapon);
};
module.exports._test = { takeWeapon, giveWeapon, FROZEN_WEAPON_ATTRIBUTE };
