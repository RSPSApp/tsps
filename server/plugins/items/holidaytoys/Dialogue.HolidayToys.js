"use strict";

// Holiday item options whose words are Wiki transcripts in the dialogue dump
// (npc-dialogues.json, imported from osrsreboxed-db). This file only picks the variant the
// player's state calls for, answers the transcripts' conditions and binds their effects.
const toys = require("../data/holiday-toys.json");

// Conversations held with the Haunted wine bottle while wearing a ghostspeak amulet.
const BOTTLE_TALKS_ATTRIBUTE = "holiday-toys:haunted-bottle-talks";
// Wrapping paper colours unlocked by delivering the Secret santa present, in delivery order
// (0 = red only, 4 = all). Wiki: a one-time unlock, kept if the present is destroyed.
const SANTA_COLOURS_ATTRIBUTE = "holiday-toys:secret-santa-colours";
const SANTA_PAGE = "Secret santa present";
// Transcript:Secret santa present, Change-colour section.
const NONE_UNLOCKED = "If no other colours are unlocked:";
const SOME_UNLOCKED = "If at least one colour is unlocked:";
const SOME_LOCKED = "If at least one colour still locked:";
const COLOUR_UNLOCKED = /^If (\w+) unlocked:$/;

let api;
let core;
let swapItem;
let options;
let santa;
// The holiday item conversation each player is in: what it was started from and how its
// message lines are shown. Replaced by the next one; checked against the transcript page.
const sessions = new WeakMap();
// Set while "Talk about other things." hands a delivery NPC back to its ordinary conversation.
const ordinary = new WeakSet();

function cacheId(name, lookup, what) {
  const id = core.CacheDefinitions[lookup](name);
  if (id == null) throw new Error(`HolidayToys: ${what} ${name} is missing from the active cache`);
  return id;
}

function init(pluginApi, swap) {
  api = pluginApi;
  core = pluginApi.core;
  swapItem = swap;
}

/** The dialogue options by `${itemId}:${option}`, resolved from cache names once. */
function build() {
  if (options) return options;
  const built = new Map();
  for (const entry of toys.dialogues) {
    const speakers = (entry.speakers ?? []).map(name => cacheId(name, "getNpcId", "NPC"));
    entry.items.forEach((name, index) => {
      built.set(`${cacheId(name, "getObjId", "item")}:${entry.option}`, {
        kind: "dialogue", page: entry.page, variant: entry.variant ?? null, state: entry.state ?? null,
        box: entry.box ?? null, statements: new Set(entry.statements ?? []),
        speaker: speakers.length ? speakers[Math.min(index, speakers.length - 1)] : null,
      });
    });
  }
  const { secretSanta } = toys;
  santa = {
    presents: secretSanta.presents.map(name => cacheId(name, "getObjId", "item")),
    seq: cacheId(secretSanta.seq, "getSeqId", "sequence"),
    spotanim: cacheId(secretSanta.spotanim, "getSpotanimId", "spotanim"),
  };
  toys.hauntedBottle.amuletIds = new Set(toys.hauntedBottle.amulets.map(name => cacheId(name, "getObjId", "item")));
  options = built;
  return options;
}

function colours(player) {
  return Number(player.getAttribute(SANTA_COLOURS_ATTRIBUTE)) || 0;
}

/** Wiki (Haunted wine bottle): the spirit talks to a player wearing a ghostspeak amulet. */
function wearsGhostspeak(player) {
  const amulet = player.getEquipment().get(core.Equipment.AMULET_SLOT)?.getId?.();
  return toys.hauntedBottle.amuletIds.has(amulet);
}

/** The transcript section the player's state calls for, and anything it counts. */
function variantFor(player, option) {
  if (option.state === "haunted-bottle") {
    const bottle = toys.hauntedBottle;
    if (!wearsGhostspeak(player)) return { variant: bottle.silent };
    const talks = (Number(player.getAttribute(BOTTLE_TALKS_ATTRIBUTE)) || 0) + 1;
    return { variant: bottle.variants[Math.min(talks, bottle.variants.length) - 1], talks };
  }
  if (option.state === "secret-santa-tag") return { variant: toys.secretSanta.tags[colours(player)] };
  return { variant: option.variant };
}

/** Plays a holiday item's transcript option; false when this module has no such option. */
function play(player, itemId, optionName, container, item) {
  const option = build().get(`${itemId}:${optionName}`);
  if (!option) return false;
  const { variant, talks } = variantFor(player, option);
  const session = { page: option.page, option, itemId, container, item, talks };
  const previous = sessions.get(player);
  sessions.set(player, session);
  const request = { player, npcId: option.speaker, variant: { page: option.page, variant }, exact: true, handled: false };
  api.emitCustomEvent("npc-dialogue:start", request);
  if (!request.handled) {
    if (previous) sessions.set(player, previous);
    else sessions.delete(player);
  } else if (talks != null) player.setAttribute(BOTTLE_TALKS_ATTRIBUTE, talks);
  return true;
}

function sessionFor(event) {
  const session = sessions.get(event.player);
  if (!session) return null;
  // Item conversations name only their page; deliveries are the NPC's own Talk-to.
  if (session.delivery ? event.npc !== session.npc : event.npcId != null && event.npcId !== session.option?.speaker) return null;
  return (event.pages ?? []).some(entry => entry.page === session.page) ? session : null;
}

/** Message lines: the transcripts' tbox lines are boxes, their mes lines chat. */
function showMessage(event) {
  const session = sessionFor(event);
  if (!session) return;
  if (session.delivery) {
    // "You've unlocked blue wrapping paper for your present." shows the new colour.
    if (session.accepted && /^You've unlocked \w+ wrapping paper/.test(event.text)) event.box = { items: [santa.presents[colours(event.player)]] };
    return;
  }
  const { option } = session;
  if (session.talks != null) event.text = String(event.text).replace(toys.hauntedBottle.count, String(session.talks));
  if (option.box === "item") event.box = { items: [session.itemId] };
  else if (option.statements.has(event.text)) event.box = { statement: true };
}

/**
 * "<NPC> performs an enchant animation and unlocks the new colour." Only once, inside a delivery
 * the player accepted: the NPC's other actions (Bob's shop, Aggie's dyes) are never taken.
 */
function unlockColour(event) {
  const session = sessionFor(event);
  if (!session?.delivery || !session.accepted || session.done || event.step?.type !== "action") return;
  if (!String(event.text ?? "").endsWith(toys.secretSanta.unlocks)) return;
  if (colours(event.player) !== session.colours) return;
  event.handled = true;
  session.done = true;
  event.player.setAttribute(SANTA_COLOURS_ATTRIBUTE, session.colours + 1);
  const npc = session.npc;
  npc?.performAnimation?.(new core.Animation(santa.seq));
  npc?.performGraphic?.(new core.Graphic(santa.spotanim));
}

function onAction(event) {
  if (event.kind === "message") showMessage(event);
  else unlockColour(event);
}

function answerCondition(event) {
  const session = sessionFor(event);
  // Only the present's own Change-colour section has conditions; a delivery never answers one.
  if (!session || session.delivery || session.page !== SANTA_PAGE) return undefined;
  const unlocked = colours(event.player);
  if (event.text === NONE_UNLOCKED) return unlocked === 0;
  if (event.text === SOME_UNLOCKED) return unlocked > 0;
  if (event.text === SOME_LOCKED) return unlocked < toys.secretSanta.deliveries.length;
  const colour = COLOUR_UNLOCKED.exec(event.text ?? "");
  if (!colour) return undefined;
  const index = toys.secretSanta.colours.findIndex(name => name.toLowerCase() === colour[1].toLowerCase());
  return index > 0 && unlocked >= index;
}

function onChoice(event) {
  const session = sessionFor(event);
  if (!session || session.page !== SANTA_PAGE) return;
  if (session.delivery) {
    if (event.option === toys.secretSanta.offer) session.accepted = true;
    if (event.option !== toys.secretSanta.other) return;
    // event=No: the NPC's ordinary conversation, as if the present were not there.
    event.end = true;
    sessions.delete(event.player);
    ordinary.add(event.player);
    api.emitCustomEvent("npc-dialogue:start", { player: event.player, npc: session.npc, npcId: event.npcId, handled: false });
    ordinary.delete(event.player);
    return;
  }
  const index = toys.secretSanta.colours.indexOf(event.option);
  if (index < 0 || session.option.state !== "secret-santa-colour") return;
  const { container, item, itemId } = session;
  // The present must still be where it was clicked; a stale menu changes nothing.
  if (!container.getItems().includes(item) || item.getId() !== itemId) return;
  if (index > colours(event.player)) return;
  swapItem(event.player, container, item, santa.presents[index]);
}

function holdsPresent(player) {
  const owned = container => container.getItems().some(item => item && santa.presents.includes(item.getId()));
  return owned(player.getInventory()) || owned(player.getEquipment());
}

/**
 * Talk-to on the next delivery NPC while holding a present offers "I have a present for you!"
 * (Transcript:Secret santa present). Earlier and later NPCs keep their ordinary conversation.
 */
function deliveryVariant(context) {
  const { player } = context;
  if (!player || ordinary.has(player)) return null;
  build();
  const unlocked = colours(player);
  const variant = toys.secretSanta.deliveries[unlocked];
  if (!variant || !holdsPresent(player)) return null;
  const offered = (context.pages ?? []).some(entry => entry.page === SANTA_PAGE && entry.variants.includes(variant));
  if (!offered) return null;
  sessions.set(player, { page: SANTA_PAGE, delivery: true, npc: context.npc, colours: unlocked });
  return { page: SANTA_PAGE, variant };
}

module.exports = {
  BOTTLE_TALKS_ATTRIBUTE,
  SANTA_COLOURS_ATTRIBUTE,
  init,
  build,
  play,
  onAction,
  onChoice,
  answerCondition,
  deliveryVariant,
};
