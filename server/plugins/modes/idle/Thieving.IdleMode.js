/**
 * Idle Thieving (plugins/modes/data/idle-mode.json "thieving"). Thieving is one of the idle skills
 * ("skills"), so a stall's theft goes to the bank as any gather does (Gathering, the stall's own
 * `storage:gather`). Here, for an idle player:
 *
 * - a pickpocket's loot (`thieving:loot`) goes to the bank too, each item as a Thieving gather, so
 *   the offline progress, auto-resume, goals and Bountiful Harvest all count it; coins go straight
 *   in, with no coin pouch to open (and no rogue outfit doubling). Clues stay in the inventory;
 * - stalls stay stocked (`thieving:deplete-stall`), and no owner or guard catches the thief
 *   (`thieving:stall-watch`, `unseenAtStalls`): a character left alone would otherwise be
 *   attacked by the guards it can't run from (East Ardougne's kill a low level);
 * - with auto-resume on, each theft that worked is followed by the next, a tick later, while the
 *   player stays put (`thieving:done`). A pickpocket that failed stuns: auto-resume picks it up
 *   after the stun (Auto);
 * - a pickpocketing character eats below `eatBelowPercent` hitpoints, and below
 *   `stopBelowPercent` with no food left waits, said once (`health`, which auto-resume asks
 *   before each try).
 */
const Common = require("./Common.IdleMode");

/** Players already told they are out of food (until they are healthy again). */
const warned = new WeakSet();

function config() {
  return Common.data.thieving;
}

function idleThief(player) {
  return config().enabled && Common.idleGather(player, Common.core.Skill.THIEVING);
}

/** `thieving:loot`: each item of a pickpocket's loot to the bank, as a Thieving gather. */
function loot(event) {
  const { player } = event;
  if (!config().bankLoot || !idleThief(player) || !Array.isArray(event.loot)) return;
  const times = Math.max(1, event.multiplier | 0);
  const left = [];
  for (const item of event.loot) {
    if (item.clue || !Number.isInteger(item.id) || !(item.amount > 0)) {
      left.push(item);
      continue;
    }
    const request = { player, itemId: item.id, amount: item.amount * times, stored: 0, skill: Common.core.Skill.THIEVING, xp: 0 };
    Common.api.emitCustomEvent("storage:gather", request);
    // What the bank had no room for is handed over as usual.
    if (request.stored < request.amount) left.push({ ...item, amount: Math.ceil((request.amount - request.stored) / times) });
  }
  event.loot = left;
}

/** `thieving:deplete-stall`: the stall stays stocked. */
function keepStall(event) {
  if (!event.handled && config().keepStalls && idleThief(event.player)) event.handled = true;
}

/** `thieving:stall-watch`: no owner or guard sees an idle thief. */
function unseen(watch) {
  if (!watch.unseen && config().unseenAtStalls && idleThief(watch.player)) watch.unseen = true;
}

/** `thieving:done`: a theft that worked is followed by the next, unless the character must eat first. */
function again(event) {
  const { player } = event;
  if (event.again || !event.succeeded || !config().repeat || !idleThief(player) || !Common.autoOn(player)) return;
  if (Common.hitpointsPercent(player) < config().eatBelowPercent) return;
  event.again = true;
}

/**
 * Before a pickpocket: "ate" (it ate, below `eatBelowPercent`), "low" (no food, below
 * `stopBelowPercent`: wait to heal) or "ok".
 */
function health(player) {
  const hp = Common.hitpointsPercent(player);
  if (hp >= config().eatBelowPercent) {
    warned.delete(player);
    return "ok";
  }
  const food = Common.findFood(player);
  if (food) {
    Common.eat(player, food);
    return "ate";
  }
  if (hp >= config().stopBelowPercent) return "ok";
  if (!warned.has(player)) player.sendMessage("You're out of food: idle thieving waits until you have healed.");
  warned.add(player);
  return "low";
}

module.exports = function attach(api) {
  api.onCustomEvent("thieving:loot", loot);
  api.onCustomEvent("thieving:deplete-stall", keepStall);
  api.onCustomEvent("thieving:stall-watch", unseen);
  api.onCustomEvent("thieving:done", again);
};

module.exports.health = health;
module.exports.handlers = { loot, keepStall, unseen, again };
