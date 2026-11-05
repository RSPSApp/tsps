"use strict";

// Plays the 25th Anniversary transcript and answers its prose conditions. The words are
// the transcript's; this module only decides which variant plays and what each step does.
const Data = require("./Data.BirthdayAnniversary");
const Progress = require("./Progress.BirthdayAnniversary");
const Scene = require("./Scene.BirthdayAnniversary");
const Actors = require("./Actors.BirthdayAnniversary");
const SOURCE = require("../../../data/definitions/event-dialogues.json")[Data.PAGE];
// Ordinary transcripts that mention the event once it is complete.
const ORDINARY_PAGES = new Set(["Wizard Grayzag", "Wizard Gary"]);
const sessions = new WeakMap();
let enabled = false, epoch = 0;

function activate(event) { if (event.key !== Data.EVENT_KEY) return; enabled = event.active === true; epoch++; }
function clear({ player }) { const session = sessions.get(player); session?.cancel?.(); sessions.delete(player); }
function cancelAll(api) { for (const player of api.core.World.getPlayers()) if (player && sessions.has(player)) clear({ player }); }
function valid(player, session) { return enabled && Scene.active() && session.epoch === epoch && sessions.get(player) === session && player.isRegistered(); }
function context(event) {
  const session = sessions.get(event.player);
  if (!session || !event.pages?.some(row => row.page === Data.PAGE)) return null;
  return session;
}
function questComplete(api, player, key) {
  const request = { player, key, complete: null };
  api.emitCustomEvent("quest:is-complete", request);
  return request.complete === true;
}
/** A completed quest has also been started; each event answers only its own state. */
function questStarted(api, player, key) {
  const request = { player, key, started: null };
  api.emitCustomEvent("quest:is-started", request);
  return request.started === true || questComplete(api, player, key);
}
function petFollowing(api, player) {
  const request = { player, pet: null };
  api.emitCustomEvent("pets:current", request);
  return !!request.pet;
}
function cabbage(api, player) {
  const ids = Data.CABBAGES.map(name => api.core.ItemIdentifiers[name]);
  return ids.find(id => player.getInventory().getAmount(id) > 0) ?? null;
}

/** Start one named variant of the event page (or a tail of it via `select`). */
function start(api, { player, npc, variant, select, ...options }) {
  if (!enabled || !Scene.active() || !player.isRegistered() || !Array.isArray(SOURCE?.variants?.[variant])) return false;
  const previous = sessions.get(player);
  const session = { ...options, npc, variant, epoch };
  sessions.set(player, session);
  const npcId = npc?.getCurrentDefinition?.(player)?.getId() ?? npc?.getId();
  const request = { player, npc, npcId, variant: { page: Data.PAGE, variant }, exact: true };
  if (typeof select === "function") request.select = select;
  api.emitCustomEvent("npc-dialogue:start", request);
  if (!request.handled) { if (previous) sessions.set(player, previous); else sessions.delete(player); return false; }
  previous?.cancel?.();
  session.cancel = request.cancel;
  return true;
}
/** The steps from the first one matching `test` (searching nested branches) to the end of that list. */
function tailFrom(steps, test) {
  for (let index = 0; index < steps.length; index++) {
    if (test(steps[index])) return steps.slice(index);
    for (const nested of [steps[index].steps, ...(steps[index].options ?? []).map(option => option.steps)]) {
      const found = Array.isArray(nested) ? tailFrom(nested, test) : null;
      if (found) return found;
    }
  }
  return null;
}
function lineText(step) { return typeof step?.player === "string" ? step.player : step?.text; }
/** Gary's directions to the next memento, read from the following-Gary variant. */
function hintLine(state) {
  const stop = Progress.nextStop(state), id = stop ? stop.hint : Data.ALL_COLLECTED_HINT;
  const step = tailFrom(SOURCE.variants["collecting-mementos-talking-to-gary-while-he-is-following-the-player"], row => row.id === id)?.[0];
  return step?.steps?.find(row => row.type === "line")?.text ?? null;
}

const SPEAKERS = Object.freeze({ Gary: "25th_host_model", "Wizard Gary": "25th_host_upgraded", Thief: "25th_thief" });
function speaker(api, event, session) {
  const name = event.step?.speaker;
  if (!name) return;
  if (SPEAKERS[name]) {
    const symbol = name === "Gary" && session.hatless ? "25th_host_hatless" : SPEAKERS[name];
    const id = Scene.archivedId(api, "npc", symbol);
    if (id !== null) event.speakerId = id;
  } else if (name === "Wizard Grayzag") {
    event.speakerId = api.core.CacheDefinitions.getNpcId("wizard_grayzag");
  } else if (name.includes("/") && session.npc) {
    // "Shop keeper/Shop assistant": whichever of the pair the player is talking to.
    const definition = session.npc.getCurrentDefinition(event.player);
    event.speakerId = definition.getId();
    event.speakerName = definition.getName();
  }
}

function condition(api, event) {
  const page = event.pages?.find(row => row.page === Data.PAGE || ORDINARY_PAGES.has(row.page))?.page;
  if (!page) return;
  const { player } = event, text = String(event.text ?? "").toLowerCase();
  const done = Progress.complete(player);
  if (text.includes("25th anniversary")) return text.includes("not") ? !done : done;
  if (text.includes("either event")) return !done;
  // This server has no 20th Anniversary event, so no account has done it.
  if (text.includes("20th anniversary")) return /hasn't|has not|did not/.test(text);
  if (page !== Data.PAGE) return;
  const session = context(event);
  if (session && !valid(player, session)) return false;
  const state = Progress.read(player);
  const negated = /isn't|has not|hasn't|does not|doesn't|did not/.test(text);
  const answer = value => negated ? !value : value;
  const quests = [["imp catcher", Data.QUESTS.impCatcher], ["romeo and juliet", Data.QUESTS.romeoAndJuliet],
    ["rune mysteries", Data.QUESTS.runeMysteries], ["daddy's home", Data.QUESTS.daddysHome], ["vampyre slayer", Data.QUESTS.vampyreSlayer]];
  if (text.includes("one small favour")) return Actors.withPlayer(api, player) && answer(questComplete(api, player, Data.QUESTS.oneSmallFavour));
  for (const [name, key] of quests) if (text.includes(name)) {
    // "has started" means started and not yet finished (the completed case is its own line).
    if (text.includes("started")) return negated ? !questStarted(api, player, key) : questStarted(api, player, key) && !questComplete(api, player, key);
    return answer(questComplete(api, player, key));
  }
  if (text.includes("gary is with the player") || text.includes("gary isn't with the player")) return answer(Actors.withPlayer(api, player));
  if (text.includes("pet following")) return answer(petFollowing(api, player));
  if (text.includes("cabbage")) return answer(cabbage(api, player) !== null);
  if (text.includes("inventory space")) return !Progress.rewarded(player);
  if (text === "in free-to-play:") return !api.core.WorldDefinition.isMembersWorld();
  if (text === "in members:") return api.core.WorldDefinition.isMembersWorld();
  if (text === "first time:") return !session?.met;
  if (text.includes("dialogue was interrupted")) return !!session?.met;
  if (text.includes("after every memento")) return Progress.allCollected(state);
  if (text.startsWith("while on")) {
    const stop = Data.STOPS.find(row => row.hint === event.stepId);
    return !!stop && Progress.nextStop(state)?.key === stop.key;
  }
  // No guessed truth for a source condition this event does not model.
  return false;
}

function line(api, event) {
  const session = context(event);
  if (!session) return;
  const { player } = event, original = String(event.text ?? "");
  speaker(api, event, session);
  event.text = original.replace("[a favour/another small favour]",
    questComplete(api, player, Data.QUESTS.oneSmallFavour) ? "another small favour" : "a favour");
  let after;
  if (session.awaitingHint && event.step?.speaker === "Gary") {
    // Each stop's transcript names the next stop on its fixed route; the Wiki lets mementos
    // come in any order, so Gary points at the first one still missing instead.
    const hint = hintLine(Progress.read(player));
    if (hint) event.text = hint;
    session.awaitingHint = false;
  }
  if (lineText(event.step) === "Where do we need to go?" && session.hints) session.awaitingHint = true;
  if (session.variant.startsWith("starting-off") && event.step?.speaker === "Gary") after = () => Progress.meet(api, player);
  if (lineText(event.step) === "Yes, I'll help make a portal to the Realm of Memories!") after = () => Progress.advance(api, player, "new", "agreed") || Progress.read(player).phase !== "new";
  if (lineText(event.step) === "Tell me about the mementos that we need.") after = () => Progress.advance(api, player, "agreed", "briefed") || Progress.rank(Progress.read(player).phase) >= Progress.rank("briefed");
  if (session.variant === "collecting-mementos-straying-too-far-outside-varrock" && original.startsWith("I'll wait back at the house")) {
    after = () => { Actors.dismiss(api, player); return true; };
  }
  event.before = () => { if (!valid(player, session)) abort(player, session); };
  if (after) event.after = () => { if (!valid(player, session) || after() !== true) abort(player, session); };
}
function abort(player, session) {
  if (session.cancel) { session.cancel(); return; }
  player.getDialogueManager().reset();
  player.getPacketSender().sendInterfaceRemoval();
}

function action(api, event) {
  const session = context(event);
  if (!session) return;
  const { player } = event;
  if (!valid(player, session)) { event.handled = true; event.end = true; return; }
  const state = Progress.read(player), text = String(event.text ?? "");
  // The Wiki transcript has gaps here (the general store's lines): skip them, don't end the talk.
  if (event.step?.type === "unavailable") { event.handled = true; return; }
  switch (event.stepId) {
    case "4lszNE": // "Gary equips his hat." - he sets off with the player.
      event.handled = true;
      session.hatless = false;
      if (!(Progress.advance(api, player, "briefed", "collecting") || state.phase === "collecting") || !Actors.summon(api, player)) event.end = true;
      session.hints = true;
      return;
    case "Yy-Obs": // "Gary teleports back to his initial location."
      event.handled = true;
      Actors.dismiss(api, player);
      return;
    case "nHNX9a": case "CwJ4vD": { // Typed as actions in the export; they are step conditions.
      const stop = Data.STOPS.find(row => row.hint === event.stepId);
      event.handled = true;
      event.steps = Progress.nextStop(state)?.key === stop?.key ? event.step.steps ?? [] : [];
      return;
    }
    case "-Eqk2L": { // "Gary places your cabbage in the ritual grid."
      const id = cabbage(api, player);
      if (state.phase !== "returned" || id === null || !player.getInventory().delete(id, 1) ||
        !Progress.advance(api, player, "returned", "ritual")) { event.handled = true; event.end = true; }
      return;
    }
    case "fxjIFk": // The portal-opening cutscene: no capture records it; the portal simply opens.
      event.handled = true;
      if (!Progress.advance(api, player, "ritual", "portal") && state.phase !== "portal") event.end = true;
      return;
    case "G1_28p": // "Grayzag rewards Gary, and departs."
      Progress.advance(api, player, "realm", "rewarding");
      return;
    case "14FDSe": // "You've completed the Birthday event..."
      Progress.markComplete(api, player);
      api.emitCustomEvent("birthday-2026:reward", { player });
      return;
    case "YBX0JZ": { // "You need [number] more free inventory slots..."
      const request = { player, needed: 0 };
      api.emitCustomEvent("birthday-2026:reward-space", request);
      event.text = text.replace("[number]", String(request.needed));
      return;
    }
  }
  if (session.stop && text.startsWith("Gary transports the new memento")) {
    const stop = Data.STOPS.find(row => row.key === session.stop);
    if (!stop || !Progress.collect(api, player, stop.key)) { event.handled = true; event.end = true; }
  }
}

/** A memento source's own options (shop, quest talk) carry no event steps: hand them back. */
function choice(api, event) {
  const session = sessions.get(event.player);
  if (!session?.stop || session.npc !== event.npc || !valid(event.player, session) ||
    Progress.read(event.player).collected.includes(session.stop)) return;
  const option = tailFrom(SOURCE.variants[session.variant], row => row.type === "choice")?.[0]?.options?.find(row => row.text === event.option);
  if (!option || option.steps?.length) return;
  event.end = true;
  clear({ player: event.player });
  const request = {
    player: event.player, npc: event.npc, npcId: event.npc.getCurrentDefinition(event.player).getId(),
    select: steps => tailFrom(steps, row => row.type === "choice")?.[0]?.options?.find(row => row.text === event.option)?.steps ?? steps,
  };
  api.emitCustomEvent("npc-dialogue:start", request);
}

module.exports = { activate, start, clear, cancelAll, condition, line, action, choice, tailFrom, cabbage };
