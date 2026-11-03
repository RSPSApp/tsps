"use strict";

/**
 * Tombs of Amascut: Osmumten's burial chamber. Loot is rolled as the party arrives; each
 * player's chest opens the reward interface (771) to take, bank or discard it, and the
 * spirit sees them out. Loot left behind waits in the lobby's retrieval chest.
 *
 * A unique (Wiki) turns the flames around Osmumten's sarcophagus purple, and its finder opens
 * the sarcophagus to reveal it. The cache drives the whole vault from TOA_VAULT_SARCOPHAGUS (14373).
 *
 * Captured:
 * - The vault's varbits are set the tick the Wardens fall (toa_vault_*, 227/01852 tick 12909) and
 *   again on arriving (tick 12926). The finder's is 3 and everyone else's 1 when there's a unique,
 *   both purple; 0 without one. TOA_VAULT_CHEST_n: 2 for your own chest with loot, 4 (emptied, the
 *   multiloc's Search) for every other, and for all eight if you're the finder (227/01762 tick 22261).
 * - The reveal (227/01762 ticks 22296-22322, 227/00554 tick 13181): Open walks up; the opened
 *   sarcophagus (toa_vault_sarcophagus_open) replaces it; a tick later toa_osmumten_chest_reveal
 *   plays; 7 ticks later toa_osmumten_chest_open, and the loot appears a tile north (toa_vault_loot01;
 *   Leagues worlds' copy is toa_vault_loot01_voucher); 7 ticks later "<name> found something special"
 *   and the item's own spin (fx_cycle_*). Search then opens toa_chests with the unique and the
 *   tertiaries together (227/00554 tick 13206); taking it all removes the loot.
 * - The interface's menu is Take, Take-5, Take-All, Take-X (script 149).
 * Estimate: which tile each party slot's chest stands on: slots follow the party's order.
 */

const Shared = require("./Shared.TombsOfAmascut");
const Raid = require("./RaidState.TombsOfAmascut");
const Rewards = require("./Loot.TombsOfAmascut");

/** The departing spirit and the burial chamber's chests: unnamed in the cache, no constants. */
const SPIRIT = 11829;
const SPIRIT_SPOT = { x: 3680, y: 5143, z: 0 };
const CHEST_IDS = new Set([46217, 44545, 46215, 46219, 46218, 44547, 29994, 46216]);
/** toa_rewards_chest_lobby and its forms: the Rewards Niche (Wiki), by TOA_SHOULD_HAVE_LOOT. */
const LOBBY_NICHE_IDS = new Set([46224, 46082, 46083]);

const LOOT_INVENTORY = 811;
const LOOT_COMPONENT = { BANK_ALL: 4, INVENTORY_ALL: 6, DISCARD_ALL: 8, ITEMS: 10 };
const LOOT_ITEMS_UID = (Shared.INTERFACE.LOOT << 16) | LOOT_COMPONENT.ITEMS;
const SCRIPT_ITEM_OPS = 149;
/**
 * TOA_SHOULD_HAVE_LOOT: chest 46224 is a False Door at 0 and a Rewards Niche (Claim) at 1.
 * (14139, used before, is a PvP Arena loadout varbit.)
 */
const VARBIT_CHEST_FULL = 14319;
const OP10 = 1 << 10;

/** TOA_VAULT_SARCOPHAGUS: 0 the standard vault, 1 purple (and the sarcophagus can be opened). */
const VARBIT_SARCOPHAGUS = 14373;
const SARCOPHAGUS = { id: 46220, x: 3679, y: 5140, z: 0, face: 2 };
const SARCOPHAGUS_IDS = new Set([46220, 44825, 44826, 44934]); // the parent, closed, purple, opened
const OPENED_SARCOPHAGUS = 44934;
const ANIMATION = { REVEAL: 9505, OPEN: 9506 }; // TOA_OSMUMTEN_CHEST_REVEAL / _OPEN
const REVEAL_DELAY_TICKS = 1;
const REVEAL_ANIMATION_TICKS = 7;
const REVEAL_SPIN_TICKS = 7;
const LOOT_LOC = { id: 44935, x: 3679, y: 5141, z: 0, face: 2 };
const LOOT_GONE = 29733; // invisible_type8_nonblocking, 227/01762 tick 22322
/** fx_cycle_*: each unique's spin on the loot loc. */
const LOOT_SPIN = { MASK: 9509, BODY: 9510, CHAPS: 9511, FANG: 9512, WARD: 9513, SHADOW: 9514, LIGHTBEARER: 9508 };

/**
 * The vault's eight chests (TOA_VAULT_CHEST_LOC0-7), one per party slot, each with its varbit
 * (TOA_VAULT_CHEST_0-7): 2 shows the slot's player their own chest with loot, 4 their emptied
 * one; anything else is someone else's chest.
 */
const SLOT_CHESTS = [
  [29994, 14356], [44545, 14357], [44547, 14358], [46215, 14359],
  [46216, 14360], [46217, 14370], [46218, 14371], [46219, 14372],
];
const CHEST_STATE = { MINE: 2, EMPTY: 4 };
const SARCOPHAGUS_STATE = { NONE: 0, SOMEONE_ELSES: 1, MINE: 3 };

class RewardRoom extends Raid.Room {
  build() {
    const spirit = this.spawn(SPIRIT, SPIRIT_SPOT, { scale: false, points: 0, face: 1 });
    if (spirit) {
      spirit.__toaScripted = true;
      spirit.getMovementQueue().setBlockMovement(true);
    }
    this.opening = false;
    rollLoot(this.raid);
  }

  onPlayerArrive(player) {
    sendChests(player);
  }

  /** The finder opens the sarcophagus: it slides open, then the unique joins their loot. */
  openSarcophagus(player) {
    const raid = this.raid;
    if (raid.sarcophagusOwner !== player) {
      player.sendMessage(raid.sarcophagusOwner
        ? `This sarcophagus holds ${Shared.displayName(raid.sarcophagusOwner)}'s reward.`
        : "The sarcophagus is sealed shut.");
      return;
    }
    if (this.opening) return;
    if (raid.sarcophagusOpened || Rewards.sealedUnique(player) === -1) {
      openLoot(player);
      return;
    }
    this.opening = true;
    const movement = player.getMovementQueue();
    movement.reset();
    player.setPositionToFace(Shared.loc(SARCOPHAGUS));
    // Every form of the sarcophagus shares one model: the lid is moved only by animations.
    raid.sarcophagusOpened = true;
    this.setObject(OPENED_SARCOPHAGUS, SARCOPHAGUS, 10, SARCOPHAGUS.face);
    this.later(REVEAL_DELAY_TICKS, () => this.animateLoc(OPENED_SARCOPHAGUS, SARCOPHAGUS, ANIMATION.REVEAL));
    this.later(REVEAL_DELAY_TICKS + REVEAL_ANIMATION_TICKS, () => {
      // The open loop from here on, so a reloaded scene shows it open rather than opening.
      this.animateLoc(OPENED_SARCOPHAGUS, SARCOPHAGUS, ANIMATION.OPEN);
      this.setObject(LOOT_LOC.id, LOOT_LOC, 10, LOOT_LOC.face);
    });
    this.later(REVEAL_DELAY_TICKS + REVEAL_ANIMATION_TICKS + REVEAL_SPIN_TICKS, () => {
      this.opening = false;
      if (!raid.players.includes(player)) return; // the lobby's niche has it
      const unique = Rewards.unsealUnique(player);
      if (unique === -1) return;
      this.animateLoc(LOOT_LOC.id, LOOT_LOC, lootSpin(unique));
      announceUnique(raid, player, unique);
      raid.sarcophagusRevealed = true;
      sendChests(player);
    });
  }

  animateLoc(id, tile, animation) {
    const { GameObject, Animation } = Shared.core();
    const object = new GameObject(id, Shared.loc(tile), 10, tile.face, null);
    for (const viewer of this.roomPlayers()) viewer.getPacketSender().sendObjectAnimation(object, new Animation(animation));
  }

  /** The finder took everything from the opened sarcophagus: the spinning item goes. */
  lootTaken() {
    if (this.raid.sarcophagusRevealed) this.setObject(LOOT_GONE, LOOT_LOC, 10, 0);
  }
}

function lootSpin(unique) {
  const I = Shared.core().ItemIdentifiers;
  const spins = {
    [I.MASORI_MASK]: LOOT_SPIN.MASK, [I.MASORI_BODY]: LOOT_SPIN.BODY, [I.MASORI_CHAPS]: LOOT_SPIN.CHAPS,
    [I.OSMUMTENS_FANG]: LOOT_SPIN.FANG, [I.ELIDINIS_WARD]: LOOT_SPIN.WARD,
    [I.TUMEKENS_SHADOW_UNCHARGED_]: LOOT_SPIN.SHADOW, [I.LIGHTBEARER]: LOOT_SPIN.LIGHTBEARER,
  };
  return spins[unique] ?? LOOT_SPIN.FANG;
}

/** Once, the tick the Wardens fall (or as the chamber is built, for a skip). */
function rollLoot(raid) {
  if (raid.lootRolled) return;
  raid.lootRolled = true;
  raid.chestSlots = new Map(raid.players.map((player, slot) => [player, slot]));
  const { uniqueWinner, petWinner } = Rewards.rollRaidLoot(raid);
  // The party hears of the unique when its finder claims it (announceUnique).
  if (uniqueWinner) raid.sarcophagusOwner = uniqueWinner;
  if (petWinner) raid.broadcast(`<col=ff0000>${Shared.displayName(petWinner)} has a funny feeling like they would have been followed...</col>`);
  for (const player of raid.players) sendChests(player);
}

function raidWon({ raid }) {
  rollLoot(raid);
}

/** As in OSRS, the party hears of a unique once its finder claims it. */
function announceUnique(raid, player, itemId) {
  const name = Shared.core().ItemDefinition.forId(itemId)?.getName?.() ?? "something";
  const message = `<col=ef1020>${Shared.displayName(player)}</col> found something special: <col=ef1020>${name}</col>`;
  if (raid) raid.broadcast(message);
  else player.sendMessage(message);
}

/** Shows the player their own chest (with loot, or emptied) among the party's. */
function sendChests(player) {
  const raid = Raid.raidOf(player);
  const sender = player.getPacketSender();
  sender.sendVarbit(VARBIT_CHEST_FULL, Rewards.hasRewards(player) ? 1 : 0);
  const finder = raid?.sarcophagusOwner === player;
  const owner = raid?.sarcophagusOwner;
  sender.sendVarbit(VARBIT_SARCOPHAGUS, !owner ? SARCOPHAGUS_STATE.NONE : finder ? SARCOPHAGUS_STATE.MINE : SARCOPHAGUS_STATE.SOMEONE_ELSES);
  const slot = raid?.chestSlots?.get(player);
  SLOT_CHESTS.forEach(([, varbit], index) => {
    sender.sendVarbit(varbit, index === slot && !finder && Rewards.hasLoot(player) ? CHEST_STATE.MINE : CHEST_STATE.EMPTY);
  });
}

// ------------------------------------------------------------------ the loot interface

function openLoot(player) {
  const loot = Rewards.lootOf(player);
  if (loot.length === 0) {
    Shared.statement(player, "There is nothing to claim.");
    player.getPacketSender().sendVarbit(VARBIT_CHEST_FULL, 0);
    return;
  }
  Rewards.logClaimed(player);
  const sender = player.getPacketSender();
  sendLoot(player, loot);
  sender.sendInterface(Shared.INTERFACE.LOOT);
  sender.sendClientScript(SCRIPT_ITEM_OPS, LOOT_ITEMS_UID, LOOT_INVENTORY, 2, 3, 0, -1, "Take", "Take-5", "Take-All", "Take-X", "");
  sender.sendInterfaceFlagsRange(LOOT_ITEMS_UID, 0, Rewards.LOOT_SLOTS - 1,
    Shared.EVENT.OP1 | Shared.EVENT.OP2 | Shared.EVENT.OP3 | Shared.EVENT.OP4 | OP10);
}

function sendLoot(player, loot) {
  player.getPacketSender().sendInventory(LOOT_INVENTORY, Rewards.LOOT_SLOTS, loot.map(({ id, amount }) => ({ id, amount })));
  const room = Raid.raidOf(player)?.roomFor(player);
  if (room?.key === "REWARD") {
    sendChests(player);
    if (loot.length === 0) room.lootTaken();
  } else if (loot.length === 0) {
    player.getPacketSender().sendVarbit(VARBIT_CHEST_FULL, 0);
  }
}

function bankFor(player, id) {
  const { Bank } = Shared.core();
  for (let tab = 0; tab < Bank.TOTAL_BANK_TABS; tab++) {
    if (tab !== Bank.BANK_SEARCH_TAB_INDEX && player.getBank(tab).contains(id)) return player.getBank(tab);
  }
  const preferred = player.getBank(Bank.getTabForItem(player, id));
  if (preferred.getFreeSlots() > 0) return preferred;
  for (let tab = 0; tab < Bank.TOTAL_BANK_TABS; tab++) {
    if (tab !== Bank.BANK_SEARCH_TAB_INDEX && player.getBank(tab).getFreeSlots() > 0) return player.getBank(tab);
  }
  return null;
}

/** Moves up to `amount` of one loot slot into the inventory or bank; returns how many moved. */
function take(player, entry, amount, destination) {
  const { Item, ItemDefinition } = Shared.core();
  const wanted = Math.max(0, Math.min(entry.amount, amount));
  if (wanted === 0) return 0;
  if (destination === "bank") {
    const bank = bankFor(player, entry.id);
    if (!bank) {
      player.sendMessage("You need more space in your bank.");
      return 0;
    }
    bank.add(new Item(entry.id, wanted), false);
    return wanted;
  }
  const inventory = player.getInventory();
  const stackable = ItemDefinition.forId(entry.id)?.isStackable?.() === true;
  const moved = stackable ? (inventory.contains(entry.id) || inventory.getFreeSlots() > 0 ? wanted : 0)
    : Math.min(wanted, inventory.getFreeSlots());
  if (moved <= 0) {
    player.sendMessage("You don't have enough inventory space.");
    return 0;
  }
  inventory.add(new Item(entry.id, moved), false);
  inventory.refreshItems();
  return moved;
}

function takeAll(player, destination) {
  const loot = Rewards.lootOf(player);
  if (loot.length === 0) {
    player.sendMessage(`There is nothing to ${destination === "bank" ? "bank" : "put in your inventory"}.`);
    return;
  }
  const left = [];
  for (const entry of loot) {
    entry.amount -= take(player, entry, entry.amount, destination);
    if (entry.amount > 0) left.push(entry);
  }
  Rewards.setLoot(player, left);
  sendLoot(player, left);
}

/**
 * The buttons work only while the loot is on screen. Played over the MCP: a Take-All click sent from
 * the Wardens' room, the chest never opened, took the loot.
 */
function lootOpen(player) {
  return player.getPacketSender().isSubInterfaceOpen(Shared.INTERFACE.LOOT);
}

function clickBankAll({ player }) {
  if (lootOpen(player)) takeAll(player, "bank");
}

function clickInventoryAll({ player }) {
  if (lootOpen(player)) takeAll(player, "inventory");
}

function clickDiscardAll({ player }) {
  if (!lootOpen(player)) return;
  if (!Rewards.hasLoot(player)) {
    player.sendMessage("There is nothing to discard.");
    return;
  }
  Shared.options(player, "Are you sure you want to discard everything?",
    "No.", () => openLoot(player),
    "Yes.", () => {
      Rewards.setLoot(player, []);
      sendLoot(player, []);
    });
}

/** Take / Take-5 / Take-10 / Take-All on one slot. */
function clickLootItem(event) {
  const { player } = event;
  if (!lootOpen(player)) return;
  const loot = Rewards.lootOf(player);
  const slot = Number.isInteger(event.slot) ? event.slot : -1;
  const entry = loot[slot];
  if (!entry) return;
  const op = event.opId ?? event.action;
  if (op === 4) {
    player.setEnteredAmountAction({ execute: (value) => takeSome(player, loot, slot, value | 0) });
    player.getPacketSender().sendEnterAmountPrompt("Enter amount:");
    return;
  }
  takeSome(player, loot, slot, op === 2 ? 5 : op === 3 ? entry.amount : 1);
}

function takeSome(player, loot, slot, amount) {
  const entry = loot[slot];
  if (!entry) return;
  entry.amount -= take(player, entry, amount, "inventory");
  if (entry.amount <= 0) loot.splice(slot, 1);
  Rewards.setLoot(player, loot);
  sendLoot(player, loot);
}

// ------------------------------------------------------------------ objects and the spirit

function openChest(event) {
  const { player } = event;
  const id = event.objectId;
  const room = Raid.raidOf(player)?.roomFor(player);
  const inReward = room?.key === "REWARD" && !room.destroyed;
  if (inReward && SARCOPHAGUS_IDS.has(id)) {
    event.handled = true;
    room.openSarcophagus(player);
    return;
  }
  const atLobby = LOBBY_NICHE_IDS.has(id) && Shared.inLobby(player.getLocation());
  if (!(CHEST_IDS.has(id) && inReward) && !atLobby) return;
  event.handled = true;
  if (atLobby) {
    // A sarcophagus left unopened hands its unique over with the rest of the loot.
    const unique = Rewards.unsealUnique(player);
    if (unique !== -1) announceUnique(Raid.raidOf(player), player, unique);
    if (!Rewards.hasLoot(player)) {
      Shared.statement(player, "There is nothing to collect.");
      return;
    }
  }
  const slotChest = SLOT_CHESTS.findIndex(([chestId]) => chestId === id);
  const slot = room?.raid?.chestSlots?.get(player);
  if (inReward && slotChest !== -1 && slot !== undefined && slotChest !== slot) {
    player.sendMessage("That chest belongs to someone else.");
    return;
  }
  openLoot(player);
}

/**
 * ITT_MET_OSMUMTEN picks the vault spirit's form (cache multinpc): 0 the Spirit, whose first meeting
 * the dialogue data plays (227/00101 ticks 13280-13288), 2 Osmumten with Leave (227/01852 tick 12993).
 */
const VARBIT_MET_OSMUMTEN = 14464;
/** toa_osmumten_vault and its three forms (vis_0-2). */
const VAULT_SPIRITS = new Set([SPIRIT, 11691, 11692, 11693]);
const MET_OSMUMTEN = 2;
const ATTR_MET_OSMUMTEN = "toa:met-osmumten";

function sendMetOsmumten({ player }) {
  if (player.getAttribute(ATTR_MET_OSMUMTEN)) player.getPacketSender().sendVarbit(VARBIT_MET_OSMUMTEN, MET_OSMUMTEN);
}

/** The first meeting (227/00101 ticks 13282-13288), then the way out. */
const FIRST_MEETING = [
  ["npc", "You. You fought against the Devourer. Her influence here has been lessened as a result. You are to be commended for your strength."],
  ["player", "I take it you're Osmumten?"],
  ["npc", "Once, but who I was in life means nothing. Vengeance is all that matters now. The Devourer may be gone, but my home has been corrupted. This corruption must be purged."],
  ["player", "Can I help?"],
  ["npc", "You can. Take your prize and leave, but when you are ready, return here. The Devourer's thralls will soon be back. You must fight them."],
  ["player", "I'll do what I can."],
  ["npc", "We shall see if it is enough."],
];

/**
 * The vault's spirit (Talk-to, or Leave once met). The dialogue data has the first meeting too, but
 * its "Yes." can't take anyone out, so this unit plays it; Raid's Osmumten hook leaves it alone here.
 */
function talkToSpirit(event) {
  if (event.handled || !VAULT_SPIRITS.has(event.npcId)) return;
  const { player } = event;
  const raid = Raid.raidOf(player);
  if (!raid || raid.roomFor(player)?.key !== "REWARD") return;
  event.handled = true;
  if (player.getAttribute(ATTR_MET_OSMUMTEN)) {
    askToLeave(player, raid);
    return true;
  }
  const { DialogueChainBuilder, NpcDialogue, PlayerDialogue, ActionDialogue } = Shared.core();
  player.sendMessage("As you approach the spirit, you hear a voice echoing in your head.");
  const chain = FIRST_MEETING.map(([who, text], index) => (who === "npc" ? new NpcDialogue(index, SPIRIT, text) : new PlayerDialogue(index, text)));
  chain.push(new ActionDialogue(FIRST_MEETING.length, { execute: () => askToLeave(player, raid) }));
  player.getDialogueManager().startDialogues(new DialogueChainBuilder().add(...chain));
  player.setAttribute(ATTR_MET_OSMUMTEN, 1);
  sendMetOsmumten({ player });
  return true;
}

function askToLeave(player, raid) {
  Shared.options(player, "Are you ready to leave the Tombs of Amascut?",
    "Yes.", () => {
      if (!Raid.raidOf(player)) return;
      player.sendMessage("You leave the Tombs of Amascut.");
      if (Rewards.hasRewards(player)) player.sendMessage("Your unclaimed rewards can be collected from the chest in the lobby.");
      raid.leave(player, { teleport: true });
    },
    "No.", () => {});
}

module.exports = function registerTombsRewards(api) {
  Shared.bind(api);
  Raid.registerRoom("REWARD", RewardRoom);
  api.onObjectInteraction(openChest);
  api.onCustomEvent("toa:raid-won", raidWon);
  api.onNpcInteraction(talkToSpirit);
  api.onInterfaceActionButton((Shared.INTERFACE.LOOT << 16) | LOOT_COMPONENT.BANK_ALL, clickBankAll);
  api.onInterfaceActionButton((Shared.INTERFACE.LOOT << 16) | LOOT_COMPONENT.INVENTORY_ALL, clickInventoryAll);
  api.onInterfaceActionButton((Shared.INTERFACE.LOOT << 16) | LOOT_COMPONENT.DISCARD_ALL, clickDiscardAll);
  api.onInterfaceActionButton(LOOT_ITEMS_UID, clickLootItem);
  api.persistAttribute(Rewards.ATTR_LOOT);
  api.persistAttribute(Rewards.ATTR_THREAD);
  api.persistAttribute(Rewards.ATTR_SARCOPHAGUS);
  api.persistAttribute(ATTR_MET_OSMUMTEN, 0);
  api.onPlayerLogin(sendMetOsmumten);
};
