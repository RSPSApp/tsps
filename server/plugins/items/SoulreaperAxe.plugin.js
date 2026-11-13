/**
 * The Soulreaper axe's four Desert Treasure II components (docs/soulreaper-axe.md): each one's
 * Inspect, and any of them used on another assembling the axe.
 *
 * Sources: rsprox capture 1754 (rev 227) - the four Inspect boxes (ticks 3734-3739), the blood-rune
 * refusal with all four components and no runes (tick 3741), and the assembly with 2,000 blood runes
 * (ticks 4090-4096); the Wiki's Transcript:Executioner's axe head for the missing-components box,
 * and Soulreaper axe (Creation) for 75 Magic (not boostable) and 400 Magic XP.
 *
 * Ours: the Magic-level refusal's wording and its place in the order of checks (neither is recorded
 * or on the Wiki).
 */
const BLOOD_RUNES = 2000;
const MAGIC_LEVEL = 75;
const MAGIC_XP = 400;

const AXE = "soulreaper";
/** Gameval, cache name, and the Inspect text (capture 1754). */
const COMPONENTS = [
  ["soulreaper_axe_head", "Executioner's axe head", "It's the head of Vardorvis' axe. You might be able to combine it with something else."],
  ["soulreaper_axe_eye", "Eye of the Duke", "It's one of Duke Sucellus' many eyes. You might be able to combine it with something else."],
  ["soulreaper_axe_staff", "Siren's staff", "It's a staff taken from the Whisperer. You might be able to combine it with something else."],
  ["soulreaper_axe_lure", "Leviathan's lure", "It's the lure of the Leviathan. You might be able to combine it with something else."],
];

const MISSING_COMPONENTS = "You don't have enough components to make anything useful. It looks like you'll need four separate components.";
const NEED_RUNES = "Assembling those items will require the power of 2,000 blood runes.";
const MAGIC_TOO_LOW = `You need a Magic level of ${MAGIC_LEVEL} to assemble the Soulreaper axe.`;
const QUESTION = "Create a Soulreaper axe?";
const ASSEMBLED = "You successfully assemble the four components into a Soulreaper axe.";

/** Capture 1754 tick 4096: as the Ancient ring icons' combination, with a second sound. */
const ANIMATION = "human_xbow_enchant_arrowtip_walkmerge";
const SPOTANIM = "xbows_enchanting_tips_spot";
const SOUNDS = [140, 1613];

let api;
let ids = null;

function resolve() {
  if (ids) return ids;
  const { CacheDefinitions } = api.core;
  ids = {
    axe: CacheDefinitions.getObjId(AXE),
    components: COMPONENTS.map(([gameval, , text]) => ({ id: CacheDefinitions.getObjId(gameval), text })),
    animation: CacheDefinitions.getSeqId(ANIMATION),
    spotanim: CacheDefinitions.getSpotanimId(SPOTANIM),
  };
  return ids;
}

function component(itemId) {
  return resolve().components.find((entry) => entry.id === itemId) ?? null;
}

/** A message box, logged in the chatbox as live does (type=mesbox), with the item when there is one. */
function box(player, text, itemId = null) {
  const { ChatType, DialogueChainBuilder, StatementDialogue, ItemStatementDialogue, EndDialogue } = api.core;
  player.getPacketSender().sendTypedMessage(ChatType.MESBOX, text);
  player.getDialogueManager().startDialogues(new DialogueChainBuilder().add(
    itemId == null ? new StatementDialogue(0, text) : new ItemStatementDialogue(0, itemId, text),
    new EndDialogue(1),
  ));
}

function inspect({ player, itemId }) {
  const entry = component(itemId);
  if (!entry) return false;
  box(player, entry.text, itemId);
  return true;
}

function hasEverything(player) {
  const inventory = player.getInventory();
  return resolve().components.every((entry) => inventory.contains(entry.id))
    && inventory.getAmount(api.core.ItemIdentifiers.BLOOD_RUNE) >= BLOOD_RUNES;
}

function assemble(player) {
  if (!hasEverything(player)) return;
  const { Animation, Graphic, ItemIdentifiers, Skill } = api.core;
  const { axe, components, animation, spotanim } = resolve();
  const inventory = player.getInventory();
  for (const entry of components) inventory.deleteNumber(entry.id, 1);
  inventory.deleteNumber(ItemIdentifiers.BLOOD_RUNE, BLOOD_RUNES);
  inventory.adds(axe, 1);
  if (animation != null) player.performAnimation(new Animation(animation));
  if (spotanim != null) player.performGraphic(new Graphic(spotanim));
  for (const sound of SOUNDS) player.getPacketSender().sendSoundEffect(sound, 1, 0, 255);
  player.getSkillManager().addExperiences(Skill.MAGIC, MAGIC_XP);
  box(player, ASSEMBLED, axe);
}

function combine({ player, usedItemId, usedWithItemId }) {
  if (!component(usedItemId) || !component(usedWithItemId)) return false;
  const inventory = player.getInventory();
  if (!resolve().components.every((entry) => inventory.contains(entry.id))) {
    box(player, MISSING_COMPONENTS);
    return true;
  }
  if (inventory.getAmount(api.core.ItemIdentifiers.BLOOD_RUNE) < BLOOD_RUNES) {
    box(player, NEED_RUNES);
    return true;
  }
  if (player.getSkillManager().getMaxLevel(api.core.Skill.MAGIC) < MAGIC_LEVEL) {
    box(player, MAGIC_TOO_LOW);
    return true;
  }
  api.sendMultiChatboxPrompt(player, QUESTION,
    "Yes.", () => assemble(player),
    "No.", () => {});
  return true;
}

module.exports = {
  name: "SoulreaperAxe",
  description: "Soulreaper axe components: Inspect each, and assemble the four with 2,000 blood runes into the axe.",
  members: true,
  _test: { inspect, combine, assemble, resolve, BLOOD_RUNES, MAGIC_XP },
  register(pluginApi) {
    api = pluginApi;
    const names = COMPONENTS.map(([, name]) => name);
    for (const name of names) api.onItemAction(name, { Inspect: inspect });
    for (let a = 0; a < names.length; a++) {
      for (let b = a + 1; b < names.length; b++) api.onItemOnItem(names[a], names[b], combine, { noted: false });
    }
  },
};
