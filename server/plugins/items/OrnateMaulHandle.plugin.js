/**
 * Ornate maul handle (https://oldschool.runescape.wiki/w/Ornate_maul_handle).
 *
 * Using the handle on a granite maul consumes the handle and swaps the maul for its
 * ornate-handle form, whose Quick Smash costs 50% special attack energy instead of 60% - that
 * cost is the special's own data (plugins/combat/specials/GraniteMaul.SpecialAttack.js). The
 * handle also takes a clamped maul, producing the form that carries both add-ons.
 *
 * Revert is the cache's own op on both forms: it returns the maul the handle was applied to and
 * destroys the handle, so nothing is given back and a clamped maul stays clamped.
 *
 * Attaching warns first, and the warning can be switched off permanently (the 26 September 2019
 * change). The cache ships no varbit for that switch, so the choice is a player attribute, and
 * the wording below is ours - the Wiki records that a warning exists, not its text.
 */
const fs = require("fs");
const path = require("path");

const SKIP_WARNING_ATTRIBUTE = "ornate-maul-handle:skip-attach-warning";
const ATTACH_WARNING =
  "Are you sure you want to attach this ornate maul handle to your granite maul?<br>" +
  "Removing the handle later destroys it.";
const ATTACHED = "You attach the ornate maul handle to your granite maul.";
const REVERTED = "You remove the ornate maul handle from your granite maul.";

let pluginApi = null;
let handleId = -1;
/** Maul id -> the ornate form the handle makes it, from data/granite-maul-handle.json. */
let forms = new Map();
/** Ornate form id -> the maul Revert returns it to. */
let reverts = new Map();

function loadHandleForms() {
  const file = path.join(__dirname, "data", "granite-maul-handle.json");
  const data = JSON.parse(fs.readFileSync(file, "utf8"));
  return {
    handle: Number(data.handle),
    forms: new Map((data.forms ?? []).map((form) => [Number(form.base), Number(form.result)])),
  };
}

function useForms(loaded) {
  handleId = loaded.handle;
  forms = loaded.forms;
  reverts = new Map([...loaded.forms].map(([maulId, formId]) => [formId, maulId]));
}

/** The attach the event asks for, or null when the pair is not this handle on a bare maul. */
function attachFor(event) {
  const { usedItemId, usedItemSlot, usedWithItemId, usedWithItemSlot } = event;
  const usedIsHandle = usedItemId === handleId;
  const maulId = usedIsHandle ? usedWithItemId : usedItemId;
  const formId = forms.get(maulId);
  if (formId === undefined) {
    return null;
  }
  return {
    player: event.player,
    handleSlot: usedIsHandle ? usedItemSlot : usedWithItemSlot,
    maulSlot: usedIsHandle ? usedWithItemSlot : usedItemSlot,
    maulId,
    formId,
  };
}

function attachNow(attach) {
  const { player, handleSlot, maulSlot, maulId, formId } = attach;
  const inventory = player.getInventory();
  const items = inventory.getItems();
  // The warning can sit open while the player rearranges, so re-read both slots before acting.
  if (items[handleSlot]?.getId() !== handleId || items[maulSlot]?.getId() !== maulId) {
    return;
  }
  inventory.deleteNumber(handleId, 1);
  items[maulSlot].setId(formId);
  inventory.refreshItems();
  player.sendMessage(ATTACHED);
}

function attachHandle(event) {
  const attach = attachFor(event);
  if (attach === null) {
    return;
  }
  event.handled = true;
  if (event.player.getAttribute(SKIP_WARNING_ATTRIBUTE) === true) {
    attachNow(attach);
    return;
  }
  pluginApi.sendMultiChatboxPrompt(
    event.player,
    ATTACH_WARNING,
    "Yes, attach it.",
    () => attachNow(attach),
    "Yes, and don't ask again.",
    () => {
      event.player.setAttribute(SKIP_WARNING_ATTRIBUTE, true);
      attachNow(attach);
    },
    "No.",
    () => {},
  );
}

function revertHandle(event) {
  const maulId = reverts.get(event.itemId);
  if (maulId === undefined) {
    return false;
  }
  event.item.setId(maulId);
  event.player.getInventory().refreshItems();
  event.player.sendMessage(REVERTED);
  return true;
}

module.exports = {
  name: "OrnateMaulHandle",
  members: true,
  _test: { loadHandleForms, SKIP_WARNING_ATTRIBUTE },
  register(api) {
    pluginApi = api;
    useForms(loadHandleForms());
    api.persistAttribute(SKIP_WARNING_ATTRIBUTE);
    api.onItemOnItem(attachHandle, { noted: false });
    // Every granite maul form shares the cache name, so only the two with a handle are claimed.
    api.onItemAction("Granite maul", { Revert: revertHandle });
    api.log("registered", { handle: handleId, forms: forms.size });
  },
};
