"use strict";

/**
 * The slayer ring's Contact Master: Rub's first row, and the worn ring's "Master" option.
 *
 * Wiki, Slayer ring: the ring "allows players to contact the most advanced Slayer master they are
 * eligible to receive tasks from", consuming no charges, but "players cannot be assigned tasks,
 * spend slayer reward points or purchase slayer equipment from a master when contacting them this
 * way".
 *
 * The dialogue is the Wiki's own, chosen from the master's transcript rather than written here:
 * - "via-an-enchanted-gem-or-a-slayer-ring-during-a-task" is the item contact itself, and only
 *   Konar's page has it transcribed: greeting, then "How am I doing so far?" (the task line and the
 *   point tally), "Who are you?", "Where are you?", "Got any tips for me?" and "Nothing really.".
 *   Played whole, while the player has a task.
 * - "via-the-astral-contact-spell" is the remote contact the Wiki transcribes for every other
 *   master: the contact greeting, then the difficulty topic and the way out. Its "I need another
 *   assignment." row is dropped — the ring cannot assign tasks — while its jump into the difficulty
 *   branch is kept, so that topic plays exactly as it does at the master.
 * - A master with neither (Nieve, Spria) falls back to the page's default transcript, filtered to
 *   those same two rows.
 *
 * No capture of the ring's own contact exists (docs/slayer.md).
 */
const Data = require("./Data.Slayer");
const Tasks = require("./Tasks.Slayer");

/** The Wiki's variant names (Transcript:<master> section headings, slugged). */
const ITEM_VARIANT = "via-an-enchanted-gem-or-a-slayer-ring-during-a-task";
const SPELL_VARIANT = "via-the-astral-contact-spell";
const DIFFICULTY = /difficulty of my assignments/i;
const NOTHING = /\bnothing\b/i;

/**
 * The masters the ring can reach, lowest requirement first (Wiki, Slayer Master): Turael none,
 * Mazchna 20 combat, Vannaka 40, Chaeldar 70, Konar 75, Nieve 85, Duradel 100 combat with 50
 * Slayer, Mortimer 100 with 70. Left out: Krystilia, whose tasks must be done in the Wilderness
 * and whom the Wiki does not rank (she "doesn't factor in the player's combat level"), and Spria,
 * who ties with Turael at no requirement — Turael is the beginner master the Wiki lists first.
 * Their level requirements are the rungs' own; the quests a rung needs are MASTER_QUESTS.
 */
const LADDER = [1, 2, 3, 4, 8, 6, 5, 10];

/**
 * The Wiki's per-master quest requirements (Slayer Master), which the ring's ladder applies too:
 * Mazchna "Requires completion of Priest in Peril", Chaeldar "Lost City", Duradel "Shilo Village",
 * Mortimer "partial completion of Fallen From Grace" — which the Wiki explains as being far enough
 * to enter Wyrmscraig Cavern, where he is. That is the stage the quest first lands the player in the
 * cavern (FallenFromGrace.Quest's STAGE_CAVERN), not merely having started it: a player still at the
 * hat or the rockfall has not met him and cannot take his tasks.
 * The ring reaches only the masters a player is "eligible to receive tasks from", so a rung whose
 * quest is missing is skipped for the one below. Asked the way Tasks.meetsQuests asks, and like it,
 * a quest no plugin answers for doesn't block.
 */
const MASTER_QUESTS = new Map([
  [2, { key: "priest_in_peril" }],
  [4, { key: "lost_city" }],
  [5, { key: "shilo_village" }],
  [10, { key: "fallen_from_grace", stage: 9 }], // Wyrmscraig Cavern (STAGE_CAVERN)
]);

let api = null;
let core = null;
/** Master id -> the NPC whose transcript and chathead this plays (the one with Assignment). */
let npcIds = null;

function init(pluginApi) {
  api = pluginApi;
  core = pluginApi.core;
}

function masterNpcIds() {
  if (!npcIds) {
    npcIds = new Map();
    const masters = Data.get().masterByName;
    const total = core.CacheDefinitions.getCounts().npcs;
    for (let id = 0; id < total; id++) {
      const npc = core.CacheDefinitions.getNpc(id);
      if (!npc?.name || !(npc.actions ?? []).includes("Assignment")) continue;
      const master = masters.get(String(npc.name).trim());
      if (master && !npcIds.has(master.id)) npcIds.set(master.id, id);
    }
  }
  return npcIds;
}

/**
 * Whether the player has met a rung's quest requirement: completion for most, a stage for the one
 * the Wiki states as "far enough to reach" a place. Asked of the quest runtime as Tasks.meetsQuests
 * asks, and unanswered (a quest this tree does not have yet) doesn't block.
 */
function meetsQuests(player, master) {
  const need = MASTER_QUESTS.get(master.id);
  if (!need) return true;
  if (need.stage != null) {
    const request = { player, key: need.key, stage: null };
    api.emitCustomEvent("quest:get-stage", request);
    return request.stage == null || Number(request.stage) >= need.stage;
  }
  const request = { player, key: need.key, complete: null };
  api.emitCustomEvent("quest:is-complete", request);
  return request.complete !== false;
}

/** The most advanced master this player may receive tasks from, or null below every rung. */
function ladderMaster(player) {
  const masters = Data.get().masters;
  let best = null;
  for (const id of LADDER) {
    const master = masters.get(id);
    if (!master || !meetsQuests(player, master) || !Tasks.meetsMaster(player, master)) continue;
    const above = !best || master.combat > best.combat
      || (master.combat === best.combat && master.slayer > best.slayer);
    if (above) best = master;
  }
  return best;
}

/**
 * Whom the ring reaches. With a task: its master — Wiki, Enchanted gem, the item contact "allows a
 * player to contact the Slayer Master that has assigned them their current Slayer task". Without
 * one: the most advanced master they may take tasks from — Wiki, Slayer ring, "the most advanced
 * Slayer master they are eligible to receive tasks from". Both are the same dialogue.
 */
function contactMaster(player) {
  const task = Tasks.current(player);
  const assigned = task ? Data.get().masters.get(task.masterId) : null;
  if (assigned) return assigned;
  return ladderMaster(player);
}

/**
 * The remote menu: the transcript's greeting, its difficulty row (which jumps into the branch the
 * master plays), and its own "nothing" row answering with the player's line and ending. The
 * assignment and rewards rows are the two the ring may not use.
 */
function contactMenu(steps) {
  const out = [];
  for (const step of steps ?? []) {
    if (step.type !== "choice") {
      out.push(step);
      continue;
    }
    const options = step.options ?? [];
    const difficulty = options.find((option) => DIFFICULTY.test(option.text ?? ""));
    const nothing = options.find((option) => NOTHING.test(option.text ?? ""));
    const kept = [];
    if (difficulty) kept.push(difficulty);
    if (nothing) kept.push({ ...nothing, steps: [{ player: nothing.text }, { type: "end" }] });
    if (kept.length) out.push({ ...step, options: kept });
    break;
  }
  return out;
}

/** Plays one variant of the master's transcript remotely; true when the engine took it. */
function play(player, npcId, variant, select) {
  const request = { player, npc: null, npcId, variant, exact: Boolean(variant), select, handled: false };
  api.emitCustomEvent("npc-dialogue:start", request);
  return request.handled === true;
}

/** Plays the contact dialogue; false when no transcript for the master would play. */
function contact(player) {
  const master = contactMaster(player);
  const npcId = master ? masterNpcIds().get(master.id) : null;
  if (!npcId) return false;
  if (Tasks.current(player) && play(player, npcId, ITEM_VARIANT, undefined)) return true;
  if (play(player, npcId, SPELL_VARIANT, contactMenu)) return true;
  return play(player, npcId, null, contactMenu);
}

/** The Rub row the ring's "Contact Master" action sits on; the worn ring calls it "Master". */
const CONTACT_ACTIONS = new Set(["Contact Master", "Master"]);

/** "jewellery:action": the ring's Rub rows and worn options (Jewellery.plugin.js). */
function action(event) {
  if (!event?.player || !event.item || !CONTACT_ACTIONS.has(event.action)) return;
  if (contact(event.player)) event.handled = true;
}

function attach(pluginApi) {
  init(pluginApi);
  api.onCustomEvent("jewellery:action", action);
}

module.exports = {
  attach,
  contactMaster,
  contactMenu,
  contact,
  _test: { masterNpcIds, LADDER, ITEM_VARIANT, SPELL_VARIANT },
};
