// A port's ledger table (rsprox.net recordings). Take-cargo puts a held task's crate for this port
// in the player's hands (both hands must be free); Deposit-cargo, while carrying one, delivers it
// at its destination, and the task's last crate completes it: Sailing XP, a port coin bag (4 in
// 5) or the destination's reward bag sized by the task's base XP, rarely shark paint (Wiki).
// The table shows Take-cargo or Deposit-cargo by sailing_carrying_cargo.
const common = require("./Common.PortTasks");
const { replaceOnBoard } = require("./Board.PortTasks");

const SEQ_PICKUP = 832; // human_pickuptable
const SOUND_PICKUP = 2739;
/** Bag sizes by a task's base XP: tiny below 400, small 1,000, medium 2,500, large 6,000 (Wiki). */
const BAG_XP = [400, 1000, 2500, 6000];
const REWARD_BAG_CHANCE = 1 / 5;
const SHARK_PAINT = 32090;
const SHARK_PAINT_CHANCE = 1 / 36;

const HANDS_FULL = "You cannot pick up any cargo as your hands are full.";
const NO_CARGO = "There is no cargo available for you to collect here.";
const LAST_SLOT_ATTRIBUTE = "port-tasks:last-slot";

function itemBox(player, itemId, text) {
  const { DialogueChainBuilder, ItemStatementDialogue } = common.core();
  player.getDialogueManager().startDialogues(new DialogueChainBuilder().add(new ItemStatementDialogue(0, itemId, text)));
}

function statement(player, text) {
  common.core().StatementDialogue.send(player, text);
}

/** "There is one more crate of this type to collect." for the crates still to go. */
function moreToGo(left, verb) {
  if (left <= 0) return "";
  return left === 1
    ? ` There is one more crate of this type to ${verb}.`
    : ` There are ${left} more crates of this type to ${verb}.`;
}

/** The held tasks with a crate still to collect at this dock, as [slot index, slot, task]. */
function collectable(player, dockId) {
  return common.slots(player)
    .map((slot, i) => [i, slot, slot && common.taskById(slot.id)])
    .filter(([, slot, task]) => task?.type === "courier" && task.cargoPort === dockId && slot.taken < task.amount);
}

function takeCargo(player, location, preferLast) {
  if (common.heldCrate(player) !== undefined || !common.handsFree(player)) {
    statement(player, HANDS_FULL);
    return;
  }
  const dock = common.dockAt(location.x, location.y);
  const options = dock ? collectable(player, dock.id) : [];
  if (options.length === 0) {
    statement(player, NO_CARGO);
    return;
  }
  const last = player.getAttribute(LAST_SLOT_ATTRIBUTE);
  const [index, , task] = (preferLast && options.find(([i]) => i === last)) || options[0];
  const held = common.slots(player);
  held[index] = { ...held[index], taken: held[index].taken + 1 };
  common.setSlots(player, held);
  player.setAttribute(LAST_SLOT_ATTRIBUTE, index);
  player.performAnimation(new (common.core().Animation)(SEQ_PICKUP));
  player.getPacketSender().sendSoundEffect(SOUND_PICKUP, 1, 15);
  common.carry(player, task.crate, index);
  itemBox(player, task.crate, `You pick up a ${common.crateName(task.crate)}.${moreToGo(task.amount - held[index].taken, "collect")}`);
}

function takeCargoOp({ player, location }) {
  takeCargo(player, location, false);
}

function takeLastCargo({ player, location }) {
  takeCargo(player, location, true);
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
  itemBox(player, task.crate, `You deliver the ${common.crateName(task.crate)} and complete your courier task!`);
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
    player.sendMessage("This cargo isn't for delivery here.");
    return;
  }
  const task = common.taskById(held[index].id);
  held[index] = { ...held[index], delivered: held[index].delivered + 1 };
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
    "Take-any-cargo": takeCargoOp,
    "Deposit-cargo": depositCargo,
  });
}

module.exports = attach;
module.exports.rewardBag = rewardBag;
module.exports.complete = complete;
module.exports.collectable = collectable;
