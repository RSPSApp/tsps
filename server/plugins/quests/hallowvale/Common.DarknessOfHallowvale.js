/**
 * Darkness of Hallowvale: helpers every unit shares (dialogue pages, boxes, menus, timing).
 *
 * Boxes are the chatbox kinds live sends: `mesbox` (messagebox), `itemBox` (objectbox 193 with one
 * item model), `doubleBox` (objectbox_double 11 with two). A box's `then` runs when the player
 * continues. `chain` plays several in a row, with the callback as the chain's last entry (an
 * ActionDialogue mid-chain stalls the client).
 */
const PAGE = "Darkness of Hallowvale";

function createCommon(api, state) {
  const {
    DialogueChainBuilder, StatementDialogue, ItemStatementDialogue, DoubleItemStatementDialogue, NpcDialogue,
    PlayerDialogue, ActionDialogue, TaskManager, CountdownTask, Animation, Graphic,
  } = api.core;
  const { startTranscript } = require("../QuestRuntime");

  /** Plays a variant of the quest's transcript page (or `page`). */
  function play(player, npcId, variant, select, page = PAGE, npc = null) {
    return startTranscript(api, player, npcId, page, variant, select, npc);
  }

  const held = (player, itemId, amount = 1) => player.getInventory().getAmount(itemId) >= amount;

  function freeSlots(player) {
    const inventory = player.getInventory();
    return typeof inventory.getFreeSlots === "function" ? inventory.getFreeSlots() : inventory.isFull() ? 0 : 28;
  }

  /** Swaps an item in its own slot (live keeps the slot for a rod or a bucket that changes). */
  function replaceInSlot(player, fromId, toId) {
    const inventory = player.getInventory();
    const items = inventory.getItems();
    const slot = items.findIndex((item) => item && item.getId() === fromId);
    if (slot < 0) return false;
    inventory.set(slot, new api.core.Item(toId, items[slot].getAmount?.() ?? 1));
    inventory.refreshItems();
    return true;
  }

  /**
   * Plays chatbox entries in order: `{ text }` messagebox, `{ item, text }` objectbox,
   * `{ items: [a, b], text }` objectbox_double, `{ npc, text, name, expression }`, `{ player: text, expression }`.
   */
  function chain(player, entries, then) {
    const builder = new DialogueChainBuilder();
    let index = 0;
    for (const entry of entries) {
      if (entry.items) builder.add(new DoubleItemStatementDialogue(index++, entry.items[0], entry.items[1], entry.text));
      else if (entry.item !== undefined) builder.add(new ItemStatementDialogue(index++, entry.item, entry.text));
      else if (entry.npc !== undefined) builder.add(new NpcDialogue(index++, entry.npc, entry.text, entry.name, entry.expression));
      else if (entry.player !== undefined) builder.add(new PlayerDialogue(index++, entry.player, entry.expression));
      else builder.add(new StatementDialogue(index++, entry.text));
    }
    if (then) builder.add(new ActionDialogue(index++, { execute: () => then(player) }));
    player.getDialogueManager().startDialogues(builder);
  }

  const mesbox = (player, text, then) => chain(player, [{ text }], then);
  const itemBox = (player, item, text, then) => chain(player, [{ item, text }], then);
  const doubleBox = (player, items, text, then) => chain(player, [{ items, text }], then);

  /** A titled option menu: `options` is `[[text, (player) => {}], ...]`. */
  function menu(player, title, options) {
    player.getDialogueManager().reset?.();
    const pairs = [];
    for (const [text, action] of options) pairs.push(text, () => action(player));
    api.sendMultiChatboxPrompt(player, title, ...pairs);
  }

  /** Live's yes/no prompts ("Yes.|No."). */
  function confirm(player, title, onYes) {
    menu(player, title, [["Yes.", onYes], ["No.", (p) => p.getPacketSender().sendInterfaceRemoval()]]);
  }

  /** Runs `fn` `ticks` ticks from now, unless the player has logged out by then. */
  function later(player, ticks, fn) {
    if (ticks <= 0) return fn(player);
    TaskManager.submit(new CountdownTask({ player, unit: "darkness-of-hallowvale" }, ticks, () => {
      if (player.isRegistered?.() === false) return;
      fn(player);
    }));
  }

  const anim = (mobile, id) => mobile.performAnimation(new Animation(id));
  // Graphic(id, delay, height) reads heights 0-2 as a Priority, so a ground-level one passes no height.
  const gfx = (mobile, id, height = 0, delay = 0) =>
    mobile.performGraphic(height > 2 ? new Graphic(id, delay, height) : new Graphic(id, delay));
  const sound = (player, id, delay = 0) => player.getPacketSender().sendSound(id, 255, delay);
  const message = (player, text) => player.sendMessage(text);

  /** Live's quest camera packets (cam_moveto_v3 / cam_lookat_v3 rates as captured). */
  function camera(player, [mx, my, mh], [lx, ly, lh], { rate = 100, rate2 = 100 } = {}) {
    const sender = player.getPacketSender();
    sender.sendCameraMoveTo(mx, my, mh, { rate, rate2 });
    sender.sendCameraLookAt(lx, ly, lh, { rate, rate2 });
  }
  const cameraReset = (player) => player.getPacketSender().sendCameraReset();

  return {
    PAGE, play, held, freeSlots, replaceInSlot, chain, mesbox, itemBox, doubleBox, menu, confirm, later,
    anim, gfx, sound, message, camera, cameraReset, state,
  };
}

module.exports = { createCommon, PAGE };
