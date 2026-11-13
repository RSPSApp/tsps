// A shipwright's Buy-boat (the Boat Emporium, BoatShop.Sailing.js) and Recover-boat: choose a boat in the boat selection interface, confirm and pay,
// and a Port Wizard brings it to this port. Recovers boats lost at sea, capsized or docked at other ports.
// The fee is BoatParts.recoveryFee (OSRS Wiki, Shipwright); the flow, texts and effects from live
// captures (docs/sailing-osrs-reference.md).
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
const { content, playSound, tileBeside } = require("./SailingContent.Sailing");
const { dropLostOnRecovery } = require("./Cargo.Sailing");
const { sendBoatVarbits } = require("./BoatVarbits.Sailing");
const { isCapsized, recoveryFee } = require("./BoatParts.Sailing");
const { MODE, openBoatSelection } = require("./BoatSelection.Sailing");
const BoatShop = require("./BoatShop.Sailing");
const { customiseBoat } = require("./Shipyard.Sailing");
const BeforePandemonium = require("./shipwright/Pandemonium.Shipwright");

const COINS = 995;
/** Port Wizards Perrie, Peter and Petra; one appears for each recovery (Paulie never does). */
const PORT_WIZARDS = [15378, 15379, 15380];
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
/** What the Port Wizard says as he arrives, one at random. */
const WIZARD_LINES = [
  "Another recovery? This won't take long...",
  "Need a recovery? One moment please...",
  "Recovery is it? Right, give me a moment...",
];
/** Ticks after the wizard appears: his line, the cast, the shipwright's word, teleporting out, gone. */
const WIZARD_TIMING = { say: 2, cast: 3, done: 5, leave: 6, gone: 9 };
/**
 * `boat_retrieve_cost_warning_dismissed`: while 0, a recovery asks before paying; "don't ask
 * again" sets it. Saved, and sent at login.
 */
const VARBIT_COST_WARNING_DISMISSED = 18139;
const COST_WARNING_ATTRIBUTE = "sailing:recovery-cost-warning-dismissed";
const LOST_CARGO = "the port wizard won't have been able to recover any fish, salvage, crates or bounty parts from your cargo hold.";
/** Junior Jim words the recovery lines his own way (Transcript: Junior Jim). */
const LINES = {
  shipwright: {
    warning: "Ah, it seems there's something in the cargo hold of that boat. If the port wizard recovers the boat, any fish, salvage, crates or bounty parts will be lost.",
    keep: "Understandable. Come back at any time.",
    lost: (where, cause) => `All done! The boat is now docked here at ${where}. However, I'm afraid that because ${cause === "capsized" ? "it had capsized" : "it was lost at sea"}, ${LOST_CARGO}`,
  },
  jim: {
    warning: "It seems there's something in the cargo hold of that boat, mate. If the port wizard recovers the boat, any fish, salvage, crates or bounty parts will be lost.",
    keep: "No worries, mate. Come back at any time.",
    lost: (where, cause) => `All done! The boat is now docked here at ${where}, but there's bad news, mate. Because the boat ${cause === "capsized" ? "had capsized" : "was lost at sea"}, ${LOST_CARGO}`,
  },
};

let pluginApi;

/**
 * Runs `action` in `ticks` ticks. `key` is what the task belongs to: a player's tasks stop when
 * they log out, so the wizard's own steps are keyed to the wizard.
 */
function later(key, ticks, action) {
  TaskManager.submit(new (class extends Task {
    constructor() { super(ticks, key); }
    execute() {
      action();
      this.stop();
    }
  })());
}

/**
 * Takes `fee` coins from the bank, as OSRS does, saying so; falls back to the inventory, which
 * says nothing.
 */
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
    return true;
  }
  // Ours: live's reply to a player who can't pay is unknown.
  player.sendMessage(`You need ${fee} coins to recover that boat.`);
  return false;
}

/**
 * A shipwright's line from dialogue index `from`, over as many chatboxes as it fills, under
 * their own name (Jim's chat head is his nameless multinpc parent).
 */
function npcLines(dock, head, text, from) {
  return pluginApi.core.ChatTextLayout.pages(text).map((page, index) => new NpcDialogue(from + index, head, page, dock.shipwright));
}

function wordsFor(dock) {
  return dock.shipwright === "Junior Jim" ? LINES.jim : LINES.shipwright;
}

/** Whether the player is still online. */
function present(player) {
  return player.isRegistered?.() !== false;
}

/**
 * The shipwright's word once the boat is here: plain for a boat brought from another port; for
 * one lost at sea or capsized, what the wizard couldn't bring back, and "Ah, I see. Thanks anyway."
 */
function closing(dock, cause, head) {
  const where = dock.name.replace(/^The /, "the ");
  if (cause === "docked") {
    const plain = npcLines(dock, head, `All done! The boat is now docked here at ${where}.`, 0);
    return [...plain, new PlayerDialogue(plain.length, "Thanks!")];
  }
  const lines = npcLines(dock, head, wordsFor(dock).lost(where, cause), 0);
  return [...lines, new PlayerDialogue(lines.length, "Ah, I see. Thanks anyway.")];
}

/**
 * A Port Wizard teleports in on a tile next to the player, facing them, says one of his lines,
 * recovers the boat and teleports out; the shipwright confirms. `head` is the shipwright the
 * player spoke to, so the line shows their face: Jim's multinpc parent is nameless, so his chat
 * head is the constant rather than his resolved form.
 */
function castRecovery(player, dock, cause, head = JUNIOR_JIM_HEAD) {
  const spot = tileBeside(pluginApi.getRegionManager?.(), player.getLocation(), player.getPrivateArea?.() ?? null, false);
  const wizard = pluginApi.spawnNpc({
    id: PORT_WIZARDS[Math.floor(Math.random() * PORT_WIZARDS.length)],
    x: spot.getX(), y: spot.getY(), z: spot.getZ(),
  });
  wizard?.setPositionToFace?.(player.getLocation());
  wizard?.performAnimation(new Animation(SEQ_TELEPORT_IN));
  wizard?.performGraphic(new Graphic(SPOT_TELEPORT_IN));
  playSound(player, SOUND_TELEPORT_IN);
  const line = WIZARD_LINES[Math.floor(Math.random() * WIZARD_LINES.length)];
  // The wizard finishes and leaves even if the player logs out; the sounds and the line are theirs.
  if (wizard) {
    later(wizard, WIZARD_TIMING.say, () => wizard.forceChat(line));
    later(wizard, WIZARD_TIMING.cast, () => {
      wizard.performAnimation(new Animation(SEQ_CAST, 10));
      wizard.performGraphic(new Graphic(SPOT_CAST, 10));
    });
    later(wizard, WIZARD_TIMING.leave, () => {
      wizard.performAnimation(new Animation(SEQ_TELEPORT_OUT, 18));
      wizard.performGraphic(new Graphic(SPOT_TELEPORT_OUT, 19));
    });
    later(wizard, WIZARD_TIMING.gone, () => pluginApi.removeNpc(wizard));
  }
  later(player, WIZARD_TIMING.cast, () => playSound(player, SOUND_CAST, 35));
  later(player, WIZARD_TIMING.done, () => {
    // Not over another conversation the player started meanwhile.
    if (!present(player) || player.getDialogueManager().isActive?.()) return;
    const lines = closing(dock, cause, head);
    player.getDialogueManager().startDialogues(new DialogueChainBuilder().add(...lines, new EndDialogue(lines.length)));
  });
  later(player, WIZARD_TIMING.leave, () => playSound(player, SOUND_TELEPORT_OUT, 18));
}

/** The boat in `slot`, if a shipwright at `dock` can recover it; otherwise says why. */
function recoverable(player, dock, slot) {
  const refusal = Sailing.recoverRefusal(player, slot, dock.id);
  if (refusal) {
    player.sendMessage(refusal);
    return undefined;
  }
  return player.getSailing().boats.find((candidate) => candidate.slot === slot);
}

/** Pays and brings the boat in `slot` to `dock`; the wizard appears on this tick. */
function recoverNow(player, dock, slot, head) {
  const boat = recoverable(player, dock, slot);
  if (!boat || !pay(player, recoveryFee(boat))) return;
  const cause = boat.location.kind !== "sunk" ? "docked" : isCapsized(boat) ? "capsized" : "lost";
  Sailing.recover(player, slot, dock.id);
  // A recovery loses salvage, courier crates and fish from the hold (OSRS Wiki, Cargo hold).
  dropLostOnRecovery(boat);
  sendBoatVarbits(player);
  castRecovery(player, dock, cause, head);
}

function costWarningDismissed(player) {
  return Number(player.getAttribute?.(COST_WARNING_ATTRIBUTE)) === 1;
}

/** Ends the menu `owner` opened. */
function closeMenu(player, owner) {
  player.getPacketSender().closeChatboxFor?.(owner);
  player.getDialogueManager().reset?.();
}

/** A menu's yes: the menu closes, and the wizard comes on the next tick. */
function recoverNext(player, owner, dock, slot, head) {
  closeMenu(player, owner);
  later(player, 1, () => {
    if (present(player)) recoverNow(player, dock, slot, head);
  });
}

function coins(fee) {
  return fee.toLocaleString("en-US");
}

/**
 * A chosen boat with anything in its hold: the shipwright warns that the cargo will be lost and
 * asks whether to recover it for the fee. Keeping the cargo ends the conversation.
 */
function warnCargo(player, dock, slot, head, fee) {
  const { OptionDialogue } = pluginApi.core;
  const words = wordsFor(dock);
  const owner = {};
  const warning = npcLines(dock, head, words.warning, 0);
  const menu = new OptionDialogue(warning.length, {
    executeOption: (option) => {
      if (Number(option) === 1) return recoverNext(player, owner, dock, slot, head);
      const keep = npcLines(dock, head, words.keep, 1);
      player.getDialogueManager().startDialogues(new DialogueChainBuilder().add(
        new PlayerDialogue(0, "I won't bother then. I'd like to keep my cargo."),
        ...keep,
        new EndDialogue(1 + keep.length),
      ));
    },
  }, "Yes, recover it without cargo.", "No, I'd like to keep my cargo.")
    .setTitle(`Recover your boat for ${coins(fee)} coins? Some cargo will be lost.`);
  player.getDialogueManager().startDialogues(new DialogueChainBuilder().add(...warning, menu), owner);
}

/** Asks before paying, until the player answers "don't ask again". */
function confirmCost(player, dock, slot, head, fee) {
  const { OptionDialogue } = pluginApi.core;
  const owner = {};
  const menu = new OptionDialogue(0, {
    executeOption: (option) => {
      const choice = Number(option);
      if (choice === 2) {
        player.setAttribute(COST_WARNING_ATTRIBUTE, 1);
        player.getPacketSender().sendVarbit(VARBIT_COST_WARNING_DISMISSED, 1);
      }
      if (choice === 1 || choice === 2) return recoverNext(player, owner, dock, slot, head);
      closeMenu(player, owner);
    },
  }, `Yes, pay ${coins(fee)} coins.`, `Yes, pay ${coins(fee)} coins and don't ask again.`, "No, don't pay.")
    .setTitle(`Recover your boat for ${coins(fee)} coins?`);
  player.getDialogueManager().startDialogues(new DialogueChainBuilder().add(menu), owner);
}

/**
 * The boat chosen in the selection. A tick later: a boat with cargo gets the shipwright's warning
 * and its menu; otherwise the cost is confirmed (unless dismissed) or the wizard comes at once.
 */
function recoverSlot(player, dock, slot, head = JUNIOR_JIM_HEAD) {
  if (!recoverable(player, dock, slot)) return;
  later(player, 1, () => {
    if (!present(player)) return;
    const boat = recoverable(player, dock, slot);
    if (!boat) return;
    const fee = recoveryFee(boat);
    if (boat.cargo?.some((item) => item && item.amount > 0)) return warnCargo(player, dock, slot, head, fee);
    if (!costWarningDismissed(player)) return confirmCost(player, dock, slot, head, fee);
    recoverNow(player, dock, slot, head);
  });
}

function recoverBoat({ player, npc, definition }) {
  // The resolved form's name: the spawned parent (14972) is nameless, its varbit form is Junior Jim.
  const name = (definition ?? npc.getCurrentDefinition?.(player))?.getName?.() ?? "";
  const dock = content().docks.find((candidate) => candidate.shipwright === name);
  if (!dock) return false;
  // The Bank PIN guards this (Wiki: Bank_PIN); a locked PIN asks first, then reopens it.
  const pin = { player, feature: "boat-recovery", resume: () => recoverBoat({ player, npc, definition }) };
  pluginApi.emitCustomEvent("bank-pin:guard", pin);
  if (pin.locked) return true;
  // The shipwright's own id, so the confirmation shows their face and not Junior Jim's.
  const head = npc?.getId?.() ?? JUNIOR_JIM_HEAD;
  openBoatSelection(player, MODE.RECOVER, dock, (slot) => recoverSlot(player, dock, slot, head));
}

/** Sends the saved "don't ask again" for the recovery cost at login. */
function sendCostWarning({ player }) {
  if (costWarningDismissed(player)) player.getPacketSender().sendVarbit(VARBIT_COST_WARNING_DISMISSED, 1);
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

/** Buy-boat and Recover-boat, refused before Pandemonium. */
const buyBoat = BeforePandemonium.unlessBeforePandemonium(() => pluginApi, BoatShop.openShop);
const recoverBoatOption = BeforePandemonium.unlessBeforePandemonium(() => pluginApi, recoverBoat);

module.exports = {
  recoverSlot,
  register(api) {
    pluginApi = api;
    api.persistAttribute(COST_WARNING_ATTRIBUTE, 0);
    api.onPlayerLogin(sendCostWarning);
    BoatShop.bind(api);
    require("./shipwright/Destroy.Shipwright")(api);
    api.onCustomEvent("npc-dialogue:action", shipwrightDialogue);
    api.onNpcDialogueVariant(BeforePandemonium.selectVariant);
    api.onCustomEvent("omnishop:describe", BoatShop.describe);
    api.onCustomEvent("omnishop:can-buy", BoatShop.canBuy);
    api.onCustomEvent("omnishop:purchase", BoatShop.deliver);
    const { docks } = content();
    for (const shipwright of new Set(docks.map((dock) => dock.shipwright).filter(Boolean))) {
      api.onNpcInteraction(shipwright, { "Buy-boat": buyBoat, "Recover-boat": recoverBoatOption });
    }
  },
};
