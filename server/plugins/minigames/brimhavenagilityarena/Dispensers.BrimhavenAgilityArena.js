"use strict";

/**
 * The world's ticket cycle, the two ways in and out, Cap'n Izzy's fee and the dispensers'
 * Tag option. The cycle is one module-level object in the shared unit: every 100 ticks a new
 * dispenser becomes active, the native hint arrow is moved over it, and each player may tag
 * once per cycle.
 */

const Shared = require("./Shared.BrimhavenAgilityArena");

/**
 * Paying and the ladders, as rsprox captures show them (rev 227-237). Paying Cap'n Izzy
 * (Pay, or "Okay, here's 200 coins." in his transcript) takes the fee and sets varbit
 * agilityarena_canenter (5964); it does not move the player. The hut ladder (3617) then climbs
 * down (827, a tick) onto the 3x3 by the exit ladder, sets current_hint_arrow (14192) to 6 and
 * shows the arrow. Unpaid, the Parrot says "Clap 'em in irons!" and continuing takes the fee.
 * The exit ladder (3618) climbs up (828, a tick) to (2808, 3193) and clears both varbits;
 * the fee is paid again for the next visit.
 */
const PARROT = 3853;
/** The Parrot's chathead animation (lore_bird_chathead_quizical). */
const PARROT_HEAD_ANIMATION = 9;
const CHATHEAD_UID = (231 << 16) | 2;
const CANENTER_VARBIT = 5964;
const HINT_ARROW_VARBIT = 14192;
const HINT_ARROW_ARENA = 6;
const CLIMB_DOWN = 827;
const CLIMB_UP = 828;
const IZZY_NO_COINS = "No coins, no entrance!";
const IZZY_PAID = "May the wind be in ye sails!";
/** The transcript's hand-over step in "I'd like to use the Agility Arena, please.". */
const TRANSCRIPT_PAY_STEP = "geqhzb";

function hasPaid(player) {
  return player.getAttribute(Shared.PAID_ATTRIBUTE) === true;
}

function setPaid(player, paid) {
  player.setAttribute(Shared.PAID_ATTRIBUTE, paid ? true : null);
  player.getPacketSender().sendVarbit(CANENTER_VARBIT, paid ? 1 : 0);
}

/** Takes the fee. Returns false (and says so) when the player cannot pay. */
function takeFee(player) {
  const core = Shared.core();
  const inventory = player.getInventory();
  if (inventory.getAmount(core.ItemIdentifiers.COINS) < Shared.ENTRY_FEE) return false;
  inventory.deleteNumber(core.ItemIdentifiers.COINS, Shared.ENTRY_FEE);
  setPaid(player, true);
  return true;
}

function izzySays(player, text) {
  const { DialogueChainBuilder, NpcDialogue, NpcIdentifiers } = Shared.core();
  player.getDialogueManager().startDialogues(new DialogueChainBuilder().add(
    new NpcDialogue(0, NpcIdentifiers.CAPN_IZZY_NO_BEARD, text),
  ));
}

/** Pay (op3): the coins item box, or Izzy's refusal. */
function payIzzy({ player }) {
  if (hasPaid(player)) {
    izzySays(player, IZZY_PAID);
    return;
  }
  if (!takeFee(player)) {
    izzySays(player, IZZY_NO_COINS);
    return;
  }
  const { DialogueChainBuilder, ItemStatementDialogue, ItemIdentifiers } = Shared.core();
  player.getDialogueManager().startDialogues(new DialogueChainBuilder().add(
    new ItemStatementDialogue(0, ItemIdentifiers.COINS, Shared.FEE_MESSAGE),
  ));
}

/** The transcript's "You hand Cap'n Izzy 200 coins." takes the fee, shown with the coins. */
function transcriptPayment(event) {
  if (event.kind !== "message" || event.stepId !== TRANSCRIPT_PAY_STEP) return;
  if (!takeFee(event.player)) {
    event.end = true;
    return;
  }
  event.box = { items: [Shared.core().ItemIdentifiers.COINS] };
}

/** Izzy's transcript conditions about the fee. */
function answerCondition({ definition, text, player }) {
  if (definition?.getName?.() !== Shared.NPC.IZZY) return null;
  const coins = player.getInventory().getAmount(Shared.core().ItemIdentifiers.COINS);
  if (text === "If the player doesn't have enough coins:") return coins < Shared.ENTRY_FEE;
  if (text === "If the player has enough coins:") return coins >= Shared.ENTRY_FEE;
  return null;
}

function parrotLine(index, text) {
  const { NpcDialogue } = Shared.core();
  const line = new NpcDialogue(index, PARROT, text);
  const send = line.send.bind(line);
  line.send = (player) => {
    send(player);
    player.getPacketSender().sendInterfaceAnimation(CHATHEAD_UID, PARROT_HEAD_ANIMATION);
  };
  return line;
}

function afterTick(action) {
  const { Task, TaskManager } = Shared.core();
  TaskManager.submit(new (class extends Task {
    constructor() {
      super(1);
    }
    execute() {
      this.stop();
      action();
    }
  })());
}

/** A random tile of the 3x3 beside the exit ladder (captures land on all of 2804-2806, 9589-9591). */
function entryTile() {
  const core = Shared.core();
  const dx = Math.floor(Math.random() * 3) - 1;
  const dy = Math.floor(Math.random() * 3) - 1;
  return new core.Location(Shared.ENTRY.x + dx, Shared.ENTRY.y + dy, Shared.ENTRY.z);
}

function enterArena(player) {
  const core = Shared.core();
  player.performAnimation(new core.Animation(CLIMB_DOWN));
  afterTick(() => {
    player.moveTo(entryTile());
    Shared.stateOf(player);
    player.getPacketSender().sendVarbit(HINT_ARROW_VARBIT, HINT_ARROW_ARENA);
    Shared.sendArrow(player);
  });
}

function leaveArena(player) {
  const core = Shared.core();
  player.performAnimation(new core.Animation(CLIMB_UP));
  afterTick(() => {
    player.moveTo(new core.Location(Shared.HUT.x, Shared.HUT.y, Shared.HUT.z));
    resetOnLeaving(player);
  });
}

/** Out of the arena by any way: the fee is spent and the arrow goes. */
function resetOnLeaving(player) {
  setPaid(player, false);
  player.getPacketSender().sendVarbit(HINT_ARROW_VARBIT, 0);
  player.getPacketSender().clearHintArrow?.();
  Shared.clearState(player);
}

function climbDown(player) {
  if (hasPaid(player)) {
    enterArena(player);
    return;
  }
  const { DialogueChainBuilder, ActionDialogue } = Shared.core();
  player.getDialogueManager().startDialogues(new DialogueChainBuilder().add(
    parrotLine(0, "Clap 'em in irons!"),
    new ActionDialogue(1, { execute: () => payIzzy({ player }) }),
  ));
}

/** The hut ladder and the arena's exit ladder, claimed before the generic Ladders plugin moves anyone. */
function claimLadder(request) {
  const { player, objectId } = request;
  if (objectId === Shared.OBJECTS.ENTRANCE_LADDER) {
    climbDown(player);
    request.handled = true;
  } else if (objectId === Shared.OBJECTS.EXIT_LADDER) {
    leaveArena(player);
    request.handled = true;
  }
}

/**
 * Tagging a dispenser: the active one pays a ticket, a voucher and the level-scaled XP; the
 * darts version dodges first (level 40, damage and a two-level drain on a miss), then pays the
 * darts obstacle's 30 XP. An inactive one only complains, and a second tag in the same cycle
 * is refused.
 */
function tagDispenser(event) {
  const { player, objectId, location } = event;
  if (objectId !== Shared.OBJECTS.TICKET_DISPENSER && objectId !== Shared.OBJECTS.DARTS_DISPENSER) return false;
  if (!location) return false;
  const active = Shared.activeTile();
  if (!active || location.x !== active.x || location.y !== active.y) {
    player.sendMessage(Shared.INACTIVE_MESSAGE);
    return;
  }
  if (Shared.stateOf(player).taggedCycle === Shared.cycle.index) {
    player.sendMessage(Shared.REPEAT_MESSAGE);
    return;
  }
  if (objectId === Shared.OBJECTS.DARTS_DISPENSER) {
    const level = Shared.agilityLevel(player);
    if (level < Shared.OBSTACLE_LEVEL.DARTS) {
      player.sendMessage(Shared.levelRefusal(Shared.OBSTACLE_LEVEL.DARTS));
      return;
    }
    if (!Shared.roll(Shared.successChance(Shared.DARTS_SUCCESS.low, Shared.DARTS_SUCCESS.high, level))) {
      player.sendMessage(Shared.DARTS_FAIL_MESSAGE);
      Shared.drainAgility(player, 2);
      Shared.hit(player, Shared.trapDamage(player.getHitpoints()));
      return;
    }
    Shared.addXp(player, Shared.OBSTACLE_XP.DARTS);
  }
  Shared.rewardTag(player);
}

/** The world cycle: ticked once a server tick, advanced every minute. */
let cycleTask = null;

function startCycle() {
  const { Task, TaskManager } = Shared.core();
  Shared.advanceCycle();
  cycleTask = new (class extends Task {
    constructor() {
      super(1, Shared.CYCLE_TASK_KEY, false);
    }
    execute() {
      Shared.tick();
    }
  })();
  TaskManager.submit(cycleTask);
}

function shutdown() {
  cycleTask?.stop();
  cycleTask = null;
}

/** Logging out inside the arena throws the player into the entrance hut and forgets them. */
function logout({ player }) {
  if (!player) return;
  const core = Shared.core();
  if (Shared.isInArena(player)) {
    player.setLocation(new core.Location(Shared.HUT.x, Shared.HUT.y, Shared.HUT.z));
    player.setAttribute(Shared.PAID_ATTRIBUTE, null);
  }
  Shared.clearState(player);
}

/** Any login that still thinks it is in the arena starts outside. */
function login({ player }) {
  if (!player) return;
  if (Shared.isInArena(player)) {
    const core = Shared.core();
    player.moveTo(new core.Location(Shared.HUT.x, Shared.HUT.y, Shared.HUT.z));
    resetOnLeaving(player);
    return;
  }
  if (hasPaid(player)) player.getPacketSender().sendVarbit(CANENTER_VARBIT, 1);
}

/** Death respawns outside; the world cycle keeps running. */
function death(event) {
  const player = event?.player;
  if (!player || !Shared.isInArena(player)) return;
  const core = Shared.core();
  resetOnLeaving(player);
  player.moveTo(new core.Location(Shared.HUT.x, Shared.HUT.y, Shared.HUT.z));
  event.handled = true;
}

module.exports = (api) => {
  api.persistAttribute(Shared.PAID_ATTRIBUTE);
  api.onNpcInteraction(Shared.NPC.IZZY, { Pay: payIzzy });
  api.onNpcDialogueCondition(answerCondition);
  api.onCustomEvent("npc-dialogue:action", transcriptPayment);
  api.onObjectInteraction("Ticket Dispenser", { Tag: tagDispenser });
  api.onCustomEvent("ladders:climb", claimLadder);
  api.onServerStartup(startCycle);
  api.onServerShutdown(shutdown);
  api.onPlayerLogout(logout);
  api.onPlayerLogin(login);
  api.onPlayerDeath(death);
};

module.exports.enterArena = enterArena;
module.exports.leaveArena = leaveArena;
module.exports.payIzzy = payIzzy;
module.exports.climbDown = climbDown;
module.exports.answerCondition = answerCondition;
module.exports.transcriptPayment = transcriptPayment;
module.exports.hasPaid = hasPaid;
module.exports.tagDispenser = tagDispenser;
module.exports.startCycle = startCycle;
module.exports.shutdown = shutdown;
module.exports.logout = logout;
module.exports.login = login;
module.exports.death = death;
module.exports.claimLadder = claimLadder;
