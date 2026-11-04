/**
 * The first time an account becomes idle (plugins/modes/data/idle-mode.json "onboarding"): a new
 * account on an idle world, `::idle on`, or an idle account that logs in from before this
 * existed. It gets the starter kit (to the inventory, or the bank when that is full), a short
 * welcome in chat, and the Idle screen, opened a few ticks after a login so the game frame is up.
 * A new account on an idle world also starts at `startTile` (Lumbridge) instead of the world's
 * spawn by the Wilderness. Saved as `idle-mode:onboarded`, so it happens once.
 */
const Common = require("./Common.IdleMode");
const Screen = require("./Screen.IdleMode");

const ONBOARDED_ATTRIBUTE = "idle-mode:onboarded";

function config() {
  return Common.data.onboarding;
}

/** Each kit item into the inventory when it fits, else the bank. */
function giveKit(player) {
  const { Item } = Common.core;
  for (const { id, amount } of config().starterKit) {
    const item = new Item(id, amount);
    if (player.getInventory().getAddableAmount(item) >= amount) player.getInventory().add(item, true);
    else Common.bank(player, id, amount);
  }
}

function openLater(player) {
  const { Task, TaskManager } = Common.core;
  TaskManager.submit(new (class OpenIdleScreenTask extends Task {
    constructor() { super(Math.max(1, config().openScreenDelayTicks | 0), player, false); }
    execute() {
      this.stop();
      if (player.isRegistered?.() !== false && Common.isIdle(player)) Screen.open(player);
    }
  })());
}

/** Onboards an idle account the first time; false when it already was. */
function start(player, { fromLogin = false } = {}) {
  if (!Common.isIdle(player) || player.getAttribute(ONBOARDED_ATTRIBUTE) === true) return false;
  player.setAttribute(ONBOARDED_ATTRIBUTE, true);
  giveKit(player);
  for (const line of config().welcome) player.sendMessage(line);
  if (fromLogin) openLater(player);
  else Screen.open(player);
  return true;
}

/** A new account on an idle world starts somewhere safe to learn: Lumbridge. */
function placeNewAccount(player) {
  const [x, y, z = 0] = config().startTile ?? [];
  if (!Number.isInteger(x) || !Number.isInteger(y)) return;
  player.moveTo(new Common.core.Location(x, y, z));
}

module.exports = function attach(api) {
  api.persistAttribute(ONBOARDED_ATTRIBUTE, false);
};

module.exports.ONBOARDED_ATTRIBUTE = ONBOARDED_ATTRIBUTE;
module.exports.start = start;
module.exports.placeNewAccount = placeNewAccount;
