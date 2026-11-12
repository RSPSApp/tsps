"use strict";

/**
 * A new Hardcore character starts in Death's Office (live 20261104T112753 and 20261104T120418):
 * - hc_first_time_leaving_tutorial_island = 1 while it is there for the first time;
 * - on arriving, Death: "Greetings, mortal. I've been expecting you.", then the Lumbridge Guide's
 *   box; Collect: "You cannot reclaim anything from me."; Shop (Death's, an Escape crystal for
 *   10,000 coins) is not here yet: shops come from osrsreboxed-db; talking to him adds "You have?", "Indeed... A new soul to partake in my challenge." and
 *   his questions (the answers to all but "Could you tell me more about Hardcore Mode?" are ours,
 *   data `ours`, until a capture on a Hardcore world has them);
 * - the exit portal then leads to Lumbridge Castle's courtyard (3221, 3219), the varbit goes to 0
 *   the tick it lands, and two ticks later "You have been given a complimentary Escape crystal from
 *   Death." with the crystal and the "Welcome to Lumbridge!" box.
 * The office itself is the DeathsOffice plugin's, reached through `deaths-office:*` events.
 */
const Common = require("./Common.HardcoreWorld");

/** Death's questions already asked this visit: "Could you tell me more" leaves the menu once heard (live). */
const heardMore = new WeakSet();
/** New characters still designing themselves: Death holds his greeting until they're done. */
const held = new WeakSet();
/** Those whose greeting came while held, to give once they're done. */
const owed = new WeakSet();

function arriving(player) {
  return Common.isHardcore(player) && Number(player.getAttribute(Common.ARRIVAL_ATTRIBUTE)) === 1;
}

/** Puts a brand-new character in Death's Office (again, if a relog left it outside), a tick after whatever started it. */
function start(player) {
  player.setAttribute(Common.ARRIVAL_ATTRIBUTE, 1);
  Common.setVarbit(player, "arrival", 1);
  Common.later(player, 1, () => Common.api().emitCustomEvent("deaths-office:enter", { player, entered: false }));
}

function deathSays(player, steps, then = null) {
  Common.api().emitCustomEvent("deaths-office:talk", { player, steps, then, handled: false });
}

/** Death holds his greeting while the character is still being designed. */
function holdGreeting(player) {
  held.add(player);
}

/** The character is made: Death greets now if he was waiting to. */
function releaseGreeting(player) {
  if (!held.delete(player)) return;
  if (owed.delete(player) && arriving(player)) arrivalGreeting(player);
}

function arrivalGreeting(player) {
  const { death } = Common.DATA;
  deathSays(player, [death.greeting, guideBox()]);
}

function guideBox() {
  return { item: Common.ids.objs.guideIcon, text: Common.DATA.messages.arrivalGuide };
}

/** `player:respawn`: a Hardcore world's respawn point is Death's Office. */
function respawn(event) {
  const { player } = event;
  if (event.handled || !Common.isHardcore(player)) return;
  event.handled = true;
  Common.api().emitCustomEvent("deaths-office:enter", { player, entered: false });
}

/**
 * `deaths-office:greet`: Death's words to a new Hardcore soul, in place of his usual ones; and
 * nothing while a life just ended waits for its choice (the choice screen speaks for him).
 */
function greet(query) {
  const { player, context } = query;
  if (Common.isHardcore(player) && player.getAttribute(Common.CHOICE_PENDING_ATTRIBUTE) === true && !context?.talk) {
    query.handled = true;
    return;
  }
  if (!arriving(player)) return;
  query.handled = true;
  const { death } = Common.DATA;
  if (context?.talk) {
    deathSays(player, [death.greeting, death.reply, death.newSoul], () => questions(player));
    return;
  }
  if (held.has(player)) {
    owed.add(player);
    return;
  }
  arrivalGreeting(player);
}

/** `deaths-office:collect`: a new soul has nothing with Death (live 20261104T112753). */
function collect(query) {
  if (!arriving(query.player)) return;
  query.handled = true;
  deathSays(query.player, [Common.DATA.death.cannotReclaim]);
}

function questions(player) {
  const { death, ours } = Common.DATA;
  const option = (key, steps) => [death.options[key], () => deathSays(player, [{ player: death.options[key], mood: "quiz" }, ...steps], () => questions(player))];
  const options = [
    option("continue", ours.continue),
    option("leave", ours.leave),
    option("who", ours.who),
    option("where", ours.where),
  ];
  if (!heardMore.has(player)) {
    options.push([death.options.more, () => {
      heardMore.add(player);
      deathSays(player, [{ player: death.options.more, mood: "quiz" }, ...death.more], () => questions(player));
    }]);
  }
  Common.api().sendMultiChatboxPrompt(player, death.menuTitle, ...options.flatMap(([text, action]) => [text, action]));
}

/** `deaths-office:exit`: the first way out leads to Lumbridge. */
function exitDestination(query) {
  if (!arriving(query.player)) return;
  const [x, y, z] = Common.DATA.lumbridge;
  query.destination = new (Common.core().Location)(x, y, z);
}

/** `deaths-office:left`: the journey begins, with Death's gift. */
function left({ player }) {
  if (!arriving(player)) return;
  player.setAttribute(Common.ARRIVAL_ATTRIBUTE, 0);
  Common.setVarbit(player, "arrival", 0);
  Common.later(player, Common.DATA.leaveLumbridgeDelayTicks, () => welcome(player));
}

function welcome(player) {
  const crystal = Common.ids.objs.escapeCrystal;
  if (Number.isInteger(crystal)) {
    player.getInventory().adds(crystal, 1);
    player.getInventory().refreshItems?.();
  }
  player.sendMessage(Common.DATA.messages.escapeCrystal);
  deathSays(player, [{ item: Common.ids.objs.guideIcon, text: Common.DATA.messages.welcomeLumbridge }]);
}

module.exports = function attach(api) {
  api.onCustomEvent("player:respawn", respawn);
  api.onCustomEvent("deaths-office:greet", greet);
  api.onCustomEvent("deaths-office:collect", collect);
  api.onCustomEvent("deaths-office:exit", exitDestination);
  api.onCustomEvent("deaths-office:left", left);
};

Object.assign(module.exports, { start, holdGreeting, releaseGreeting, respawn, greet, collect, exitDestination, left, welcome });
