"use strict";

/**
 * The Mimic chest's loot (see ../Mimic.plugin.js for behaviour and sources).
 *
 * Wiki (The Mimic): six chances from a master clue, five from elite; every leave
 * or death costs one roll on the drop table (simultaneous death with the Mimic
 * does not); failing every attempt means no loot. One bonus outcome uses the
 * exact tier/attempt quantity list; original clue rolls are paid separately.
 * Player-supplied transcript (verbatim from the game):
 * - Opening it before the kill: "Visit the Strange Casket, upstairs in Watson's
 *   house in Hosidius, to attempt the Mimic's challenge."
 * - Opening it inside the fight area: "It'd be bad taste to try opening that
 *   in here."
 * Killing the boss stashes nothing on the floor for arena kills
 * (NpcDrops' `npc-drops:generated` event, handled); opening the chest outside
 * the arena generates the original clue rewards plus one bonus outcome and
 * consumes the chest. The open-world Mimic's drops are untouched.
 * - Obtaining the Mimic prints "The chest turned out to be the Mimic!", but no
 *   obtain path exists yet (elite/master caskets don't open in TSPS — no clue
 *   system), so that line waits on it.
 */

const Shared = require("./Shared.Mimic");
const Lair = require("./Lair.Mimic");
const State = require("./State.Mimic");
const Pool = require("./Pool.Mimic");
const BONUS_TABLES = require("../data/reward-tables.json").tables;
const opening = new WeakSet();

const DEFEATED_ATTRIBUTE = State.LEGACY_DEFEATED_ATTRIBUTE;
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

/** Validate every credited cache definition before consuming the casket. */
function validateDrops(drops) {
  const { ItemDefinition } = Shared.core();
  return drops.map(drop => {
    if (!Number.isSafeInteger(drop.itemId) || drop.itemId < 0 ||
        !Number.isSafeInteger(drop.amount) || drop.amount < 1 || typeof drop.noted !== "boolean") throw new Error("Invalid Mimic reward");
    const definition = ItemDefinition.forId(drop.itemId);
    if (!definition || definition === ItemDefinition.DEFAULT || definition.getId() !== drop.itemId) throw new Error(`Missing Mimic reward ${drop.itemId}`);
    const creditId = drop.noted ? definition.getNoteId() : drop.itemId;
    if (!Number.isInteger(creditId) || drop.noted && creditId <= 0) throw new Error(`Missing noted Mimic reward ${drop.itemId}`);
    const creditDefinition = ItemDefinition.forId(creditId);
    if (!creditDefinition || creditDefinition === ItemDefinition.DEFAULT || creditDefinition.getId() !== creditId) throw new Error(`Missing Mimic reward definition ${creditId}`);
    return { ...drop, creditId, stackable: creditDefinition.isStackable() };
  });
}

/** Grant rewards, dropping overflow at the player; return totals for the loot window. */
function give(player, drops) {
  const { Item } = Shared.core();
  const credited = new Map();
  const inventory = player.getInventory();
  for (const { itemId, amount, creditId: id, stackable } of drops) {
    if (stackable) inventory.forceAdd(player, new Item(id, amount));
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
  if (opening.has(player)) return;
  if (inFightArea(player)) {
    player.sendMessage("It'd be bad taste to try opening that in here.");
    return;
  }
  const inventory = player.getInventory();
  const slot = Number.isInteger(event.slot) ? event.slot : Shared.mimicSlot(player);
  const item = inventory.getItems()[slot];
  if (item?.getId?.() !== Shared.ids().CASKET_ITEM || item.getAmount() !== 1 || event.item && event.item !== item) return;
  const casket = Shared.rewardState(player, item);
  if (!casket.defeated) {
    player.sendMessage("Visit the Strange Casket, upstairs in Watson's house in Hosidius, to attempt the Mimic's challenge.");
    return;
  }
  if (casket.attemptsLeft < 1) {
    player.sendMessage("Visit the Strange Casket, upstairs in Watson's house in Hosidius, to attempt the Mimic's challenge.");
    return;
  }
  opening.add(player);
  try {
    let drops, extra;
    try {
      const request = { player, tier: casket.tier, rolls: casket.normalRolls, drops: null, handled: false, error: null };
      pluginApi.emitCustomEvent("treasure-trails:roll-casket", request);
      if (!request.handled || !Array.isArray(request.drops) || request.error) throw request.error ?? new Error("Casket reward service unavailable");
      const bonus = Pool.roll(BONUS_TABLES, casket.tier, casket.attemptsLeft);
      drops = validateDrops([...request.drops, ...bonus]);
      const first = bonus.find(drop => drop.itemId !== Shared.ids().PLANK);
      const name = Shared.core().ItemDefinition.forId(first.itemId).getName();
      extra = `The Mimic adds a little extra reward for you: <col=ff0000>${first.amount} x ${name}</col>`;
    } catch (error) {
      event.error = error;
      player.sendMessage("You can't open this casket right now.");
      return;
    }
    // A service callback may have replaced or moved the clicked item.
    if (inventory.getItems()[slot] !== item) return;
    inventory.deleteAtSlot(slot, 1);
    State.forget(player, casket.id);
    player.setAttribute(DEFEATED_ATTRIBUTE, false);
    const stacks = give(player, drops);
    player.sendMessage(extra);
    showLoot(player, stacks);
  } finally {
    opening.delete(player);
  }
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
