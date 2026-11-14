/**
 * Making the Desert Treasure II ancient rings (docs/ancient-rings.md; rsprox capture 3432, rev 235,
 * and https://oldschool.runescape.wiki/w/Ancient_rings). Four steps, the same for each ring:
 *
 * 1. A chisel on a Fremennik ring (80 Crafting, 400 XP) breaks it into its icon, once Desert Treasure II
 *    is complete (Wiki: Berserker icon, "after completing Desert Treasure II"). Before that the chisel
 *    does nothing with the ring (no refusal is recorded or on the Wiki).
 * 2. Peer the Seer teaches how to combine an icon with an ancient vestige (once, per player).
 * 3. The icon used on its boss's vestige, with 500 blood runes, 90 Magic and 80 Crafting (both
 *    boostable), makes the upgraded icon (400 Magic XP).
 * 4. At a furnace, the upgraded icon, 3 chromium ingots and a ring mould make the ring (2,500 Crafting
 *    XP). The tradeable ring is made, not the untradeable one.
 *
 * Messages, menus, sounds and animations are from capture 3432 (a Berserker/Ultor run). The other
 * three rings follow the same flow with their own items. The capture shows no level-requirement
 * refusal, so those messages are the Wiki's requirement worded in the same style.
 */
const LEARNED_ATTRIBUTE = "ancient-rings:combine-learned";
const DESERT_TREASURE_II = "desert_treasure_ii";
const PEER_LEARN_STEP = "U25hrc";
const PEER_LEARN_MESSAGE_ID = "ancient-rings-learn";
const PEER_LEARN_TEXT = "Peer the Seer shows you how to combine ring icons with ancient vestiges.";
const RING_ICON_VARIANT = "standard-dialogue-with-a-ring-icon";
const NOT_LEARNED = "You're not quite sure how to combine those. Perhaps a Fremennik could help.";
const BLOOD_RUNES = 500;
/** Every loc that works as a furnace (skills/data/furnaces.json), where the ring is crafted. */
const FURNACE_NAMES = require("../skills/data/furnaces.json").names;
const CHROMIUM_INGOTS = 3;
const CRAFTING_LEVEL = 80;
const MAGIC_LEVEL = 90;
const BREAK_XP = 400;
const COMBINE_XP = 400;
const CRAFT_XP = 2500;
const BREAK_ANIMATION = 8833;
const COMBINE_ANIMATION = 10096;
const COMBINE_GRAPHIC = 759;
const BREAK_SOUND = 2586;
const COMBINE_SOUND = 140;
const CRAFT_SOUND = 2725;

/** Fremennik ring -> icon -> vestige -> upgraded icon -> tradeable ring, by name for messages. */
const RINGS = [
  { name: "Berserker", ring: "BERSERKER_RING", icon: "BERSERKER_ICON", vestige: "ULTOR_VESTIGE", upgraded: "ULTOR_ICON", result: 28307, finalName: "Ultor" },
  { name: "Archer", ring: "ARCHERS_RING", icon: "ARCHER_ICON", vestige: "VENATOR_VESTIGE", upgraded: "VENATOR_ICON", result: 28310, finalName: "Venator" },
  { name: "Warrior", ring: "WARRIOR_RING", icon: "WARRIOR_ICON", vestige: "BELLATOR_VESTIGE", upgraded: "BELLATOR_ICON", result: 28316, finalName: "Bellator" },
  { name: "Seers", ring: "SEERS_RING", icon: "SEERS_ICON", vestige: "MAGUS_VESTIGE", upgraded: "MAGUS_ICON", result: 28313, finalName: "Magus" },
];

let api;
let table = null;

function recipes() {
  if (table) return table;
  const { ItemIdentifiers: I } = api.core;
  table = RINGS.map((entry) => ({
    ...entry,
    ringId: I[entry.ring],
    iconId: I[entry.icon],
    vestigeId: I[entry.vestige],
    upgradedId: I[entry.upgraded],
  }));
  return table;
}

const articled = (name) => `${name} ring`;

function level(player, skill) {
  return player.getSkillManager().getCurrentLevel(skill);
}

function statement(player, text, items) {
  const { DialogueChainBuilder, ItemStatementDialogue, DoubleItemStatementDialogue, EndDialogue } = api.core;
  const chain = new DialogueChainBuilder();
  chain.add(items.length > 1
    ? new DoubleItemStatementDialogue(0, items[0], items[1], text)
    : new ItemStatementDialogue(0, items[0], text));
  chain.add(new EndDialogue(1));
  player.getDialogueManager().startDialogues(chain);
}

/** A warning box, then the Yes./No. menu the capture shows; nothing is consumed before Yes. */
function confirm(player, warning, items, question, onYes) {
  const { DialogueChainBuilder, ItemStatementDialogue, DoubleItemStatementDialogue, ActionDialogue } = api.core;
  const chain = new DialogueChainBuilder();
  chain.add(items.length > 1
    ? new DoubleItemStatementDialogue(0, items[0], items[1], warning)
    : new ItemStatementDialogue(0, items[0], warning));
  chain.add(new ActionDialogue(1, {
    execute: () => api.sendMultiChatboxPrompt(player, question,
      "Yes.", onYes,
      "No.", () => {}),
  }));
  player.getDialogueManager().startDialogues(chain);
}

function hasLearned(player) {
  return player.getAttribute(LEARNED_ATTRIBUTE) === true;
}

function sound(player, id) {
  player.getPacketSender().sendSoundEffect(id, 1, 0, 255);
}

/** 1. Chisel on a ring: its icon. */
function breakRing(player, recipe) {
  const { Skill } = api.core;
  const inventory = player.getInventory();
  if (level(player, Skill.CRAFTING) < CRAFTING_LEVEL) {
    player.sendMessage(`You need level ${CRAFTING_LEVEL} Crafting to break down the ${articled(recipe.name)}.`);
    return true;
  }
  confirm(player,
    `Are you sure you wish to break down the ${articled(recipe.name)} into a ${recipe.name} icon? This cannot be reversed.`,
    [recipe.ringId, api.core.ItemIdentifiers.CHISEL], `Break down the ${articled(recipe.name)}?`, () => {
      if (!inventory.contains(recipe.ringId)) return;
      inventory.deleteNumber(recipe.ringId, 1);
      inventory.adds(recipe.iconId, 1);
      player.performAnimation(new api.core.Animation(BREAK_ANIMATION));
      player.getSkillManager().addExperiences(Skill.CRAFTING, BREAK_XP);
      sound(player, BREAK_SOUND);
      player.sendMessage(`You successfully break down the ${articled(recipe.name)} into a ${recipe.name} icon.`);
      statement(player, `You successfully break down the ${articled(recipe.name)} into a ${recipe.name} icon.`, [recipe.iconId]);
    });
  return true;
}

function desertTreasureIIComplete(player) {
  const request = { player, key: DESERT_TREASURE_II, complete: false };
  api.emitCustomEvent("quest:is-complete", request);
  return request.complete === true;
}

function useChisel({ player, usedItemId, usedWithItemId }) {
  const ringId = usedItemId === api.core.ItemIdentifiers.CHISEL ? usedWithItemId : usedItemId;
  const recipe = recipes().find((entry) => entry.ringId === ringId);
  if (!recipe || !desertTreasureIIComplete(player)) return false;
  return breakRing(player, recipe);
}

/** 3. Icon on its vestige: the upgraded icon. */
function combine(player, recipe) {
  const { Skill } = api.core;
  const inventory = player.getInventory();
  if (!hasLearned(player)) {
    player.sendMessage(NOT_LEARNED);
    statement(player, NOT_LEARNED, [recipe.iconId, recipe.vestigeId]);
    return true;
  }
  if (inventory.getAmount(api.core.ItemIdentifiers.BLOOD_RUNE) < BLOOD_RUNES) {
    const text = `You'll also need ${BLOOD_RUNES} blood runes to be able to combine those.`;
    player.sendMessage(text);
    statement(player, text, [api.core.ItemIdentifiers.BLOOD_RUNE]);
    return true;
  }
  if (level(player, Skill.MAGIC) < MAGIC_LEVEL || level(player, Skill.CRAFTING) < CRAFTING_LEVEL) {
    player.sendMessage(`You need level ${MAGIC_LEVEL} Magic and level ${CRAFTING_LEVEL} Crafting to combine those.`);
    return true;
  }
  const what = `${recipe.name} icon, ${recipe.finalName} vestige and ${BLOOD_RUNES} blood runes`;
  confirm(player, `Are you sure you wish to combine the ${what} to create ${articledIcon(recipe.finalName)}?`,
    [recipe.iconId, recipe.vestigeId], `Combine the ${what}?`, () => {
      if (!inventory.contains(recipe.iconId) || !inventory.contains(recipe.vestigeId)
        || inventory.getAmount(api.core.ItemIdentifiers.BLOOD_RUNE) < BLOOD_RUNES) return;
      inventory.deleteNumber(recipe.iconId, 1);
      inventory.deleteNumber(recipe.vestigeId, 1);
      inventory.deleteNumber(api.core.ItemIdentifiers.BLOOD_RUNE, BLOOD_RUNES);
      inventory.adds(recipe.upgradedId, 1);
      player.performAnimation(new api.core.Animation(COMBINE_ANIMATION));
      player.performGraphic(new api.core.Graphic(COMBINE_GRAPHIC));
      player.getSkillManager().addExperiences(Skill.MAGIC, COMBINE_XP);
      sound(player, COMBINE_SOUND);
      const done = `You successfully combine the ${what} to create ${articledIcon(recipe.finalName)}.`;
      player.sendMessage(done);
      statement(player, done, [recipe.upgradedId]);
    });
  return true;
}

const articledIcon = (finalName) => `${/^[AEIOU]/.test(finalName) ? "an" : "a"} ${finalName} icon`;

function useIconOnVestige({ player, usedItemId, usedWithItemId }) {
  const recipe = recipes().find((entry) => (entry.iconId === usedItemId && entry.vestigeId === usedWithItemId)
    || (entry.iconId === usedWithItemId && entry.vestigeId === usedItemId));
  return recipe ? combine(player, recipe) : false;
}

function furnaceRecipe(player) {
  const inventory = player.getInventory();
  return recipes().find((entry) => inventory.contains(entry.upgradedId));
}

/** 4. The furnace's Smelt option with an upgraded icon: the ring. */
function craft({ player }) {
  const recipe = furnaceRecipe(player);
  if (!recipe) return false;
  const { Skill, ItemIdentifiers: I } = api.core;
  const inventory = player.getInventory();
  const name = `${recipe.finalName} ring`;
  if (inventory.getAmount(I.CHROMIUM_INGOT) < CHROMIUM_INGOTS) {
    const text = `You'll need ${CHROMIUM_INGOTS} chromium ingots to craft ${/^[AEIOU]/.test(recipe.finalName) ? "an" : "a"} ${name}.`;
    player.sendMessage(text);
    statement(player, text, [I.CHROMIUM_INGOT]);
    return true;
  }
  if (!inventory.contains(I.RING_MOULD)) {
    const text = `You'll need a ring mould to craft ${/^[AEIOU]/.test(recipe.finalName) ? "an" : "a"} ${name}.`;
    player.sendMessage(text);
    statement(player, text, [I.RING_MOULD]);
    return true;
  }
  if (level(player, Skill.MAGIC) < MAGIC_LEVEL || level(player, Skill.CRAFTING) < CRAFTING_LEVEL) {
    player.sendMessage(`You need level ${MAGIC_LEVEL} Magic and level ${CRAFTING_LEVEL} Crafting to craft ${/^[AEIOU]/.test(recipe.finalName) ? "an" : "a"} ${name}.`);
    return true;
  }
  confirm(player, `Craft ${/^[AEIOU]/.test(recipe.finalName) ? "an" : "a"} ${name}? This process cannot be reversed.`,
    [I.CHROMIUM_INGOT, recipe.upgradedId], `Craft ${/^[AEIOU]/.test(recipe.finalName) ? "an" : "a"} ${name}?`, () => {
      if (!inventory.contains(recipe.upgradedId) || inventory.getAmount(I.CHROMIUM_INGOT) < CHROMIUM_INGOTS
        || !inventory.contains(I.RING_MOULD)) return;
      inventory.deleteNumber(recipe.upgradedId, 1);
      inventory.deleteNumber(I.CHROMIUM_INGOT, CHROMIUM_INGOTS);
      inventory.adds(recipe.result, 1);
      player.getSkillManager().addExperiences(Skill.CRAFTING, CRAFT_XP);
      sound(player, CRAFT_SOUND);
      const done = `You successfully craft ${/^[AEIOU]/.test(recipe.finalName) ? "an" : "a"} ${name}.`;
      player.sendMessage(done);
      statement(player, done, [recipe.result]);
    });
  return true;
}

/** Peer the Seer's "with a ring icon" transcript plays while the player carries a ring icon. */
function peerVariant({ player, npcId }) {
  const { NpcIdentifiers } = api.core;
  if (npcId !== NpcIdentifiers.PEER_THE_SEER) return null;
  const inventory = player.getInventory();
  return recipes().some((entry) => inventory.contains(entry.iconId)) ? RING_ICON_VARIANT : null;
}

/** The transcript's unimplemented step ("Peer shows you how to combine...") teaches the combination. */
function peerAction(event) {
  if (event.kind === "message" && event.stepId === PEER_LEARN_MESSAGE_ID) {
    event.player.setAttribute(LEARNED_ATTRIBUTE, true);
    event.text = PEER_LEARN_TEXT;
    event.box = { statement: true };
    return;
  }
  if (event.stepId !== PEER_LEARN_STEP || event.npcId !== api.core.NpcIdentifiers.PEER_THE_SEER) return;
  event.handled = true;
  event.steps = [{ type: "message", id: PEER_LEARN_MESSAGE_ID, text: PEER_LEARN_TEXT }];
}

const ICON_HINT = "It's an icon from an old ring. With the help of a Fremennik, you might be able to combine it with something else.";
const VESTIGE_HINT = "It's an ancient vestige filled with power. You might be able to combine it with something else.";
const UPGRADED_HINT = "It's an ancient icon filled with power. You might be able to use it to craft a powerful ring.";

/** Item name -> its Inspect text (capture 3432). */
const INSPECT_TEXT = new Map([
  ["Berserker icon", ICON_HINT], ["Archer icon", ICON_HINT], ["Warrior icon", ICON_HINT], ["Seers icon", ICON_HINT],
  ["Ultor vestige", VESTIGE_HINT], ["Venator vestige", VESTIGE_HINT],
  ["Bellator vestige", VESTIGE_HINT], ["Magus vestige", VESTIGE_HINT],
  ["Ultor icon", UPGRADED_HINT], ["Venator icon", UPGRADED_HINT], ["Bellator icon", UPGRADED_HINT], ["Magus icon", UPGRADED_HINT],
]);

/** Cache names of the Fremennik rings the chisel breaks down. */
const RING_NAMES = ["Berserker ring", "Archers ring", "Warrior ring", "Seers ring"];
/** [icon, vestige] name pairs, one per ring. */
const ICON_VESTIGE_PAIRS = [["Berserker icon", "Ultor vestige"], ["Archer icon", "Venator vestige"],
  ["Warrior icon", "Bellator vestige"], ["Seers icon", "Magus vestige"]];

function inspectIcon({ player, itemId }) {
  const text = INSPECT_TEXT.get(api.core.ItemDefinition.forId(itemId)?.getName?.());
  if (!text) return false;
  player.sendMessage(text);
  statement(player, text, [itemId]);
  return true;
}

module.exports = {
  name: "AncientRingCrafting",
  description: "Desert Treasure II ancient rings: break Fremennik rings with a chisel, combine icons with vestiges and craft the finished rings at a furnace.",
  members: true,
  _test: { recipes: () => recipes(), useChisel, useIconOnVestige, craft, peerVariant, peerAction, inspectIcon, LEARNED_ATTRIBUTE },
  register(pluginApi) {
    api = pluginApi;
    api.persistAttribute(LEARNED_ATTRIBUTE, false);
    for (const ring of RING_NAMES) api.onItemOnItem("Chisel", ring, useChisel, { noted: false });
    for (const [icon, vestige] of ICON_VESTIGE_PAIRS) api.onItemOnItem(icon, vestige, useIconOnVestige, { noted: false });
    for (const name of INSPECT_TEXT.keys()) api.onItemAction(name, { Inspect: inspectIcon });
    for (const name of FURNACE_NAMES) api.onObjectInteraction(name, { Smelt: craft, Use: craft });
    api.onNpcDialogueVariant(peerVariant);
    api.onCustomEvent("npc-dialogue:action", peerAction);
  },
};
