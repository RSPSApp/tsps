"use strict";

/**
 * The crucible (multiloc 44776, by crucible_state 13937): filled with up to 28 bars' worth of
 * metal, then poured into a set-up mould jig.
 *
 * rsprox captures (recordings 96 and 565):
 * - Fill (op1) opens the make-x menu "What metal would you like to add?" with all six bars;
 *   its quantity cap is the space left. A bar the player doesn't hold gets an item box "You have
 *   no Bronze bars to add to the crucible.".
 * - Using bars or equipment asks "How many would you like to add?" (1|5|X|All) unless only
 *   one is held. The player pulls the lever (4909, synth 2725) and, three ticks later, the
 *   metal count varbit and crucible state change and an item box tells what went in: "You add
 *   6 Iron bars to the crucible." or, for equipment, "You add 7 Bronze platelegss to the
 *   crucible,<br>worth 14 Bronze bars." (live really adds an "s" to the item's name).
 * - Adding more than fits asks first: "Adding this item will overflow the crucible. You will
 *   lose 12 bars worth of Steel. Are you sure you want to add it?" (No./Yes.); the excess is lost.
 * - Then either "The crucible is now full of molten metal, it is ready to be poured into the
 *   mould jig." (message box) or "You need to add 10 more metal bars worth of material to pour
 *   the crucible into the mould jig." (game message).
 * - Pour (op1 when full) needs the jig set up; the player pushes (810, synth 5605) and the
 *   crucible plays giants_foundry_crucible_pour01. Next tick the alloy's score is set (13913);
 *   six ticks after the push the metal reaches the jig (mould_state 1 -> 2) and the crucible
 *   empties.
 *
 * Equipment counts as its smithing cost minus one bar (Wiki); adding a metal needs the level
 * to smelt it (boostable).
 */

const DATA = require("../data/giants-foundry.json");
const Shared = require("./Shared.GiantsFoundry");

const CAPACITY = DATA.crucibleCapacity;
const ANIM_LEVER = 4909; // human_elem2_lever_3way_right
const SOUND_LEVER = 2725;
const ANIM_PUSH = 810; // human_push
const SOUND_POUR = 5605;
const LOC_ANIM_POUR = 9447; // giants_foundry_crucible_pour01
const ADD_DELAY = 3;
/** The powered staves' wording for a preset copy (Presets.PvpMode tags them untradeable, unbankable and preset). */
const PRESET_TEXT = "Preset items cannot be used for this.";

/** A preset (or meta-untradeable, unbankable) copy is never melted: the metal pays Kovac in coins and reputation. */
function restricted(item) {
  return !!item && (item.isPresetItem?.() === true || item.isUntradeable?.() === true || item.isUnbankable?.() === true);
}

/** How many plain copies of `itemId` the inventory holds. */
function plainHeld(player, itemId) {
  return player.getInventory().getItems().reduce((total, item) =>
    (item?.getId() === itemId && !restricted(item) ? total + item.getAmount() : total), 0);
}

/** Takes `amount` plain copies of `itemId`, by slot, leaving restricted copies alone. */
function takePlain(player, itemId, amount) {
  const inventory = player.getInventory();
  let left = amount;
  inventory.getItems().forEach((item, slot) => {
    if (left <= 0 || item?.getId() !== itemId || restricted(item)) return;
    const taken = Math.min(left, item.getAmount());
    inventory.deleteAtSlot(slot, taken, false);
    left -= taken;
  });
}
const POUR_SCORE_DELAY = 1;
const POUR_ARRIVE_DELAY = 6;
const POURED_AT = "pouredAt";

const STATE = { EMPTY: 0, PARTIAL: 1, FULL: 2 };
const JIG = { EMPTY: 0, SET: 1, POURED: 2, COOLED: 3 };

const MESSAGE = {
  FULL: "The crucible is now full of molten metal, it is ready to be poured into the mould jig.",
  NEED_MORE: (bars) => `You need to add ${bars} more metal bars worth of material to pour the crucible into the mould jig.`,
  NONE_HELD: (bar) => `You have no ${bar}s to add to the crucible.`,
  OVERFLOW: (bars, metal) => `Adding this item will overflow the crucible. You will lose ${bars} bars worth of ${metal}. Are you sure you want to add it?`,
  SET_MOULD_FIRST: "I'll need to set the mould up before pouring metal into it.",
  /** Not captured: the Wiki only says a poured preform must be handed in before the next pour. */
  HAND_IN_FIRST: "You need to hand your current sword in to Kovac before pouring another.",
};

const busy = new WeakSet();

/** What an item is worth in the crucible: its metal (index into DATA.metals) and bars each. */
function metalValue(itemId) {
  const { ItemDefinition } = Shared.core();
  const definition = ItemDefinition.forId(itemId);
  if (!definition || definition.isNoted?.()) return null;
  const name = definition.getName();
  for (let metal = 0; metal < DATA.metals.length; metal++) {
    const spec = DATA.metals[metal];
    if (name === spec.bar) return { metal, bars: 1, bar: true };
    if (!name.startsWith(`${spec.prefix} `)) continue;
    const bars = DATA.items[name.slice(spec.prefix.length + 1)];
    if (bars) return { metal, bars, bar: false };
  }
  return null;
}

function counts(player) {
  return DATA.metals.map((_, metal) => Shared.get(player, Shared.VARBIT.METAL_COUNT_FIRST + metal));
}

function total(player) {
  return counts(player).reduce((sum, value) => sum + value, 0);
}

/**
 * The alloy's score (Wiki): the two most common metals count, ties going to the better metal;
 * each gives V = 10 * tier * amount / 28 and the score is floor((floor(10 V1) + floor(10 V2) +
 * floor(V1 * V2)) / 10). Pure metals score 10 (bronze) to 60 (rune); 14 adamant + 14 rune, 130.
 */
function metalScore(amounts) {
  const ranked = amounts
    .map((amount, metal) => ({ amount, tier: DATA.metals[metal].tier }))
    .filter((entry) => entry.amount > 0)
    .sort((a, b) => b.amount - a.amount || b.tier - a.tier);
  const [v1, v2] = [ranked[0], ranked[1]].map((entry) => (entry ? (10 * entry.tier * entry.amount) / CAPACITY : 0));
  return Math.floor((Math.floor(10 * v1) + Math.floor(10 * v2) + Math.floor(v1 * v2)) / 10);
}

function refreshState(player) {
  const amount = total(player);
  Shared.set(player, Shared.VARBIT.CRUCIBLE_STATE, amount >= CAPACITY ? STATE.FULL : amount > 0 ? STATE.PARTIAL : STATE.EMPTY);
}

function clear(player) {
  for (let metal = 0; metal < DATA.metals.length; metal++) Shared.set(player, Shared.VARBIT.METAL_COUNT_FIRST + metal, 0);
  refreshState(player);
}

function canSmelt(player, metal) {
  return Shared.currentLevel(player, "SMITHING") >= DATA.metals[metal].level;
}

/** Pulls the lever and, three ticks later, melts `amount` of the item into the crucible. */
function melt(player, itemId, value, amount) {
  const { DialogueChainBuilder, ItemStatementDialogue, DoubleItemStatementDialogue, ActionDialogue } = Shared.core();
  if (busy.has(player)) return;
  const held = plainHeld(player, itemId);
  const count = Math.min(amount, held);
  if (count <= 0) return;
  busy.add(player);
  Shared.animate(player, ANIM_LEVER);
  Shared.sound(player, SOUND_LEVER);
  Shared.later(ADD_DELAY, () => {
    busy.delete(player);
    const taken = Math.min(count, plainHeld(player, itemId));
    if (taken <= 0) return;
    takePlain(player, itemId, taken);
    player.getInventory().refreshItems();
    const worth = taken * value.bars;
    const space = Math.max(0, CAPACITY - total(player));
    const varbit = Shared.VARBIT.METAL_COUNT_FIRST + value.metal;
    Shared.set(player, varbit, Shared.get(player, varbit) + Math.min(worth, space));
    refreshState(player);
    Shared.step(player, total(player) >= CAPACITY ? "crucible-full" : "metal-added");
    const metal = DATA.metals[value.metal];
    const name = Shared.itemName(itemId);
    const barId = barItemId(value.metal);
    const chain = new DialogueChainBuilder();
    if (value.bar) {
      chain.add(new ItemStatementDialogue(0, itemId, `You add ${taken} ${name}s to the crucible.`));
    } else {
      const plural = taken > 1 ? `${name}s` : name;
      chain.add(new DoubleItemStatementDialogue(0, itemId, barId,
        `You add ${taken} ${plural} to the crucible,<br>worth ${worth} ${metal.bar}s.`));
    }
    chain.add(new ActionDialogue(1, { execute: () => afterAdding(player) }));
    player.getDialogueManager().startDialogues(chain);
  });
}

function afterAdding(player) {
  const left = CAPACITY - total(player);
  if (left <= 0) {
    Shared.statement(player, MESSAGE.FULL);
    return;
  }
  player.getPacketSender().sendInterfaceRemoval();
  player.sendMessage(MESSAGE.NEED_MORE(left));
}

function barItemId(metal) {
  return itemIdByName(DATA.metals[metal].bar);
}

const barIds = new Map();

function itemIdByName(name) {
  if (barIds.has(name)) return barIds.get(name);
  const { ItemIdentifiers } = Shared.core();
  const key = name.toUpperCase().replace(/[^A-Z0-9]+/g, "_");
  const id = Number(ItemIdentifiers[key]);
  barIds.set(name, Number.isInteger(id) ? id : -1);
  return barIds.get(name);
}

/** Melts after asking, when the metal would spill over the top. */
function addWithConfirm(player, itemId, value, amount) {
  const count = Math.min(amount, plainHeld(player, itemId));
  if (count <= 0) return;
  const space = CAPACITY - total(player);
  const lost = count * value.bars - space;
  if (lost <= 0) {
    melt(player, itemId, value, count);
    return;
  }
  const { DialogueChainBuilder, ItemStatementDialogue, ActionDialogue } = Shared.core();
  const metal = DATA.metals[value.metal].bar.replace(/ bar$/, "");
  player.getDialogueManager().startDialogues(new DialogueChainBuilder().add(
    new ItemStatementDialogue(0, itemId, MESSAGE.OVERFLOW(lost, metal)),
    new ActionDialogue(1, { execute: () => Shared.options(player, "Select an Option",
      "No.", () => player.getPacketSender().sendInterfaceRemoval(),
      "Yes.", () => melt(player, itemId, value, count)) }),
  ));
}

/** Common checks before anything goes in. False when it can't. */
function canFill(player, value) {
  if (!Shared.questComplete(player)) {
    Shared.playerSays(player, "Maybe I should talk with Kovac first before messing around with anything.");
    return false;
  }
  if (total(player) >= CAPACITY) {
    Shared.statement(player, MESSAGE.FULL);
    return false;
  }
  if (value && !canSmelt(player, value.metal)) {
    Shared.statement(player, `You need a Smithing level of ${DATA.metals[value.metal].level} to add ${DATA.metals[value.metal].prefix.toLowerCase()} to the crucible.`);
    return false;
  }
  return true;
}

function promptAmount(player, callback) {
  if (player.getEnteredAmountAction?.() != null) return;
  player.setEnteredAmountAction({ execute: callback });
  player.getPacketSender().sendEnterAmountPrompt("How many would you like to add?");
}

/** Item-on-object hooks see every use; this one takes metal used on the crucible. */
function useOnCrucible(event) {
  const { player, itemId, objectId } = event;
  if (event.handled || objectId !== Shared.OBJECT.CRUCIBLE_MULTI) return;
  const value = metalValue(itemId);
  if (!value) return;
  event.handled = true;
  if (!canFill(player, value)) return;
  const held = plainHeld(player, itemId);
  if (held <= 0) {
    Shared.statement(player, PRESET_TEXT);
    return;
  }
  if (held <= 1) {
    addWithConfirm(player, itemId, value, 1);
    return;
  }
  const choose = (amount) => () => addWithConfirm(player, itemId, value, amount);
  const options = ["1", choose(1)];
  if (held >= 5) options.push("5", choose(5));
  options.push("X", () => promptAmount(player, (amount) => { if (amount > 0) addWithConfirm(player, itemId, value, amount); }));
  options.push("All", choose(held));
  Shared.api().sendMultiChatboxPrompt(player, "How many would you like to add?", ...options);
}

/** Fill: pick a bar from the make-x menu; it never overflows (the quantity is capped). */
function fill({ player }) {
  if (!canFill(player, null)) return;
  const { CreationMenu } = Shared.core();
  const bars = DATA.metals.map((_, metal) => barItemId(metal));
  const space = CAPACITY - total(player);
  const menu = new CreationMenu("What metal would you like to add?", bars, {
    execute: (itemId, amount) => fillWith(player, itemId, amount),
  }, { maxAmount: space, lastAmount: space });
  player.getPacketSender().sendCreationMenu(menu);
}

function fillWith(player, itemId, amount) {
  player.getPacketSender().closeCreationMenu?.();
  const value = metalValue(itemId);
  if (!value || !canFill(player, value)) return;
  if (player.getInventory().getAmount(itemId) <= 0) {
    const { DialogueChainBuilder, ItemStatementDialogue, EndDialogue } = Shared.core();
    player.getDialogueManager().startDialogues(new DialogueChainBuilder().add(
      new ItemStatementDialogue(0, itemId, MESSAGE.NONE_HELD(Shared.itemName(itemId))),
      new EndDialogue(1),
    ));
    return;
  }
  melt(player, itemId, value, Math.min(amount, CAPACITY - total(player)));
}

/** Check (no capture): says what is in the crucible. */
function check({ player }) {
  const amounts = counts(player);
  const parts = amounts
    .map((amount, metal) => (amount > 0 ? `${amount} ${DATA.metals[metal].bar.replace(/ bar$/, "").toLowerCase()}` : null))
    .filter(Boolean);
  if (!parts.length) {
    player.sendMessage("The crucible is empty.");
    return;
  }
  player.sendMessage(`The crucible holds ${parts.join(", ")}: ${total(player)} of ${CAPACITY} bars' worth.`);
}

/** Empty (no capture): everything inside is lost (Wiki), so it asks first. */
function empty({ player }) {
  if (total(player) <= 0) {
    player.sendMessage("The crucible is empty.");
    return;
  }
  Shared.options(player, "Empty the crucible? Its metal will be lost.",
    "Yes.", () => {
      player.getPacketSender().sendInterfaceRemoval();
      clear(player);
    },
    "No.", () => player.getPacketSender().sendInterfaceRemoval());
}

/** A preform still to be handed in: worn, stored, or waiting in the jig. */
function hasPreform(player) {
  return Shared.wornPreform(player)
    || Shared.get(player, Shared.VARBIT.PREFORM_STORED) === 1
    || Shared.get(player, Shared.VARBIT.MOULD_STATE) >= JIG.POURED
    || Shared.get(player, Shared.VARBIT.PREFORM_DIFFICULTY) > 0;
}

function pour(event) {
  const { player, object } = event;
  if (!Shared.questComplete(player)) return false;
  if (busy.has(player)) return true;
  if (hasPreform(player)) {
    Shared.statement(player, MESSAGE.HAND_IN_FIRST);
    return true;
  }
  if (Shared.get(player, Shared.VARBIT.MOULD_STATE) !== JIG.SET) {
    Shared.playerSays(player, MESSAGE.SET_MOULD_FIRST);
    return true;
  }
  busy.add(player);
  Shared.animate(player, ANIM_PUSH);
  Shared.sound(player, SOUND_POUR);
  player.getPacketSender().sendObjectAnimation(object, { id: LOC_ANIM_POUR });
  const score = Shared.field(player, "tutorial", false) === true ? 5 : metalScore(counts(player));
  Shared.later(POUR_SCORE_DELAY, () => Shared.set(player, Shared.VARBIT.ALLOY_DIFFICULTY, score));
  Shared.later(POUR_ARRIVE_DELAY, () => {
    busy.delete(player);
    clear(player);
    Shared.set(player, Shared.VARBIT.MOULD_STATE, JIG.POURED);
    Shared.setField(player, POURED_AT, Shared.tick());
    Shared.step(player, "poured");
  });
  return true;
}

module.exports = function attachCrucible(api) {
  api.onObjectInteraction("Crucible (empty)", { Fill: fill, Check: check, Empty: empty });
  api.onObjectInteraction("Crucible (partially full)", { Fill: fill, Check: check, Empty: empty });
  api.onObjectInteraction("Crucible (full)", { Pour: pour, Check: check, Empty: empty });
  api.onItemOnObject(useOnCrucible, { noted: false });
};

Object.assign(module.exports, { hasPreform, metalValue, metalScore, counts, total, clear, POURED_AT, JIG, CAPACITY, MESSAGE });
