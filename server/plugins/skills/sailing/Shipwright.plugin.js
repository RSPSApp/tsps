// A shipwright's Buy-boat (the Boat Emporium, BoatShop.Sailing.js) and Recover-boat: choose a boat in the boat selection interface, pay from the bank,
// and a Port Wizard brings it to this port. Recovers sunk boats and boats docked at other ports.
// Fees by boat type from the cache (raft 250, skiff 3,750, sloop 50,000); the flow, texts and
// effects from a live capture of Junior Jim (docs/sailing-osrs-reference.md).
const { Sailing } = require("../../../src/main/typescript/elvarg/game/content/sailing/Sailing");
const { Bank } = require("../../../src/main/typescript/elvarg/game/model/container/impl/Bank");
const { Animation } = require("../../../src/main/typescript/elvarg/game/model/Animation");
const { Graphic } = require("../../../src/main/typescript/elvarg/game/model/Graphic");
const { Task } = require("../../../src/main/typescript/elvarg/game/task/Task");
const { TaskManager } = require("../../../src/main/typescript/elvarg/game/task/TaskManager");
const { DialogueChainBuilder } = require("../../../src/main/typescript/elvarg/game/model/dialogues/builders/DialogueChainBuilder");
const { NpcDialogue } = require("../../../src/main/typescript/elvarg/game/model/dialogues/entries/impl/NpcDialogue");
const { PlayerDialogue } = require("../../../src/main/typescript/elvarg/game/model/dialogues/entries/impl/PlayerDialogue");
const { EndDialogue } = require("../../../src/main/typescript/elvarg/game/model/dialogues/entries/impl/EndDialogue");
const { content, playSound } = require("./SailingContent.Sailing");
const { dropLostOnRecovery } = require("./Cargo.Sailing");
const { sendBoatVarbits } = require("./BoatVarbits.Sailing");
const { recoveryFee } = require("./BoatParts.Sailing");
const { MODE, openBoatSelection } = require("./BoatSelection.plugin");
const BoatShop = require("./BoatShop.Sailing");
const { customiseBoat } = require("./Shipyard.plugin");

const COINS = 995;
/** Port Wizards Perrie, Peter, Petra and Paulie; one appears for each recovery. */
const PORT_WIZARDS = [15378, 15379, 15380, 15381];
/** Junior Jim's chat head (the base of his multinpc). */
const JUNIOR_JIM_HEAD = 14972;
const SEQ_TELEPORT_IN = 715;
const SEQ_CAST = 725;
const SEQ_TELEPORT_OUT = 714;
const SPOT_TELEPORT_IN = 1299;
const SPOT_CAST = 3546;
const SPOT_TELEPORT_OUT = 111;
const SOUND_TELEPORT_IN = 201;
const SOUND_CAST = 10900;
const SOUND_TELEPORT_OUT = 200;

let pluginApi;

function later(player, ticks, action) {
  TaskManager.submit(new (class extends Task {
    constructor() { super(ticks, player); }
    execute() {
      action();
      this.stop();
    }
  })());
}

/** Takes `fee` coins from the bank, as OSRS does; falls back to the inventory. */
function pay(player, fee) {
  if (fee <= 0) return true;
  const bank = player.getBank(Bank.getTabForItem(player, COINS));
  if (bank.getAmount(COINS) >= fee) {
    bank.delete(COINS, fee);
    player.sendMessage("Payment has been taken from your bank.");
    return true;
  }
  const inventory = player.getInventory();
  if (inventory.getAmount(COINS) >= fee) {
    inventory.delete(COINS, fee);
    player.sendMessage("Payment has been taken from your inventory.");
    return true;
  }
  player.sendMessage(`You need ${fee} coins to recover that boat.`);
  return false;
}

/**
 * A Port Wizard teleports in, recovers the boat and teleports out; the shipwright confirms.
 * `head` is the shipwright the player spoke to, so the line shows their face: Jim's multinpc
 * parent is nameless, so his chat head is the constant rather than his resolved form.
 */
function castRecovery(player, dock, head = JUNIOR_JIM_HEAD) {
  const spot = dock.portWizard ?? dock.landing;
  const wizard = pluginApi.spawnNpc({
    id: PORT_WIZARDS[Math.floor(Math.random() * PORT_WIZARDS.length)],
    x: spot.x, y: spot.y, z: spot.z ?? 0,
  });
  wizard?.performAnimation(new Animation(SEQ_TELEPORT_IN));
  wizard?.performGraphic(new Graphic(SPOT_TELEPORT_IN));
  wizard?.forceChat("Another recovery? This won't take long...");
  playSound(player, SOUND_TELEPORT_IN);
  later(player, 1, () => {
    wizard?.performAnimation(new Animation(SEQ_CAST, 10));
    wizard?.performGraphic(new Graphic(SPOT_CAST, 10));
    playSound(player, SOUND_CAST, 35);
    const where = dock.name.replace(/^The /, "the ");
    player.getDialogueManager().startDialogues(new DialogueChainBuilder().add(
      new NpcDialogue(0, head, `All done! The boat is now docked here at ${where}.`),
      new PlayerDialogue(1, "Thanks!"),
      new EndDialogue(2),
    ));
  });
  later(player, 2, () => {
    wizard?.performAnimation(new Animation(SEQ_TELEPORT_OUT, 18));
    wizard?.performGraphic(new Graphic(SPOT_TELEPORT_OUT, 19));
    playSound(player, SOUND_TELEPORT_OUT, 18);
  });
  later(player, 4, () => { if (wizard) pluginApi.removeNpc(wizard); });
}

/** Recovers the boat in `slot` to `dock`, if it can be and the player can pay. */
function recoverSlot(player, dock, slot, head = JUNIOR_JIM_HEAD) {
  const refusal = Sailing.recoverRefusal(player, slot, dock.id);
  if (refusal) {
    player.sendMessage(refusal);
    return;
  }
  const boat = player.getSailing().boats.find((candidate) => candidate.slot === slot);
  if (!pay(player, recoveryFee(boat))) return;
  Sailing.recover(player, slot, dock.id);
  // A recovery loses salvage, courier crates and fish from the hold (OSRS Wiki, Cargo hold).
  dropLostOnRecovery(boat);
  sendBoatVarbits(player);
  castRecovery(player, dock, head);
}

function recoverBoat({ player, npc, definition }) {
  // The resolved form's name: the spawned parent (14972) is nameless, its varbit form is Junior Jim.
  const name = (definition ?? npc.getCurrentDefinition?.(player))?.getName?.() ?? "";
  const dock = content().docks.find((candidate) => candidate.shipwright === name);
  if (!dock) return false;
  // The shipwright's own id, so the confirmation shows their face and not Junior Jim's.
  const head = npc?.getId?.() ?? JUNIOR_JIM_HEAD;
  openBoatSelection(player, MODE.RECOVER, dock, (slot) => recoverSlot(player, dock, slot, head));
}

/**
 * Still standing with the shipwright, free, and with nothing else open: the guard
 * Destroy.Shipwright's `open()` applies, since the selection opens a tick after the click
 * that asked for it and the player may have walked off or opened something else by then.
 */
function stillWith(quote) {
  const { player, npc } = quote;
  return player?.isRegistered?.() === true && !player.busy?.()
    && npc?.isRegistered?.() === true
    && player.getLocation().isWithinDistance(npc.getLocation(), 5)
    && !player.getDialogueManager().isActive()
    && !player.getPacketSender().hasInterruptibleInterface();
}

/**
 * The shipwright's boat services as the transcript's `open_interface` targets, each wired to the
 * handler its NPC option already uses. Junior Jim's definition (14974) offers Talk-to alone, so
 * for him these steps are the only route to any of them; an unclaimed target drops the action and
 * the conversation simply ends with nothing opened. Destroy Boat keeps its own listener.
 */
const DIALOGUE_TARGETS = {
  "Boat Emporium": BoatShop.openShop,
  "Boat Customisation": customiseBoat,
  "Recover Boat": recoverBoat,
};

/**
 * A shipwright's boat-service dialogue step: claimed here, then opened one tick later so the
 * interface lands after the dialogue has closed, as Destroy.Shipwright does.
 */
function shipwrightDialogue(event) {
  if (event.action !== "open_interface") return;
  const open = DIALOGUE_TARGETS[event.target];
  if (open === undefined) return;
  event.handled = true;
  event.end = true;
  const quote = { player: event.player, npc: event.npc, definition: event.definition };
  later(event.player, 1, () => {
    if (stillWith(quote)) open(quote);
  });
}

module.exports = {
  name: "SailingShipwright",
  members: true,
  recoverSlot,
  register(api) {
    pluginApi = api;
    BoatShop.bind(api);
    require("./shipwright/Destroy.Shipwright")(api);
    api.onCustomEvent("npc-dialogue:action", shipwrightDialogue);
    api.onCustomEvent("omnishop:describe", BoatShop.describe);
    api.onCustomEvent("omnishop:can-buy", BoatShop.canBuy);
    api.onCustomEvent("omnishop:purchase", BoatShop.deliver);
    const { docks } = content();
    for (const shipwright of new Set(docks.map((dock) => dock.shipwright).filter(Boolean))) {
      api.onNpcInteraction(shipwright, { "Buy-boat": BoatShop.openShop, "Recover-boat": recoverBoat });
    }
  },
};
