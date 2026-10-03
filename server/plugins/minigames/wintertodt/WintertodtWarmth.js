"use strict";

/**
 * Warmth: the meter that stands in for hitpoints inside the prison (varbit 11434, 0-1000).
 *
 * Wiki ("Warmth", "Wintertodt/Strategies"):
 * - Damage, rounded down, with FM the base Firemaking level, W warm items worn (max 4) and
 *   B braziers lit (max 3): standard (16 - W - min(2B, 6)) * 100 / FM; brazier 2 * and area
 *   3 * floor((10 - W) * 100 / FM). The captures' hitsplats are these values and take ten times
 *   as much warmth (6 -> 60 at 99 Firemaking with four warm items).
 * - Food healing at least 4 restores 35% (not triangle sandwiches or wine), a dose of
 *   rejuvenation potion 30%, and the meter regenerates 8% a minute plus 1% per warm item.
 * - At 0% the cold kills you outright.
 * Captures: the hitsplat is 75 (76 to others) with health bar 79; regeneration came every 100
 * ticks; at 0 "<col=ef1020>The cold of the Wintertodt has overcome you!" and a hit for all
 * your hitpoints.
 */

const Shared = require("./WintertodtShared");
const Corners = require("./WintertodtCorners");

const ATTR_WARMTH = "wintertodt:warmth";
const REGEN_TICKS = 100;
const REGEN_BASE = 80;
const REGEN_PER_WARM_ITEM = 10;
const FOOD_RESTORE = 350;
const FOOD_MIN_HEAL = 4;
const POTION_RESTORE = 300;
const MAX_WARM_ITEMS = 4;
const NOT_WARMING_FOODS = new Set(["triangle sandwich", "bottle of wine"]);

/** Wiki "Warmth": every item that counts as warm clothing, by cache name. */
const WARM_ITEM_NAMES = new Set([
  // Head
  "santa mask", "antisanta mask", "bunnyman mask", "larupia hat", "graahk headdress", "kyatt hat",
  "chicken head", "evil chicken head", "pyromancer hood", "santa hat", "black santa hat",
  "inverted santa hat", "festive elf hat", "festive games crown", "bearhead", "fire tiara",
  "elemental tiara", "lumberjack hat", "forestry hat", "snow goggles & hat", "snowglobe helmet",
  "firemaking hood", "fire max hood", "infernal max hood", "bomber cap", "cap and goggles",
  "bobble hat", "earmuffs", "wolf mask", "woolly hat", "jester hat", "tri-jester hat",
  "slayer helmet", "araxyte slayer helmet", "black slayer helmet", "green slayer helmet",
  "hydra slayer helmet", "purple slayer helmet", "red slayer helmet", "turquoise slayer helmet",
  "twisted slayer helmet", "tzkal slayer helmet", "tztok slayer helmet", "vampyric slayer helmet",
  "hooded slayer helmet",
  // Neck
  "jester scarf", "tri-jester scarf", "woolly scarf", "bobble scarf", "gnome scarf", "rainbow scarf",
  "festive scarf",
  // Hands
  "santa gloves", "antisanta gloves", "bunny paws", "clue hunter gloves", "gloves of silence",
  "fremennik gloves", "warm gloves", "grey gloves", "red gloves", "yellow gloves", "teal gloves",
  "purple gloves",
  // Cape
  "firemaking cape", "max cape", "fire cape", "fire max cape", "infernal cape", "infernal max cape",
  "obsidian cape", "accumulator max cape", "ardougne max cape", "assembler max cape",
  "mythical max cape", "imbued guthix max cape", "imbued saradomin max cape",
  "imbued zamorak max cape", "guthix max cape", "saradomin max cape", "zamorak max cape",
  "wolf cloak", "rainbow cape", "clue hunter cloak",
  // Weapon
  "staff of fire", "fire battlestaff", "lava battlestaff", "steam battlestaff", "smoke battlestaff",
  "mystic fire staff", "mystic lava staff", "mystic steam staff", "mystic smoke staff",
  "twinflame staff", "infernal axe", "infernal pickaxe", "infernal harpoon",
  "volcanic abyssal whip", "ale of the gods", "bruma torch", "dragon candle dagger",
  // Shield
  "tome of fire", "bruma torch (off-hand)", "lit bug lantern",
  // Body
  "santa jacket", "antisanta jacket", "bunny top", "clue hunter garb", "polar camo top",
  "wood camo top", "jungle camo top", "desert camo top", "larupia top", "graahk top", "kyatt top",
  "bomber jacket", "yak-hide armour (top)", "pyromancer garb", "chicken wings",
  "evil chicken wings", "ugly halloween jumper", "christmas jumper", "oldschool jumper",
  "rainbow jumper", "icy jumper",
  // Legs
  "santa pantaloons", "antisanta pantaloons", "bunny legs", "clue hunter trousers",
  "polar camo legs", "wood camo legs", "jungle camo legs", "desert camo legs", "larupia legs",
  "graahk legs", "kyatt legs", "yak-hide armour (legs)", "chicken legs", "evil chicken legs",
  "pyromancer robe",
  // Ring
  "ring of the elements",
  // Feet
  "santa boots", "antisanta boots", "bunny feet", "clue hunter boots", "pyromancer boots",
  "chicken feet", "evil chicken feet", "festive elf slippers", "mole slippers", "holy moleys",
  "bear feet", "demon feet", "frog slippers", "bob the cat slippers", "jad slippers",
  "cow slippers", "brutus slippers",
]);

/** Trims the variant suffixes the Wiki lists under one name: (t), (r), (i), (or), uncharged. */
function baseName(name) {
  return String(name ?? "").toLowerCase().replace(/\s*\((t|r|i|e|or|uncharged)\)$/, "").trim();
}

function isWarm(itemId) {
  const { ItemDefinition } = Shared.core();
  const name = String(ItemDefinition.forId(itemId)?.getName?.() ?? "").toLowerCase();
  return WARM_ITEM_NAMES.has(name) || WARM_ITEM_NAMES.has(baseName(name));
}

function warmItems(player) {
  let count = 0;
  for (const item of player.getEquipment().getItems()) {
    const id = item?.getId?.() ?? -1;
    if (id > 0 && isWarm(id)) count++;
  }
  return Math.min(MAX_WARM_ITEMS, count);
}

function warmthOf(player) {
  const value = player.getAttribute(ATTR_WARMTH);
  return typeof value === "number" ? value : Shared.MAX_WARMTH;
}

function setWarmth(player, value) {
  const warmth = Math.max(0, Math.min(Shared.MAX_WARMTH, Math.trunc(value)));
  player.setAttribute(ATTR_WARMTH, warmth);
  player.getPacketSender().sendVarbit(Shared.VARBIT.WARMTH, warmth);
  return warmth;
}

function restore(player, amount) {
  return setWarmth(player, warmthOf(player) + amount);
}

/** Damage, in hitsplat units; the meter loses ten times as much. */
function damageFor(player, kind) {
  const fm = Math.max(1, Shared.firemakingLevel(player));
  const warm = warmItems(player);
  if (kind === "standard") {
    const braziers = Math.min(2 * Corners.litCount(), 6);
    return Math.max(1, Math.floor(((16 - warm - braziers) * 100) / fm));
  }
  const base = Math.floor(((10 - warm) * 100) / fm);
  return (kind === "brazier" ? 2 : 3) * base;
}

/** Takes warmth for one of the Wintertodt's attacks; at 0 the cold kills. */
function hurt(player, kind, message) {
  const damage = damageFor(player, kind);
  if (message) player.sendMessage(message);
  const warmth = setWarmth(player, warmthOf(player) - damage * 10);
  player.showHitsplat?.(damage, Shared.COLD_SPLAT, { current: warmth, max: Shared.MAX_WARMTH, bar: Shared.WARMTH_BAR });
  if (warmth <= 0) overcome(player);
  return damage;
}

function overcome(player) {
  const { HitDamage, HitMask } = Shared.core();
  player.sendMessage("<col=ef1020>The cold of the Wintertodt has overcome you!");
  Shared.stopAction(player);
  const hitpoints = player.getHitpoints();
  if (hitpoints > 0) player.getCombat().getHitQueue().addPendingDamage([new HitDamage(hitpoints, HitMask.RED)]);
}

/** Every 100 ticks: 8% plus 1% per warm item. */
function regenerate(player) {
  if (warmthOf(player) >= Shared.MAX_WARMTH) return;
  restore(player, REGEN_BASE + REGEN_PER_WARM_ITEM * warmItems(player));
}

function tick(ticks, players) {
  if (ticks % REGEN_TICKS !== 0) return;
  for (const player of players) regenerate(player);
}

/** Wiki: entering with fewer than four warm items earns a warning. */
function enter(player) {
  setWarmth(player, Shared.MAX_WARMTH);
  if (warmItems(player) < MAX_WARM_ITEMS) {
    player.sendMessage("You feel the cold wind strike you as you enter; perhaps you should find some warmer clothes.");
  }
}

function leave(player) {
  player.setAttribute(ATTR_WARMTH, Shared.MAX_WARMTH);
  player.getPacketSender().sendVarbit(Shared.VARBIT.WARMTH, Shared.MAX_WARMTH);
}

function ateFood(player, itemId, heal) {
  if (!(heal >= FOOD_MIN_HEAL)) return;
  const { ItemDefinition } = Shared.core();
  const name = String(ItemDefinition.forId(itemId)?.getName?.() ?? "").toLowerCase();
  if (NOT_WARMING_FOODS.has(name)) return;
  restore(player, FOOD_RESTORE);
}

module.exports = {
  ATTR_WARMTH, POTION_RESTORE, WARM_ITEM_NAMES,
  isWarm, warmItems, warmthOf, setWarmth, restore, damageFor, hurt, tick, enter, leave, ateFood,
};
