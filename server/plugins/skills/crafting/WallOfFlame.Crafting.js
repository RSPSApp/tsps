/**
 * Fusing cut onyx and zenyte shards at the wall of flame (Temple of Marimbo, Ape Atoll) into uncut zenyte.
 *
 * Wiki (Uncut zenyte, fetched wikitext): made at the wall of flame with a zombie monkey greegree (small or large) worn,
 * after Monkey Madness II, at Crafting level 70 (not boostable, so the real level is used), 15 Crafting XP per uncut
 * zenyte, 3 ticks each. Wiki (Wall of flame, ids 4765 and 4766): a zenyte shard and onyx on the fire prompts the fuse.
 *
 * Captures, by game tick (the raw decoded recordings: rsprox 1157, rev 237.1, raw sha256 3efbb079...b484; rsprox 3342, rev
 * 235.1, raw sha256 35030e04...232e). 1157: the zenyte shard used on the wall (OpLocT 4765) at tick 3260; the prompt "Fuse all
 * of your onyx and zenyte shards?" with "Yes - fuse them all." / "Fuse only one." / "Don't fuse any of my gems!" at 3262; the
 * choice at 3266; the fuse messages at 3268, 3271 and 3274, each with one uncut zenyte added and one onyx and one shard gone.
 * 3342: the onyx used on the wall with no greegree at 4251, the statement box at 4252; with the greegree and one pair: the use
 * at 4451, the prompt "Fuse your onyx and zenyte shard?" with "Yes - fuse them." / "Don't fuse any of my gems!" at 4452, the
 * choice at 4454, the fuse message at 4456.
 *
 * Not captured, so not implemented: an animation (none in either window), the requirement refusals (no MM2, below level 70:
 * left to the engine), and the XP base (the captures' worlds multiply it; 15 is the Wiki's). "Fuse only one." is taken from its
 * label: one fuse, inferred. The fuse makes one item per 3 ticks, starting 2 ticks after the choice.
 */
const Shared = require("./Shared.Crafting");

const WALL_OF_FLAME = "Wall of flame";
const ONYX_ITEM = "Onyx";
const ZENYTE_SHARD_ITEM = "Zenyte shard";
const MONKEY_MADNESS_II = "monkey_madness_ii";
const FUSE_LEVEL = 70;
const FUSE_XP = 15;
const FUSE_TICKS = 3;
const FIRST_FUSE_TICKS = 2;
// The statement box's text as captured (IfSetText 229:3 in rec 3342 line 89566, with its own line break).
const NO_GREEGREE_MESSAGE = "You must be a zombie monkey to withstand the heat of the firepit<br>long enough to fuse zenyte.";
const FUSE_MESSAGE = "You reach into the extremely hot flames and fuse the zenyte and onyx together, forming an uncut zenyte.";
const FUSE_ALL_PROMPT = "Fuse all of your onyx and zenyte shards?";
const FUSE_ONE_PROMPT = "Fuse your onyx and zenyte shard?";
const DONT_FUSE = "Don't fuse any of my gems!";

function ids() {
  const { ItemIdentifiers: I } = Shared.getCore();
  return {
    onyx: I.ONYX,
    shard: I.ZENYTE_SHARD,
    uncut: I.UNCUT_ZENYTE,
    greegrees: [I.ZOMBIE_MONKEY_GREEGREE, I.ZOMBIE_MONKEY_GREEGREE_2],
  };
}

/** Pairs of onyx and shard held: the fuse makes one uncut zenyte per pair. */
function pairsHeld(player) {
  const { onyx, shard } = ids();
  const inventory = player.getInventory();
  return Math.min(inventory.getAmount(onyx), inventory.getAmount(shard));
}

function wearsGreegree(player) {
  const { Equipment } = Shared.getCore();
  const worn = player.getEquipment().get(Equipment.WEAPON_SLOT)?.getId?.() ?? -1;
  return ids().greegrees.includes(worn);
}

/** Monkey Madness II done and Crafting 70 by the real level (the Wiki says the level is not boostable). */
function meetsRequirements(player) {
  const { Skill } = Shared.getCore();
  const request = { player, key: MONKEY_MADNESS_II, complete: null };
  Shared.getApi().emitCustomEvent("quest:is-complete", request);
  return request.complete === true && player.getSkillManager().getMaxLevel(Skill.CRAFTING) >= FUSE_LEVEL;
}

function canFuse(player) {
  return pairsHeld(player) >= 1 && meetsRequirements(player) && wearsGreegree(player);
}

/** One fuse: an onyx and a shard for an uncut zenyte, the message and 15 Crafting XP. Returns false if it could not. */
function fuseOne(player) {
  if (!canFuse(player)) return false;
  const { onyx, shard, uncut } = ids();
  const inventory = player.getInventory();
  inventory.deleteNumber(onyx, 1);
  inventory.deleteNumber(shard, 1);
  inventory.adds(uncut, 1);
  player.sendMessage(FUSE_MESSAGE);
  Shared.addCraftingXp(player, FUSE_XP);
  Shared.produced(player, uncut, 1, FUSE_XP, "wall-of-flame", [[onyx, 1], [shard, 1]]);
  return true;
}

/** Makes up to `wanted` uncut zenyte, one per FUSE_TICKS, from the pairs still held at the choice. */
function fuse(player, wanted) {
  const amount = Math.min(wanted, pairsHeld(player));
  if (amount < 1 || !canFuse(player)) return;
  Shared.startMaking(player, {
    amount,
    firstTick: FIRST_FUSE_TICKS,
    interval: FUSE_TICKS,
    has: () => canFuse(player),
    make: () => fuseOne(player),
  });
}

/**
 * The item-on-wall use. Not handled (the engine's default) unless the object is the Ape Atoll pit's wall (4765 or 4766:
 * the Between a Rock mine's walls, 5977-5980, share the name and are not fuse walls), the player holds both gems and meets
 * the requirements.
 */
function fuseOnWall(event) {
  const { player } = event;
  const { ObjectIdentifiers: O } = Shared.getCore();
  if (event.objectId !== O.WALL_OF_FLAME && event.objectId !== O.WALL_OF_FLAME_2) return false;
  if (pairsHeld(player) < 1) return false;
  if (!meetsRequirements(player)) return false;
  event.handled = true;
  if (!wearsGreegree(player)) {
    // One tick after the use, as the capture has it: the statement box (interface 229), not a chat line.
    Shared.nextTick(player, () => Shared.getCore().StatementDialogue.send(player, NO_GREEGREE_MESSAGE));
    return true;
  }
  const api = Shared.getApi();
  if (pairsHeld(player) === 1) {
    api.sendMultiChatboxPrompt(player, FUSE_ONE_PROMPT,
      "Yes - fuse them.", () => fuse(player, 1),
      DONT_FUSE, () => {});
  } else {
    api.sendMultiChatboxPrompt(player, FUSE_ALL_PROMPT,
      "Yes - fuse them all.", () => fuse(player, pairsHeld(player)),
      "Fuse only one.", () => fuse(player, 1),
      DONT_FUSE, () => {});
  }
  return true;
}

// Names are the cache's: "Onyx" (6573), "Zenyte shard" (19529), "Wall of flame" (4765 and 4766). Noted items are
// excluded, as a noted onyx or shard is not an ingredient on the wall.
function attach(api) {
  api.onItemOnObject(ONYX_ITEM, WALL_OF_FLAME, fuseOnWall, { noted: false });
  api.onItemOnObject(ZENYTE_SHARD_ITEM, WALL_OF_FLAME, fuseOnWall, { noted: false });
}

module.exports = attach;
module.exports._test = { fuseOnWall, fuseOne, fuse, pairsHeld, canFuse, meetsRequirements, wearsGreegree, FUSE_MESSAGE, NO_GREEGREE_MESSAGE };
