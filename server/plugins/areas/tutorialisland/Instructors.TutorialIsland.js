/**
 * The instructors' talks. Words come from the Wiki transcripts (npc-dialogues.json page
 * "Learning the Ropes"); this unit picks the variant for the player's step, answers the
 * transcripts' prose conditions and runs their hand-outs.
 *
 * As captured, a hand-out and the step it completes arrive together: the step moves on when the
 * item is given, not when the talk starts, so a talk closed early leaves the step to replay.
 * "Gives you" lines show as item boxes; transcript lines that are really the step text (the
 * Wiki writes them as messages, "InventoryThis is your inventory...") are left to the overlay.
 */
const T = require("./Common.TutorialIsland");
const Interface = require("./Interface.TutorialIsland");

const { STEP, IDS } = T;
const [GIELINOR, SURVIVAL, CHEF, QUEST, MINING, COMBAT, MAGIC, ACCOUNT, PRAYER, IRONMAN] = [
  IDS.GIELINOR_GUIDE, IDS.SURVIVAL_EXPERT, IDS.MASTER_CHEF, IDS.QUEST_GUIDE, IDS.MINING_INSTRUCTOR,
  IDS.COMBAT_INSTRUCTOR, IDS.MAGIC_INSTRUCTOR, IDS.ACCOUNT_GUIDE, IDS.BROTHER_BRACE, IDS.IRONMAN_TUTOR,
].map((ids) => new Set(ids));

/** Air and mind runes Terrova tops you up to. */
const TUTORIAL_RUNES = 25;

let Items;

/** The Ironman plugin's answer for this player ({ mode: "none" } without it). */
function ironman(player) {
  const query = { player, mode: "none", label: null };
  T.api.emitCustomEvent("ironman:mode", query);
  return query;
}

/**
 * Talks that open a "click the flashing tab" step move it on themselves only when the tab click
 * can't reach us (the mobile frame); otherwise they replay without moving on.
 */
function tabFallback(player, to) {
  if (!Interface.tabsClickable(player)) T.setProgress(player, to);
}

function variantFor(player, npcId) {
  if (!T.isActive(player)) return null;
  const current = T.progress(player);

  if (GIELINOR.has(npcId)) {
    if (current <= STEP.GIELINOR_TALK) {
      T.setProgress(player, STEP.OPEN_SETTINGS);
      return "gielinor-guide";
    }
    if (current <= STEP.SETTINGS_OPENED) {
      if (current === STEP.SETTINGS_OPENED || !Interface.tabsClickable(player)) {
        T.setProgress(player, STEP.GIELINOR_DOOR);
        return "gielinor-guide-after-opening-settings-menu";
      }
      return "gielinor-guide-talking-to-the-gielinor-guide-again";
    }
    return "gielinor-guide-talking-to-the-gielinor-guide-again";
  }

  if (SURVIVAL.has(npcId)) {
    if (current <= STEP.SURVIVAL_TALK) return "survival-expert-talking-to-the-survival-expert";
    if (current <= STEP.FISH) {
      if (current === STEP.OPEN_INVENTORY) tabFallback(player, STEP.FISH);
      return "survival-expert-before-fishing";
    }
    if (current === STEP.OPEN_SKILLS) {
      tabFallback(player, STEP.SKILLS_OPENED);
      return "survival-expert-before-opening-skills-menu";
    }
    if (current === STEP.SKILLS_OPENED) return "survival-expert-after-fishing";
    if (current === STEP.CHOP_TREE) return "survival-expert-before-cutting-a-tree";
    if (current === STEP.LIGHT_FIRE) return "survival-expert-before-lighting-a-fire";
    if (current === STEP.COOK_SHRIMP) return "survival-expert-before-cooking-the-shrimp";
    return "survival-expert-speaking-to-the-survival-expert-again";
  }

  if (CHEF.has(npcId)) {
    if (current <= STEP.CHEF_TALK) {
      T.setProgress(player, STEP.MAKE_DOUGH);
      return "master-chef-talking-to-the-master-chef";
    }
    if (current === STEP.MAKE_DOUGH) return "master-chef-talking-to-the-master-chef-before-cooking-the-dough";
    return "master-chef-talking-to-the-master-chef-again";
  }

  if (QUEST.has(npcId)) {
    if (current <= STEP.QUEST_TALK) {
      T.setProgress(player, STEP.OPEN_QUESTS);
      return "quest-guide-talking-to-the-quest-guide";
    }
    if (current === STEP.QUESTS_OPENED || (current === STEP.OPEN_QUESTS && !Interface.tabsClickable(player))) {
      T.setProgress(player, STEP.QUEST_LADDER);
      return "quest-guide-talking-to-the-quest-guide-after-viewing-the-quest-journal";
    }
    return "quest-guide-talking-to-the-quest-guide-again";
  }

  if (MINING.has(npcId)) {
    if (current <= STEP.MINING_TALK) return "mining-instructor-talking-to-the-mining-instructor";
    if (current <= STEP.MINE_COPPER) return "mining-instructor-before-obtaining-both-ores";
    if (current === STEP.SMELT) return "mining-instructor-after-obtaining-both-ores";
    if (current === STEP.BAR_SMELTED) return "mining-instructor-talking-to-the-mining-instructor-after-smelting-a-bronze-bar";
    if (current <= STEP.SMITH_DAGGER) return "mining-instructor-before-making-the-dagger";
    return "mining-instructor-talking-to-the-mining-instructor-again";
  }

  if (COMBAT.has(npcId)) {
    if (current <= STEP.COMBAT_TALK) {
      T.setProgress(player, STEP.OPEN_EQUIPMENT);
      return "combat-instructor-talking-to-the-combat-instructor";
    }
    if (current <= STEP.EQUIP_DAGGER) {
      if (current === STEP.OPEN_EQUIPMENT) tabFallback(player, STEP.OPEN_EQUIPMENT_STATS);
      return "combat-instructor-talking-to-the-combat-instructor-before-equipping-a-weapon";
    }
    if (current <= STEP.EQUIP_SWORD_SHIELD) return "combat-instructor-talking-to-the-combat-instructor-after-equipping-a-bronze-dagger";
    if (current === STEP.OPEN_COMBAT) {
      tabFallback(player, STEP.ENTER_RAT_PEN);
      return "combat-instructor-talking-to-the-combat-instructor-before-opening-the-combat-interface";
    }
    if (current <= STEP.FIGHTING_RAT) return "combat-instructor-talking-to-the-combat-instructor-before-killing-a-giant-rat";
    if (current === STEP.RAT_KILLED || (current === STEP.RANGE_RAT && !T.hasItem(player, Items.SHORTBOW))) {
      return "combat-instructor-talking-to-the-combat-instructor-after-killing-the-first-giant-rat";
    }
    if (current <= STEP.RANGING_RAT) return "combat-instructor-talking-to-the-combat-instructor-before-killing-the-second-giant-rat";
    return "combat-instructor-talking-to-the-combat-instructor-again";
  }

  if (ACCOUNT.has(npcId)) {
    if (current <= STEP.ACCOUNT_TALK) {
      T.setProgress(player, STEP.OPEN_ACCOUNT);
      return "banking-tutorial-talking-to-the-account-guide";
    }
    if (current === STEP.ACCOUNT_OPENED || (current === STEP.OPEN_ACCOUNT && !Interface.tabsClickable(player))) {
      T.setProgress(player, STEP.ACCOUNT_DOOR);
      return "banking-tutorial-talking-to-the-account-guide-after-opening-the-account-management-menu";
    }
    if (current === STEP.OPEN_ACCOUNT) return "banking-tutorial-talking-to-the-account-guide";
    return "banking-tutorial-talking-to-the-account-guide-again";
  }

  if (PRAYER.has(npcId)) {
    if (current <= STEP.PRAYER_TALK) {
      T.setProgress(player, STEP.OPEN_PRAYER);
      return "prayer-tutorial-talking-to-brother-brace";
    }
    if (current === STEP.PRAYER_OPENED || (current === STEP.OPEN_PRAYER && !Interface.tabsClickable(player))) {
      T.setProgress(player, STEP.PRAYER_DOOR);
      return "prayer-tutorial-talking-to-brother-brace-after-opening-the-prayer-menu";
    }
    if (current === STEP.OPEN_PRAYER) return "prayer-tutorial-talking-to-brother-brace";
    return "prayer-tutorial-talking-to-brother-brace-again";
  }

  if (MAGIC.has(npcId)) {
    if (current <= STEP.MAGIC_TALK) {
      T.setProgress(player, STEP.OPEN_MAGIC);
      return "magic-instructor-talking-to-the-magic-instructor";
    }
    if (current === STEP.MAGIC_OPENED || (current === STEP.OPEN_MAGIC && !Interface.tabsClickable(player))) {
      return "magic-instructor-talking-to-the-magic-instructor-after-opening-the-magic-interface";
    }
    if (current === STEP.OPEN_MAGIC) return "magic-instructor-talking-to-the-magic-instructor";
    if (current < STEP.LEAVE_TALK) return "magic-instructor-talking-to-the-magic-instructor-before-casting-air-strike";
    return "after-casting-wind-strike";
  }

  if (IRONMAN.has(npcId)) return "ironman-tutor-speaking-to-the-ironman-tutor";

  return null;
}

/**
 * Tools a step needs that only the instructor's hand-out talk gives. The Wiki transcripts have no
 * "lost it" branch for these (unlike the chef's flour or the mining hammer), so talking to the
 * instructor again while on the step gives back what's missing. Our behaviour; not captured.
 */
function stepTools() {
  return [
    { instructor: "survival expert", npcs: SURVIVAL, from: STEP.OPEN_INVENTORY, to: STEP.FISH,
      tools: [{ id: Items.SMALL_FISHING_NET, name: "a small fishing net" }] },
    { instructor: "survival expert", npcs: SURVIVAL, from: STEP.CHOP_TREE, to: STEP.COOK_SHRIMP,
      tools: [{ id: Items.BRONZE_AXE, name: "a bronze axe" }, { id: Items.TINDERBOX, name: "a tinderbox" }] },
    { instructor: "mining instructor", npcs: MINING, from: STEP.MINE_TIN, to: STEP.MINE_COPPER,
      tools: [{ id: Items.BRONZE_PICKAXE, name: "a bronze pickaxe" }] },
  ];
}

/** Gives back the current step's missing tools, as far as the inventory has room. */
function replaceStepTools(player, npcId) {
  if (!T.isActive(player)) return;
  const current = T.progress(player);
  const entry = stepTools().find((tools) => tools.npcs.has(npcId) && current >= tools.from && current <= tools.to);
  if (!entry) return;
  const inv = player.getInventory();
  const given = [];
  for (const tool of entry.tools) {
    if (T.hasItem(player, tool.id) || inv.getFreeSlots() <= 0) continue;
    inv.adds(tool.id, 1);
    given.push(tool.name);
  }
  if (given.length) player.sendMessage(`The ${entry.instructor} gives you ${given.join(" and ")}.`);
}

function addArrows(inv, target) {
  const amount = Math.max(0, target - inv.getAmount(Items.BRONZE_ARROW));
  if (amount > 0) inv.adds(Items.BRONZE_ARROW, amount);
}

/**
 * A transcript hand-out, by its wording: gives the items and, for the hand-out that completes a
 * step, moves that step on with it. Returns the item ids given.
 */
function grantNamed(player, text) {
  const value = String(text ?? "").toLowerCase();
  const inv = player.getInventory();
  const given = (ids) => {
    for (const id of ids) inv.adds(id, 1);
    return ids;
  };
  if (value.includes("small fishing net")) {
    T.advanceFrom(player, STEP.SURVIVAL_TALK, STEP.OPEN_INVENTORY);
    return T.hasItem(player, Items.SMALL_FISHING_NET) ? [] : given([Items.SMALL_FISHING_NET]);
  }
  if (value.includes("bronze axe and a tinderbox")) {
    const ids = given([Items.BRONZE_AXE, Items.TINDERBOX]);
    T.advanceFrom(player, STEP.SKILLS_OPENED, STEP.CHOP_TREE);
    return ids;
  }
  if (value.includes("pot of flour") || value.includes("bucket of water")) {
    const ids = [];
    if (value.includes("pot of flour")) ids.push(...given([Items.POT_OF_FLOUR_3]));
    if (value.includes("bucket of water")) ids.push(...given([Items.BUCKET_OF_WATER]));
    // With both in hand the step points at combining them instead of at the chef.
    Interface.render(player, T.progress(player));
    return ids;
  }
  if (value.includes("bronze pickaxe")) {
    const ids = given([Items.BRONZE_PICKAXE]);
    T.advanceFrom(player, STEP.MINING_TALK, STEP.MINE_TIN);
    return ids;
  }
  if (value.includes("hammer")) {
    const ids = inv.getAmount(Items.HAMMER) <= 0 ? given([Items.HAMMER]) : [];
    T.advanceFrom(player, STEP.BAR_SMELTED, STEP.USE_ANVIL);
    return ids;
  }
  if (value.includes("bronze sword and a wooden shield")) {
    const ids = given([Items.BRONZE_SHORTSWORD, Items.WOODEN_SHIELD]);
    T.advanceFrom(player, STEP.DAGGER_EQUIPPED, STEP.EQUIP_SWORD_SHIELD);
    return ids;
  }
  if (value.includes("wooden shield")) return given([Items.WOODEN_SHIELD]);
  if (value.includes("bronze sword")) return given([Items.BRONZE_SHORTSWORD]);
  if (value.includes("shortbow") || value.includes("arrows")) {
    const ids = [];
    if (value.includes("shortbow") && inv.getAmount(Items.SHORTBOW) <= 0) ids.push(...given([Items.SHORTBOW]));
    if (value.includes("arrows")) {
      addArrows(inv, 50);
      ids.push(Items.BRONZE_ARROW);
    }
    if (!T.advanceFrom(player, STEP.RAT_KILLED, STEP.RANGE_RAT)) Interface.render(player, T.progress(player));
    return ids;
  }
  if (value.includes("air and mind runes") || value.includes("air runes and mind runes")) {
    // Top up rather than add: the first talk has both a receive step and the message.
    for (const rune of [Items.AIR_RUNE, Items.MIND_RUNE]) {
      const missing = TUTORIAL_RUNES - inv.getAmount(rune);
      if (missing > 0) inv.adds(rune, missing);
    }
    if (T.progress(player) === STEP.OPEN_MAGIC || T.progress(player) === STEP.MAGIC_OPENED) {
      T.setProgress(player, STEP.CAST_WIND_STRIKE);
    }
    return [Items.AIR_RUNE, Items.MIND_RUNE];
  }
  return [];
}

/** The item box for a "gives you" line: the hand-out's items, as captured (none for the net). */
function boxItems(text) {
  const value = String(text).toLowerCase();
  const pairs = [
    ["bronze axe", [Items.BRONZE_AXE, Items.TINDERBOX]],
    ["flour and some water", [Items.POT_OF_FLOUR_3, Items.BUCKET_OF_WATER]],
    ["some water", [Items.BUCKET_OF_WATER]],
    ["some flour", [Items.POT_OF_FLOUR_3]],
    ["bronze pickaxe", [Items.BRONZE_PICKAXE]],
    ["hammer", [Items.HAMMER]],
    ["bronze sword and a wooden shield", [Items.BRONZE_SHORTSWORD, Items.WOODEN_SHIELD]],
    ["bronze sword", [Items.BRONZE_SHORTSWORD]],
    ["wooden shield", [Items.WOODEN_SHIELD]],
    ["shortbow and some bronze arrows", [Items.SHORTBOW, Items.BRONZE_ARROW]],
    ["shortbow", [Items.SHORTBOW]],
    ["bronze arrows", [Items.BRONZE_ARROW]],
    ["air runes and mind runes", [Items.AIR_RUNE, Items.MIND_RUNE]],
  ];
  return pairs.find(([words]) => value.includes(words))?.[1];
}

/** Transcript messages that are really the step text ("InventoryThis is ..."): title glued to body. */
const STEP_TITLES = [...new Set(T.data.steps.filter((step) => step.text).map((step) => step.text[0]))];

function isStepText(text) {
  const value = String(text);
  return STEP_TITLES.some((title) => value.startsWith(title) && /^[A-Z]/.test(value.slice(title.length)))
    || value.startsWith("Please wait") || value.startsWith("Your character is now");
}

/** Hand-outs written only as messages (no receive step): the axe and tinderbox, Terrova's top-up. */
const MESSAGE_HAND_OUTS = ["bronze axe and a tinderbox", "air runes and mind runes"];

function onDialogueAction(event) {
  const step = event?.step;
  if (!step || !T.NPCS.has(event.npcId) || !T.isActive(event.player)) return;
  const player = event.player;
  if (step.action === "receive" && event.kind === undefined) {
    grantNamed(player, event.text ?? step.text);
    return;
  }
  if (step.action === "open_interface" && step.target === "Ironman" && event.kind === undefined) {
    // End the talk first: closing it closes every interface, the setup included.
    event.handled = true;
    event.end = true;
    queueMicrotask(() => T.api.emitCustomEvent("ironman:open-setup", { player, upgrades: true, handled: false }));
    return;
  }
  if (step.type !== "message" || event.kind !== "message" || typeof step.text !== "string") return;
  const text = step.text;
  if (isStepText(text)) {
    event.handled = true;
    return;
  }
  if (!/ gives you /.test(text)) return;
  if (MESSAGE_HAND_OUTS.some((words) => text.toLowerCase().includes(words))) grantNamed(player, text);
  // The net has no box in the capture: the first line hands it over silently.
  const items = boxItems(text);
  if (items) event.box = { items };
  else event.handled = true;
}

/** "[Ironman type]" in the Ironman tutor's greeting. */
function onDialogueLine(event) {
  if (!IRONMAN.has(event.npcId) || typeof event.text !== "string" || !event.text.includes("[Ironman type]")) return;
  event.text = event.text.replace("[Ironman type]", ironman(event.player).label ?? "Ironman");
}

function freeSpace(player) {
  return player.getInventory().getFreeSlots();
}

function answerCondition(player, npcId, text) {
  if (!T.NPCS.has(npcId) || !T.isActive(player)) return null;
  const value = String(text ?? "").toLowerCase();
  const inv = player.getInventory();
  if (value.includes("playing on desktop")) return true;
  if (value.includes("playing on mobile") || value.includes("plying on mobile")) return false;
  if (value.includes("successfully cooked") || value.includes("successfully cooks") || value.includes("player is successful")) return true;
  if (value.includes("shrimp burned") || value.includes("burns the bread")) return false;
  const flour = inv.getAmount(Items.POT_OF_FLOUR_3) > 0 || inv.getAmount(Items.POT_OF_FLOUR) > 0;
  const water = inv.getAmount(Items.BUCKET_OF_WATER) > 0;
  if (value.includes("neither flour nor water")) return !flour && !water;
  if (value.includes("only has flour")) return flour && !water;
  if (value.includes("only has water")) return !flour && water;
  if (value.includes("does not have enough inventory space")) return freeSpace(player) <= 0;
  if (value.includes("not have a hammer and has inventory space")) return !T.hasItem(player, Items.HAMMER) && freeSpace(player) > 0;
  if (value.includes("not have a hammer and has no inventory space")) return !T.hasItem(player, Items.HAMMER) && freeSpace(player) <= 0;
  if (value.includes("no free inventory spaces")) return freeSpace(player) <= 0;
  // Paired with a following "exactly one free inventory space" branch: zero free spaces, not < 2.
  if (value.includes("does not have two free inventory spaces")) return freeSpace(player) === 0;
  if (value.includes("exactly one free inventory space")) return freeSpace(player) === 1;
  const sword = T.hasItem(player, Items.BRONZE_SHORTSWORD);
  const shield = T.hasItem(player, Items.WOODEN_SHIELD);
  if (value.includes("missing a sword or shield")) return !sword || !shield;
  if (value.includes("one free inventory space and does not have a sword or shield")) return freeSpace(player) === 1 && !sword && !shield;
  if (value.includes("one free inventory space and has a sword but not a shield")) return freeSpace(player) === 1 && sword && !shield;
  if (value.includes("one free inventory space and has a shield but not a sword")) return freeSpace(player) === 1 && shield && !sword;
  if (value.includes("two free inventory space and does not have a sword or shield")) return freeSpace(player) >= 2 && !sword && !shield;
  const bow = T.hasItem(player, Items.SHORTBOW);
  const arrows = inv.getAmount(Items.BRONZE_ARROW) + player.getEquipment().getAmount(Items.BRONZE_ARROW);
  if (value.includes("does not have a shortbow and has less than 50 arrows")) return !bow && arrows < 50;
  if (value.includes("has a shortbow but less than 50 arrows")) return bow && arrows < 50;
  if (value.includes("does not have a shortbow but has 50 arrows")) return !bow && arrows >= 50;
  if (value.includes("enough runes")) {
    const enough = inv.getAmount(Items.AIR_RUNE) >= 5 && inv.getAmount(Items.MIND_RUNE) >= 5;
    return value.includes("doesn't have enough runes") ? !enough : enough;
  }
  const iron = ironman(player).mode !== "none";
  // The past-experience screen's answer; players from before it count as brand new.
  const experience = player.getAttribute(T.EXPERIENCE_ATTRIBUTE) ?? "new";
  if (value.includes("brand new") && value.includes("first time here")) {
    return experience === "new" && (value.includes("has not chosen") ? !iron : value.includes("has chosen") ? iron : true);
  }
  if (value.includes("played in the past") || value.includes("experienced player")) return experience !== "new";
  if (value.includes("regular account")) return !iron;
  if (value.includes("has not chosen to be an ironman")) return !iron;
  if (value.includes("has chosen to be an ironman")) return iron;
  if (value.includes("is an ironman")) return iron;
  if (value.includes("world that does not allow polls")) return false;
  if (value.includes("free world")) return !T.core.WorldDefinition.isMembersWorld();
  if (value.includes("members")) return T.core.WorldDefinition.isMembersWorld();
  if (value.includes("poll booth before talking to the banker")) return false;
  return null;
}

/** "Yes." to the Magic Instructor's "Do you want to go to the mainland?": cast Home Teleport next. */
function onDialogueChoice(event) {
  if (!MAGIC.has(event.npcId) || !T.isActive(event.player)) return;
  if (T.progress(event.player) === STEP.LEAVE_TALK && event.option === "Yes.") {
    T.setProgress(event.player, STEP.HOME_TELEPORT);
  }
}

function onDialogueVariant({ player, npcId }) {
  // Before variantFor, which can move the step on as the talk starts.
  replaceStepTools(player, npcId);
  return variantFor(player, npcId);
}

module.exports = function attach(api) {
  Items = api.core.ItemIdentifiers;
  api.onNpcDialogueVariant(onDialogueVariant);
  api.onNpcDialogueCondition(({ player, npcId, text }) => answerCondition(player, npcId, text));
  api.onCustomEvent("npc-dialogue:action", onDialogueAction);
  api.onCustomEvent("npc-dialogue:choice", onDialogueChoice);
  api.onCustomEvent("npc-dialogue:line", onDialogueLine);
};
