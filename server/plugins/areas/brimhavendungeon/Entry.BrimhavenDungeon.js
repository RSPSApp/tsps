/**
 * Saniboch (tribesman_doorman) and the Brimhaven Dungeon entrance (dungeon_tree_closed), as the
 * OSRS Wiki and rsprox recordings (227/70, 234/3275 and the entrance's 9) have them:
 *
 * - The fee: 875 coins for one visit, or 1,000,000 coins once for permanent access, carried in
 *   the inventory. Paying sets karam_dungeon_entryfee or karam_dungeon_permanentaccess; both sit
 *   in karam_dungeon_doordata, which turns the entrance from Pay into Enter.
 * - Talk-to plays his transcript (npc-dialogues.json "Saniboch"); this unit answers its
 *   conditions and takes the coins on its payment lines, which show in an item box with coins.
 * - Pay, on Saniboch or on the entrance, plays his right-click variants: with permanent access
 *   or a visit paid he lets the player in; without 875 coins he sends them off; with less than
 *   1,000,000 it is "Pay 875 coins to enter?"; otherwise the three-way menu the recordings show.
 * - Enter: the pick-up animation, and a tick later the player is inside at (2713, 9564, 0). A
 *   visit paid once is used up by going in; permanent access stays.
 */
const PERMANENT_ATTRIBUTE = "brimhaven-dungeon:permanent-access";
const ENTRY_PAID_ATTRIBUTE = "brimhaven-dungeon:entry-paid";

const SANIBOCH = "Saniboch";
const ENTRANCE = "Dungeon entrance";
const ENTRANCE_LOC = "dungeon_tree_closed";
const SANIBOCH_NPC = "tribesman_doorman";
const ENTRY_FEE_VARBIT = "karam_dungeon_entryfee";
const PERMANENT_VARBIT = "karam_dungeon_permanentaccess";
const ENTER_SEQ = "human_pickuptable";
const INSIDE = [2713, 9564, 0];

const ENTRY_FEE = 875;
const PERMANENT_FEE = 1000000;

const PAY_ONCE_MESSAGE = "You give Saniboch 875 coins.";
const PAY_PERMANENT_MESSAGE = "You give Saniboch 1,000,000 coins for permanent access to the dungeon.";
const THANKS_ONCE = "Many thanks. You may now pass the door. May your death be a glorious one!";

/** Right-click Pay variants of his transcript, in the order they are checked. */
const PAY_VARIANTS = {
  permanent: "standard-dialogue-right-click-pay-option-if-the-player-has-paid-for-permanent-access",
  paid: "standard-dialogue-right-click-pay-option-if-the-player-has-paid-to-enter-once",
  poor: "standard-dialogue-right-click-pay-option-if-the-player-does-not-have-at-least-875-coins-and-has-not-paid-for-permanent-access",
  once: "standard-dialogue-right-click-pay-option-if-the-player-has-at-least-875-coins-but-less-than-1-million-coins",
  menu: "standard-dialogue-right-click-pay-option-if-the-player-has-not-paid-for-permanent-access",
};

/**
 * The transcript has two conditions reading "If the player has at least 875 coins with them:";
 * the first leads to "I haven't got that much money with me.", so it is the other way round.
 */
const NOT_ENOUGH_FOR_ENTRY_STEP = "-AWo6p";

let core = null;
let pluginApi = null;
/** Players on their way in, between the click and the move. */
const entering = new WeakSet();

const coins = (player) => player.getInventory().getAmount(core.ItemIdentifiers.COINS);
const hasPermanentAccess = (player) => player.getAttribute(PERMANENT_ATTRIBUTE) === true;
const hasPaidEntry = (player) => player.getAttribute(ENTRY_PAID_ATTRIBUTE) === true;
const mayEnter = (player) => hasPermanentAccess(player) || hasPaidEntry(player);

function isSaniboch(definition) {
  return definition?.getName?.() === SANIBOCH;
}

/** The varbits the entrance and his options read, from what the player has paid. */
function syncVarbits(player) {
  const { CacheDefinitions } = core;
  player.getPacketSender()
    .sendVarbit(CacheDefinitions.getVarbitId(ENTRY_FEE_VARBIT), hasPaidEntry(player) ? 1 : 0)
    .sendVarbit(CacheDefinitions.getVarbitId(PERMANENT_VARBIT), hasPermanentAccess(player) ? 1 : 0);
}

function syncOnLogin({ player }) {
  syncVarbits(player);
}

/** The transcript's prose conditions, answered from the player's state. */
function conditions(player) {
  const paid = mayEnter(player);
  const carried = coins(player);
  return {
    "If the entry cost has already been paid, or if the player has paid for permanent access:": paid,
    "If the entry cost has not been paid:": !paid,
    "If the player has at least 875 coins with them:": carried >= ENTRY_FEE,
    "If the player does not have at least 1,000,000 coins:": carried < PERMANENT_FEE,
    "If the player has at least 1,000,000 coins:": carried >= PERMANENT_FEE,
  };
}

function answerCondition({ player, definition, text, stepId }) {
  if (!isSaniboch(definition)) return null;
  if (stepId === NOT_ENOUGH_FOR_ENTRY_STEP) return coins(player) < ENTRY_FEE;
  const answers = conditions(player);
  return Object.hasOwn(answers, text) ? answers[text] : null;
}

/**
 * Takes the fee if the player still carries it (they may have dropped coins mid-conversation)
 * and records what it bought. False when they can't pay.
 */
function pay(player, fee, attribute) {
  const inventory = player.getInventory();
  if (coins(player) < fee) return false;
  inventory.deleteNumber(core.ItemIdentifiers.COINS, fee);
  inventory.refreshItems();
  player.setAttribute(attribute, true);
  if (attribute === PERMANENT_ATTRIBUTE) player.setAttribute(ENTRY_PAID_ATTRIBUTE, false);
  syncVarbits(player);
  // `brimhaven-dungeon:permanent-access` { player } (a league's "Pay Saniboch for Permanent Access").
  if (attribute === PERMANENT_ATTRIBUTE) pluginApi?.emitCustomEvent("brimhaven-dungeon:permanent-access", { player });
  return true;
}

/** His payment lines: take the coins and show them in the item box, or end the talk. */
function dialogueAction(action) {
  if (action.kind !== "message" || !isSaniboch(action.definition)) return;
  const { player } = action;
  const once = action.text === PAY_ONCE_MESSAGE;
  if (!once && action.text !== PAY_PERMANENT_MESSAGE) return;
  // Already covered (a visit paid, then "875 coins for one visit" offered again): nothing more
  // is taken, and he lets them pass as the line goes on.
  if (once ? mayEnter(player) : hasPermanentAccess(player)) {
    action.handled = true;
    return;
  }
  if (!pay(player, once ? ENTRY_FEE : PERMANENT_FEE, once ? ENTRY_PAID_ATTRIBUTE : PERMANENT_ATTRIBUTE)) {
    // Not carrying the fee (any more): his "Begone with you, riff raff." instead of the payment.
    action.handled = true;
    startPayment(player, action.npc, PAY_VARIANTS.poor);
    return;
  }
  action.box = { items: [core.ItemIdentifiers.COINS] };
}

/** "Pay 875 coins to enter?" Yes: the one-visit payment and his thanks, as the menu's first option has them. */
function payOnceOnYes(steps) {
  return steps.map((step) => step?.type !== "choice" ? step : {
    ...step,
    options: step.options.map((option) => option.text !== "Yes" ? option : {
      ...option,
      steps: [{ type: "message", text: PAY_ONCE_MESSAGE }, { npc: THANKS_ONCE }],
    }),
  });
}

function payVariant(player) {
  if (hasPermanentAccess(player)) return PAY_VARIANTS.permanent;
  if (hasPaidEntry(player)) return PAY_VARIANTS.paid;
  const carried = coins(player);
  if (carried < ENTRY_FEE) return PAY_VARIANTS.poor;
  if (carried < PERMANENT_FEE) return PAY_VARIANTS.once;
  return PAY_VARIANTS.menu;
}

/** Pay, from Saniboch or the entrance (which "automatically attempts to pay Saniboch"). */
function startPayment(player, npc, variant = payVariant(player)) {
  pluginApi.emitCustomEvent("npc-dialogue:start", {
    player,
    npc: npc ?? null,
    npcId: core.CacheDefinitions.getNpcId(SANIBOCH_NPC),
    variant,
    exact: true,
    select: variant === PAY_VARIANTS.once ? payOnceOnYes : undefined,
    handled: false,
  });
}

function payOption({ player, npc }) {
  startPayment(player, npc);
}

function isEntrance(event) {
  return core.CacheDefinitions.getLocNames().get(event.objectId) === ENTRANCE_LOC;
}

function payAtEntrance(event) {
  if (!isEntrance(event)) return false;
  startPayment(event.player, null);
  return true;
}

/**
 * Moves the player in, using up a visit paid once, unless they were moved, died or left in the
 * meantime. Movement is held for the tick between, as for other loc teleports.
 */
function goInside(player, start) {
  entering.delete(player);
  player.getMovementQueue().setBlockMovement(false);
  if (!player.isRegistered() || player.getHitpoints() <= 0 || !player.getLocation().equals(start) || !mayEnter(player)) return;
  if (!hasPermanentAccess(player)) {
    player.setAttribute(ENTRY_PAID_ATTRIBUTE, false);
    syncVarbits(player);
  }
  player.moveTo(new core.Location(...INSIDE));
}

function enter(event) {
  if (!isEntrance(event)) return false;
  const { player } = event;
  if (entering.has(player)) return true;
  if (!mayEnter(player)) {
    startPayment(player, null);
    return true;
  }
  const movement = player.getMovementQueue();
  if (movement.isMovementBlocked()) return true;
  entering.add(player);
  movement.setBlockMovement(true).reset();
  player.performAnimation(new core.Animation(core.CacheDefinitions.getSeqId(ENTER_SEQ)));
  const start = player.getLocation().clone();
  core.TaskManager.submit(new core.CountdownTask(player, 1, () => goInside(player, start)));
  return true;
}

function attach(api) {
  core = api.core;
  pluginApi = api;
  api.persistAttribute(PERMANENT_ATTRIBUTE, false);
  api.persistAttribute(ENTRY_PAID_ATTRIBUTE, false);
  api.onPlayerLogin(syncOnLogin);
  api.onNpcInteraction(SANIBOCH, { Pay: payOption });
  api.onObjectInteraction(ENTRANCE, { Enter: enter, Pay: payAtEntrance });
  api.onNpcDialogueCondition(answerCondition);
  api.onCustomEvent("npc-dialogue:action", dialogueAction);
}

module.exports = {
  attach,
  conditions,
  answerCondition,
  dialogueAction,
  payVariant,
  payOnceOnYes,
  enter,
  payAtEntrance,
  syncVarbits,
  PERMANENT_ATTRIBUTE,
  ENTRY_PAID_ATTRIBUTE,
  INSIDE,
};
