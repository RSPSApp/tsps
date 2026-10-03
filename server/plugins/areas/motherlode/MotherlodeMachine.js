/**
 * Prospector Percy's washing machine: the hoppers take pay-dirt, which floats down the channel
 * while a water wheel turns and washes into ore in the player's sack. The wheels' struts break
 * and are repaired with a hammer.
 */
const { Animation } = require("../../../src/main/typescript/elvarg/game/model/Animation");
const { Item } = require("../../../src/main/typescript/elvarg/game/model/Item");
const { Location } = require("../../../src/main/typescript/elvarg/game/model/Location");
const { Skill } = require("../../../src/main/typescript/elvarg/game/model/Skill");
const { World } = require("../../../src/main/typescript/elvarg/game/World");
const { ItemIds, NpcIds } = require("../../../src/main/typescript/elvarg/util/IdEnums");
const { DialogueChainBuilder } = require("../../../src/main/typescript/elvarg/game/model/dialogues/builders/DialogueChainBuilder");
const { NpcDialogue } = require("../../../src/main/typescript/elvarg/game/model/dialogues/entries/impl/NpcDialogue");
const { ItemStatementDialogue } = require("../../../src/main/typescript/elvarg/game/model/dialogues/entries/impl/ItemStatementDialogue");
const { EndDialogue } = require("../../../src/main/typescript/elvarg/game/model/dialogues/entries/impl/EndDialogue");
const Mine = require("./MotherlodeState");
const { loc, swapLoc, findLoc, ObjectManager } = require("./MotherlodeWorld");

const HOPPER = 26674;
const LOWER_HOPPER = [3748, 5672];
const UPPER_HOPPER = [3755, 5677];
/**
 * The upper hopper is fenced in by railings, so it is used across them from the walkway (as
 * OpenRune's approach op): the path to it would otherwise fail its reach check.
 */
const UPPER_HOPPER_APPROACH = [3755, 5676];
const SACK = 26688;
const BROKEN_STRUT = 26670;
const FIXED_STRUT = 26669;
const BROKEN_WHEEL = 26672;
const FIXED_WHEEL = 26671;
const WATERFALL_FOAM = 2016;
const CENTREPIECE = 10;

/** The two wheels as captured: the map has them broken, and the server spawns them fixed. */
const STRUTS = [
  { strut: [3742, 5669], wheel: [3743, 5668], foam: [3743, 5671] },
  { strut: [3742, 5663], wheel: [3743, 5662], foam: [3743, 5665] },
];
/** OpenRune's (ISC) strut timer: each breaks 2-4 rounds of 97 ticks after its repair. */
const STRUT_ROUND_TICKS = 97;
const STRUT_ROUNDS = [2, 4];
/** Wiki: a 12% chance to repair each tick at Smithing 1, up to 27% at 99, for 1.5 XP per level. */
const REPAIR_CHANCE = { min: 0.12, max: 0.27 };
const REPAIR_XP_PER_LEVEL = 1.5;
const HAMMER_ANIMATION = 3971;
const HAMMER_SOUND = 1786;
const HAMMER_ANIMATION_TICKS = 4;

/**
 * The channel's flowing water as captured: overlays (10459) round its four sides, and small foams
 * (2018) at its corners, which are re-sent every 3 ticks.
 */
const WATER_OVERLAY = 10459;
const WATER_FOAM = 2018;
const GROUND_DECORATION = 22;
const CHANNEL_WATER = [
  ...Array.from({ length: 12 }, (_, i) => [[3743, 5660 + i], 2]),
  [[3743, 5672], 3],
  ...Array.from({ length: 4 }, (_, i) => [[3744 + i, 5672], 3]),
  ...Array.from({ length: 12 }, (_, i) => [[3748, 5661 + i], 0]),
  ...Array.from({ length: 5 }, (_, i) => [[3744 + i, 5660], 1]),
];
const CHANNEL_FOAMS = [[[3744, 5660], 0], [[3744, 5672], 2], [[3748, 5660], 0], [[3748, 5671], 3]];
const FOAM_TICKS = 3;

/** The pay-dirt floating down the channel (npc 6564), one tile a tick, as captured. */
const FLOATING_PAY_DIRT = NpcIds.COL_FF9040_PAY_DIRT_COL;
const CHANNEL_START = [3748, 5671];
const CHANNEL_TILES = 11;
const DEPOSIT_ANIMATION = 832;
const DEPOSIT_SOUND = 2496;
const CLEANED_SOUND = 2739;

/** Percy's overhead lines (Wiki transcript) when a wheel or both break. */
const PERCY_ONE_BROKEN = ["We got us a jammed wheel!", "Ye'd better fix that wheel!", "Git yer hammer an' fix that wheel!"];
const PERCY_BOTH_BROKEN = ["That water ain't flowing!", "Both them wheels be jammed!", "Git yer hammer an' fix them wheels!"];

let pluginApi;
const struts = STRUTS.map((spot) => ({ ...spot, broken: true, breaksAt: -1, foamLoc: null }));
/** player -> their pay-dirt in the channel */
const batches = new Map();
/** player -> the strut they're hammering */
const hammering = new Map();

function init(api) {
  pluginApi = api;
}

function random([min, max]) {
  return min + Math.floor(Math.random() * (max - min + 1));
}

function isFlowing() {
  return struts.some((strut) => !strut.broken);
}

function repairStrut(strut, now) {
  const broken = findLoc(BROKEN_STRUT, strut.strut);
  if (broken) swapLoc(broken, loc(FIXED_STRUT, strut.strut, CENTREPIECE, 0));
  const wheel = findLoc(BROKEN_WHEEL, strut.wheel);
  if (wheel) swapLoc(wheel, loc(FIXED_WHEEL, strut.wheel, CENTREPIECE, 0));
  strut.foamLoc = loc(WATERFALL_FOAM, strut.foam, CENTREPIECE, 1);
  ObjectManager.register(strut.foamLoc, true);
  strut.broken = false;
  strut.breaksAt = now + STRUT_ROUND_TICKS * random(STRUT_ROUNDS);
}

function breakStrut(strut) {
  const fixed = findLoc(FIXED_STRUT, strut.strut);
  if (fixed) swapLoc(fixed, loc(BROKEN_STRUT, strut.strut, CENTREPIECE, 0));
  const wheel = findLoc(FIXED_WHEEL, strut.wheel);
  if (wheel) swapLoc(wheel, loc(BROKEN_WHEEL, strut.wheel, CENTREPIECE, 2));
  if (strut.foamLoc) ObjectManager.deregister(strut.foamLoc, true);
  strut.foamLoc = null;
  strut.broken = true;
  strut.breaksAt = -1;
  percySays(isFlowing() ? PERCY_ONE_BROKEN : PERCY_BOTH_BROKEN);
}

function percySays(lines) {
  const percy = World.getNpcs().search((npc) => npc?.getId() === NpcIds.PROSPECTOR_PERCY);
  percy?.forceChat(lines[Math.floor(Math.random() * lines.length)]);
}

function repairChance(player) {
  const level = Math.min(99, Math.max(1, player.getSkillManager().getCurrentLevel(Skill.SMITHING)));
  return REPAIR_CHANCE.min + ((REPAIR_CHANCE.max - REPAIR_CHANCE.min) * (level - 1)) / 98;
}

/** The broken strut's Hammer. */
function hammerStrut({ player, location }) {
  const strut = struts.find(({ strut: [x, y] }) => x === location.x && y === location.y);
  if (!strut?.broken) return;
  if (!player.getInventory().contains(ItemIds.HAMMER)) {
    player.sendMessage("You need a hammer to repair the strut.");
    return;
  }
  hammering.set(player, { strut, nextAnimationIn: 0 });
}

function tickHammering(player, work, now) {
  const { strut } = work;
  if (!strut.broken || !player.isRegistered?.() || player.getMovementQueue().size() > 0) {
    hammering.delete(player);
    player.performAnimation(Animation.DEFAULT_RESET_ANIMATION);
    return;
  }
  if (--work.nextAnimationIn <= 0) {
    work.nextAnimationIn = HAMMER_ANIMATION_TICKS;
    player.performAnimation(new Animation(HAMMER_ANIMATION, 10));
    player.getPacketSender().sendSound(HAMMER_SOUND, 0, 10);
  }
  if (Math.random() >= repairChance(player)) return;
  repairStrut(strut, now);
  const level = player.getSkillManager().getMaxLevel(Skill.SMITHING);
  player.getSkillManager().addExperiences(Skill.SMITHING, level * REPAIR_XP_PER_LEVEL);
}

/** A hopper's Deposit: all the pay-dirt the sack has room for goes into the machine. */
function deposit({ player, objectId, location }) {
  if (objectId !== HOPPER) return false;
  const state = Mine.stateOf(player);
  if (location.x === UPPER_HOPPER[0] && location.y === UPPER_HOPPER[1] && !state.upperHopper) {
    player.getDialogueManager().startDialogues(new DialogueChainBuilder().add(
      new NpcDialogue(0, NpcIds.MERCY, "I don't think you should be using that without speaking to Percy first."),
      new EndDialogue(1),
    ));
    return;
  }
  const held = player.getInventory().getAmount(Mine.PAY_DIRT);
  if (held <= 0) {
    player.sendMessage("You don't have any pay-dirt to deposit.");
    return;
  }
  const count = Math.min(held, Mine.space(state));
  if (count <= 0) {
    player.sendMessage("The sack is too full to hold any more pay-dirt. You should collect your ore first.");
    return;
  }
  player.getInventory().delete(Mine.PAY_DIRT, count);
  const ores = Mine.takeHeld(player, state, count);
  state.machine.push(...ores);
  Mine.save(player, state);
  player.performAnimation(new Animation(DEPOSIT_ANIMATION));
  player.getPacketSender().sendSound(DEPOSIT_SOUND, 0, 0);
  queueBatch(player, ores);
  if (count < held) player.sendMessage("The sack can't hold all of your pay-dirt, so you keep the rest.");
}

/** Walks to the upper hopper's railing rather than to a side of it. */
function routeToHopper(event) {
  const location = event.object.getLocation();
  if (event.objectId !== HOPPER || location.getX() !== UPPER_HOPPER[0] || location.getY() !== UPPER_HOPPER[1]) return;
  event.destination = { x: UPPER_HOPPER_APPROACH[0], y: UPPER_HOPPER_APPROACH[1], z: 0 };
}

/** Pay-dirt goes down the channel from the tick after it's deposited. */
function queueBatch(player, ores) {
  const queue = batches.get(player) ?? [];
  queue.push({ ores, npc: null, tiles: -1 });
  batches.set(player, queue);
}

function spawnFloating() {
  const [x, y] = CHANNEL_START;
  const npc = pluginApi.spawnNpc({ id: FLOATING_PAY_DIRT, x, y, z: 0, wanderRadius: 0 });
  npc?.setScriptedMovement?.(true);
  return npc;
}

function advance(batch) {
  if (batch.tiles < 0) {
    batch.tiles = 0;
    batch.npc = spawnFloating();
    return false;
  }
  batch.tiles++;
  const [x, y] = CHANNEL_START;
  batch.npc?.moveTo(new Location(x, y - batch.tiles, 0));
  return batch.tiles >= CHANNEL_TILES;
}

/** The batch reached the sack: its pay-dirt is ore now, with the Wiki's bonus XP. */
function clean(player, batch) {
  if (batch.npc) pluginApi.removeNpc(batch.npc);
  const state = Mine.stateOf(player);
  let xp = 0;
  for (const key of batch.ores) {
    const index = state.machine.indexOf(key);
    if (index < 0) continue;
    state.machine.splice(index, 1);
    state.sack[key] = (state.sack[key] ?? 0) + 1;
    xp += Mine.ORE_BY_KEY.get(key).xp;
  }
  Mine.save(player, state);
  if (xp > 0) player.getSkillManager().addExperiences(Skill.MINING, xp);
  Mine.syncVarbits(player);
  player.getPacketSender().sendSound(CLEANED_SOUND, 0, 30);
  player.sendMessage(Mine.sackTotal(state) >= Mine.capacity(state)
    ? "Some ore is ready to be collected from the sack. It's getting full."
    : "Some ore is ready to be collected from the sack.");
}

function tickBatches() {
  if (!isFlowing()) return;
  for (const [player, queue] of batches) {
    for (const batch of [...queue]) {
      if (!advance(batch)) continue;
      queue.splice(queue.indexOf(batch), 1);
      clean(player, batch);
    }
    if (!queue.length) batches.delete(player);
  }
}

/** On login: pay-dirt left in the machine carries on down the channel. */
function resume(player) {
  const state = Mine.stateOf(player);
  if (state.machine.length && !batches.has(player)) queueBatch(player, [...state.machine]);
}

function forget(player) {
  for (const batch of batches.get(player) ?? []) {
    if (batch.npc) pluginApi.removeNpc(batch.npc);
  }
  batches.delete(player);
  hammering.delete(player);
}

/** The sack's Search: nuggets first, then each ore into the free slots (as captured). */
function searchSack({ player, objectId }) {
  if (objectId !== SACK) return false;
  const state = Mine.stateOf(player);
  if (Mine.sackTotal(state) === 0) {
    player.sendMessage(state.machine.length ? "Your pay-dirt is still being cleaned." : "The sack is empty.");
    return;
  }
  let collected = 0;
  for (const ore of Mine.ORES) {
    const stored = state.sack[ore.key] ?? 0;
    if (!stored) continue;
    const inventory = player.getInventory();
    const nuggetsStack = ore.item === Mine.GOLDEN_NUGGET && inventory.contains(ore.item);
    const take = ore.item === Mine.GOLDEN_NUGGET
      ? (nuggetsStack || inventory.getFreeSlots() > 0 ? stored : 0)
      : Math.min(stored, inventory.getFreeSlots());
    if (!take) continue;
    if (ore.item === Mine.GOLDEN_NUGGET) inventory.add(new Item(ore.item, take), true);
    else for (let i = 0; i < take; i++) inventory.add(new Item(ore.item, 1), true);
    state.sack[ore.key] = stored - take;
    collected += take;
  }
  Mine.save(player, state);
  Mine.syncVarbits(player);
  if (!collected) {
    player.sendMessage("Your inventory is too full to hold any more ore.");
    return;
  }
  player.getDialogueManager().startDialogues(new DialogueChainBuilder().add(
    new ItemStatementDialogue(0, Mine.PAY_DIRT, "You collect your ore from the sack."),
    new EndDialogue(1),
  ));
}

function spawnFoams() {
  for (const [tile, face] of CHANNEL_FOAMS) ObjectManager.register(loc(WATER_FOAM, tile, CENTREPIECE, face), true);
}

function start(now) {
  for (const [tile, face] of CHANNEL_WATER) ObjectManager.register(loc(WATER_OVERLAY, tile, GROUND_DECORATION, face), true);
  spawnFoams();
  for (const strut of struts) repairStrut(strut, now);
}

function tick(now) {
  if (now % FOAM_TICKS === 0) spawnFoams();
  for (const strut of struts) {
    if (!strut.broken && now >= strut.breaksAt) breakStrut(strut);
  }
  for (const [player, work] of hammering) tickHammering(player, work, now);
  tickBatches();
}

/** ::mlmstrut - breaks a working strut now. */
function forceBreak({ player }) {
  const strut = struts.find((candidate) => !candidate.broken);
  if (!strut) return player.sendMessage("Both struts are already broken.");
  breakStrut(strut);
}

module.exports = {
  init, start, tick, deposit, routeToHopper, searchSack, hammerStrut, resume, forget, forceBreak, isFlowing,
  struts, batches, HOPPER, SACK, BROKEN_STRUT, CHANNEL_TILES,
};
