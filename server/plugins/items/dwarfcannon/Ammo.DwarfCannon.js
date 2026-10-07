/**
 * Cannonballs (docs/dwarf-cannon.md): loading, "Fire", "Empty" and "Load X" as captured.
 * Granite balls go in first and must be used up before steel ones load (Wiki).
 */
const Cannon = require("./Common.DwarfCannon");
const Data = require("./Data.DwarfCannon");

/** Ours (not captured). */
const MESSAGE = {
  NOT_YOURS: "This isn't your cannon.",
  NO_BALLS: "You need to load the cannon with cannonballs first.",
  FULL: "Your cannon is already fully loaded.",
  NO_SPACE: "You need more inventory space to unload your cannon.",
};

/** Takes up to `amount` balls from the owner's inventory, granite first (Wiki). Returns how many. */
function loadFromInventory(cannon, amount) {
  const { player } = cannon;
  if (!player || cannon.gone) return 0;
  const Items = Cannon.core.ItemIdentifiers;
  const inventory = player.getInventory();
  let loaded = 0;
  const room = () => Math.min(Data.CAPACITY - Cannon.balls(cannon), amount - loaded);
  const granite = Math.min(room(), inventory.getAmount(Items.GRANITE_CANNONBALL));
  if (granite > 0) {
    inventory.delete(Items.GRANITE_CANNONBALL, granite);
    cannon.granite += granite;
    loaded += granite;
    player.sendMessage(`You load the cannon with ${granite} granite cannonball${granite === 1 ? "" : "s"}.`);
  }
  const steel = cannon.granite > 0 ? 0 : Math.min(room(), inventory.getAmount(Items.STEEL_CANNONBALL));
  if (steel > 0) {
    inventory.delete(Items.STEEL_CANNONBALL, steel);
    cannon.steel += steel;
    loaded += steel;
    player.sendMessage(`You load the cannon with ${steel} cannonball${steel === 1 ? "" : "s"}.`);
  }
  if (loaded > 0) {
    Cannon.save(cannon);
    Cannon.sendVars(cannon);
  }
  return loaded;
}

/** The player's own cannon at `object`; someone else's is refused, anything else falls through. */
function ownCannon(player, object) {
  const cannon = Cannon.cannonAt(object);
  if (!cannon) return null;
  if (cannon.owner !== player.getUsername()) {
    player.sendMessage(MESSAGE.NOT_YOURS);
    return false;
  }
  return cannon;
}

/** "Fire": tops the cannon up from the inventory, then starts it turning (captured). */
function fire({ player, object }) {
  const cannon = ownCannon(player, object);
  if (cannon === null) return false;
  if (!cannon) return true;
  loadFromInventory(cannon, Data.CAPACITY);
  if (Cannon.balls(cannon) === 0) {
    player.sendMessage(MESSAGE.NO_BALLS);
    return true;
  }
  if (!cannon.firing) {
    cannon.firing = true;
    // The firing flag goes out the next tick, and the barrel turns from the one after.
    cannon.firedAt = Cannon.core.World.getProcessCycle();
  }
  return true;
}

/** Stops firing; the flag clears the next tick (captured). */
function stopFiring(cannon) {
  cannon.firing = false;
  Cannon.later(1, () => cannon.player?.getPacketSender().sendConfig(Data.VARP.FIRING, 0));
}

/** "Empty": every ball back to the inventory, with the captured message. */
function empty({ player, object }) {
  const cannon = ownCannon(player, object);
  if (cannon === null) return false;
  if (!cannon) return true;
  if (!giveBalls(player, cannon)) return true;
  stopFiring(cannon);
  return true;
}

/** Puts the cannon's balls in the inventory; false (and a message) without room. */
function giveBalls(player, cannon) {
  const Items = Cannon.core.ItemIdentifiers;
  const inventory = player.getInventory();
  const needed = [[Items.STEEL_CANNONBALL, cannon.steel], [Items.GRANITE_CANNONBALL, cannon.granite]]
    .filter(([id, amount]) => amount > 0 && !inventory.contains(id)).length;
  if (inventory.getFreeSlots() < needed) {
    player.sendMessage(MESSAGE.NO_SPACE);
    return false;
  }
  for (const [id, amount, name] of [[Items.STEEL_CANNONBALL, cannon.steel, "Steel cannonball"], [Items.GRANITE_CANNONBALL, cannon.granite, "Granite cannonball"]]) {
    if (amount <= 0) continue;
    inventory.add(new Cannon.core.Item(id, amount), true);
    player.sendMessage(`You unload your cannon and receive ${name} x ${amount}.`);
  }
  cannon.steel = 0;
  cannon.granite = 0;
  Cannon.save(cannon);
  Cannon.sendVars(cannon);
  return true;
}

/** "Load X": the first time asks how many; after that, loads that many (captured). */
function loadX({ player, object }) {
  const cannon = ownCannon(player, object);
  if (cannon === null) return false;
  if (!cannon) return true;
  const amount = Number(player.getAttribute(Cannon.LOAD_X_ATTRIBUTE) ?? 0);
  if (amount > 0) {
    if (Cannon.balls(cannon) >= Data.CAPACITY) player.sendMessage(MESSAGE.FULL);
    else if (loadFromInventory(cannon, amount) === 0) player.sendMessage(MESSAGE.NO_BALLS);
    return true;
  }
  askLoadX(player);
  return true;
}

function askLoadX(player) {
  const sender = player.getPacketSender();
  sender.sendVarbit(Data.VARBIT.BUSY, 1);
  player.setEnteredAmountAction({ execute: (amount) => setLoadX(player, amount) });
  sender.sendEnterAmountPrompt(`Set load-x cannonballs (1 - ${Data.CAPACITY}):`);
}

function setLoadX(player, entered) {
  player.getPacketSender().sendVarbit(Data.VARBIT.BUSY, 0);
  if (!Number.isInteger(entered) || entered <= 0) return;
  const amount = Math.min(Data.CAPACITY, entered);
  player.setAttribute(Cannon.LOAD_X_ATTRIBUTE, amount);
  player.getPacketSender().sendVarbit(Data.VARBIT.LOAD_X, amount);
  player.sendMessage(`You will now load ${amount} cannonballs when using Load-x.`);
}

module.exports = function attachAmmo(api) {
  api.persistAttribute(Cannon.LOAD_X_ATTRIBUTE);
  api.onObjectInteraction("Dwarf multicannon", { Fire: fire, Empty: empty, "Load X": loadX });
};

Object.assign(module.exports, { loadFromInventory, fire, empty, loadX, setLoadX, stopFiring, giveBalls, ownCannon, MESSAGE });
