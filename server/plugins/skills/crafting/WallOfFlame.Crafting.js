/**
 * Fusing cut onyx and zenyte shards at the wall of flame (Temple of Marimbo, Ape Atoll) into uncut zenyte.
 *
 * Wiki (Uncut zenyte, fetched wikitext): made at the wall of flame with a zombie monkey greegree (small or large) worn,
 * after Monkey Madness II, at Crafting level 70 (not boostable, so the real level is used), 15 Crafting XP per uncut
 * zenyte, 3 ticks each. Wiki (Wall of flame, ids 4765 and 4766): a zenyte shard and onyx on the fire prompts the fuse.
 *
 * rsprox 1157 (rev 237.1; sha256 3efbb079...b484): the use is OpLocT(4765) with the zenyte shard at 97003 [3260]; the prompt
 * "Fuse all of your onyx and zenyte shards?" with "Yes - fuse them all." / "Fuse only one." / "Don't fuse any of my gems!" at
 * 97070 [3262]; the choice at 97124 [3266]; the fuse message at 97160 [3268], 97209 [3271] and 97258 [3274], each with one
 * uncut zenyte added and one onyx and one shard gone.
 * rsprox 3342 (rev 235.1; sha256 35030e04...232e): without the greegree the onyx use at 89541 [4251] gives the line at
 * 89555 [4252]; with it, one pair: the use at 92428 [4451], the prompt "Fuse your onyx and zenyte shard?" with "Yes - fuse them."
 * / "Don't fuse any of my gems!" at 92452 [4452], the choice at 92465 [4454], the fuse message at 92484 [4456].
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
const NO_GREEGREE_MESSAGE = "You must be a zombie monkey to withstand the heat of the firepit long enough to fuse zenyte.";
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

/** The item-on-wall use. Not handled (the engine's default) unless the player holds both gems and meets the requirements. */
function fuseOnWall(event) {
  const { player } = event;
  if (pairsHeld(player) < 1) return false;
  if (!meetsRequirements(player)) return false;
  event.handled = true;
  if (!wearsGreegree(player)) {
    // One tick after the use, as the capture has it.
    Shared.nextTick(player, () => player.sendMessage(NO_GREEGREE_MESSAGE));
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

function attach(api) {
  api.onItemOnObject(ONYX_ITEM, WALL_OF_FLAME, fuseOnWall);
  api.onItemOnObject(ZENYTE_SHARD_ITEM, WALL_OF_FLAME, fuseOnWall);
}

module.exports = attach;
module.exports._test = { fuseOnWall, fuseOne, fuse, pairsHeld, canFuse, meetsRequirements, wearsGreegree, FUSE_MESSAGE, NO_GREEGREE_MESSAGE };
