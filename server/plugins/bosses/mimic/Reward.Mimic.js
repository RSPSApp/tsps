"use strict";

/**
 * The Mimic chest's loot (see ../Mimic.plugin.js for behaviour and sources).
 *
 * Wiki (The Mimic): six chances from a master clue, five from elite; every leave
 * or death costs one roll on the drop table (simultaneous death with the Mimic
 * does not); failing every attempt means no loot. Reward quantities scale with
 * attempts left: amount = floor(max * rolls / 5), elite tiers.
 * Player-supplied transcript (verbatim from the game):
 * - Opening it before the kill: "Visit the Strange Casket, upstairs in Watson's
 *   house in Hosidius, to attempt the Mimic's challenge."
 * - Opening it inside the fight area: "It'd be bad taste to try opening that
 *   in here."
 * Killing the boss stashes nothing on the floor for arena kills
 * (NpcDrops' `npc-drops:generated` event, handled); opening the chest outside
 * the arena rolls the table once per remaining roll into the inventory and
 * consumes the chest. The open-world Mimic's drops are untouched.
 * - Obtaining the Mimic prints "The chest turned out to be the Mimic!", but no
 *   obtain path exists yet (elite/master caskets don't open in TSPS — no clue
 *   system), so that line waits on it.
 */

const Shared = require("./Shared.Mimic");
const Lair = require("./Lair.Mimic");
const State = require("./State.Mimic");

const DEFEATED_ATTRIBUTE = State.LEGACY_DEFEATED_ATTRIBUTE;
/** Elite consumable max quantities for attempt-scaled tiers: floor(max * R / 5).
 * Maxima mirror the_mimic entries in npc-drops.json (the canonical table data). */
function tierMax() {
  const { ItemIdentifiers: I } = Shared.core();
  return new Map([
    [I.DEATH_RUNE, 600],
    [I.BLOOD_RUNE, 500],
    [I.GRIMY_RANARR_WEED, 25],
    [I.WINE_OF_ZAMORAK, 25],
    [I.RAW_MANTA_RAY, 15],
  ]);
}
/** Clue casket loot window (group 73, item grid on child 3; verified in cache). */
const LOOT_INTERFACE = 73;
const LOOT_GRID_UID = (73 << 16) | 3;
/** Script 1065 populates inventory container 141 (Barrows' pattern). */
const LOOT_CONTAINER = 141;
const GAMEFRAME_OVERLAY_UID = (161 << 16) | 92;

let pluginApi = null;

function inFightArea(player) {
  const area = player.getArea?.();
  return area instanceof Lair.areaClass() && Lair.sessionOf(area) != null;
}

/** Into the inventory, or force-stacked when it won't fit (KeyChests' give). Returns the credited stacks for the loot window. */
function give(player, drops) {
  const { Item, ItemDefinition } = Shared.core();
  const credited = new Map();
  const inventory = player.getInventory();
  for (const { itemId, amount, noted } of drops) {
    if (!Number.isInteger(itemId) || !(amount > 0)) continue;
    const noteId = noted ? ItemDefinition.forId(itemId).getNoteId() : -1;
    const id = noteId >= 0 ? noteId : itemId;
    if (ItemDefinition.forId(id).isStackable()) inventory.forceAdd(player, new Item(id, amount));
    else for (let i = 0; i < amount; i++) inventory.forceAdd(player, new Item(id, 1));
    credited.set(id, (credited.get(id) ?? 0) + amount);
    pluginApi?.emitCustomEvent("collection-log:obtain", { player, itemId, amount });
  }
  inventory.refreshItems();
  return [...credited].map(([id, amount]) => ({ id, amount }));
}

/** The casket loot window (display-only; the items above are already credited). */
function showLoot(player, stacks) {
  const sender = player.getPacketSender?.();
  if (!sender) return;
  sender.sendSubInterface(GAMEFRAME_OVERLAY_UID, LOOT_INTERFACE, 0);
  sender.sendInterfaceScript(1065, [LOOT_GRID_UID], undefined, undefined, {
    [LOOT_CONTAINER]: {
      capacity: stacks.length,
      slots: stacks.map((stack, slot) => ({ slot, itemId: stack.id, quantity: stack.amount })),
    },
  });
}

function openMimic(event) {
  const { player } = event ?? {};
  if (!player || !Shared.alive(player)) return;
  event.handled = true;
  if (inFightArea(player)) {
    player.sendMessage("It'd be bad taste to try opening that in here.");
    return;
  }
  const inventory = player.getInventory();
  const slot = Number.isInteger(event.slot) ? event.slot : Shared.mimicSlot(player);
  const item = inventory.getItems()[slot];
  if (item?.getId?.() !== Shared.ids().CASKET_ITEM || event.item && event.item !== item) return;
  const casket = Shared.rewardState(player, item);
  if (!casket.defeated) {
    player.sendMessage("Visit the Strange Casket, upstairs in Watson's house in Hosidius, to attempt the Mimic's challenge.");
    return;
  }
  const rolls = casket.attemptsLeft;
  const { PLANK } = Shared.ids();
  inventory.deleteAtSlot(slot, 1);
  State.forget(player, casket.id);
  player.setAttribute?.(DEFEATED_ATTRIBUTE, false);
  // Spent out: the chest is gone with no loot (Wiki: failing every attempt).
  if (rolls < 1) {
    player.sendMessage("Visit the Strange Casket, upstairs in Watson's house in Hosidius, to attempt the Mimic's challenge.");
    return;
  }
  // One full pass (the Always plank + pre-roll), then extra passes without it.
  const drops = [];
  pluginApi?.emitCustomEvent("npc-drops:roll-table", { player, npcId: Shared.ids().BOSS, drops });
  if (rolls > 1) {
    pluginApi?.emitCustomEvent("npc-drops:extra-rolls", { player, npc: null, npcId: Shared.ids().BOSS, rolls: rolls - 1, drops });
  }
  for (const drop of drops) {
    const max = tierMax().get(drop.itemId);
    if (max != null) drop.amount = Math.max(1, Math.floor((max * rolls) / Shared.FRESH_ROLLS));
  }
  const stacks = give(player, drops);
  const first = drops.find((drop) => drop.itemId !== PLANK) ?? drops[0];
  if (first) {
    const { ItemDefinition } = Shared.core();
    const name = ItemDefinition.forId(first.itemId)?.getName?.() ?? "loot";
    player.sendMessage(`The Mimic adds a little extra reward for you: <col=ff0000>${first.amount} x ${name}</col>`);
  }
  showLoot(player, stacks);
}

/** An arena kill pays on open, not on the floor. */
function onDropsGenerated(event) {
  const { player, npc, npcId } = event ?? {};
  if (npcId !== Shared.ids().BOSS || !player) return;
  const area = npc.getPrivateArea?.() ?? npc.getArea?.();
  const session = area ? Lair.sessionOf(area) : null;
  if (!session) return;
  if (session.owner && player !== session.owner && player.getAsPlayer?.() !== session.owner) return;
  event.handled = true;
  Shared.markDefeated(player, session.casketId);
}

/** Dying is observed through postLeave (the respawn leaves the arena), which
 * spends the roll there; no hook here, so a death can never cost twice. */
function attach(api) {
  pluginApi = api;
  api.persistAttribute(DEFEATED_ATTRIBUTE, false);
  api.persistAttribute(State.LEDGER_ATTRIBUTE, {});
  api.persistAttribute(Shared.ROLLS_ATTRIBUTE, Shared.FRESH_ROLLS);
  api.onItemAction("Mimic", { Open: openMimic });
  api.onCustomEvent("npc-drops:generated", onDropsGenerated);
}

module.exports = { attach, openMimic, onDropsGenerated, DEFEATED_ATTRIBUTE };
