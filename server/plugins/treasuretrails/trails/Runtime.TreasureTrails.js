"use strict";

const { randomUUID } = require("node:crypto");
const Catalogue = require("./Catalogue.TreasureTrails");
const Dialogue = require("./Dialogue.TreasureTrails");
const { TIERS, META_PREFIX, completedAttribute, sharedCompletedCount } = require("./Tiers.TreasureTrails");
const SKILL_CHALLENGES = require("./data/skill-challenges.json");
const NPC_SPAWNS = require("../../../data/definitions/npc-spawns.json");
const MASTER_PARTS = require("./data/master-parts.json");
// A three-part master step's torn parts, as the cache names them.
const TORN_PARTS = ["trail_master_part1", "trail_master_part2", "trail_master_part3"];
// The clue helper names a target tile but no area. Emote steps accept the beginner
// runtime's usual radius around it; music steps need the player near Cecilia's bridge.
const EMOTE_RADIUS = 3;
const MUSIC_RADIUS = 5;
const URI_STANDARD = "standard-dialogue";
const URI_REFUSAL = "speaking-with-another-player-s-uri-or-with-incorrect-attire";
let api;
let core;
let catalogues = new Map();
const uris = new WeakMap();
// A trail's live fight (Wiki "Saradomin wizard", "Double agent"): player -> { npc, token }, and back.
const encounters = new WeakMap();
const encounterOwners = new WeakMap();
const playing = new WeakMap();
const pick = (entries, random = Math.random) => entries[Math.floor(random() * entries.length)];
const location = entity => ({ x: entity.getLocation().getX(), y: entity.getLocation().getY(), z: entity.getLocation().getZ() });
const distance = (a, b) => a.z === b.z ? Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y)) : Infinity;
const metaKey = tier => META_PREFIX + tier.name;
// The cache's collection log categories and the label its script 2735 gives each count.
const clueCategoryName = tier => `${tier.label} Treasure Trails`;
const rareClueCategoryName = tier => `${tier.label} Treasure Trails (Rare)`;

function data(tier) {
  if (!catalogues.has(tier.name)) catalogues.set(tier.name, loadCatalogue(tier));
  return catalogues.get(tier.name);
}

/** The tier's catalogue, with the steps and Sherlock tasks this server can finish. */
function loadCatalogue(tier) {
  const loaded = Catalogue.load(core, tier);
  loaded.supportedTasks = [...loaded.tasks.values()].filter(task => SKILL_CHALLENGES[task.key]);
  // Master's three-part steps draw their cryptics from these (Wiki: "three cryptic clues in one step").
  loaded.parts = loaded.steps.filter(step => isPart(loaded, step) && partRollable(step));
  loaded.hotcold = loaded.steps.filter(step => step.family === "hotcold");
  loaded.rollable = loaded.steps.filter(step => rollable(loaded, step));
  return loaded;
}

let spawned = null;
/** NPC ids with a static or plugin-backed world spawn. */
function worldSpawned() {
  spawned ??= new Set([
    ...NPC_SPAWNS.map(entry => entry.id ?? core.NpcIdentifiers[entry.key]),
    // These are spawned by their actual game content: a mangled-bone pyre, The Heart of Darkness,
    // and the Shellbane Gryphon cave. They are not ordinary npc-spawns.json entries.
    core.NpcIdentifiers.FEROCIOUS_BARBARIAN_SPIRIT,
    core.NpcIdentifiers.FROST_NAGUA_3,
    core.NpcIdentifiers.SHELLBANE_GRYPHON,
  ].filter(Number.isInteger));
  return spawned;
}

/**
 * Steps this server can finish: a kill step needs one of its NPCs to be spawned by world data or
 * an implemented game feature, and Sherlock needs a task the server can detect.
 */
function rollable(catalogue, step) {
  if (step.target === "kill") return step.npcIds.some(id => worldSpawned().has(id));
  if (step.skill) return step.skill.itemId != null && catalogue.supportedTasks.length > 0;
  // "Combine the torn clue scroll parts." is master's three-part step.
  if (isThreePart(catalogue, step)) return catalogue.parts.length >= 3;
  // A master skill challenge is its own step: only tasks the server can detect.
  if (step.family === "skillchallenge") return Boolean(SKILL_CHALLENGES[step.key]);
  // Hot/cold targets are reached through Jorral, never rolled themselves.
  if (step.family === "hotcold") return false;
  if (catalogue.oneItem && step.family === "cryptic") return Boolean(step.falo) || MASTER_PARTS.hotColdStarters.includes(step.key);
  return true;
}

/** Master's targetless skill-challenge row is the step that holds three cryptic parts. */
function isThreePart(catalogue, step) {
  return catalogue.oneItem && step.family === "skillchallenge" && step.target === "none";
}

/** Every master cryptic but Falo's, Jorral's and Watson's is a part of a three-part step. */
function isPart(catalogue, step) {
  return catalogue.oneItem && step.family === "cryptic" && !step.falo && !MASTER_PARTS.hotColdStarters.includes(step.key);
}

/** A part this server can finish: not one master-parts.json leaves out, and an NPC that is spawned. */
function partRollable(step) {
  if (MASTER_PARTS.unrolled[step.key]) return false;
  return step.target !== "npc" || step.npcIds.some(id => worldSpawned().has(id));
}

/**
 * Whether `player` may be given a part. A part whose master-parts.json condition names a
 * `requirementEvent` (Viggora: Curse of the Empty Lord up to him) asks its content, which sets
 * `ready`; with no player to ask, it is left out.
 */
function partOffered(player, step) {
  const event = MASTER_PARTS.conditions[step.key]?.requirementEvent;
  if (!event) return true;
  if (!player) return false;
  const request = { player, npc: null, ready: false, here: false };
  api?.emitCustomEvent?.(event, request);
  return request.ready === true;
}

/** A new step's own state: a three-part step draws its three parts, from those the player may get. */
function stepState(tier, step, random = Math.random, player = null) {
  if (!isThreePart(data(tier), step)) return {};
  const pool = data(tier).parts.filter(part => partOffered(player, part)), parts = [];
  while (parts.length < 3) parts.push(pool.splice(Math.floor(random() * pool.length), 1)[0].row);
  return { parts, found: [false, false, false] };
}

function tierOfItem(id) {
  return TIERS.find(tier => data(tier).byItem.has(id)) ?? null;
}

function trailLength(tier, random = Math.random, player = null) {
  const [minimum, maximum] = tier.length;
  const length = minimum + Math.floor(random() * (maximum - minimum + 1));
  if (!player) return length;
  // Content may set a new trail's length within its tier's ("treasure-trails:trail-length", a league relic's shortest trails).
  const request = { player, tier: tier.name, length, minimum, maximum };
  api?.emitCustomEvent?.("treasure-trails:trail-length", request);
  return Number.isInteger(request.length) ? Math.max(minimum, Math.min(maximum, request.length)) : length;
}

/**
 * "treasure-trails:requirement-waived" { player, kind, waived }: content may lift a step's item
 * requirement (a league relic): `kind` is "emote" (what to wear), "falo" (the item to show) or
 * "charlie" (the item to bring).
 */
function requirementWaived(player, kind, itemId = null) {
  const request = { player, kind, itemId, waived: false };
  api?.emitCustomEvent?.("treasure-trails:requirement-waived", request);
  return request.waived === true;
}

function validState(tier, item, state) {
  // The meta's row is the step; on master's one clue scroll it is the only way to know it.
  const step = data(tier).byRow.get(state?.row);
  const [minimum, maximum] = tier.length;
  return state?.version === 1 && step && step.itemId === item.getId() && typeof state.token === "string" &&
    Number.isInteger(state.length) && state.length >= minimum && state.length <= maximum &&
    Number.isInteger(state.completed) && state.completed >= 0 && state.completed < state.length;
}

/** The step item for `state`, carrying it; every step of a trail is a different cache item. */
function stepItem(tier, step, state) {
  return new core.Item(step.itemId, 1).setMetaValue(metaKey(tier), { ...state, row: step.row });
}

function stateOf(player, slot, random = Math.random) {
  const inventory = player.getInventory();
  const item = inventory.getItems()[slot];
  const tier = item && tierOfItem(item.getId());
  if (!tier) return null;
  const current = item.getMetaValue(metaKey(tier));
  if (isExtra(tier, item.getId()))
    return trails(player).find(trail => trail.state.token === current?.token && trail.state.revision === current?.revision) ?? null;
  if (validState(tier, item, current)) return { tier, item, slot, state: current, step: data(tier).byRow.get(current.row) };
  // A clue without a trail (a drop, box or vessel) starts one on a random step of its tier.
  const step = pick(data(tier).rollable, random);
  const state = { version: 1, token: randomUUID(), revision: 0, completed: 0, length: trailLength(tier, random, player), row: step.row, ...stepState(tier, step, random, player) };
  const replacement = stepItem(tier, step, state);
  inventory.setItem(slot, replacement);
  inventory.refreshItems();
  return { tier, item: replacement, slot, state, step };
}

function trails(player) {
  return player.getInventory().getItems().flatMap((item, slot) => {
    const tier = item && item.getAmount() > 0 ? tierOfItem(item.getId()) : null;
    const state = tier ? item.getMetaValue(metaKey(tier)) : null;
    return tier && validState(tier, item, state) && data(tier).byItem.get(item.getId()).itemId === item.getId()
      ? [{ tier, item, slot, state, step: data(tier).byRow.get(state.row) }] : [];
  });
}

function startedTrails(player) {
  // Interactions that need a held clue start the trail of any fresh scroll first.
  player.getInventory().getItems().forEach((item, slot) => { if (item && tierOfItem(item.getId())) stateOf(player, slot); });
  return trails(player);
}

function stillHeld(player, snapshot) {
  return trails(player).find(trail => trail.state.token === snapshot.state.token && trail.state.revision === snapshot.state.revision);
}

/** A challenge scroll, puzzle box or Sherlock's scroll: carried beside its clue, never a clue itself. */
function isExtra(tier, id) {
  const step = data(tier).byItem.get(id);
  return [step.challenge?.itemId, ...(step.puzzle?.itemIds ?? []), step.light?.itemId, step.skill?.itemId].includes(id);
}

function clicked(event) {
  const item = event.player.getInventory().getItems()[event.slot];
  return item && item.getAmount() > 0 && tierOfItem(item.getId()) && (!event.item || item === event.item) ? item : null;
}

function clueText(step) {
  if (step.family === "music") {
    const where = step.description.replace(/\.$/, "").replace(/^\w/, letter => letter.toLowerCase());
    const npc = core.CacheDefinitions.getNpc(step.npcIds[0])?.name ?? "";
    return `The clue reveals who to speak to:<br><br>I'd like to hear some music.<br>Come and see me ${where}, and play:<br>${step.track}<br>Thanks,<br>${npc}`;
  }
  if (step.family === "anagram") return `This anagram reveals<br>who to speak to next:<br><br>${step.text}`;
  if (step.family === "cipher") return `The cipher reveals who to speak to:<br><br>${step.text}`;
  if (step.family === "fairyring") return `The cryptic reveals where to dig:<br><br>${step.text}`;
  return step.text;
}

function auxiliarySlot(player, trail, kind) {
  const ids = trail.step[kind]?.itemIds ?? [trail.step[kind]?.itemId];
  return player.getInventory().getItems().findIndex(item => item && ids.includes(item.getId()) &&
    item.getMetaValue(metaKey(trail.tier))?.token === trail.state.token &&
    item.getMetaValue(metaKey(trail.tier))?.revision === trail.state.revision);
}
function challengeSlot(player, trail) { return auxiliarySlot(player, trail, "challenge"); }
function puzzleSlot(player, trail) { return auxiliarySlot(player, trail, "puzzle"); }
function lightSlot(player, trail) { return auxiliarySlot(player, trail, "light"); }
/** The step's puzzle or light box, whichever the NPC handed over. */
function boxSlot(player, trail) { return Math.max(puzzleSlot(player, trail), lightSlot(player, trail)); }
function holdsChallenge(player, trail) { return challengeSlot(player, trail) >= 0; }

function read(event) {
  if (!clicked(event)) return false;
  const sender = event.player.getPacketSender();
  const item = event.player.getInventory().getItems()[event.slot];
  const tier = tierOfItem(item.getId());
  const step = data(tier).byItem.get(item.getId());
  if ([step.challenge?.itemId, step.skill?.itemId].includes(item.getId())) {
    // A shared scroll (elite) stands for many rows: its own trail says which question or task.
    const meta = item.getMetaValue(metaKey(tier));
    const own = trails(event.player).find(trail => trail.state.token === meta?.token)?.step ?? step;
    const text = item.getId() === own.skill?.itemId ? data(tier).tasks.get(meta?.task)?.text : own.challenge?.question;
    const group = data(tier).textInterface;
    sender.sendInterface(group);
    sender.sendString(text ?? "", (group << 16) | 2);
    return true;
  }
  const trail = stateOf(event.player, event.slot);
  event.player.setAttribute(LAST_READ_ATTRIBUTE, { tier: trail.tier.name, token: trail.state.token });
  if (trail.step.family === "map" && trail.step.interfaceId != null) {
    sender.sendInterface(trail.step.interfaceId);
    return true;
  }
  const group = data(trail.tier).textInterface;
  sender.sendInterface(group);
  sender.sendString(Array.isArray(trail.state.parts) ? partsText(trail) : clueText(trail.step), (group << 16) | 2);
  return true;
}

/** A three-part step reads its three cryptics, each struck through once found (live captures). */
function partsText(trail) {
  return trail.state.parts.map((row, index) => {
    const text = data(trail.tier).byRow.get(row)?.text ?? "";
    return trail.state.found?.[index] ? `<str>${text}</str>` : text;
  }).join("<br><br>");
}

function checkSteps(event) {
  if (!clicked(event)) return false;
  const trail = stateOf(event.player, event.slot);
  event.player.sendMessage(`You have completed ${trail.state.completed} steps on this ${trail.tier.name} Treasure Trail.`);
  return true;
}

function dismissUri(player) {
  const active = uris.get(player);
  if (active) api.removeNpc(active.npc);
  uris.delete(player);
}

/** What a finished step leaves: the next step's clue, or the casket after the last. */
function nextItem(trail, random = Math.random, player = null) {
  const completed = trail.state.completed + 1;
  if (completed >= trail.state.length) return { casket: true, item: new core.Item(data(trail.tier).casket, 1) };
  // A step's own progress (a fight, a puzzle, master's done task, Falo's song, a hot/cold target
  // and a three-part step's parts) ends with it.
  const { defeated, solved, image, taskDone, song, hotcold, previous, parts, found, ...carried } = trail.state;
  const step = pick(data(trail.tier).rollable, random);
  return { casket: false, item: stepItem(trail.tier, step, { ...carried, completed, revision: trail.state.revision + 1, ...stepState(trail.tier, step, random, player) }) };
}

/** `said` overrides the hand-over message, as the giving NPC's transcript words it: { clue, casket }. */
function advance(player, snapshot, random = Math.random, said = {}, show = true, removeUri = true) {
  const trail = stillHeld(player, snapshot);
  if (!trail) return false;
  if (removeUri) dismissUri(player);
  dismissEncounter(player);
  const inventory = player.getInventory();
  for (const kind of ["challenge", "puzzle", "light", "skill"]) {
    const slot = auxiliarySlot(player, trail, kind);
    if (slot >= 0) inventory.setItem(slot, new core.Item(-1, 0));
  }
  const { casket, item: received } = nextItem(trail, random, player);
  // Live captures: "You've found a new clue!" and "You've obtained a casket!", in a message box.
  const words = casket ? said.casket ?? "You've obtained a casket!" : said.clue ?? "You've found a new clue!";
  // The exact slot matters when scrolls of several tiers are carried.
  inventory.setItem(trail.slot, received);
  inventory.refreshItems();
  if (show) Dialogue.itemBox(player, received.getId(), words);
  return true;
}

function dialogue(player, npcId, lines, onEnd) {
  const chain = new core.DialogueChainBuilder();
  lines.forEach((text, index) => chain.add(new core.NpcDialogue(index, npcId, text)));
  if (onEnd) chain.add(new core.ActionDialogue(lines.length, { execute: onEnd }));
  chain.add(new core.EndDialogue(lines.length + 1));
  player.getDialogueManager().startDialogues(chain);
}

function isUri(npcId) {
  return TIERS.some(tier => data(tier).uri === npcId);
}

function talk(event) {
  if (event.handled) return;
  const { player, npcId, npc } = event;
  const definition = event.definition ?? npc.getCurrentDefinition?.(player);
  if (definition?.getActions?.()[event.clickType - 1] !== "Talk-to") return;
  if (isUri(npcId)) {
    const active = uris.get(player);
    if (!active || active.npc !== npc) return;
    const trail = stillHeld(player, active.trail);
    if (!trail) { dismissUri(player); return; }
    event.handled = true;
    meetUri(player, npc, npcId, trail);
    return;
  }
  // Sherlock's skill challenges, Falo and Jorral (hot/cold) have their own units.
  const trail = startedTrails(player).find(entry => ["anagram", "cryptic", "cipher", "music"].includes(entry.step.family) &&
    entry.step.target === "npc" && !entry.step.skill && !entry.step.falo && !MASTER_PARTS.hotColdStarters.includes(entry.step.key) &&
    entry.step.npcIds.includes(npcId));
  if (!trail) return;
  event.handled = true;
  if (trail.step.family === "music") { hearSong(player, npcId, trail); return; }
  if (trail.step.puzzle?.itemId != null || trail.step.light?.itemId != null) {
    if (boxSlot(player, trail) >= 0) puzzleAgain(player, npc, npcId, trail);
    else handOutPuzzle(player, npc, npcId, trail);
    return;
  }
  if (trail.step.challenge?.itemId != null) {
    if (holdsChallenge(player, trail)) askAnswer(player, npc, npcId, trail);
    else handOutChallenge(player, npc, npcId, trail);
    return;
  }
  const steps = Dialogue.transcript(player, npc, npcId, `treasure-trails-${trail.tier.name}`);
  const said = Dialogue.lines(steps, Math.random, npcName(npcId));
  // The talk began beside the NPC; a wandering NPC (Elder Torgan) may step away during it.
  Dialogue.play(player, npcId, said.length ? said : [{ npc: "Well done, you've found me!" }], () => advance(player, trail, Math.random,
    { clue: Dialogue.message(steps) ?? `${npcName(npcId)} has given you another clue scroll!`, casket: Dialogue.message(steps, true) ?? "You've obtained a casket!" }));
}

/** Uri (Wiki transcript): wrong attire or a missing emote gets his refusal; otherwise a random phrase. */
function meetUri(player, npc, npcId, trail) {
  const active = uris.get(player);
  const ready = emoteReady(player, trail.step) && active.done >= trail.step.emotes.length;
  if (!ready) {
    const refusal = Dialogue.lines(Dialogue.transcript(player, npc, npcId, URI_REFUSAL), Math.random, npcName(npcId));
    Dialogue.play(player, npcId, refusal.length ? refusal : [{ npc: "I do not believe we have any business, Comrade." }]);
    return;
  }
  const steps = Dialogue.transcript(player, npc, npcId, URI_STANDARD);
  const said = steps ? Dialogue.lines(steps, Math.random, npcName(npcId)) : [];
  // The standard variant is a random phrase, then the player's "What?" and the hand-over.
  const what = steps?.find(step => typeof step.player === "string");
  const casket = trail.state.completed + 1 >= trail.state.length;
  const words = (!casket && trail.tier.uriClueMessage) || Dialogue.message(steps, casket) || (casket ? "You've obtained a casket!" : "You have been given a new clue!");
  if (!advance(player, trail, Math.random, {}, false, false)) return;
  const received = !casket && trail.tier.uriClueDisplay ? core.CacheDefinitions.getObjId(trail.tier.uriClueDisplay) : player.getInventory().getItems()[trail.slot].getId();
  Dialogue.play(player, npcId, what ? [...said, { player: what.player }] : said,
    () => {
      if (uris.get(player)?.npc === npc) dismissUri(player);
      Dialogue.itemBox(player, received, words);
    });
}

function npcName(npcId) {
  return core.CacheDefinitions.getNpc(npcId)?.name ?? "";
}

/** The challenge is carried alongside its clue; it does not count as another trail step. */
function handOutChallenge(player, npc, npcId, trail) {
  const steps = Dialogue.transcript(player, npc, npcId, `treasure-trails-${trail.tier.name}`);
  Dialogue.play(player, npcId, Dialogue.lines(steps, Math.random, npcName(npcId)), () => {
    const current = stillHeld(player, trail);
    // The talk began beside the NPC; a wandering NPC (the flax keeper) may have stepped away since.
    if (!current || holdsChallenge(player, current)) return;
    const inventory = player.getInventory();
    const slot = inventory.getItems().findIndex(item => !item || item.getAmount() <= 0);
    if (slot < 0) { player.sendMessage("You need a free inventory space to receive a challenge scroll."); return; }
    const scroll = new core.Item(current.step.challenge.itemId, 1).setMetaValue(metaKey(current.tier), { ...current.state });
    inventory.setItem(slot, scroll);
    inventory.refreshItems();
    Dialogue.itemBox(player, scroll.getId(), Dialogue.message(steps) ?? `${npcName(npcId)} has given you a challenge scroll!`);
  });
}

/**
 * A puzzle box remains linked to the held clue, like its question challenge. Master's NPCs hand
 * over a puzzle or a light box (the cache's "puzzle_or_light"); the Wiki doesn't say how one is
 * chosen, so it is even. Each master image has its own box item.
 */
function handOutPuzzle(player, npc, npcId, trail, random = Math.random) {
  const steps = Dialogue.transcript(player, npc, npcId, `treasure-trails-${trail.tier.name}`);
  Dialogue.play(player, npcId, Dialogue.speech(steps), () => {
    const current = stillHeld(player, trail);
    if (!current || boxSlot(player, current) >= 0) return;
    const inventory = player.getInventory(), slot = inventory.getItems().findIndex(item => !item || item.getAmount() <= 0);
    const light = current.step.light?.itemId != null && (current.step.puzzle?.itemId == null || random() < 0.5);
    const kind = light ? "light box" : "puzzle box";
    if (slot < 0) { player.sendMessage(`You need a free inventory space to receive a ${kind}.`); return; }
    let box;
    if (light) box = new core.Item(current.step.light.itemId, 1).setMetaValue(metaKey(current.tier), { ...current.state, solved: false });
    else {
      const image = pick(current.tier.puzzleImages, random);
      const itemId = current.tier.puzzleBoxes ? core.CacheDefinitions.getObjId(current.tier.puzzleBoxes[image]) : current.step.puzzle.itemId;
      box = new core.Item(itemId, 1).setMetaValue(metaKey(current.tier), { ...current.state, image, solved: false });
    }
    inventory.setItem(slot, box);
    player.getInventory().refreshItems();
    // Master's NPCs (live captures): "Wingstone hands you a light puzzle box." or "… a puzzlebox!", with the box shown.
    if (current.step.light) Dialogue.itemBox(player, box.getId(), `${npcName(npcId)} hands you a ${light ? "light puzzle box." : "puzzlebox!"}`);
    else player.sendMessage(Dialogue.message(steps) ?? `${npcName(npcId)} has given you a ${kind}!`);
  });
}

/** With the box solved the NPC gives the next clue; unsolved, it asks again. */
function puzzleAgain(player, npc, npcId, trail) {
  const box = player.getInventory().getItems()[boxSlot(player, trail)];
  const solved = box?.getMetaValue(metaKey(trail.tier))?.solved === true;
  const steps = Dialogue.puzzleTranscript(player, npc, npcId, trail.tier.name, solved);
  const said = Dialogue.lines(steps);
  if (!solved) {
    Dialogue.play(player, npcId, said.length ? said : [{ npc: "Sorry but you haven't solved the puzzle yet." }]);
    return;
  }
  Dialogue.play(player, npcId, said, () => {
    const latest = stillHeld(player, trail);
    if (!latest) return;
    const box = player.getInventory().getItems()[boxSlot(player, latest)];
    if (box?.getMetaValue(metaKey(latest.tier))?.solved !== true) return;
    const casket = latest.state.completed + 1 >= latest.state.length;
    const words = Dialogue.message(steps, casket);
    advance(player, latest, Math.random, casket ? { casket: words ?? "You've obtained a casket!" } :
      { clue: words ?? `${npcName(npcId)} has given you another clue scroll!` });
  });
}

/** Talking again asks for the answer; a wrong one costs nothing (Wiki "Challenge scroll"). */
function askAnswer(player, npc, npcId, trail) {
  const steps = Dialogue.againTranscript(player, npc, npcId, trail.tier.name);
  const prompt = Dialogue.lines(steps, Math.random, npcName(npcId));
  const ask = prompt.find(line => line.npc)?.npc ?? "Please enter the answer to the question.";
  Dialogue.play(player, npcId, prompt.length ? prompt : [{ npc: ask }], () => {
    player.setEnteredAmountAction({ execute: amount => answered(player, npc, npcId, trail, steps, amount) });
    player.getPacketSender().sendEnterAmountPrompt("Enter amount:");
  });
}

function answered(player, npc, npcId, trail, steps, amount) {
  const current = stillHeld(player, trail);
  if (!current || !holdsChallenge(player, current)) return;
  if (Number(amount) !== Number(current.step.challenge.answer)) {
    const wrong = Dialogue.lines(Dialogue.wrongBranch(steps), Math.random, npcName(npcId));
    Dialogue.play(player, npcId, wrong.length ? wrong : [{ npc: "Wrong! Try again." }]);
    return;
  }
  const correct = Dialogue.correctBranch(steps);
  const said = Dialogue.lines(correct, Math.random, npcName(npcId));
  Dialogue.play(player, npcId, said.length ? said : [{ npc: "Correct." }], () => {
    const latest = stillHeld(player, current);
    if (!latest || !holdsChallenge(player, latest)) return;
    const casket = latest.state.completed + 1 >= latest.state.length;
    const words = Dialogue.message(correct, casket);
    advance(player, latest, Math.random, casket ? { casket: words ?? "You've obtained a casket!" } :
      { clue: words ?? `${npcName(npcId)} has given you another clue scroll!` });
  });
}

function search(event) {
  if (event.handled) return;
  const { player, objectId } = event;
  const trail = startedTrails(player).find(entry => ["loc", "key"].includes(entry.step.target) && entry.step.locIds.includes(objectId) &&
    distance(event.location, entry.step.location) === 0);
  if (!trail) return;
  const inventory = player.getInventory();
  event.handled = true;
  // The exact locked-note wording is not in the cache; its helper supplies the key's source.
  if (trail.step.target === "key" && !inventory.getItems().some(item => item && item.getId() === trail.step.keyItem)) {
    player.sendMessage(`It is locked. ${trail.step.description}`);
    return;
  }
  if (trail.step.target === "key") inventory.delete(trail.step.keyItem, 1);
  advance(player, trail);
}

/** Killing one of a keyed step's NPCs drops its key while the player has none (Wiki cryptic clues). */
function keyDrop({ player, npcId, drops }) {
  if (!player || !Array.isArray(drops)) return;
  const trail = trails(player).find(entry => entry.step.target === "key" && entry.step.npcIds.includes(npcId));
  if (!trail || player.getInventory().getItems().some(item => item && item.getId() === trail.step.keyItem)) return;
  drops.push({ itemId: trail.step.keyItem, amount: 1 });
}

/**
 * A kill step's NPC drops the next clue, or the casket, for its killer (Wiki cryptic clues:
 * "pick up the clue or casket that it drops"). The clue in hand goes, so the drop is never a
 * second clue of the tier; the drop keeps the trail's meta.
 */
function killDrop({ killer, npc, npcId }) {
  const trail = killer && trails(killer).find(entry => entry.step.target === "kill" && entry.step.npcIds.includes(npcId));
  if (!trail) return;
  const next = nextItem(trail, Math.random, killer);
  killer.getInventory().deleteAtSlot(trail.slot, 1);
  core.ItemOnGroundManager.registerLocation(killer, next.item, npc.getLocation().clone());
  // As live captures show it.
  killer.sendMessage("<col=ff0000>You spot a new clue falling to the floor.</col>");
}

function dig(event) {
  const I = core.ItemIdentifiers;
  if (event.allow === false || !/\bdig\b/i.test(String(event.option)) || ![I.SPADE, I.EASTFLOOR_SPADE].includes(event.itemId)) return;
  const { player } = event;
  if (!player.getInventory().getItems().some(item => item && item.getId() === event.itemId)) return;
  const trail = startedTrails(player).find(entry => ["map", "cryptic", "coordinate", "fairyring"].includes(entry.step.family) &&
    entry.step.target === "coord" && distance(location(player), entry.step.location) === 0);
  if (!trail) return;
  event.allow = false;
  player.performAnimation(new core.Animation(core.CacheDefinitions.getSeqId("human_dig") ?? 830));
  // Wiki coordinates guide: the dig summons the step's wizard, who must be beaten before digging again.
  if (trail.step.encounter && trail.state.defeated !== true) {
    if (!liveEncounter(player, trail)) summon(player, trail);
    return;
  }
  advance(player, trail);
}

const alive = npc => (typeof npc.isRegistered !== "function" || npc.isRegistered()) && npc.getHitpoints() > 0;

function liveEncounter(player, trail) {
  const active = encounters.get(player);
  return active && active.token === trail.state.token && active.npcs.some(alive) ? active : null;
}

function freeTiles(player) {
  const origin = player.getLocation();
  const region = api.getRegionManager();
  return [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([dx, dy]) => new core.Location(origin.getX() + dx, origin.getY() + dy, origin.getZ()))
    .filter(tile => !region.blocked(tile, player.getPrivateArea?.()) && region.canMovestart(origin, tile, 1, 1, player.getPrivateArea?.()));
}

function freeTile(player) {
  return freeTiles(player)[0];
}

/**
 * Spawns the step's fight for the player alone and sets it on them: every NPC the cache's
 * encounter lists, so master's three Ancient Wizards come together (Wiki "a three-on-one fight").
 */
function summon(player, trail) {
  dismissEncounter(player);
  const spots = freeTiles(player);
  if (!spots.length) return null;
  const npcs = trail.step.encounter.npcIds.map((id, index) => {
    const spot = spots[index % spots.length];
    return api.spawnNpc({ id, x: spot.getX(), y: spot.getY(), z: spot.getZ(), owner: player, ownerOnly: true, wanderRadius: 0 });
  }).filter(Boolean);
  if (!npcs.length) return null;
  encounters.set(player, { npcs, token: trail.state.token });
  for (const npc of npcs) {
    encounterOwners.set(npc, player);
    npc.getCombat?.().attack(player);
  }
  return npcs[0];
}

function dismissEncounter(player) {
  for (const npc of encounters.get(player)?.npcs ?? []) if (alive(npc)) api.removeNpc(npc);
  encounters.delete(player);
}

/** A fight is beaten once all of its NPCs are dead; a double agent's death also brings Uri. */
function encounterDied({ npc }) {
  const player = encounterOwners.get(npc);
  const active = player && encounters.get(player);
  if (!active || !active.npcs.includes(npc) || active.npcs.some(other => other !== npc && alive(other))) return;
  encounters.delete(player);
  const trail = trails(player).find(entry => entry.state.token === active.token);
  if (!trail) return;
  const state = { ...trail.state, defeated: true, revision: trail.state.revision + 1 };
  trail.item.setMetaValue(metaKey(trail.tier), state);
  player.getInventory().refreshItems();
  if (trail.step.family === "emote" && emoteReady(player, trail.step)) spawnUri(player, { ...trail, state });
}

function wearing(player, requirement) {
  if (requirement.emptySlot != null)
    return !player.getEquipment().getItems().some(item => item && item.getId() > 0 && core.ItemDefinition.forId(item.getId()).getEquipmentType().getSlot() === requirement.emptySlot);
  return player.getEquipment().getItems().some(item => item && (requirement.anyOf ? requirement.anyOf.includes(item.getId()) :
    core.CacheDefinitions.getItem(item.getId())?.params?.get?.(Catalogue.TRAIL_ITEM_GROUP_PARAM) === requirement.group));
}

function emoteReady(player, step) {
  return step.family === "emote" && distance(location(player), step.location) <= EMOTE_RADIUS &&
    (step.equipment.every(requirement => wearing(player, requirement)) || (step.equipment.length > 0 && requirementWaived(player, "emote")));
}

function emote({ player, slot }) {
  // Medium steps ask for a second emote after Uri appears, before he is spoken to.
  const active = uris.get(player);
  const pending = active && stillHeld(player, active.trail);
  if (pending && active.done < pending.step.emotes.length && pending.step.emotes[active.done] === slot && emoteReady(player, pending.step)) {
    active.done++;
    return;
  }
  const trail = startedTrails(player).find(entry => entry.step.family === "emote" && entry.step.emotes[0] === slot && emoteReady(player, entry.step));
  if (!trail) return;
  // Wiki "Double agent": hard steps send the agent first, unless the emote is the trail's first step.
  if (trail.step.encounter && trail.state.defeated !== true && trail.state.completed > 0) {
    if (!liveEncounter(player, trail)) { dismissUri(player); summon(player, trail); }
    return;
  }
  spawnUri(player, trail);
}

function spawnUri(player, trail) {
  dismissUri(player);
  const spot = freeTile(player);
  if (!spot) return;
  const npc = api.spawnNpc({ id: data(trail.tier).uri, x: spot.getX(), y: spot.getY(), z: spot.getZ(), owner: player, ownerOnly: true, wanderRadius: 0 });
  if (npc) uris.set(player, { npc, trail, done: 1 });
}

function songPlayed({ player, trackId }) {
  if (player) playing.set(player, trackId);
}

/** Wiki Transcript:Cecilia: select the requested song, then speak to her again. */
function hearSong(player, npcId, trail) {
  if (playing.get(player) !== trail.step.midi) {
    dialogue(player, npcId, ["Select the song I asked you to play, and speak to me again."]);
    return;
  }
  dialogue(player, npcId, ["Thank you, I love that song!"], () => {
    if (playing.get(player) === trail.step.midi && distance(location(player), trail.step.location) <= MUSIC_RADIUS) advance(player, trail);
  });
}

function restore({ player }) {
  for (const tier of TIERS) {
    const varbit = core.CacheDefinitions.getVarbitId(`collection_clues_${tier.name}_completed`);
    if (varbit != null) player.getPacketSender().sendVarbit(varbit, Number(player.getAttribute(completedAttribute(tier))) || 0);
  }
}

function categoryCount(request) {
  if (request.category === "Shared Treasure Trail Rewards") {
    request.count = sharedCompletedCount(request.player);
    return;
  }
  const tier = TIERS.find(entry => request.category === clueCategoryName(entry) || request.category === rareClueCategoryName(entry));
  if (tier) request.count = Number(request.player.getAttribute(completedAttribute(tier))) || 0;
}

function leave({ player }) { dismissUri(player); dismissEncounter(player); }

function readActions() {
  return { Read: read, "Check steps": checkSteps };
}

/** The trail whose clue the player read last ("treasure-trails:current-step"). */
const LAST_READ_ATTRIBUTE = "treasure-trails:last-read";

/**
 * "treasure-trails:current-step" { player, location, target }: where the clue the player read last
 * leads (a league relic's clue compass), while that trail is still carried; `target` is the step's
 * kind of goal ("npc", "loc", "kill", "coord", ...) and `family` its step's ("hotcold", "emote", ...).
 */
function currentStep(request) {
  if (!request?.player) return;
  const last = request.player.getAttribute(LAST_READ_ATTRIBUTE);
  const trail = last && trails(request.player).find((entry) => entry.tier.name === last.tier && entry.state.token === last.token);
  if (!trail?.step?.location) return;
  request.location = trail.step.location;
  request.target = trail.step.target ?? null;
  request.family = trail.step.family ?? null;
}

module.exports = function attachTreasureTrails(pluginApi) {
  api = pluginApi;
  api.persistAttribute?.(LAST_READ_ATTRIBUTE, null);
  api.onCustomEvent("treasure-trails:current-step", currentStep);
  core = api.core;
  // Build before gameplay so the first object/NPC click cannot stall a game tick.
  catalogues = new Map(TIERS.map(tier => [tier.name, loadCatalogue(tier)]));
  for (const tier of TIERS) api.persistAttribute(completedAttribute(tier), 0);
  Dialogue.attach(api);
  for (const tier of TIERS) api.onItemAction(`Clue scroll (${tier.name})`, readActions());
  for (const tier of TIERS) api.onItemAction(`Challenge scroll (${tier.name})`, { Read: read });
  api.onCustomEvent("npc-drops:add", keyDrop);
  api.onBeforeNpcInteraction(talk);
  api.onBeforeObjectInteraction(search);
  api.onCanUseItem(dig);
  api.onCustomEvent("player:emote", emote);
  api.onCustomEvent("audio:play-song", songPlayed);
  api.onCustomEvent("collection-log:category-count", categoryCount);
  api.onPlayerLogin(restore);
  api.onPlayerLogout(leave);
  api.onPlayerDisconnect(leave);
  api.onPlayerDeath(leave);
  api.onNpcDeath(encounterDied);
  api.onNpcDeath(killDrop);
};

Object.assign(module.exports, { META_PREFIX, EMOTE_RADIUS, MUSIC_RADIUS, data, tierOfItem, trailLength, stateOf, trails, read, checkSteps,
  advance, nextItem, partOffered, puzzleSlot, lightSlot, boxSlot, auxiliarySlot, handOutPuzzle, summon, liveEncounter, partsText, wearing, TORN_PARTS, MASTER_PARTS, startedTrails, stillHeld, rollable, talk, search, keyDrop, killDrop, dig, emote, encounterDied,
  songPlayed, emoteReady, answered, clueText, restore, categoryCount, completedAttribute, metaKey, requirementWaived });
