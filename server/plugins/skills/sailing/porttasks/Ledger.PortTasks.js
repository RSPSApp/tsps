// A port's ledger table (rsprox.net recordings). Take-cargo puts a held task's crate for this port
// in the player's hands (both hands must be free); Deposit-cargo, while carrying one, delivers it
// at its destination, and the task's last crate completes it: Sailing XP, a port coin bag (4 in
// 5) or the destination's reward bag sized by the task's base XP, rarely shark paint (Wiki).
// The table shows Take-cargo or Deposit-cargo by sailing_carrying_cargo. Every box it opens is
// also written to the chatbox.
const common = require("./Common.PortTasks");
const { replaceOnBoard } = require("./Board.PortTasks");
const { dockById } = require("../SailingContent.Sailing");

/** Taking a crate and setting one down both play these. */
const SEQ_PICKUP = 832; // human_pickuptable
const SOUND_PICKUP = 2739;
const SOUND_COMPLETE = 10791;
/** Bag sizes by a task's base XP: tiny below 400, small 1,000, medium 2,500, large 6,000 (Wiki). */
const BAG_XP = [400, 1000, 2500, 6000];
const REWARD_BAG_CHANCE = 1 / 5;
const SHARK_PAINT = 32090;
const SHARK_PAINT_CHANCE = 1 / 36;

const HANDS_FULL = "You cannot pick up any cargo as your hands are full.";
const CREW_HELP = ", but your crew can help with that.";
const CREW_DROP_OFF = "Your crew drop off the cargo that needed to be delivered here.";
/** Crate counts in the boxes, spelt out (rsprox: "There are two more crates of this type to collect"). */
const NUMBER_WORDS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];
const NO_CARGO = "There is no cargo available for you to collect here.";
const WHICH_CARGO = "Which cargo would you like to take?";
const LAST_SLOT_ATTRIBUTE = "port-tasks:last-slot";
const DEPOSIT_WARNING_SETTING = 463;
/** port_task_loading_bay_warning_dismissed: 1 after "don't ask again" (the row's tick clears it). */
const DEPOSIT_WARNING_VARBIT = 18137;
const DEPOSIT_TITLE = "Deposit the cargo?";
const DEPOSIT_OPTIONS = ["Yes.", "Yes, and don't ask again.", "No."];

/** The box's text in the chatbox too. */
function echo(player, text) {
  player.getPacketSender().sendTypedMessage(common.core().ChatType.MESBOX, text);
}

function itemBox(player, itemId, text) {
  const { DialogueChainBuilder, ItemStatementDialogue } = common.core();
  echo(player, text);
  player.getDialogueManager().startDialogues(new DialogueChainBuilder().add(new ItemStatementDialogue(0, itemId, text)));
}

function statement(player, text) {
  echo(player, text);
  common.core().StatementDialogue.send(player, text);
}

function pickupFeedback(player) {
  player.performAnimation(new (common.core().Animation)(SEQ_PICKUP));
  player.getPacketSender().sendSoundEffect(SOUND_PICKUP, 1, 15);
}

/** "There is one more crate of this type to collect." for the crates still to go. */
function moreToGo(left, verb) {
  if (left <= 0) return "";
  return left === 1
    ? ` There is one more crate of this type to ${verb}.`
    : ` There are ${NUMBER_WORDS[left] ?? left} more crates of this type to ${verb}.`;
}

/**
 * The held tasks with a crate still to collect at this dock, as [slot index, slot, task]. Crates
 * the crew are carrying count as collected.
 */
function collectable(player, dockId) {
  return common.slots(player)
    .map((slot, i) => [i, slot, slot && common.taskById(slot.id)])
    .filter(([i, slot, task]) => task?.type === "courier" && task.cargoPort === dockId
      && slot.taken + common.crewAmount(player, i) < task.amount);
}

/** The crates the player can take here, or null after the box saying why not. */
function takeable(player, location) {
  if (common.heldCrate(player) !== undefined || !common.handsFree(player)) {
    statement(player, HANDS_FULL);
    return null;
  }
  const dock = common.dockAt(location.x, location.y);
  const options = dock ? collectable(player, dock.id) : [];
  if (options.length === 0) {
    statement(player, NO_CARGO);
    return null;
  }
  return { dock, options };
}

/** "Crate of bananas (The Pandemonium).": a crate and where it goes. */
function cargoOption(task) {
  const name = common.crateName(task.crate);
  const destination = dockById(task.destination)?.name ?? task.destination;
  return `${name.charAt(0).toUpperCase()}${name.slice(1)} (${destination}).`;
}

/**
 * Take-cargo asks "Which cargo would you like to take?" when crates of more than one held task are
 * here, listing them in slot order; Take-any-cargo takes one of them at random without asking.
 * Take-last-cargo takes the last-taken task's crate (Ours: otherwise it acts as Take-cargo).
 */
function takeCargo(player, location, mode) {
  const found = takeable(player, location);
  if (!found) return;
  const { dock, options } = found;
  const last = player.getAttribute(LAST_SLOT_ATTRIBUTE);
  const chosen = mode === "last" ? options.find(([i]) => i === last)
    : mode === "any" ? options[Math.floor(Math.random() * options.length)]
      : undefined;
  if (chosen || options.length === 1) {
    take(player, dock, chosen ?? options[0]);
    return;
  }
  chooseCargo(player, location, options);
}

function chooseCargo(player, location, options) {
  const { DialogueChainBuilder, OptionDialogue } = common.core();
  const owner = {};
  const picks = options.map(([index, , task]) => [index, task.id]);
  player.getDialogueManager().startDialogues(new DialogueChainBuilder()
    .add(new OptionDialogue(0, {
      executeOption: (option) => {
        player.getPacketSender().closeChatboxFor(owner);
        const [index, taskId] = picks[Number(option) - 1] ?? [];
        if (index === undefined) return;
        // Hands, slots and crew may have changed while the menu was open.
        const found = takeable(player, location);
        const pick = found?.options.find(([i, , task]) => i === index && task.id === taskId);
        if (pick) take(player, found.dock, pick);
      },
    }, ...options.map(([, , task]) => cargoOption(task))).setTitle(WHICH_CARGO)), owner);
}

function take(player, dock, [index, , task]) {
  const held = common.slots(player);
  held[index] = { ...held[index], taken: held[index].taken + 1 };
  common.setSlots(player, held);
  player.setAttribute(LAST_SLOT_ATTRIBUTE, index);
  pickupFeedback(player);
  common.carry(player, task.crate, index);
  // Crewmates with the boat docked here carry what's left (crew/Courier.Crew.js sets `helped`).
  const left = task.amount - held[index].taken - common.crewAmount(player, index);
  const pickup = { player, index, task, dock, left, helped: 0 };
  common.core().PluginManager.emitCustomEvent("port-tasks:cargo-taken", pickup);
  const more = moreToGo(left, "collect");
  const text = pickup.helped > 0 && more ? `${more.slice(0, -1)}${CREW_HELP}` : more;
  itemBox(player, task.crate, `You pick up a ${common.crateName(task.crate)}.${text}`);
}

function takeCargoOp({ player, location }) {
  takeCargo(player, location, "choose");
}

function takeLastCargo({ player, location }) {
  takeCargo(player, location, "last");
}

function takeAnyCargo({ player, location }) {
  takeCargo(player, location, "any");
}

/** The bag a finished task gives: a coin bag, or 1 in 5 the destination's reward bag. */
function rewardBag(task, random = Math.random) {
  const size = BAG_XP.filter((xp) => task.xp >= xp).length;
  const reward = common.DATA.rewardBags[task.destination]?.[size];
  return random() < REWARD_BAG_CHANCE && reward ? reward : common.DATA.coinBags[size];
}

/** Gives a reward, or keeps it for the port master's Claim-rewards when the inventory is full. */
function give(player, itemId) {
  const inventory = player.getInventory();
  if (inventory.getFreeSlots() > 0 || (inventory.getAmount(itemId) > 0 && common.core().CacheDefinitions.getItem(itemId)?.stackable)) {
    inventory.addItem(new (common.core().Item)(itemId, 1));
    return;
  }
  player.setAttribute(common.UNCLAIMED_ATTRIBUTE, [...(player.getAttribute(common.UNCLAIMED_ATTRIBUTE) ?? []), itemId]);
}

/** Tasks completed in all and today (the day's count restarts at midnight, UTC). */
function countCompletion(player) {
  const today = new Date().toISOString().slice(0, 10);
  const saved = player.getAttribute(common.COMPLETED_ATTRIBUTE) ?? {};
  const next = { total: (saved.total ?? 0) + 1, day: today, today: saved.day === today ? (saved.today ?? 0) + 1 : 1 };
  player.setAttribute(common.COMPLETED_ATTRIBUTE, next);
  player.getPacketSender().sendConfig(common.VARP_TASKS_COMPLETED, next.total);
  player.getPacketSender().sendVarbit(common.VARBIT.COMPLETED_TODAY, next.today);
}

function complete(player, index, task, random = Math.random) {
  const { Skill } = common.core();
  const held = common.slots(player);
  held[index] = null;
  common.setSlots(player, held);
  player.getSkillManager().addExperiences(Skill.SAILING, task.xp);
  if (task.noReward !== true) {
    give(player, rewardBag(task, random));
    if (random() < SHARK_PAINT_CHANCE) give(player, SHARK_PAINT);
  }
  countCompletion(player);
  replaceOnBoard(player, task);
  player.sendMessage(`You have finished the ${common.blue(task.name)} port task.`);
  player.getPacketSender().sendSoundEffect(SOUND_COMPLETE, 1, 0);
  itemBox(player, task.crate, `You deliver the ${common.crateName(task.crate)} and complete your courier task!`);
}

/**
 * The carried crate's slot when this dock is where it was picked up and it is still owed there,
 * or -1. Setting it down there makes it collectable again.
 */
function returnable(player, crate, dock) {
  const held = common.slots(player);
  const carriedIndex = player.getAttribute(common.CARRIED_SLOT_ATTRIBUTE);
  const carried = Number.isInteger(carriedIndex) ? held[carriedIndex] : null;
  const source = carried && common.taskById(carried.id);
  return source?.type === "courier" && source.crate === crate && source.cargoPort === dock?.id
    && carried.taken > carried.delivered ? carriedIndex : -1;
}

function returnToSource(player, crate, dock) {
  if (common.heldCrate(player) !== crate) return;
  const index = returnable(player, crate, dock);
  if (index < 0) return;
  const held = common.slots(player);
  held[index] = { ...held[index], taken: held[index].taken - 1 };
  common.setSlots(player, held);
  common.putDown(player);
  pickupFeedback(player);
  itemBox(player, crate, `You deposit the ${common.crateName(crate)}.`);
}

/**
 * All Settings "Port task cargo deposit warning" (463): while varbit 18137 is 0, setting a crate
 * down anywhere but its destination asks first, a message box then "Deposit the cargo?".
 * "Yes, and don't ask again." sets 18137.
 */
function depositWarning(player, crate, dock) {
  const { DialogueChainBuilder, StatementDialogue, OptionDialogue, PluginManager } = common.core();
  const text = depositWarningText(crate);
  const sender = player.getPacketSender();
  const owner = {};
  echo(player, text);
  player.getDialogueManager().startDialogues(new DialogueChainBuilder()
    .add(new StatementDialogue(0, text))
    .add(new OptionDialogue(1, {
      executeOption: (option) => {
        sender.closeChatboxFor(owner);
        const choice = Number(option);
        if (choice === 2) PluginManager.emitCustomEvent("settings:set", { player, settingId: DEPOSIT_WARNING_SETTING, value: 1 });
        if (choice === 1 || choice === 2) returnToSource(player, crate, dock);
      },
    }, ...DEPOSIT_OPTIONS).setTitle(DEPOSIT_TITLE)), owner);
}

function depositWarningText(crate) {
  return `Are you sure you wish to deposit the ${common.crateName(crate)} here? If you obtained this cargo from a different port, you will have to return to that port to re-acquire it.`;
}

function depositCargo({ player, location }) {
  const crate = common.heldCrate(player);
  if (crate === undefined) return;
  const dock = common.dockAt(location.x, location.y);
  const held = common.slots(player);
  const index = held.findIndex((slot) => {
    const task = slot && common.taskById(slot.id);
    return task?.crate === crate && task.destination === dock?.id && slot.delivered < slot.taken;
  });
  if (index < 0) {
    if (returnable(player, crate, dock) < 0) {
      player.sendMessage("This cargo isn't for delivery here.");
      return;
    }
    if ((Number(player.getPacketSender().getVarbit(DEPOSIT_WARNING_VARBIT)) || 0) !== 0) {
      returnToSource(player, crate, dock);
      return;
    }
    depositWarning(player, crate, dock);
    return;
  }
  const task = common.taskById(held[index].id);
  // The crew hand theirs in first (rsprox: delivered 0 -> 3, then the player's crate).
  const crew = common.crewCargo(player)[index];
  if (crew?.crate === crate && crew.amount > 0) {
    // Credit only the crates the crew actually take out of the hold (one banked meanwhile is not delivered).
    const handIn = { player, index, ...crew, taken: crew.amount };
    common.setCrewCargo(player, index, null);
    common.core().PluginManager.emitCustomEvent("port-tasks:crew-delivered", handIn);
    const taken = Math.max(0, Math.min(crew.amount, Math.trunc(Number(handIn.taken) || 0)));
    held[index] = { ...held[index], delivered: held[index].delivered + taken };
    if (taken > 0) player.sendMessage(CREW_DROP_OFF);
  }
  held[index] = { ...held[index], delivered: held[index].delivered + 1 };
  pickupFeedback(player);
  common.putDown(player);
  if (held[index].delivered < task.amount) {
    common.setSlots(player, held);
    itemBox(player, crate, `You deliver the ${common.crateName(crate)}.${moreToGo(task.amount - held[index].delivered, "deliver")}`);
    return;
  }
  complete(player, index, task);
}

function attach(api) {
  common.init(api);
  api.persistAttribute(common.UNCLAIMED_ATTRIBUTE);
  api.persistAttribute(common.COMPLETED_ATTRIBUTE);
  api.onObjectInteraction("Ledger table", {
    "Take-cargo": takeCargoOp,
    "Take-last-cargo": takeLastCargo,
    "Take-any-cargo": takeAnyCargo,
    "Deposit-cargo": depositCargo,
  });
}

module.exports = attach;
module.exports.rewardBag = rewardBag;
module.exports.complete = complete;
module.exports.collectable = collectable;
module.exports.moreToGo = moreToGo;
module.exports.cargoOption = cargoOption;
module.exports.WHICH_CARGO = WHICH_CARGO;
module.exports.give = give;
module.exports.countCompletion = countCompletion;
module.exports.depositWarningText = depositWarningText;
module.exports.DEPOSIT_OPTIONS = DEPOSIT_OPTIONS;
module.exports.DEPOSIT_WARNING_VARBIT = DEPOSIT_WARNING_VARBIT;
module.exports.SHARK_PAINT = SHARK_PAINT;
module.exports.SHARK_PAINT_CHANCE = SHARK_PAINT_CHANCE;
