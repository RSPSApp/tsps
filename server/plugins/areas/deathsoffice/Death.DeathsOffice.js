"use strict";

/**
 * Death. The lines and their order are the Wiki's transcript. The greeting with or without a
 * grave, early collection, "No, I want to talk about something else." and the chathead moods of
 * those lines are from rsprox recordings 86, 89, 1751 and 1764; the other lines' moods are
 * UNVERIFIED. Talk-to and Collect reach across his desk.
 */
const Common = require("./Common.DeathsOffice");
const Instance = require("./Instance.DeathsOffice");
const Entrances = require("./Entrances.DeathsOffice");
const Retrieval = require("./Retrieval.DeathsOffice");

const DESK_RANGE = 3;
const ANGEL_PRICE = 200000;
const COINS = 995;
const STYLE = { BASIC: 0, ANGEL: 1 };
const SELECT = "Select an option";

/** graphical_multi (140): the two grave styles to pick from. */
const STYLE_PICKER = { title: 4, basic: 2, angel: 3, basicPic: 5, angelPic: 6 };
const STYLE_PICKER_GROUP = 140;
/** The cache's display models of the two styles (both objs are named "Gravestone"). */
const STYLE_OBJ = { basic: "sirens_tome", angel: "osb7_comb" };

/** A unit that answers Talk-to and Collect instead (the first-death tutorial); true when it did. */
let override = { talk: () => false, collect: () => false };
const picking = new Map();

function uid(child) {
  return (STYLE_PICKER_GROUP << 16) | child;
}

// ---------------------------------------------------------------- greetings

/**
 * Talk-to, or Death speaking when the player reaches his desk. `context` says why: { talk },
 * { login } (logged in inside) or { arrived } (came through an entrance). A game mode with a
 * conversation of its own answers `deaths-office:greet` { player, context, handled } first.
 */
function greet(player, context = {}) {
  if (override.talk(player)) return;
  const query = { player, context, handled: false };
  Common.api().emitCustomEvent("deaths-office:greet", query);
  if (query.handled) return;
  const state = Common.state(player);
  if (state.ironman === "ultimate") {
    ultimateIronman(player);
    return;
  }
  if (state.grave) {
    graveGreeting(player, state);
    return;
  }
  Common.talk(player, [{ npc: "Hello mortal. Have you come to retrieve something you lost when you died?", mood: "bored" }], () => mainOptions(player));
}

function ultimateIronman(player) {
  Common.talk(player, [
    { npc: "Hello mortal. If you're looking for something you lost when you died, I'm afraid I don't cater to Ultimate Ironmen. Your items would have fallen on the ground where you died.", mood: "bored" },
    { player: "Can I change how I die?", mood: "quiz" },
  ], () => changeDeath(player));
}

function graveGreeting(player, state) {
  Common.talk(player, [{ npc: "Hello mortal. I see you have a gravestone, somewhere in the world. Did you want to ask me about it?", mood: "bored" }], () => Common.choose(player, SELECT,
    ["Can I collect the items from that gravestone now?", () => collectEarly(player, state)],
    ["No, I want to talk about something else.", () => Common.talk(player, [
      { player: "No, I want to talk about something else.", mood: "bored" },
      { npc: "Very well. Have you come to retrieve something you lost from a previous gravestone?", mood: "happy" },
    ], () => mainOptions(player))],
  ));
}

/** Since 10 April 2024 Death quotes his office's fee for the whole grave. */
function collectEarly(player, state) {
  const fee = state.grave.officeFee;
  const cost = fee > 0
    ? `I expect this fee to be about ${Common.formatCoins(fee)} coins for this reclaim.`
    : "I however expect it to be free for this reclaim.";
  Common.talk(player, [
    { player: "Can I collect the items from that gravestone now?", mood: "quiz" },
    { npc: `If you wish. However, I do charge for returning items here - you would likely pay less if you collect them from the gravestone directly. ${cost}`, mood: "quiz" },
  ], () => Common.choose(player, SELECT,
    ["Bring my items here now; I'll pay your fee.", () => Common.talk(player, [{ player: "Bring my items here now; I'll pay your fee.", mood: "angry" }], () => {
      Common.api().emitCustomEvent("gravestones:expire", { player });
      Retrieval.open(player);
    })],
    ["Actually I'll go and collect them at the gravestone.", () => Common.talk(player, [{ player: "Actually I'll go and collect them at the gravestone.", mood: "neutral" }])],
  ));
}

// ---------------------------------------------------------------- the menus

function mainOptions(player) {
  Common.choose(player, SELECT,
    ["How does that work?", () => howDoesThatWork(player)],
    ["What is this place?", () => whatIsThisPlace(player)],
    ["Yes, have you got anything for me?", () => anythingForMe(player)],
    ["More options...", () => moreOptions(player)],
  );
}

function moreOptions(player) {
  Common.choose(player, SELECT,
    ["Can I choose a different-looking gravestone?", () => chooseGravestone(player)],
    ["Can I change how I die?", () => changeDeath(player)],
    ["Not just now, thanks.", () => notNow(player)],
    ["Previous options...", () => mainOptions(player)],
  );
}

/** UNVERIFIED: live also turns the camera to the Coffer here; the client has no camera move yet. */
function howDoesThatWork(player) {
  Common.talk(player, [
    { player: "How does that work?", mood: "quiz" },
    { npc: "When you die, you often drop things you were carrying. In most cases, a gravestone appears near where you died, and your items can be retrieved there.", mood: "bored" },
    { npc: "However, gravestones do not last for long. When your gravestone collapses, your items come here, to me. I can return them to you - though I charge a fee for my services.", mood: "shifty" },
    { npc: "Aside from that, if you bring me your unwanted possessions, and sacrifice them into my Coffer here, I'll count their value against any future fees I charge you.", mood: "happy" },
    { npc: "I don't accept just any junk, but I'll try to give you a good price for anything decent.", mood: "shifty" },
    { npc: "So do you need to retrieve something you lost when you died?", mood: "bored" },
  ], () => Common.choose(player, SELECT,
    ["What is this place?", () => whatIsThisPlace(player)],
    ["Yes, have you got anything for me?", () => anythingForMe(player)],
    ["Can I choose a different-looking gravestone?", () => chooseGravestone(player)],
    ["Not just now, thanks.", () => notNow(player)],
  ));
}

function whatIsThisPlace(player) {
  Common.talk(player, [
    { player: "What is this place?", mood: "quiz" },
    { npc: "As you should be able to see, I am Death. The Grim Reaper. The Inexorable One. The Inescapable Grasp of Mortal Destiny. And this is my little office. Nice, isn't it?", mood: "neutral" },
  ], () => Common.choose(player, SELECT,
    ["It's lovely.", () => Common.talk(player, [
      { player: "It's lovely.", mood: "happy" },
      { npc: "Thank you. I feel the colour scheme suits my style. Now, can I help you retrieve something you lost when you died?", mood: "happy" },
    ], () => mainOptions(player))],
    ["Your decorations leave a bit to be desired.", () => Common.talk(player, [
      { player: "Your decorations leave a bit to be desired.", mood: "neutral" },
      { npc: "Sometimes it's hard to care for beauty when one's very existence is just seen as a curse upon the world. Now, do you actually want to retrieve something from me?", mood: "sad" },
    ], () => mainOptions(player))],
  ));
}

function anythingForMe(player) {
  Common.talk(player, [{ player: "Yes, have you got anything for me?", mood: "happy" }], () => Retrieval.open(player));
}

/** The Wiki: the death animation picker opens here; it isn't built yet, so Death stops at his question. */
function changeDeath(player) {
  Common.talk(player, [
    { npc: "Er... I suppose so.", mood: "neutral" },
    { npc: "How would you like to... die?", mood: "quiz" },
  ]);
}

function notNow(player) {
  Common.talk(player, [
    { player: "Not just now, thanks.", mood: "neutral" },
    { npc: "Really? There isn't much else for you to do here. But you know your business.", mood: "bored" },
  ]);
}

// ---------------------------------------------------------------- the grave style

function chooseGravestone(player) {
  Common.talk(player, [{ player: "Can I choose a different-looking gravestone?", mood: "quiz" }], () => openStylePicker(player));
}

/** graphical_multi: the basic grave (free) and the angel (200k). UNVERIFIED: the title. */
function openStylePicker(player) {
  const { CacheDefinitions } = Common.core();
  const state = Common.state(player);
  const sender = player.getPacketSender();
  sender.sendChatboxInterface(STYLE_PICKER_GROUP)
    .sendString(`Death's Coffer: ${Common.formatCoins(state.coffer)} coins`, uid(STYLE_PICKER.title))
    .sendItemOnInterfaces(uid(STYLE_PICKER.basicPic), CacheDefinitions.getObjId(STYLE_OBJ.basic), 0)
    .sendItemOnInterfaces(uid(STYLE_PICKER.angelPic), CacheDefinitions.getObjId(STYLE_OBJ.angel), 0)
    .sendString("<br><br><br><br>Basic: Free", uid(STYLE_PICKER.basic))
    .sendString("<br><br><br><br>Angel: 200k coins", uid(STYLE_PICKER.angel));
  picking.set(player, true);
}

function pickStyle(event) {
  const { player } = event;
  if (!picking.delete(player)) return;
  const angel = event.buttonId === uid(STYLE_PICKER.angel);
  player.getPacketSender().closeInterface(STYLE_PICKER_GROUP);
  const state = Common.state(player);
  if (angel) pickAngel(player, state);
  else pickBasic(player, state);
}

function tryAgain(player) {
  return [
    ["Can I choose a different-looking gravestone?", () => chooseGravestone(player)],
    ["Actually, never mind.", () => Common.talk(player, [{ player: "Actually, never mind.", mood: "neutral" }])],
  ];
}

function pickBasic(player, state) {
  if (state.style === STYLE.BASIC) {
    Common.talk(player, [{ npc: "You've already got the basic gravestone.", mood: "bored" }], () => Common.choose(player, SELECT, ...tryAgain(player)));
    return;
  }
  Common.talk(player, [{ npc: "Do you really want to switch to the basic gravestone? I'm not offering to give back the fee you paid earlier.", mood: "quiz" }], () => Common.choose(player, SELECT,
    ["Yes, I want the basic gravestone.", () => Common.talk(player, [{ player: "Yes, I want the basic gravestone.", mood: "neutral" }], () => {
      setStyle(player, STYLE.BASIC);
      Common.talk(player, [{ item: Common.core().CacheDefinitions.getObjId(STYLE_OBJ.basic), text: "Your gravestone is now the basic type." }]);
    })],
    ["Actually, never mind.", () => Common.talk(player, [{ player: "Actually, never mind.", mood: "neutral" }])],
  ));
}

/**
 * "I can take coins from your inventory, or from my Coffer." UNVERIFIED: which goes first when
 * both could pay; the inventory's here.
 */
function pickAngel(player, state) {
  if (state.style === STYLE.ANGEL) {
    // UNVERIFIED: the Wiki has no line for picking the angel again.
    Common.talk(player, [{ npc: "You've already got the Angel of Death.", mood: "bored" }], () => Common.choose(player, SELECT, ...tryAgain(player)));
    return;
  }
  const carried = player.getInventory().getAmount(COINS) >= ANGEL_PRICE;
  if (!carried && state.coffer < ANGEL_PRICE) {
    Common.talk(player, [{ npc: "You haven't got 200,000 coins to pay for that. I can take coins from your inventory, or from my Coffer.", mood: "bored" }], () => Common.choose(player, SELECT, ...tryAgain(player)));
    return;
  }
  Common.talk(player, [{ npc: "Most people won't see your grave, by the way. It appears to you, but it aims to be invisible to everyone else. Are you sure you want to buy a cosmetic override for it?", mood: "quiz" }], () => Common.choose(player, SELECT,
    ["Yes, I understand other people won't often see it.", () => Common.talk(player, [{ player: "Yes, I understand other people won't often see it.", mood: "happy" }], () => buyAngel(player))],
    ["No thanks, it's not worth it.", () => Common.talk(player, [
      { player: "No thanks, it's not worth it.", mood: "neutral" },
      { npc: "It is not for me to judge how people spend their money.", mood: "bored" },
    ])],
  ));
}

function buyAngel(player) {
  const inventory = player.getInventory();
  if (inventory.getAmount(COINS) >= ANGEL_PRICE) {
    inventory.deleteNumber(COINS, ANGEL_PRICE);
    inventory.refreshItems();
  } else if (!Common.adjustCoffer(player, -ANGEL_PRICE)) {
    return;
  }
  Common.sound(player, Common.PAYMENT_SOUND, Common.PAYMENT_SOUND_DELAY);
  setStyle(player, STYLE.ANGEL);
  Common.talk(player, [
    { item: Common.core().CacheDefinitions.getObjId(STYLE_OBJ.angel), text: "Your gravestone is now the Angel of Death." },
    { npc: "It is not for me to judge how people spend their money.", mood: "bored" },
  ]);
}

function setStyle(player, style) {
  Common.api().emitCustomEvent("gravestones:set-style", { player, style });
}

// ---------------------------------------------------------------- options on Death

function reachAcrossDesk(event) {
  if (event.npcId === Common.ID.death && Instance.deathOf(event.player) === event.npc) event.range = DESK_RANGE;
}

function talkTo({ player, npc }) {
  if (Instance.deathOf(player) !== npc) return false;
  greet(player, { talk: true });
  return true;
}

/**
 * Collect opens the retrieval interface, even with nothing stored (rsprox recording 4266). A game
 * mode with its own answer takes `deaths-office:collect` { player, handled } first.
 */
function collect({ player, npc }) {
  if (Instance.deathOf(player) !== npc) return false;
  if (override.collect(player)) return true;
  const query = { player, handled: false };
  Common.api().emitCustomEvent("deaths-office:collect", query);
  if (query.handled) return true;
  Retrieval.open(player);
  return true;
}

/**
 * `deaths-office:talk` { player, steps, then }: another plugin has Death (and the player) say
 * `steps` with the office's own chatheads and moods ({ npc | player: text, mood }, { statement },
 * { item, text }), then runs `then`.
 */
function talkRequest(request) {
  if (!request?.player || !Array.isArray(request.steps) || request.handled) return;
  request.handled = true;
  Common.talk(request.player, request.steps, typeof request.then === "function" ? request.then : null);
}

function setOverride(handlers) {
  override = { ...override, ...handlers };
}

function attach(api) {
  Common.bind(api);
  Instance.onGreet(greet);
  Entrances.onGreet(greet);
  api.onNpcRoute(reachAcrossDesk);
  api.onNpcInteraction("Death", { "Talk-to": talkTo, Collect: collect });
  api.onInterfaceActionButton([uid(STYLE_PICKER.basic), uid(STYLE_PICKER.angel)], pickStyle);
  api.onCustomEvent("deaths-office:talk", talkRequest);
}

module.exports = { attach, greet, mainOptions, setOverride };
