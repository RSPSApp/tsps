"use strict";

/**
 * Barbarian Training's firemaking, fishing, Herblore and spear/hasta smithing sections (Wiki:
 * Barbarian Training).
 *
 * Otto Godblessed teaches rod fishing first: the rod is under his bed, and a leaping fish caught
 * with it completes the section once Otto hears of it. Herblore comes after rod fishing. Otto
 * asks for an attack mix (an attack potion(2) with roe), and handing it over completes the
 * section, which unlocks every barbarian mix (the recipes with an `unlock` in
 * skills/data/herblore.json, answered here through "herblore:unlocked").
 *
 * Words: the Wiki transcript (npc-dialogues.json, page "Barbarian Training"), read through
 * NpcDialogues' "npc-dialogue:start" `select`. The bed's object boxes, the mix's message box and
 * the farewell are from rsprox recording 1533. The section stages are the cache's varbits
 * brut_fishing_r and brut_herb_potion (Quest Helper: 1 tasked, 2 done, 3 told Otto).
 *
 * Barehanded fishing ("Please teach me of your cunning with harpoons.", cache varbit
 * brut_fishing_s, same 1/2/3 stages): once Otto has set it, the harpoon spots' Harpoon option
 * fishes barehanded without a harpoon (answered through "fishing:barehand-unlocked"); a
 * barehanded catch completes it, and "I've fished with my hands!" tells Otto.
 *
 * Otto's agricultural topic stays Farming's: choosing it hands the Talk-to over to
 * skills/farming/Services.Farming's own Otto menu. Spear/hasta smithing follows the two fishing
 * reports, Tai Bwo Wannai Trio and Tamayu's post-quest training (Wiki). Each weapon has its own
 * instruction, successful manufacture and report; a carried weapon is not proof of manufacture.
 * Bow firemaking uses its existing instruction and return transcript, with saved lesson
 * progress: taught, an oak-log bow fire, then acknowledgement (cache varbit brut_fire, same
 * 1/2/3 stages). It does not change Logs' lighting permissions. Once Otto is told, he also
 * explains pyre ships ("I have completed firemaking with a bow. What follows this?", cache
 * varbit brut_craft_ship = 1): with both, the whirlpool into the Ancient Cavern opens
 * (world/data/loc-teleport-sync.json, Wiki: Ancient Cavern). Chewed bones on a pyre ship
 * (skills/firemaking/BarbarianPyres' "barbarian-pyre:built", any logs) after that lesson make it
 * 2, and "I've created a pyre ship!" (the transcript's "Firemaking - Speaking to Otto after
 * creating a pyre ship") makes it 3: the training done. Mangled bones do not count (Wiki).
 */

const Hastae = require("./barbariantraining/Hastae.BarbarianTraining");

const STATE_ATTRIBUTE = "barbarian-training";
/**
 * Cache varbits (osrs-dumps varbit.sym): brut_fishing_s 3757, brut_fishing_r 3758, brut_fire 3759,
 * brut_herb_potion 3761, brut_smith_spear 3762, brut_smith_hasta 3763, brut_craft_ship 3764.
 */
const VARBITS = { harpoon: 3757, fishingRod: 3758, firemaking: 3759, herblore: 3761, spear: 3762, hasta: 3763, pyreShips: 3764 };
const TASKED = 1;
const DONE = 2;
const TOLD = 3;
/** The shop whose page lists the pearl barbarian rod under "===With Barbarian Training===". */
const ALCHEMY_SHOP = "Alry the Angler's Angling Accessories";
// TaiBwoWannaiTrio.Quest owns this reward state: claimTamayuSpear sets 5 when combat training is claimed.
const TAMAYU_TRAINING_ATTRIBUTE = "quest.tai_bwo_wannai_trio.tamayu";
const TAMAYU_TRAINING_CLAIMED = 5;
const MIN_SMITHING_LEVEL = 5;

const OTTO = "Otto Godblessed";
const BED = "Barbarian bed";
const TRANSCRIPT = {
  first: "starting-off-after-speaking-to-him-once",
  again: "starting-off-after-speaking-to-him-once-talking-to-otto-again-without-doing-as-he-asks",
  fishing: "fishing",
  firemaking: "firemaking",
  herblore: "herblore",
  herbloreAgain: "herblore-speaking-to-otto-again-without-an-attack-mix",
  herbloreDone: "herblore-speaking-to-otto-with-an-attack-mix",
  pyreShipDone: "firemaking-speaking-to-otto-after-creating-a-pyre-ship",
  smithing: "smithing",
  spearAgain: "smithing-speaking-to-otto-again-without-making-a-spear",
  spearDone: "smithing-speaking-to-otto-again-after-making-a-spear",
  hastaAgain: "smithing-speaking-to-otto-again-without-making-a-hasta",
  hastaDone: "smithing-speaking-to-otto-again-after-making-a-hasta",
};
const TOPIC = {
  harpoon: "Please teach me of your cunning with harpoons.",
  harpoonDone: "I've fished with my hands!",
  firemaking: "I'm ready for your firemaking wisdom. Please instruct me.",
  firemakingDone: "I've set fire to logs with a bow!",
  pyreShips: "I have completed firemaking with a bow. What follows this?",
  pyreShipDone: "I've created a pyre ship!",
  rod: "What can I learn about the use of a fishing rod?",
  rodDone: "I've fished with a barbarian rod!",
  herblore: "What was that secret knowledge of herblore we talked of?",
  herbloreDone: "I've made a barbarian potion!",
  spear: "Tell me more about the use of spears.",
  hasta: "What of the one-handed spears of which you spoke?",
  farming: "How can I use my strength in the ways of agriculture?",
  leave: "I'd better get going.",
  /** rsprox recording 1529: the top-level menu's training entry, shown while the player carries a hastae item. */
  training: "Let's talk about my training.",
};
// Transcript boundary guards, not replacement dialogue: a truncated export must not teach early.
const SMITHING_FINAL_REPLY = {
  spear: {
    0: "Note well that you will require wood for the spear shafts; the quality of wood must be similar to that of the metal involved.",
    2: "The manufacture of spears is now yours as a speciality. Use your skill well. In addition I am ready to reveal one-handed spear crafts.",
  },
  hasta: {
    0: "Indeed. You may use our special anvil for this spear type too. The ways of black and dragon spears are beyond our knowledge, however; these spears may not be created.",
    2: "To live life to it's fullest of course - that you may be a peaceful spirit when your time ends.",
  },
};
const GREETING = "Good day to you, hearty warrior! May the spirits guide you.";
const MORE = "I seek more knowledge.";
const NO_MORE = "I have no more questions at this time.";
/** rsprox recording 1533, after "I have no more questions at this time.". */
const FAREWELL = "In that case, farewell.";
/** rsprox recording 1533: a mesbox after the attack mix, the game message after the farming tasks. */
const LEARNED = "You feel you have learned more of barbarian ways. Otto might wish to talk to you more.";
/** rsprox recording 1533, Search on brut_barbarian_bed. */
const ROD_TAKEN = "You find a heavy fishing rod under the bed and take it.";
const ROD_NO_SPACE = "You find a heavy fishing rod under the bed, but don't have space for it.";
const ROD_ALREADY = "You already have a heavy fishing rod.";

let api;
let core;
let hastae;

function state(player) {
  const saved = player.getAttribute(STATE_ATTRIBUTE);
  const current = saved && typeof saved === "object" ? saved : {};
  current.harpoon = stage(current.harpoon);
  current.fishingRod = stage(current.fishingRod);
  current.herblore = stage(current.herblore);
  current.firemaking = stage(current.firemaking);
  current.pyreShips = stage(current.pyreShips);
  current.spear = stage(current.spear);
  current.hasta = stage(current.hasta);
  if (saved !== current) player.setAttribute(STATE_ATTRIBUTE, current);
  return current;
}

function stage(value) {
  return Number.isInteger(value) && value >= 0 && value <= TOLD ? value : 0;
}

function sync(player) {
  const current = state(player);
  const sender = player.getPacketSender();
  for (const [section, varbit] of Object.entries(VARBITS)) sender.sendVarbit(varbit, current[section]);
}

function loggedIn({ player }) {
  sync(player);
}

function setStage(player, section, value) {
  state(player)[section] = value;
  player.getPacketSender().sendVarbit(VARBITS[section], value);
}

/** "herblore:unlocked": the attack mix once Otto has asked for it, every mix once he has it. */
function answerUnlock(request) {
  if (!request?.player || typeof request.unlock !== "string") return;
  const [key, when] = request.unlock.split(":");
  if (key !== "barbarian_herblore") return;
  const herblore = state(request.player).herblore;
  request.allowed = when === "started" ? herblore >= TASKED : herblore === TOLD;
}

/** Rod fishing starts with the instruction, before catching a fish or completing other sections. */
function answerFishingUnlock(request) {
  if (!request?.player || request.unlock !== "barbarian_rod") return;
  request.allowed = state(request.player).fishingRod >= TASKED;
}

/** "fishing:barehand-unlocked": barehanded fishing once Otto has set the harpoon section. */
function answerBarehand(request) {
  if (!request?.player) return;
  request.allowed = state(request.player).harpoon >= TASKED;
}

/**
 * "shop:stock-visible": the pearl barbarian rod waits for the rod-fishing section. Wiki, Pearl
 * barbarian rod: it "can only be purchased if the relevant part of the Barbarian Training
 * miniquest is completed with Otto Godblessed". osrsreboxed-db merges the store table Alry's page
 * keeps under "===With Barbarian Training===" (its shop parser reads every table a quest or
 * requirement section adds), so the row is in shops.json and this hides it until the section is
 * done — TOLD, i.e. after Otto hears of the catch, which is when this plugin completes it.
 * Unlike using the rod (answerFishingUnlock, from TASKED), the purchase waits for the whole section.
 */
function stockVisible(event) {
  if (!event?.player || event.shopName !== ALCHEMY_SHOP) return;
  if (event.itemId !== core.ItemIdentifiers.PEARL_BARBARIAN_ROD || event.player.isPlayerBot?.()) return;
  if (state(event.player).fishingRod !== TOLD) event.visible = false;
}

function finishedFishing(player) {
  const current = state(player);
  return current.fishingRod === TOLD && current.harpoon === TOLD;
}

/** The Smithing part told to Otto: the hasta reported (Wiki: Barbarian Training). */
function learnedHastae(player) {
  return state(player).hasta === TOLD;
}

/** Wiki (Zamorakian hasta): Otto converts spears after the Fishing and Smithing parts. */
function canConvertSpears(player) {
  return finishedFishing(player) && learnedHastae(player);
}

function hasSmithingBaseLevel(player) {
  return player.getSkillManager().getMaxLevel(core.Skill.SMITHING) >= MIN_SMITHING_LEVEL;
}

/** Wiki also requires Tamayu's post-quest combat training, not quest completion alone. */
function smithingPrerequisites(player) {
  if (!finishedFishing(player) || !hasSmithingBaseLevel(player)) return false;
  const request = { player, key: "tai_bwo_wannai_trio", complete: false };
  api.emitCustomEvent("quest:is-complete", request);
  const claimed = player.getAttribute(TAMAYU_TRAINING_ATTRIBUTE);
  return request.complete === true && Number.isInteger(claimed) && claimed >= TAMAYU_TRAINING_CLAIMED;
}

function answerSmithingUnlock(request) {
  if (!request?.player || !["barbarian_spear", "barbarian_hasta"].includes(request.unlock)) return;
  const current = state(request.player);
  request.allowed = smithingPrerequisites(request.player) && (request.unlock === "barbarian_spear"
    ? current.spear >= TASKED : current.spear === TOLD && current.hasta >= TASKED);
}

// ---------------------------------------------------------------- transcript

/** The spoken steps of one choice in a variant of Otto's transcript, up to its next choice. */
function topicLines(player, npc, npcId, variant, optionText) {
  let found = null;
  api.emitCustomEvent("npc-dialogue:start", { player, npc, npcId, variant, exact: true, handled: false,
    select: (steps) => { found = steps; return []; } });
  const option = findOption(found ?? [], optionText);
  const lines = [];
  for (const step of option?.steps ?? []) {
    if (step?.type === "choice" || step?.type === "jump") break;
    if (typeof step?.player === "string") lines.push({ player: step.player });
    else if (step?.type === "line" && typeof step.text === "string") lines.push({ npc: step.text });
  }
  return lines;
}

/** The first menu option titled `optionText`, its own menu's first, then the menus inside its options. */
function findOption(steps, optionText) {
  const menus = steps.filter((step) => step?.type === "choice");
  for (const menu of menus) {
    const option = menu.options?.find((entry) => entry.text === optionText);
    if (option) return option;
  }
  for (const menu of menus) {
    for (const entry of menu.options ?? []) {
      const option = findOption(entry.steps ?? [], optionText);
      if (option) return option;
    }
  }
  return null;
}

function addLine(chain, index, line, player, npcId) {
  const text = String(line.player ?? line.npc).replace(/\[player name\]/gi, player.getUsername?.() ?? "");
  chain.add(line.player != null ? new core.PlayerDialogue(index, text) : new core.NpcDialogue(index, npcId, text));
}

/**
 * Plays `lines`, then `next` if given, else closes. The engine's ActionDialogue does not move the
 * chain on, so an action only ever ends a chain, and it opens whatever comes next.
 */
function play(player, npcId, lines, next = null) {
  const chain = new core.DialogueChainBuilder();
  lines.forEach((line, index) => addLine(chain, index, line, player, npcId));
  chain.add(new core.ActionDialogue(lines.length, { execute: () => {
    if (next) next();
    else player.getPacketSender().sendInterfaceRemoval();
  } }));
  player.getDialogueManager().startDialogues(chain);
}

function ask(player, options, title = null) {
  const chain = new core.DialogueChainBuilder();
  const menu = new core.OptionDialogue(0, { executeOption: (option) => options[Number(option) - 1]?.[1]?.() },
    ...options.map(([text]) => text));
  if (title) menu.setTitle?.(title);
  chain.add(menu);
  player.getDialogueManager().startDialogues(chain);
}

// ---------------------------------------------------------------- Otto

function near(player, npc) {
  return !npc?.getLocation || player.getLocation().isWithinDistance(npc.getLocation(), 5);
}

/** Preset, untradeable and unbankable copies keep their restrictions, as in Herblore's mixing. */
function restricted(item) {
  const { Item } = core;
  return item.isPresetItem?.() === true
    || item.getMetaValue?.(Item.PRESET_META) === true
    || item.getMetaValue?.(Item.UNTRADEABLE_META) === true
    || item.getMetaValue?.(Item.UNBANKABLE_META) === true;
}

/** The inventory slot of an attack mix(2) Otto may take, or -1. */
function attackMixSlot(player) {
  return player.getInventory().getItems().findIndex((item) =>
    item?.getId() === core.ItemIdentifiers.ATTACK_MIX_2_ && item.getAmount() > 0 && !restricted(item));
}

function holdsAttackMix(player) {
  return attackMixSlot(player) >= 0;
}

/** The topics Otto offers for what the player has done so far. */
function topics(player, talk) {
  const current = state(player);
  const list = [];
  // The transcript's menus list the harpoon topic first.
  if (current.harpoon === DONE) list.push([TOPIC.harpoonDone, () => harpoonDone(player, talk)]);
  else if (current.harpoon < DONE) list.push([TOPIC.harpoon, () => harpoonLesson(player, talk)]);
  if (current.firemaking === DONE) list.push([TOPIC.firemakingDone, () => firemakingDone(player, talk)]);
  else if (current.firemaking < TOLD) list.push([TOPIC.firemaking, () => firemakingLesson(player, talk)]);
  else if (current.pyreShips === DONE) list.push([TOPIC.pyreShipDone, () => pyreShipDone(player, talk)]);
  else list.push([TOPIC.pyreShips, () => pyreShipsLesson(player, talk)]);
  if (current.fishingRod === DONE) list.push([TOPIC.rodDone, () => rodDone(player, talk)]);
  else if (current.fishingRod < DONE) list.push([TOPIC.rod, () => rodLesson(player, talk)]);
  if (current.fishingRod === TOLD && current.herblore < TOLD) {
    if (current.herblore === DONE && holdsAttackMix(player)) list.push([TOPIC.herbloreDone, () => herbloreDone(player, talk)]);
    else list.push([TOPIC.herblore, () => herbloreLesson(player, talk)]);
  }
  if (finishedFishing(player) && hasSmithingBaseLevel(player)) {
    if (current.spear < TOLD) list.push([TOPIC.spear, () => spearTopic(player, talk)]);
    else list.push([TOPIC.hasta, () => hastaTopic(player, talk)]);
  }
  list.push([TOPIC.farming, () => {
    player.getPacketSender().sendInterfaceRemoval();
    // Farming's modules need the server core when loaded, so this is required on first use.
    require("../skills/farming/Services.Farming").farmingNpc(talk.event);
  }]);
  list.push([TOPIC.leave, () => play(player, talk.npcId, [{ player: TOPIC.leave }])]);
  return list;
}

function menu(player, talk) {
  if (!near(player, talk.npc)) { player.getPacketSender().sendInterfaceRemoval(); return; }
  ask(player, topics(player, talk));
}

/** "I seek more knowledge." goes back to the topics; the other says goodbye. */
function afterTopic(player, talk) {
  ask(player, [
    [MORE, () => menu(player, talk)],
    [NO_MORE, () => play(player, talk.npcId, [{ player: NO_MORE }, { npc: FAREWELL }])],
  ]);
}

/**
 * The topic's transcript lines; `onReply`, if given, runs as Otto starts to answer. `onFinished`
 * runs after the actual spoken transcript and requires it to exist. False, with
 * the chatbox closed, when Otto has wandered off.
 */
function lesson(player, talk, variant, option, onReply = null, onFinished = null) {
  if (!near(player, talk.npc)) { player.getPacketSender().sendInterfaceRemoval(); return false; }
  const found = topicLines(player, talk.npc, talk.npcId, variant, option);
  if (onFinished && !found.length) { player.getPacketSender().sendInterfaceRemoval(); return false; }
  const lines = found.length ? found : [{ player: option }];
  const after = () => {
    if (onFinished) {
      if (!near(player, talk.npc)) { player.getPacketSender().sendInterfaceRemoval(); return; }
      onFinished();
    }
    afterTopic(player, talk);
  };
  if (!onReply) { play(player, talk.npcId, lines, after); return true; }
  play(player, talk.npcId, lines.slice(0, 1), () => {
    onReply();
    play(player, talk.npcId, lines.slice(1), after);
  });
  return true;
}

/** Complete the spoken instruction before recording that this player has heard it. */
function firemakingLesson(player, talk) {
  lesson(player, talk, TRANSCRIPT.first, TOPIC.firemaking, null, () => {
    if (state(player).firemaking < TASKED) setStage(player, "firemaking", TASKED);
  });
}

function firemakingDone(player, talk) {
  if (state(player).firemaking !== DONE) return;
  lesson(player, talk, TRANSCRIPT.firemaking, TOPIC.firemakingDone, null, () => {
    if (state(player).firemaking === DONE) setStage(player, "firemaking", TOLD);
  });
}

/** Otto's pyre ship explanation, which also says how to reach the whirlpool into the caverns. It stays on offer, replaying the same words. */
function pyreShipsLesson(player, talk) {
  if (state(player).firemaking !== TOLD) return;
  lesson(player, talk, TRANSCRIPT.firemaking, TOPIC.pyreShips, null, () => {
    const current = state(player);
    if (current.firemaking === TOLD && !current.pyreShips) setStage(player, "pyreShips", 1);
  });
}

/** Otto's acknowledgement of the pyre ship: the training's last stage, set once his words are done. */
function pyreShipDone(player, talk) {
  if (state(player).pyreShips !== DONE) return;
  lesson(player, talk, TRANSCRIPT.pyreShipDone, TOPIC.pyreShipDone, null, () => {
    if (state(player).pyreShips === DONE) setStage(player, "pyreShips", TOLD);
  });
}

/** "barbarian-pyre:built": chewed bones on a pyre ship, once Otto has explained them (Wiki). */
function builtPyre({ player, bonesId } = {}) {
  if (!player || bonesId !== core.ItemIdentifiers.CHEWED_BONES) return;
  if (state(player).pyreShips === TASKED) setStage(player, "pyreShips", DONE);
}

/** Observe the existing successful skill action, not a request or another training section. */
function madeBowFire({ player, itemId, bow } = {}) {
  if (!player || bow !== true || itemId !== core.ItemIdentifiers.OAK_LOGS) return;
  if (state(player).firemaking === TASKED) setStage(player, "firemaking", DONE);
}

/**
 * rsprox_transcripts/237/01149.txt: brut_fishing_s goes 0 to 1 only at the lesson's last line (and 2 to 3 at
 * Otto's last reply), so a chat closed part-way sets nothing; here the stage is set once the lines are done.
 */
function harpoonLesson(player, talk) {
  if (state(player).harpoon === TASKED) { lesson(player, talk, TRANSCRIPT.again, TOPIC.harpoon); return; }
  lesson(player, talk, TRANSCRIPT.first, TOPIC.harpoon, null, () => {
    if (state(player).harpoon < TASKED) setStage(player, "harpoon", TASKED);
  });
}

function harpoonDone(player, talk) {
  if (state(player).harpoon !== DONE) return;
  lesson(player, talk, TRANSCRIPT.fishing, TOPIC.harpoonDone, null, () => {
    if (state(player).harpoon === DONE) setStage(player, "harpoon", TOLD);
  });
}

function rodLesson(player, talk) {
  if (state(player).fishingRod >= TASKED) { lesson(player, talk, TRANSCRIPT.again, TOPIC.rod); return; }
  const lines = topicLines(player, talk.npc, talk.npcId, TRANSCRIPT.first, TOPIC.rod);
  const finalReply = lines[lines.length - 1];
  if (!near(player, talk.npc) || lines.length < 2 || !finalReply?.npc) {
    player.getPacketSender().sendInterfaceRemoval();
    return;
  }
  // rsprox 237/01149 tick 8766: brut_fishing_r becomes 1 as Otto's final reply begins.
  play(player, talk.npcId, lines.slice(0, -1), () => {
    if (!near(player, talk.npc)) { player.getPacketSender().sendInterfaceRemoval(); return; }
    if (state(player).fishingRod < TASKED) setStage(player, "fishingRod", TASKED);
    play(player, talk.npcId, [finalReply], () => afterTopic(player, talk));
  });
}

function rodDone(player, talk) {
  if (state(player).fishingRod !== DONE) return;
  const lines = topicLines(player, talk.npc, talk.npcId, TRANSCRIPT.fishing, TOPIC.rodDone);
  const finalReply = lines[lines.length - 1];
  if (!near(player, talk.npc) || lines.length < 2 || !finalReply?.npc) {
    player.getPacketSender().sendInterfaceRemoval();
    return;
  }
  // rsprox237/01149 tick8987: stage3 starts with Otto's final reply, after the player's question.
  play(player, talk.npcId, lines.slice(0, -1), () => {
    if (!near(player, talk.npc) || state(player).fishingRod !== DONE) {
      player.getPacketSender().sendInterfaceRemoval();
      return;
    }
    setStage(player, "fishingRod", TOLD);
    play(player, talk.npcId, [finalReply], () => afterTopic(player, talk));
  });
}

function herbloreLesson(player, talk) {
  const asked = state(player).herblore >= TASKED;
  if (lesson(player, talk, asked ? TRANSCRIPT.herbloreAgain : TRANSCRIPT.herblore, TOPIC.herblore) && !asked) setStage(player, "herblore", TASKED);
}

/** Only this transcript's initial spear topic has the two quest-condition branches. */
function smithingTopicLines(player, talk, variant, option, eligible) {
  let found = null;
  api.emitCustomEvent("npc-dialogue:start", { player, npc: talk.npc, npcId: talk.npcId,
    variant, exact: true, handled: false, select: steps => { found = steps; return []; } });
  const selected = findOption(found ?? [], option);
  let steps = selected?.steps ?? [];
  if (variant === TRANSCRIPT.smithing && option === TOPIC.spear) {
    const condition = eligible ? "If Tai Bwo Wannai Trio has been completed:" : "If Tai Bwo Wannai Trio has not been completed:";
    const branch = steps.find(step => step?.type === "condition" && step.text === condition);
    if (!branch) return [];
    steps = [...steps.filter(step => typeof step?.player === "string"), ...(branch.steps ?? [])];
  }
  const lines = [];
  for (const step of steps) {
    if (step?.type === "choice" || step?.type === "jump") break;
    if (typeof step?.player === "string") lines.push({ player: step.player });
    else if (step?.type === "line" && typeof step.text === "string") lines.push({ npc: step.text });
  }
  return lines;
}

/**
 * No normal-world smithing boundary capture was found. Chosen consistently with rod teaching:
 * grant on the final actual NPC reply, never the menu choice or an empty/player-only transcript.
 */
function smithingReply(player, talk, lines, section, expected, next) {
  const required = SMITHING_FINAL_REPLY[section]?.[expected];
  const reply = required ? lines.findLastIndex(line => line.npc === required) : -1;
  const serial = player.getTeleportSerial?.();
  if (reply < 1 || !near(player, talk.npc)) { player.getPacketSender().sendInterfaceRemoval(); return; }
  play(player, talk.npcId, lines.slice(0, reply), () => {
    if (!near(player, talk.npc) || talk.npc?.isRegistered?.() === false || player.isRegistered?.() === false
      || player.getTeleportSerial?.() !== serial || !smithingPrerequisites(player) || state(player)[section] !== expected) {
      player.getPacketSender().sendInterfaceRemoval(); return;
    }
    setStage(player, section, next);
    play(player, talk.npcId, lines.slice(reply), () => afterTopic(player, talk));
  });
}

function spearTopic(player, talk) {
  if (!finishedFishing(player) || !near(player, talk.npc)) return;
  const current = state(player).spear;
  const eligible = smithingPrerequisites(player);
  const variant = !eligible || !current ? TRANSCRIPT.smithing : current === TASKED ? TRANSCRIPT.spearAgain : TRANSCRIPT.spearDone;
  const lines = smithingTopicLines(player, talk, variant, TOPIC.spear, eligible);
  if (!eligible || current === TASKED) {
    if (lines.some(line => line.npc)) play(player, talk.npcId, lines, () => afterTopic(player, talk));
    else player.getPacketSender().sendInterfaceRemoval();
    return;
  }
  if (current === 0 || current === DONE) smithingReply(player, talk, lines, "spear", current, current === 0 ? TASKED : TOLD);
}

function hastaTopic(player, talk) {
  const current = state(player);
  if (current.spear !== TOLD || !smithingPrerequisites(player) || !near(player, talk.npc)) return;
  const variant = !current.hasta ? TRANSCRIPT.smithing : current.hasta === TASKED ? TRANSCRIPT.hastaAgain : TRANSCRIPT.hastaDone;
  const lines = smithingTopicLines(player, talk, variant, TOPIC.hasta, true);
  if (current.hasta === 0 || current.hasta === DONE) {
    smithingReply(player, talk, lines, "hasta", current.hasta, current.hasta === 0 ? TASKED : TOLD);
  } else if (lines.some(line => line.npc)) play(player, talk.npcId, lines, () => afterTopic(player, talk));
}

/** Credit only the actual barbarian-anvil production after its inventory transaction succeeded. */
function madeWeapon({ player, source, itemId } = {}) {
  if (!player || source !== "barbarian-anvil" || !smithingPrerequisites(player)) return;
  const recipes = require("../skills/smithing/Data.Smithing").spears();
  const section = recipes.some(recipe => recipe.spearId === itemId) ? "spear"
    : recipes.some(recipe => recipe.hastaId === itemId) ? "hasta" : null;
  if (!section || state(player)[section] !== TASKED || (section === "hasta" && state(player).spear !== TOLD)) return;
  setStage(player, section, DONE);
  player.getDialogueManager().startDialogues(new core.DialogueChainBuilder()
    .add(new core.StatementDialogue(0, LEARNED)).add(new core.EndDialogue(1)));
}

/** rsprox recording 1533: the mix goes, and the section completes, as Otto thanks the player. */
function herbloreDone(player, talk) {
  lesson(player, talk, TRANSCRIPT.herbloreDone, TOPIC.herbloreDone, () => {
    const slot = attackMixSlot(player);
    if (state(player).herblore !== DONE || slot < 0) return;
    player.getInventory().deleteAtSlot(slot, 1, false);
    player.getInventory().refreshItems();
    setStage(player, "herblore", TOLD);
  });
}

/**
 * rsprox recording 1529: carrying a Zamorakian spear, the greeting led to live's top-level menu.
 * Ours: only a player with something for the hastae service gets it; the rest of that menu (My
 * notes, the spirits) isn't here, so the others go straight to the training topics as before.
 */
function opening(player, talk) {
  if (!hastae.offered(player).length) { menu(player, talk); return; }
  ask(player, [
    [TOPIC.training, () => menu(player, talk)],
    [Hastae.TEXT.top, () => hastae.topic(player, talk)],
    [TOPIC.leave, () => play(player, talk.npcId, [{ player: TOPIC.leave }])],
  ]);
}

function talkToOtto(event) {
  if (event.handled) return;
  const definition = event.definition ?? event.npc?.getCurrentDefinition?.(event.player);
  if (definition?.getName?.() !== OTTO || definition.getActions?.()[event.clickType - 1] !== "Talk-to") return;
  event.handled = true;
  const { player } = event;
  const talk = { event, npc: event.npc, npcId: event.npcId ?? definition.getId?.() ?? core.NpcIdentifiers.OTTO_GODBLESSED };
  play(player, talk.npcId, [{ npc: GREETING }], () => opening(player, talk));
}

// ---------------------------------------------------------------- the bed, the catch and the mix

function itemBox(player, text) {
  player.getDialogueManager().startDialogues(new core.DialogueChainBuilder()
    .add(new core.ItemStatementDialogue(0, core.ItemIdentifiers.BARBARIAN_ROD, text)).add(new core.EndDialogue(1)));
}

function takeRod(player) {
  const inventory = player.getInventory();
  if (inventory.getFreeSlots() < 1) { itemBox(player, ROD_NO_SPACE); return; }
  inventory.adds(core.ItemIdentifiers.BARBARIAN_ROD, 1);
  itemBox(player, ROD_TAKEN);
}

function searchBed(event) {
  const { player } = event;
  if (!player.getInventory().contains(core.ItemIdentifiers.BARBARIAN_ROD)) { takeRod(player); return; }
  const chain = new core.DialogueChainBuilder();
  const options = new core.OptionDialogue(0, { executeOption: (option) => {
    if (Number(option) === 1) takeRod(player);
    else player.getPacketSender().sendInterfaceRemoval();
  } }, "Take another.", "Don't take any more.");
  options.setTitle?.(ROD_ALREADY);
  chain.add(options);
  player.getDialogueManager().startDialogues(chain);
}

function caughtFish({ player, itemId, barehand } = {}) {
  if (!player) return;
  // rsprox_transcripts/237/01149.txt: the barehanded tuna's catch line, brut_fishing_s 1 to 2, then the mesbox.
  if (barehand === true && state(player).harpoon === TASKED) {
    setStage(player, "harpoon", DONE);
    player.getDialogueManager().startDialogues(new core.DialogueChainBuilder()
      .add(new core.StatementDialogue(0, LEARNED)).add(new core.EndDialogue(1)));
    return;
  }
  if (state(player).fishingRod !== TASKED) return;
  const { LEAPING_TROUT, LEAPING_SALMON, LEAPING_STURGEON } = core.ItemIdentifiers;
  if (![LEAPING_TROUT, LEAPING_SALMON, LEAPING_STURGEON].includes(itemId)) return;
  setStage(player, "fishingRod", DONE);
  player.getDialogueManager().startDialogues(new core.DialogueChainBuilder()
    .add(new core.StatementDialogue(0, LEARNED)).add(new core.EndDialogue(1)));
}

function madePotion({ player, itemId } = {}) {
  if (!player || itemId !== core.ItemIdentifiers.ATTACK_MIX_2_ || state(player).herblore !== TASKED) return;
  setStage(player, "herblore", DONE);
  player.getDialogueManager().startDialogues(new core.DialogueChainBuilder()
    .add(new core.StatementDialogue(0, LEARNED)).add(new core.EndDialogue(1)));
}

/** ::quest all (`quest:complete-all-miniquests`): every section told to Otto. No item rewards. */
function completeForCommand(request) {
  const { player } = request;
  if (!player) return;
  const current = state(player);
  const open = Object.keys(VARBITS).filter((section) => current[section] !== TOLD);
  if (!open.length) return;
  for (const section of open) setStage(player, section, TOLD);
  request.completed.push("Barbarian Training");
}

function attach(pluginApi) {
  api = pluginApi;
  core = api.core;
  api.persistAttribute(STATE_ATTRIBUTE, {});
  hastae = Hastae.createHastae(api, { play, ask, near, restricted, canConvertSpears, learnedHastae });
  api.onCustomEvent("quest:complete-all-miniquests", completeForCommand);
  api.onPlayerLogin(loggedIn);
  api.onBeforeNpcInteraction(talkToOtto);
  api.onCustomEvent("firemaking:success", madeBowFire);
  api.onCustomEvent("barbarian-pyre:built", builtPyre);
  api.onObjectInteraction(BED, { Search: searchBed });
  api.onCustomEvent("fishing:success", caughtFish);
  api.onCustomEvent("fishing:unlocked", answerFishingUnlock);
  api.onCustomEvent("shop:stock-visible", stockVisible);
  api.onCustomEvent("herblore:made", madePotion);
  api.onCustomEvent("herblore:unlocked", answerUnlock);
  api.onCustomEvent("fishing:barehand-unlocked", answerBarehand);
  api.onCustomEvent("smithing:unlocked", answerSmithingUnlock);
  api.onCustomEvent("smithing:success", madeWeapon);
}

module.exports = {
  name: "BarbarianTraining",
  description: "Adds Otto's Barbarian Training lessons and progression for fishing, firemaking, Herblore and spear/hasta smithing, and his hastae service (Zamorakian spear/hasta conversion, broken dragon hasta repair).",
  members: true,
  // TreasureTrails first: its before-hook answers clue steps that send the player to Otto (the
  // medium anagram and hard cipher), which this Talk-to must not take over.
  dependsOn: ["NpcDialogues", "Farming", "TreasureTrails"],
  register: attach,
  _test: { hastae: () => hastae, STATE_ATTRIBUTE, VARBITS, TOPIC, TASKED, DONE, TOLD, LEARNED, ROD_TAKEN, ROD_NO_SPACE, state, topics, topicLines, answerUnlock, answerBarehand, talkToOtto,
    searchBed, caughtFish, madePotion, setStage, builtPyre, stockVisible, ALCHEMY_SHOP },
};
