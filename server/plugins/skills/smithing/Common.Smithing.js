/**
 * Helpers shared by the Smithing units: message boxes (optionally running `then` on continue),
 * hammers, the Smithing level, the Smiths' uniform, and cache lookups by gameval name.
 */
const Core = require("./Core.Smithing");
// Read directly, not through Core: the Giants' Foundry asks for the uniform too.
const { ItemIdentifiers: Items } = require("../../../src/main/typescript/elvarg/util/ItemIdentifiers");

function show(player, entry, then) {
  const { DialogueChainBuilder, ActionDialogue } = Core;
  const chain = new DialogueChainBuilder().add(entry);
  // An ActionDialogue only works at the end of a chain: it runs on the box's continue.
  if (then) chain.add(new ActionDialogue(1, { execute: () => { player.getDialogueManager().reset(); then(); } }));
  player.getDialogueManager().startDialogues(chain);
}

function messageBox(player, text, then) {
  show(player, new Core.StatementDialogue(0, text), then);
}

/** A filterable game line: the chat's spam channel, as captured for the smithing and smelting lines. */
function spam(player, text) {
  player.getPacketSender().sendTypedMessage(Core.ChatType.SPAM, text);
}

function itemBox(player, itemId, text, then) {
  show(player, new Core.ItemStatementDialogue(0, itemId, text), then);
}

/** Wiki (Smithing): a hammer, or an Imcando hammer carried or wielded (either hand). */
function hasHammer(player) {
  const { ItemIdentifiers: Items, Equipment } = Core;
  const hammers = [Items.HAMMER, Items.IMCANDO_HAMMER, Items.IMCANDO_HAMMER_OFF_HAND_];
  const equipment = player.getEquipment?.();
  const wielded = [Equipment.WEAPON_SLOT, Equipment.SHIELD_SLOT].map((slot) => equipment?.get(slot)?.getId?.());
  return hammers.some((id) => player.getInventory().contains(id) || wielded.includes(id));
}

/**
 * The Smiths' uniform (https://oldschool.runescape.wiki/w/Smiths%27_Uniform): "Each piece gives
 * a 20% chance", "up to a 100% chance with the full set" (tunic, trousers, boots and either
 * gloves). Used for anvil work and the Giants' Foundry's preform progress.
 */
function smithsUniformChance(player) {
  const equipment = player.getEquipment();
  const pieces = [Items.SMITHS_TUNIC, Items.SMITHS_TROUSERS, Items.SMITHS_BOOTS].filter((id) => equipment.contains(id)).length
    + ([Items.SMITHS_GLOVES, Items.SMITHS_GLOVES_I_].some((id) => equipment.contains(id)) ? 1 : 0);
  return pieces === 4 ? 1 : pieces * 0.2;
}

/** The Smithing level the skill checks: the current level, raised by content ("skills:level-boost", a league relic's invisible +12). */
function smithingLevel(player) {
  const request = { player, skill: Core.Skill.SMITHING, boost: 0 };
  Core.api.emitCustomEvent("skills:level-boost", request);
  return player.getSkillManager().getCurrentLevel(Core.Skill.SMITHING) + Math.max(0, request.boost | 0);
}

/** How many items one cycle of a make-X loop makes ("skills:actions-per-cycle", a league relic's all at once); 1 unless content says more. */
function actionsPerCycle(player, skill, kind) {
  const request = { player, skill, kind, actions: 1 };
  Core.api.emitCustomEvent("skills:actions-per-cycle", request);
  return Math.max(1, request.actions | 0);
}

/** A product made, with its amount and XP ("skills:produced", for content that adds to it: a league relic's extra product); `kind` names the loop. */
function produced(player, skill, itemId, amount, xp, kind = null) {
  Core.api.emitCustomEvent("skills:produced", { player, skill, itemId, amount, xp, kind });
}

function required(kind, name, id) {
  if (id == null) throw new Error(`Smithing: unknown ${kind} ${name}`);
  return id;
}

/** The cache id of an obj gameval, e.g. "godwars_godsword_blade1". */
function obj(name) {
  return required("obj", name, Core.CacheDefinitions.getObjId(name));
}

function varbit(name) {
  return required("varbit", name, Core.CacheDefinitions.getVarbitId(name));
}

function varp(name) {
  return required("varp", name, Core.CacheDefinitions.getVarpId(name));
}

/** An Animation of a seq gameval, e.g. "human_smithing", optionally delayed by `delay` client cycles. */
function animation(name, delay = 0) {
  return new Core.Animation(required("seq", name, Core.CacheDefinitions.getSeqId(name)), delay);
}

/** The anvil and repair hammering; `delay` in client cycles. */
function hammering(delay = 0) {
  return animation("human_smithing", delay);
}

/** The powered staves' wording for a preset copy (Presets.PvpMode tags them untradeable, unbankable and preset). */
const PRESET_TEXT = "Preset items cannot be used for this.";

/** A preset (or meta-untradeable, unbankable) copy: it must never come out as part of a fresh, tradeable product. */
function restricted(item) {
  return !!item && (item.isPresetItem?.() === true || item.isUntradeable?.() === true || item.isUnbankable?.() === true);
}

module.exports = { messageBox, spam, itemBox, hasHammer, smithsUniformChance, smithingLevel, actionsPerCycle, produced, obj, varbit, varp, animation, hammering, restricted, PRESET_TEXT };
