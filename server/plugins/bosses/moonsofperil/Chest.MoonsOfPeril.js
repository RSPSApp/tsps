/**
 * The Lunar Chest in the Ancient Shrine, and Eyatlalli's offerings (docs/moons-of-peril.md), data
 * `chest` and `eyatlalli`. As captured, Claim on the chest (chest_sun01_default01):
 * - clears every subdued Moon's varbit, says "Your Lunar Chest count is: <col=ff0000>N</col>."
 *   (the Combat Achievements kill count of the Moons of Peril, varp total_pmoon_chests), turns the
 *   chest open for the player (chest_sun01_open01), fills pmoon_rewardinv and opens pmoon_reward
 *   with sound 2655: Withdraw-1, Withdraw-all and Take-all ("You take the items from the chest."
 *   once it is empty), Bank-all ("You deposit your items into the bank.") and Discard-all.
 * - The loot (Wiki): each Moon subdued is its own 1/56 roll for a piece of its set, never one the
 *   player has until they have the whole set; only when none hits, 1, 3 or 6 rolls on the
 *   standard table for one, two or three Moons. Loot left in the chest waits for the next Claim.
 * Eyatlalli (Wiki): an undamaged Moon armour piece used on her is sacrificed for a 1/50 chance at
 * any of the twelve pieces (no duplicate protection); sulphurous essence gives 50 Runecraft xp each.
 */
const Common = require("./Common.MoonsOfPeril");
const Scoreboard = require("./Scoreboard.MoonsOfPeril");

/** What is waiting in the chest: [{ id, amount }]. */
const CHEST_ATTRIBUTE = "moons-of-peril:chest";
/** Each set's pieces already given since the set was last completed: { blood: [names], ... }. */
const PIECES_ATTRIBUTE = "moons-of-peril:set-pieces";
/** The player's own Lunar Chest count (Combat Achievements keeps its copy). */
const COUNT_ATTRIBUTE = Scoreboard.CHESTS_ATTRIBUTE;

const MONSTER = "Moons of Peril";

const chest = () => Common.data.chest;
const itemId = (name) => Common.core.ItemIdentifiers[name];
const uid = (component) => (chest().interface << 16) | component;
const OPS = (1 << 1) | (1 << 2) | (1 << 10);

function contents(player) {
  const items = player.getAttribute(CHEST_ATTRIBUTE);
  return Array.isArray(items) ? items.filter((entry) => entry && entry.amount > 0) : [];
}

function setContents(player, items) {
  const left = items.filter((entry) => entry.amount > 0);
  player.setAttribute(CHEST_ATTRIBUTE, left.length > 0 ? left : null);
}

// ------------------------------------------------------------------ the loot

function weighted(table) {
  const total = table.reduce((sum, entry) => sum + entry.weight, 0);
  let roll = Math.random() * total;
  for (const entry of table) {
    roll -= entry.weight;
    if (roll < 0) return entry;
  }
  return table[table.length - 1];
}

/** A piece of the Moon's set the player hasn't had since last completing it (Wiki). */
function piece(player, moon) {
  const set = chest().sets[moon];
  const owned = { ...(player.getAttribute(PIECES_ATTRIBUTE) ?? {}) };
  let had = Array.isArray(owned[moon]) ? owned[moon] : [];
  if (had.length >= set.length) had = [];
  const name = Common.pick(set.filter((entry) => !had.includes(entry)));
  owned[moon] = [...had, name];
  player.setAttribute(PIECES_ATTRIBUTE, owned);
  return name;
}

function roll(player, moons) {
  const spec = chest();
  const { ItemDefinition } = Common.core;
  const loot = [];
  const add = (id, amount) => {
    const same = loot.find((entry) => entry.id === id);
    if (same) same.amount += amount;
    else loot.push({ id, amount });
  };
  for (const moon of moons) {
    if (Common.randomInt(1, spec.uniqueChance) === 1) add(itemId(piece(player, moon)), 1);
  }
  if (loot.length > 0) return loot;
  for (let i = 0; i < spec.rolls[moons.length]; i++) {
    const entry = weighted(spec.table);
    let id = itemId(entry.item);
    if (entry.noted) id = ItemDefinition.forId(id).getNoteId?.() > 0 ? ItemDefinition.forId(id).getNoteId() : id;
    add(id, Common.randomInt(entry.min, entry.max));
  }
  return loot;
}

// ------------------------------------------------------------------ the chest

function claim({ player, objectId, object }) {
  const spec = chest();
  if (objectId !== spec.loc && objectId !== spec.openLoc) return false;
  if (contents(player).length > 0) {
    open(player, object);
    return true;
  }
  const moons = Common.MOONS.filter((moon) => Common.isDead(player, moon));
  if (moons.length === 0) {
    player.sendMessage(spec.noMoons);
    return true;
  }
  for (const moon of moons) Common.setDead(player, moon, false);
  count(player);
  const loot = roll(player, moons);
  for (const entry of loot) {
    Common.api.emitCustomEvent("collection-log:obtain", { player, itemId: unnoted(entry.id), amount: entry.amount });
  }
  setContents(player, loot);
  open(player, object);
  return true;
}

function unnoted(id) {
  const definition = Common.core.ItemDefinition.forId(id);
  return definition?.isNoted?.() ? definition.getNoteId() : id;
}

/** One more chest: the count message first, as live sends it (Combat Achievements announces it). */
function count(player) {
  const next = (Number(player.getAttribute(COUNT_ATTRIBUTE)) || 0) + 1;
  player.setAttribute(COUNT_ATTRIBUTE, next);
  Scoreboard.chestOpened();
  const request = {
    player, monster: MONSTER, count: next,
    announce: (total) => player.sendMessage(chest().countMessage.replace("{count}", total)),
  };
  Common.api.emitCustomEvent("combat-achievements:kill", request);
  if (request.total === undefined) {
    player.sendMessage(chest().countMessage.replace("{count}", next));
    player.getPacketSender().sendConfig(chest().countVarp, next);
  }
}

/** pmoon_reward over pmoon_rewardinv, as captured. */
function open(player, object) {
  const spec = chest();
  const sender = player.getPacketSender();
  if (object?.getLocation) {
    Common.addLoc(player, Common.personalLoc(spec.openLoc, object.getLocation(), object.getType?.() ?? 10, object.getFace?.() ?? 0));
  }
  Common.sound(player, spec.openSound);
  refresh(player);
  sender.sendInterface(spec.interface);
  sender.sendClientScript(INV_INIT_SCRIPT, uid(spec.components.items), spec.inventory, 3, 2, 0, -1, "Withdraw-1", "Withdraw-all", "", "", "");
  sender.sendInterfaceFlagsRange(uid(spec.components.items), 0, spec.size - 1, OPS);
}

/** interface_inv_init: the reward grid's slots, rows and ops. */
const INV_INIT_SCRIPT = 149;

function refresh(player) {
  const spec = chest();
  player.getPacketSender().sendInventory(spec.inventory, spec.size, contents(player).slice(0, spec.size));
}

function close(player) {
  player.getPacketSender().sendInterfaceRemoval();
}

/** Into the inventory: all of it, or as much as there is room for. */
function take(player, entry, amount) {
  const { Item } = Common.core;
  const inventory = player.getInventory();
  const room = inventory.getAddableAmount(new Item(entry.id, amount));
  if (room <= 0) {
    inventory.full?.();
    return 0;
  }
  inventory.add(new Item(entry.id, room), true);
  return room;
}

function withdraw(event) {
  const { player, slot } = event;
  const items = contents(player);
  const entry = items[slot];
  if (!entry) return true;
  const op = Number(event.opId ?? event.action);
  if (op === 10) {
    player.sendMessage(Common.core.ItemDefinition.forId(entry.id)?.getExamine?.() ?? "");
    return true;
  }
  const moved = take(player, entry, op === 1 ? 1 : entry.amount);
  entry.amount -= moved;
  setContents(player, items);
  if (contents(player).length === 0) {
    player.sendMessage(chest().takeMessage);
    close(player);
    return true;
  }
  refresh(player);
  return true;
}

/** Take-all: everything there is room for, into the inventory. */
function takeAll({ player }) {
  const items = contents(player);
  for (const entry of items) entry.amount -= take(player, entry, entry.amount);
  setContents(player, items);
  if (contents(player).length > 0) {
    refresh(player);
    return true;
  }
  player.sendMessage(chest().takeMessage);
  close(player);
  return true;
}

/** Discard-all's Yes (the client asks first): the loot is gone for good. */
function discardAll({ player }) {
  setContents(player, []);
  close(player);
  return true;
}

function bankFor(player, id) {
  const { Bank } = Common.core;
  for (let tab = 0; tab < Bank.TOTAL_BANK_TABS; tab++) {
    if (tab !== Bank.BANK_SEARCH_TAB_INDEX && player.getBank(tab).contains(id)) return player.getBank(tab);
  }
  for (let tab = 0; tab < Bank.TOTAL_BANK_TABS; tab++) {
    if (tab !== Bank.BANK_SEARCH_TAB_INDEX && player.getBank(tab).getFreeSlots() > 0) return player.getBank(tab);
  }
  return null;
}

function bankAll({ player }) {
  const { Item } = Common.core;
  const items = contents(player);
  for (const entry of items) {
    const bank = bankFor(player, unnoted(entry.id));
    if (!bank) continue;
    const room = bank.getAddableAmount(new Item(unnoted(entry.id), entry.amount));
    if (room <= 0) continue;
    bank.add(new Item(unnoted(entry.id), room), false);
    entry.amount -= room;
  }
  setContents(player, items);
  if (contents(player).length > 0) {
    player.sendMessage("You need more space in your bank.");
    refresh(player);
    return true;
  }
  player.sendMessage(chest().bankMessage);
  close(player);
  return true;
}

// ------------------------------------------------------------------ Eyatlalli

function armourPieces() {
  return Object.values(chest().sets).flatMap((set) => set.slice(1));
}

function allPieces() {
  return Object.values(chest().sets).flat();
}

/** By the name `player` sees: the shrine's Eyatlalli is a nameless parent (pmoon_eyatlalli_postquest). */
function isEyatlalli(npc, player) {
  return npc?.getDefinition?.()?.getName?.() === Common.data.eyatlalli.npc
    || npc?.getCurrentDefinition?.(player)?.getName?.() === Common.data.eyatlalli.npc;
}

function useOnEyatlalli(event) {
  const { player, target, itemId: used } = event;
  if (!isEyatlalli(target, player)) return;
  const { eyatlalli } = Common.data;
  if (used === itemId(eyatlalli.essence.item)) {
    event.handled = true;
    offerEssence(player);
    return;
  }
  const name = armourPieces().find((entry) => itemId(entry) === used);
  if (!name) return;
  event.handled = true;
  askSacrifice(player, name);
}

function offerEssence(player) {
  const { essence } = Common.data.eyatlalli;
  const id = itemId(essence.item);
  const amount = player.getInventory().getAmount(id);
  if (amount <= 0) return;
  player.getInventory().deleteNumber(id, amount);
  player.getSkillManager().addExperience(Common.core.Skill.RUNECRAFTING, essence.xp * amount, true);
  player.sendMessage(essence.message);
}

function itemName(id) {
  return Common.core.ItemDefinition.forId(id)?.getName?.() ?? "piece";
}

function askSacrifice(player, name) {
  const { sacrifice } = Common.data.eyatlalli;
  const { OptionDialogue, DialogueChainBuilder } = Common.core;
  const id = itemId(name);
  player.getDialogueManager().startDialogues(new DialogueChainBuilder().add(
    new OptionDialogue(0, {
      executeOption(option) {
        close(player);
        // Options come one-based (DialogueManager.handleResume): 1 is "Yes."
        if (Number(option) === 1) sacrificePiece(player, id);
      },
    }, ...sacrifice.options).setTitle(sacrifice.question.replace("{item}", itemName(id))),
  ));
}

function sacrificePiece(player, id) {
  const { sacrifice } = Common.data.eyatlalli;
  const { Item } = Common.core;
  if (!player.getInventory().contains(id)) return;
  player.getInventory().deleteNumber(id, 1);
  player.sendMessage(sacrifice.lost.replace("{item}", itemName(id)));
  if (Common.randomInt(1, sacrifice.chance) !== 1) return;
  const reward = itemId(Common.pick(allPieces()));
  player.getInventory().add(new Item(reward, 1), true);
  const name = itemName(reward);
  player.sendMessage(sacrifice.gained.replace("{article}", /^[aeiou]/i.test(name) ? "an" : "a").replace("{item}", name));
  Common.api.emitCustomEvent("collection-log:obtain", { player, itemId: reward, amount: 1 });
}

// ------------------------------------------------------------------ hooks

/** At login Combat Achievements catches up with the chests counted here. */
function answerKillCount(request) {
  const own = Number(request?.player?.getAttribute(COUNT_ATTRIBUTE)) || 0;
  if (own > 0) request.counts[MONSTER] = Math.max(Number(request.counts[MONSTER]) || 0, own);
}

module.exports = function attachChest(api) {
  api.persistAttribute(CHEST_ATTRIBUTE, null);
  api.persistAttribute(PIECES_ATTRIBUTE, null);
  api.persistAttribute(COUNT_ATTRIBUTE, 0);
  api.onObjectInteraction("Lunar Chest", { Claim: claim });
  api.onInterfaceActionButton(uid(chest().components.items), withdraw);
  api.onInterfaceActionButton(uid(chest().components.takeAll), takeAll);
  api.onInterfaceActionButton(uid(chest().components.bankAll), bankAll);
  api.onInterfaceActionButton(uid(chest().components.discardYes), discardAll);
  api.onItemOnNpc(useOnEyatlalli);
  api.onCustomEvent("combat-achievements:kill-count", answerKillCount);
};

Object.assign(module.exports, { roll, piece, contents });
