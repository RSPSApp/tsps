// A shipwright's Recover-boat: choose a boat in the boat selection interface, pay from the bank,
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
const { content, playSound } = require("./sailingContent");
const { dropLostOnRecovery } = require("./cargo");
const { sendBoatVarbits } = require("./boatVarbits");
const { recoveryFee } = require("./boatParts");
const { MODE, openBoatSelection } = require("./BoatSelection.plugin");

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

/** A Port Wizard teleports in, recovers the boat and teleports out; the shipwright confirms. */
function castRecovery(player, dock) {
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
      new NpcDialogue(0, JUNIOR_JIM_HEAD, `All done! The boat is now docked here at ${where}.`),
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
function recoverSlot(player, dock, slot) {
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
  castRecovery(player, dock);
}

function recoverBoat({ player, npc }) {
  const name = npc.getDefinition?.()?.getName?.() ?? "";
  const dock = content().docks.find((candidate) => candidate.shipwright === name);
  if (!dock) return false;
  openBoatSelection(player, MODE.RECOVER, dock, (slot) => recoverSlot(player, dock, slot));
}

module.exports = {
  name: "SailingShipwright",
  members: true,
  recoverSlot,
  register(api) {
    pluginApi = api;
    const { docks } = content();
    for (const shipwright of new Set(docks.map((dock) => dock.shipwright).filter(Boolean))) {
      api.onNpcInteraction(shipwright, { "Recover-boat": recoverBoat });
    }
  },
};
