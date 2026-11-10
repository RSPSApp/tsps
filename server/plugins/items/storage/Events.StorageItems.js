/**
 * What every container shares (docs/storage-items.md): the `storage:*` events gatherers and
 * consumers emit, the bank panel's op9 and its Fill label (the container's param-595 op: "Empty", or "Use" for the
 * tackle box; captured on the herb sack and seed box, which move everything into the bank
 * silently), death, and Destroy.
 */
const Storage = require("./Common.StorageItems");

/** The bank panel's op that the cache labels with param 595. */
const BANK_OP = 9;

/**
 * `if4` (varp 264): one bit per inventory slot whose bank op the cache's script 2576 labels "Fill"
 * instead of its param-595 text (Wiki, Plank sack: since 27 August 2025 the op reads Fill or Empty
 * by whether the inventory has anything it takes).
 */
const BANK_FILL_VARP = 264;

function bankRefreshed({ player }) {
  let bits = 0;
  player.getInventory().getItems().forEach((item, slot) => {
    if (Storage.familyOf(item)?.bankFills?.(player)) bits |= 1 << slot;
  });
  const sender = player.getPacketSender();
  if (sender.getVarp(BANK_FILL_VARP) !== bits) sender.sendConfig(BANK_FILL_VARP, bits);
}

function bankOp(event) {
  if (event.op !== BANK_OP) return;
  const family = Storage.familyOf(event.item);
  if (!family?.bankEmpty) return;
  family.bankEmpty(event.player);
  event.handled = true;
}

/**
 * Containers other plugins hold (rune pouch, essence pouches, herb sack, seed box) answer this
 * with `containers.push({ holds(item), empty(player, item) -> [{ id, amount }], keptInPvp?,
 * toBankInPvp? })`. `empty` takes the contents out of the container and returns them.
 */
const DEATH_CONTAINERS_EVENT = "storage:death-containers";

let pluginApi = null;
/** A death's event is handled once, also when a retrieval hook runs this ahead of its own turn. */
const handledDeaths = new WeakSet();

function familyContainer(family) {
  const isOurs = (item) => family.names.includes(Storage.nameOf(item));
  return {
    holds: isOurs,
    empty(player) {
      const contents = Storage.contents(player, family);
      Storage.setContents(player, family, []);
      return contents;
    },
    keptInPvp: !family.emptiedOnPvpDeath,
    // A family's contents follow the last one carried when it heads for the floor (or a grave).
    follows: (event) => event.items.some(isOurs) && !event.untradeables.some(isOurs),
  };
}

function deathContainers() {
  const families = [...Storage.FAMILIES.values()].filter((family) => family.followsOnDeath).map(familyContainer);
  const query = { containers: [] };
  pluginApi?.emitCustomEvent(DEATH_CONTAINERS_EVENT, query);
  return [...families, ...query.containers];
}

/** The seed box's PvP death puts what the bank has room for there first. */
function intoBank(player, { id, amount }) {
  const { Bank, Item } = Storage.core;
  const bank = player.getBank(Bank.getTabForItem(player, id));
  const moved = Math.min(amount, bank.getAddableAmount(new Item(id, amount)));
  if (moved > 0) bank.add(new Item(id, moved), false);
  return amount - moved;
}

/**
 * What a death does with a container's contents (Wiki: Settings, "Always empty ... on death"):
 * - a PvP death always empties it, and the contents go to the killer with the rest of the loot;
 *   a fish barrel the death keeps keeps them;
 * - otherwise the contents stay in the container, kept or lost (a lost one goes to the grave
 *   with them). A fish barrel or tackle box heading for the floor takes them along.
 */
function deathDrops(event) {
  if (handledDeaths.has(event)) return;
  handledDeaths.add(event);
  const { player, killer } = event;
  const pvp = !!killer && killer !== player;
  const lost = new Set([...event.items, ...event.untradeables]);
  const carried = [...new Set([
    ...(player.getInventory?.()?.getValidItems?.() ?? []),
    ...(player.getEquipment?.()?.getValidItems?.() ?? []),
    ...lost,
  ])];
  for (const container of deathContainers()) {
    const held = carried.filter((item) => container.holds(item));
    if (held.length === 0) continue;
    const kept = held.some((item) => !lost.has(item));
    let empty;
    if (pvp) empty = !(container.keptInPvp && kept);
    else empty = container.follows?.(event) === true;
    if (!empty) continue;
    for (const item of held) {
      for (const entry of container.empty(player, item)) {
        const left = pvp && container.toBankInPvp ? intoBank(player, entry) : entry.amount;
        if (left > 0) event.items.push(new Storage.core.Item(entry.id, left));
      }
    }
  }
}

module.exports = (api) => {
  pluginApi = api;
  api.onCustomEvent("storage:contents", Storage.answerContents);
  api.onCustomEvent(Storage.ROOM_EVENT, Storage.answerRoom);
  api.onCustomEvent(Storage.GATHER_EVENT, Storage.answerGather);
  api.onCustomEvent(Storage.AMOUNT_EVENT, Storage.answerAmount);
  api.onCustomEvent(Storage.TAKE_EVENT, Storage.answerTake);
  api.onCustomEvent(Storage.core.Bank.INVENTORY_OP_EVENT, bankOp);
  api.onCustomEvent(Storage.core.Bank.REFRESHED_EVENT, bankRefreshed);
  api.onCustomEvent("destroy-item:destroyed", Storage.destroyed);
  api.onPlayerDeathDrops(deathDrops);
};

/** For a death-drops hook that takes the lost items before this one runs (a boss's deathbank). */
module.exports.deathDrops = deathDrops;
module.exports.DEATH_CONTAINERS_EVENT = DEATH_CONTAINERS_EVENT;
