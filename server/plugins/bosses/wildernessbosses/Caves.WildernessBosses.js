/**
 * The Wilderness boss caves (https://oldschool.runescape.wiki/w/Escape_Caves and the lairs'
 * pages): six lairs and the Escape Caves between the three multi-combat ones, as captured
 * (docs/wilderness-bosses.md).
 *
 * - Entrances: "Enter" (the Vet'ion crevice "Jump-Down") asks the shared 50,000 coin fee unless it
 *   is paid, then the player crawls in (godwars_human_crawling) and lands a tick later
 *   (human_falling_end). The fee comes from the inventory, the bank or both; each kill where the
 *   player did the most damage takes 10,000 off the next one. It stays paid until the player
 *   dies to another player without having left the Wilderness since their last visit, and that
 *   player gets it as loot. world.json pluginConfig `WildernessBosses:entryFee` changes the fee;
 *   at 0 every entry is the silent free one a full discount gives.
 * - The Wiki gates each lair behind the medium Wilderness diary or a boss Slayer task of the
 *   boss; world.json pluginConfig `WildernessBosses:requireDiary` (default true) turns it off.
 * - "Peek": needs 20 kills of the boss; then says whether anyone is inside. "Check-Fee": the fee,
 *   whether it is paid and the discount.
 * - Exits: the singles lairs come out beside their entrance; the multi lairs at one of the
 *   Escape Caves' three arrival points at random, the same one as the player before if they
 *   left the same lair within 10 seconds. Logging out in a multi lair does the same.
 * - Each lair is an Area on PvP ground: it runs the Wilderness's own rules first
 *   ("wilderness:rules"), shows the singles-plus icon in the singles lairs, and blocks
 *   teleports for 3 ticks after entering unless the hard Wilderness diary is done.
 */
const Common = require("./Common.WildernessBosses");
const EscapeCaves = require("./EscapeCaves.WildernessBosses");
const Hud = require("./Hud.WildernessBosses");

const REQUIRE_DIARY_CONFIG = "WildernessBosses:requireDiary";
const ENTRY_FEE_CONFIG = "WildernessBosses:entryFee";
const ENTERED_AT_ATTRIBUTE = "wilderness-bosses:entered-at";
const TELEPORT_LOCK_TICKS = 3;
const ENGAGED_AT_ATTRIBUTE = "wilderness-bosses:engaged-at";
const ABANDONED_TICKS = 100;
/** The engaged-at value of a boss already reset, until it fights again. */
const RESET = "reset";

/** As captured: the escape caves are crawled through (human_longcrawl). */
const LONG_CRAWL = 2796;

const FEE_BOX = (cost) => `You need to pay a ${format(cost)} coin fee to enter.<br>This can be taken from your inventory, bank, or both.`;
const FEE_PROMPT = (cost) => `Pay ${format(cost)} coins to enter?`;
const PEEK_NO_KILLS = "You don't know this cave well enough to glean any useful information. You feel that you'll be more successful once you've killed whatever is inside, 20 times.";
const PEEK_MORE_KILLS = (left) => `You don't know this cave well enough to glean any useful information. You feel that you'll be more successful once you've killed the boss inside, ${left} more times.`;
const PEEK_EMPTY = "You peek into the darkness and everything seems quiet. The cave is empty.";
const PEEK_ACTIVE = "You peek into the darkness and can make out some movement. There is activity inside.";
/** Not captured (ours): the gate, the shortfall and the teleport lock. */
const GATE_MESSAGE = (boss) => `You need to have completed the medium Wilderness Diary, or have a ${boss} Slayer task, to enter this cave.`;
const NO_COINS_MESSAGE = "You don't have enough coins to pay the entry fee.";
const NO_FEE_TEXT = "There is no entry fee for these caves.";
const TELEPORT_LOCKED_MESSAGE = "You can't teleport out of here yet.";

/** Slayer boss task names for each lair's boss (a bear task does not count). */
const SLAYER_BOSSES = Object.freeze({
  callisto: ["callisto", "artio"],
  artio: ["callisto", "artio"],
  vetion: ["vet'ion", "calvar'ion"],
  calvarion: ["vet'ion", "calvar'ion"],
  venenatis: ["venenatis", "spindel"],
  spindel: ["venenatis", "spindel"],
});

let api = null;
let core = null;
/** lair key -> the area registered for it. */
const areas = new Map();
/** multi lair key -> { tick, arrival } of its last exit, for the 10-second follow. */
const lastExits = new Map();

function format(amount) {
  return amount.toLocaleString("en-US");
}


function tileKey(at) {
  return `${at[0]},${at[1]},${at[2]}`;
}

function eventKey(event) {
  return `${event.location.x},${event.location.y},${event.location.z}`;
}

const ENTRANCES = new Map(Common.LAIRS.map((lair) => [tileKey(lair.entrance.at), lair]));
const EXITS = new Map(Common.LAIRS.map((lair) => [tileKey(lair.exit.at), lair]));
const ESCAPE_ENTRANCES = new Map(Common.ESCAPE.entrances.map((entrance) => [tileKey(entrance.at), entrance]));
const ESCAPE_EXITS = new Map(Common.ESCAPE.exits.map((exit) => [tileKey(exit.at), exit]));

// ------------------------------------------------------------------ the fee

/** The base fee before discounts: wilderness-bosses.json's (the Wiki's 50,000) unless the world sets one. */
function baseFee() {
  const fee = Number(api?.getPluginConfig(ENTRY_FEE_CONFIG, Common.DATA.fee));
  return Number.isSafeInteger(fee) && fee >= 0 ? fee : Common.DATA.fee;
}

/** The most kills can take off the fee: the Wiki's 50,000, never more than the fee itself. */
function maxDiscount() {
  return Math.min(Common.DATA.maxDiscount, baseFee());
}

function feePaid(player) {
  return player.getAttribute(Common.FEE_PAID_ATTRIBUTE) === true;
}

function discount(player) {
  return Number(player.getAttribute(Common.DISCOUNT_ATTRIBUTE)) || 0;
}

function feeCost(player) {
  return Math.max(0, baseFee() - discount(player));
}

function sendFeeState(player) {
  player.getPacketSender()
    .sendVarbit(Common.VARBIT.FEE_PAID, feePaid(player) ? 1 : 0)
    .sendVarbit(Common.VARBIT.DISCOUNT, Math.floor(discount(player) / Common.DATA.discountPerKill))
    .sendVarbit(Common.VARBIT.FEE_WARNING, player.getAttribute(Common.NO_WARNING_ATTRIBUTE) === true ? 1 : 0);
}

/**
 * Takes the fee from the inventory, the bank or both. The inventory message is captured; the
 * bank's and both's follow it (not captured).
 */
function payFee(player) {
  const cost = feeCost(player);
  const inventory = player.getInventory();
  const bank = player.getBank(core.Bank.getTabForItem(player, Common.COINS));
  const carried = Math.min(inventory.getAmount(Common.COINS), cost);
  if (carried + bank.getAmount(Common.COINS) < cost) {
    player.sendMessage(NO_COINS_MESSAGE);
    return false;
  }
  if (carried > 0) inventory.delete(Common.COINS, carried);
  if (carried < cost) bank.delete(Common.COINS, cost - carried);
  const from = carried === cost ? "your inventory" : carried === 0 ? "your bank" : "your inventory and bank";
  player.setAttribute(Common.FEE_PAID_ATTRIBUTE, true);
  player.setAttribute(Common.FEE_AMOUNT_ATTRIBUTE, cost);
  player.setAttribute(Common.DISCOUNT_ATTRIBUTE, 0);
  if (cost > 0) player.sendMessage(`<col=ef1020>You enter the cave and ${format(cost)} coins is taken from ${from} to pay the entry fee.`);
  sendFeeState(player);
  return true;
}

/** Paid, or "don't ask again": in. Otherwise the captured box, then the three-way prompt. */
function feeThen(player, enter) {
  if (feePaid(player)) {
    enter();
    return;
  }
  if (player.getAttribute(Common.NO_WARNING_ATTRIBUTE) === true || feeCost(player) === 0) {
    if (payFee(player)) enter();
    return;
  }
  const cost = feeCost(player);
  const { DialogueChainBuilder, ItemStatementDialogue, ActionDialogue } = core;
  player.getDialogueManager().startDialogues(new DialogueChainBuilder()
    .add(new ItemStatementDialogue(0, Common.COINS_ICON, FEE_BOX(cost)))
    .add(new ActionDialogue(1, {
      execute: () => api.sendMultiChatboxPrompt(player, FEE_PROMPT(cost),
        "Yes.", () => payAndEnter(player, enter, false),
        "Yes, and don't ask again.", () => payAndEnter(player, enter, true),
        "No.", () => {}),
    })));
}

function payAndEnter(player, enter, dontAskAgain) {
  if (dontAskAgain) {
    player.setAttribute(Common.NO_WARNING_ATTRIBUTE, true);
    player.getPacketSender().sendVarbit(Common.VARBIT.FEE_WARNING, 1);
  }
  if (payFee(player)) enter();
}

function checkFee({ player }) {
  const fee = baseFee();
  const paid = feePaid(player);
  const off = discount(player);
  const text = fee === 0 ? NO_FEE_TEXT : `The base entry fee for these caves is ${format(fee)} coins,<br>`
    + `${paid ? "which you have paid" : "which you have not paid"}. Killing wilderness bosses will<br>`
    + `reduce the fee by ${format(Common.DATA.discountPerKill)}. `
    + (off > 0 ? `You have a ${format(off)} discount<br>towards your next fee.` : "You have no discount<br>towards your next fee.");
  player.getDialogueManager().startDialogues(new core.DialogueChainBuilder()
    .add(new core.ItemStatementDialogue(0, Common.COINS_ICON, text)));
}

/**
 * A kill where the player did the most damage: 10,000 off the next fee, up to 50,000 (captured
 * message). Called by the bosses' loot. A world with a lower fee caps it there; one without a fee
 * has nothing to discount.
 */
function addDiscount(player) {
  const before = discount(player);
  const most = maxDiscount();
  if (before >= most) return;
  const after = Math.min(most, before + Common.DATA.discountPerKill);
  player.setAttribute(Common.DISCOUNT_ATTRIBUTE, after);
  player.getPacketSender().sendVarbit(Common.VARBIT.DISCOUNT, Math.floor(after / Common.DATA.discountPerKill));
  const max = after >= most ? " You now have the maximum discount." : "";
  player.sendMessage(`Your entry fee discount has increased. It is now ${format(after)} / ${format(most)} coins.${max}`);
}

// ------------------------------------------------------------------ entrances

/**
 * Puts a player who was just moved into a cave into its area. The Wilderness's own area covers
 * the caves too, and a player keeps the area they hold while it still contains them, so a move
 * from the surface would otherwise leave them in it.
 */
function claim(player, area) {
  if (!area || player.getArea() === area) return;
  area.enter(player);
  player.setArea(area);
}

function meetsGate(player, lair) {
  if (!api.getPluginConfig(REQUIRE_DIARY_CONFIG, true)) return true;
  if (Common.isDiaryComplete(player, "medium")) return true;
  const request = { player, task: null };
  api.emitCustomEvent("slayer:current-task", request);
  return (SLAYER_BOSSES[lair.key] ?? []).includes(String(request.task?.name ?? "").toLowerCase());
}

/** Crawls in: the crawl now, a tick later the landing on a random arrival tile. */
function crawlInto(player, lair, at) {
  player.setPositionToFace(new core.Location(at[0], at[1], at[2]));
  player.getMovementQueue().reset();
  player.performAnimation(new core.Animation(Common.ANIMATION.CRAWL));
  Common.later(lair.entrance.crawlTicks, () => {
    if (!player.isRegistered()) return;
    player.moveTo(Common.randomTile(lair.entrance.arrive));
    player.performAnimation(new core.Animation(Common.ANIMATION.LAND));
    claim(player, areas.get(lair.key));
  }, player);
}

function enterLair(event) {
  const lair = ENTRANCES.get(eventKey(event));
  if (!lair || event.objectId !== lair.entrance.id) return false;
  const { player } = event;
  if (!meetsGate(player, lair)) {
    player.sendMessage(GATE_MESSAGE(lair.boss));
    return true;
  }
  feeThen(player, () => crawlInto(player, lair, lair.entrance.at));
  return true;
}

function peek(event) {
  const lair = ENTRANCES.get(eventKey(event));
  if (!lair || event.objectId !== lair.entrance.id) return false;
  const { player } = event;
  player.setPositionToFace(new core.Location(lair.entrance.at[0], lair.entrance.at[1], lair.entrance.at[2]));
  const kills = Common.kills(player, lair);
  if (kills < Common.DATA.peekKills) {
    player.sendMessage(kills === 0 ? PEEK_NO_KILLS : PEEK_MORE_KILLS(Common.DATA.peekKills - kills));
    return true;
  }
  const inside = areas.get(lair.key)?.getPlayers().length ?? 0;
  player.sendMessage(inside > 0 ? PEEK_ACTIVE : PEEK_EMPTY);
  return true;
}

function checkLairFee(event) {
  if (!ENTRANCES.has(eventKey(event)) && !ESCAPE_ENTRANCES.has(eventKey(event))) return false;
  checkFee(event);
  return true;
}

// ------------------------------------------------------------------ exits

/** One of the Escape Caves' three arrival points; the last one if the lair was left < 10 s ago. */
function escapeArrival(lair) {
  const now = core.World.getProcessCycle();
  const last = lastExits.get(lair.key);
  const arrival = last && now - last.tick <= Common.ESCAPE.followTicks
    ? last.arrival
    : Common.ESCAPE.arrivals[Math.floor(Math.random() * Common.ESCAPE.arrivals.length)];
  lastExits.set(lair.key, { tick: now, arrival });
  return arrival;
}

function exitDestination(lair) {
  return Common.randomTile(lair.exit.to === "escape" ? escapeArrival(lair) : lair.exit.to);
}

/** As captured: no animation, out on the next tick. */
function exitLair(event) {
  const lair = EXITS.get(eventKey(event));
  if (!lair || event.objectId !== lair.exit.id) return false;
  const { player } = event;
  Common.later(1, () => {
    if (!player.isRegistered()) return;
    const destination = exitDestination(lair);
    player.moveTo(destination);
    if (Common.inEscapeCaves(destination)) EscapeCaves.enteredFromLair(player);
  }, player);
  return true;
}

/** A surface "Cave" into the Escape Caves: the fee, then a long crawl in. */
function enterEscapeCaves(event) {
  const entrance = ESCAPE_ENTRANCES.get(eventKey(event));
  if (!entrance || event.objectId !== entrance.id) return false;
  const { player } = event;
  feeThen(player, () => {
    player.getMovementQueue().reset();
    player.performAnimation(new core.Animation(LONG_CRAWL));
    Common.later(1, () => {
      if (!player.isRegistered()) return;
      player.moveTo(Common.randomTile(entrance.arrive));
      claim(player, EscapeCaves.area());
      EscapeCaves.enteredFromSurface(player);
    }, player);
  });
  return true;
}

/** The Escape Caves' ways out: a crawl (or a climb), out a tick later. */
function exitEscapeCaves(event) {
  const exit = ESCAPE_EXITS.get(eventKey(event));
  if (!exit || event.objectId !== exit.id) return false;
  const { player } = event;
  player.getMovementQueue().reset();
  player.performAnimation(new core.Animation(exit.animation));
  Common.later(1, () => {
    if (player.isRegistered()) player.moveTo(Common.randomTile(exit.to));
  }, player);
  return true;
}

/** A "Cave" exit: out of a lair, or out of the Escape Caves. */
function exitCave(event) {
  return exitLair(event) || exitEscapeCaves(event);
}

// ------------------------------------------------------------------ fee loss and logins

/** Leaving the Wilderness ends the visit that a player kill would cost the fee. */
function mapSquareChanged({ player }) {
  if (player.getAttribute(Common.VISITED_ATTRIBUTE) === true && !core.Wilderness.isIn(player)) {
    player.setAttribute(Common.VISITED_ATTRIBUTE, false);
  }
}

/** Killed by a player since the last visit: the fee is lost, and the killer gets it. */
function playerDied({ player, killer }) {
  if (!feePaid(player) || !killer?.isPlayer?.()) return;
  if (player.getAttribute(Common.VISITED_ATTRIBUTE) !== true) return;
  const amount = Number(player.getAttribute(Common.FEE_AMOUNT_ATTRIBUTE)) || 0;
  player.setAttribute(Common.FEE_PAID_ATTRIBUTE, false);
  player.setAttribute(Common.FEE_AMOUNT_ATTRIBUTE, 0);
  player.setAttribute(Common.VISITED_ATTRIBUTE, false);
  sendFeeState(player);
  if (amount > 0) {
    // An Ironman killer takes no other player's loot: the fee drops for the victim (PlayerDeathTask.lootOwner).
    const owner = core.PlayerDeathTask.lootOwner(player, killer.getAsPlayer());
    core.ItemOnGroundManager.registerLocation(owner, new core.Item(Common.COINS, amount), player.getLocation().clone());
  }
}

/** A login in a multi lair comes out in the Escape Caves, as leaving by any means does. */
function login({ player }) {
  sendFeeState(player);
  const lair = Common.lairAt(player.getLocation());
  if (lair?.exit.to === "escape") {
    player.moveTo(exitDestination(lair));
    EscapeCaves.enteredFromLair(player);
  }
}

// ------------------------------------------------------------------ the lairs

function teleportLocked(player) {
  const enteredAt = player.getAttribute(ENTERED_AT_ATTRIBUTE);
  if (!Number.isInteger(enteredAt)) return false;
  return core.World.getProcessCycle() - enteredAt < TELEPORT_LOCK_TICKS && !Common.isDiaryComplete(player, "hard");
}

/**
 * An idle boss takes on whoever is in its lair (captured: Callisto opens fire on a player who has
 * just crawled in at the far end of his den), beyond the engine's aggression range from its spawn.
 */
function rouse(player, lair, area) {
  const boss = Hud.bossIn(area, lair);
  if (!boss || boss.getHitpoints() <= 0 || player.getHitpoints() <= 0) return;
  const target = boss.getCombat().getTarget();
  if (target && area.hasMember(target)) return;
  const method = core.CombatFactory.getMethod(boss);
  if (core.CombatFactory.canAttack(boss, method, player) === core.CanAttackResponse.CAN_ATTACK) boss.getCombat().attack(player);
}

/**
 * A fight nobody is in any more (no target left in the lair, not hit, for 100 ticks: everyone
 * left, died or logged out) starts over, so the next group finds a whole boss with no hounds, traps or webs
 * left behind. Ours: OSRS's own timing isn't known.
 */
function watchFight(boss, lair, area) {
  const now = core.World.getProcessCycle();
  const target = boss.getCombat().getTarget();
  const engaged = (target != null && area.hasMember(target)) || boss.getCombat().ticksSinceAttacked() < 2;
  const since = boss.getAttribute(ENGAGED_AT_ATTRIBUTE);
  // A boss with nobody near isn't processed at all, so a long gap since it was last engaged is
  // an abandoned fight too, even if its old target has just come back.
  if (Number.isInteger(since) && now - since >= ABANDONED_TICKS && boss.getHitpoints() > 0) {
    boss.setAttribute(ENGAGED_AT_ATTRIBUTE, RESET);
    boss.getCombat().reset();
    Common.FIGHTS.get(lair.key)?.reset?.(boss);
    boss.setHitpoints(boss.getMaxHitpoints());
    boss.getCombat().clearDamageMap();
    return;
  }
  if (engaged || since == null) boss.setAttribute(ENGAGED_AT_ATTRIBUTE, now);
}

/**
 * The caves' Wilderness levels, as cache script 384 gives them: each lair's whole map square has
 * one level, and the Escape Caves rise 33 to 40 with y (33 + scale(y % 64 - 6, 50, 7)).
 */
function levelAt(x, y) {
  const inSquare = ([minX, minY, maxX, maxY]) => x >= minX && x <= maxX && y >= minY && y <= maxY;
  const lair = Common.LAIRS.find((each) => inSquare(each.box));
  if (lair) return lair.level;
  if (inSquare(Common.ESCAPE.box)) return 33 + Math.trunc(((y % 64) - 6) * 7 / 50);
  return null;
}

function createLairArea(lair) {
  class WildernessBossLair extends core.Area {
    constructor() {
      super([Common.boundary(lair.box, lair.plane)]);
      this.lair = lair;
    }

    process(mobile) {
      Common.rules()?.process(mobile);
      if (mobile.isNpc()) {
        if (lair.bossIds.includes(mobile.getId())) watchFight(mobile.getAsNpc(), lair, this);
        return;
      }
      Hud.process(mobile.getAsPlayer(), lair, this);
      rouse(mobile.getAsPlayer(), lair, this);
      Common.FIGHTS.get(lair.key)?.playerTick?.(mobile.getAsPlayer(), lair);
    }

    postEnter(mobile) {
      Common.rules()?.postEnter(mobile);
      if (mobile.isNpc()) {
        if (lair.bossIds.includes(mobile.getId())) Common.FIGHTS.get(lair.key)?.spawned?.(mobile.getAsNpc(), lair);
        return;
      }
      const player = mobile.getAsPlayer();
      player.setAttribute(Common.VISITED_ATTRIBUTE, true);
      player.setAttribute(ENTERED_AT_ATTRIBUTE, core.World.getProcessCycle());
      if (!lair.multi) player.getPacketSender().sendVarbit(Common.VARBIT.SINGLES_PLUS, 1);
      Hud.entered(player);
    }

    postLeave(mobile, logout) {
      Common.rules()?.postLeave(mobile, logout);
      if (!mobile.isPlayer()) return;
      const player = mobile.getAsPlayer();
      player.setAttribute(ENTERED_AT_ATTRIBUTE, null);
      if (!lair.multi) player.getPacketSender().sendVarbit(Common.VARBIT.SINGLES_PLUS, 0);
      Hud.left(player);
    }

    canAttack(attacker, target) {
      return Common.rules()?.canAttack(attacker, target) ?? null;
    }

    canTeleport(player, wildernessLevelLimit) {
      if (teleportLocked(player)) {
        player.sendMessage(TELEPORT_LOCKED_MESSAGE);
        return false;
      }
      return Common.rules()?.canTeleport(player, wildernessLevelLimit) ?? null;
    }

    npcAggressionTolerance(player, npc) {
      return Common.rules()?.npcAggressionTolerance(player, npc) ?? null;
    }

    isMulti() {
      return lair.multi;
    }
  }
  return new WildernessBossLair();
}

function playersIn(lairKey) {
  return areas.get(lairKey)?.getPlayers() ?? [];
}

function attach(pluginApi) {
  api = pluginApi;
  core = pluginApi.core;
  core.Wilderness.setLevelSource("wilderness-bosses", levelAt);
  for (const key of [Common.FEE_PAID_ATTRIBUTE, Common.NO_WARNING_ATTRIBUTE, Common.VISITED_ATTRIBUTE]) {
    pluginApi.persistAttribute(key, false);
  }
  pluginApi.persistAttribute(Common.DISCOUNT_ATTRIBUTE, 0);
  pluginApi.persistAttribute(Common.FEE_AMOUNT_ATTRIBUTE, 0);
  pluginApi.onObjectInteraction("Cave Entrance", { Enter: enterLair, Peek: peek, "Check-Fee": checkLairFee });
  pluginApi.onObjectInteraction("Crevice", { "Jump-Down": enterLair, Peek: peek, "Check-Fee": checkLairFee });
  pluginApi.onObjectInteraction("Memorial", { Enter: enterLair, Peek: peek, "Check-Fee": checkLairFee });
  pluginApi.onObjectInteraction("Cave", { Enter: enterEscapeCaves, Exit: exitCave, "Check-Fee": checkLairFee });
  pluginApi.onObjectInteraction("Exit", { "Climb-up": exitEscapeCaves });
  pluginApi.onPlayerMapSquareChange(mapSquareChanged);
  pluginApi.onPlayerDeath(playerDied);
  pluginApi.onPlayerLogin(login);
  for (const lair of Common.LAIRS) {
    const area = createLairArea(lair);
    areas.set(lair.key, area);
    pluginApi.registerArea(area);
  }
}

module.exports = {
  attach,
  addDiscount,
  playersIn,
  feeCost,
  _test: { feeThen, checkFee, ENTRANCES, EXITS, ESCAPE_ENTRANCES, ESCAPE_EXITS, ENTERED_AT_ATTRIBUTE, escapeArrival, payFee, meetsGate, teleportLocked, playerDied, lastExits, areas },
};
