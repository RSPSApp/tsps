"use strict";

/**
 * Dark essence fragments: Kourend's dark essence blocks chiselled into the fragments that the
 * Blood Altar and the Soul Altar bind (Wiki: Dark essence fragments).
 *
 * Wiki: a chisel used on a dark essence block needs 38 Crafting and gives 8 Crafting XP and 4
 * fragments a block; "Auto-chiseling is 1, then 3, then 4 ticks". No more than 108 fragments are
 * held. Count says "This stack of fragments is roughly equivalent to X pieces of essence." ("one
 * piece" for one, Transcript:Dark essence fragments).
 *
 * Recorded (rsprox_transcripts/226/01672.txt): the fragments are one never-stacking item whose
 * inventory count stays 1, so how many it holds is the item's own (meta `dark-essence-fragments`
 * here). The first block chiselled turns into the fragments in its slot, later ones are removed;
 * each plays arceuus_chisel_essenceblock with synth chisel and 8 Crafting XP. Chiselling starts on
 * the use's tick, the next block goes 3 ticks later and each after that 4 ticks on (ticks 871,
 * 874, 878). At the cap the use is an item box: "Your pile of fragments cannot grow any larger."
 * Count is an item box (zoom 400) with the line above.
 *
 * Ours: the refusal below 38 Crafting (no recording or Wiki line), modelled on the altars'.
 * Not built: the 111 a picked-up stack can reach, fragments vanishing on death.
 */
const { pauseForLevelUp } = require("../SkillActions");

/** How many fragments the fragments item holds. */
const FRAGMENTS_META = "dark-essence-fragments";
const FRAGMENTS_PER_BLOCK = 4;
const MAX_FRAGMENTS = 108;
const CHISEL_LEVEL = 38;
const CHISEL_XP = 8;
/** synth chisel (rsprox_transcripts/226/01672.txt). */
const CHISEL_SOUND = 2586;
/** Ticks after the first block to the second, then between each later one. */
const SECOND_BLOCK_TICKS = 3;
const LATER_BLOCK_TICKS = 4;

const CAP_TEXT = "Your pile of fragments cannot grow any larger.";
const LEVEL_TEXT = `You need a Crafting level of at least ${CHISEL_LEVEL} to chisel this.`;

let api;
let core;
let ids;

/** Each player's chiselling loop, retained while the level-up dialogue is open. */
const sessions = new WeakMap();

/** How many fragments one fragments item holds: 1 for one with no count of its own. */
function fragmentsIn(item) {
  if (item?.getId?.() !== ids.fragments) return 0;
  const saved = Number(item.getMetaValue?.(FRAGMENTS_META));
  return Number.isInteger(saved) && saved > 0 ? saved : 1;
}

/** Every fragment the player holds, over every fragments item in the inventory. */
function heldFragments(player) {
  return player.getInventory().getItems().reduce((sum, item) => sum + fragmentsIn(item), 0);
}

function itemBox(player, text) {
  const { DialogueChainBuilder, ItemStatementDialogue } = core;
  player.getDialogueManager().startDialogues(new DialogueChainBuilder().add(new ItemStatementDialogue(0, ids.fragments, text)));
}

function hasChisel(player) {
  return player.getInventory().contains(ids.chisel);
}

/** One block chiselled into four fragments; false when none is left, or at the cap (with its box). */
function chiselOne(player) {
  const inventory = player.getInventory();
  const blockSlot = inventory.getSlotForItemId(ids.block);
  if (blockSlot < 0 || !hasChisel(player)) return false;
  const held = heldFragments(player);
  if (held + FRAGMENTS_PER_BLOCK > MAX_FRAGMENTS) {
    itemBox(player, CAP_TEXT);
    return false;
  }
  const fragmentsSlot = inventory.getSlotForItemId(ids.fragments);
  if (fragmentsSlot < 0) {
    // The first block becomes the fragments in its own slot.
    inventory.setItem(blockSlot, new core.Item(ids.fragments, 1, { [FRAGMENTS_META]: FRAGMENTS_PER_BLOCK }));
  } else {
    const fragments = inventory.getItems()[fragmentsSlot];
    inventory.setItem(fragmentsSlot, new core.Item(ids.fragments, 1, { ...(fragments.getMeta() ?? {}), [FRAGMENTS_META]: fragmentsIn(fragments) + FRAGMENTS_PER_BLOCK }));
    inventory.deleteAtSlot(blockSlot, 1, false);
  }
  inventory.refreshItems();
  player.performAnimation(new core.Animation(ids.chiselSeq));
  player.getPacketSender().sendSound(CHISEL_SOUND, 1, 0);
  player.getSkillManager().addExperiences(core.Skill.CRAFTING, CHISEL_XP);
  return true;
}

function stopChiselling(player) {
  sessions.get(player)?.stop();
  sessions.delete(player);
}

function keepChiselling(player) {
  let wait = SECOND_BLOCK_TICKS;
  const task = new (class extends core.Task {
    constructor() { super(1, player.getIndex(), false); }
    execute() {
      if (!player.isRegistered() || player.getHitpoints() <= 0) return stopChiselling(player);
      if (this.levelUpPaused) return;
      if (--wait > 0) return;
      wait = LATER_BLOCK_TICKS;
      if (!chiselOne(player)) stopChiselling(player);
    }
  })();
  sessions.set(player, task);
  core.TaskManager.submit(task);
}

/** A chisel used on a dark essence block (either way round): one now, then the rest in turn. */
function chiselBlocks({ player }) {
  // Members content, as the Dark Altar that makes the blocks.
  if (!player || !core.WorldDefinition.isMembersWorld()) return false;
  if (player.getSkillManager().getCurrentLevel(core.Skill.CRAFTING) < CHISEL_LEVEL) {
    player.sendMessage(LEVEL_TEXT);
    return true;
  }
  stopChiselling(player);
  if (chiselOne(player)) keepChiselling(player);
  return true;
}

function countFragments({ player, item, slot }) {
  const held = item ?? player.getInventory().getItems()[slot];
  const count = fragmentsIn(held) || heldFragments(player);
  itemBox(player, count === 1
    ? "This stack of fragments is roughly equivalent to one piece of essence."
    : `This stack of fragments is roughly equivalent to ${count} pieces of essence.`);
  return true;
}

function pauseChiselling(event) {
  pauseForLevelUp(event, sessions, (player) => stopChiselling(player));
}

/**
 * Binds every fragment held: removes the fragments items and answers how many fragments they held.
 * `inventory` may be a preview copy.
 */
function takeFragments(inventory) {
  let total = 0;
  inventory.getItems().forEach((item, slot) => {
    const count = fragmentsIn(item);
    if (!count) return;
    total += count;
    inventory.deleteAtSlot(slot, 1, false);
  });
  return total;
}

function attach(pluginApi) {
  api = pluginApi;
  core = api.core;
  const { ItemIdentifiers, CacheDefinitions } = core;
  ids = {
    chisel: ItemIdentifiers.CHISEL,
    block: ItemIdentifiers.DARK_ESSENCE_BLOCK,
    fragments: ItemIdentifiers.DARK_ESSENCE_FRAGMENTS,
    chiselSeq: CacheDefinitions.getSeqId("arceuus_chisel_essenceblock"),
  };
  api.onItemOnItem("Chisel", "Dark essence block", chiselBlocks, { noted: false });
  api.onItemAction("Dark essence fragments", { Count: countFragments });
  api.onCustomEvent("level-up:popup-opened", pauseChiselling);
}

module.exports = { attach, fragmentsIn, heldFragments, takeFragments, chiselOne, sessions, FRAGMENTS_META, MAX_FRAGMENTS };
