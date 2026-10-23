/**
 * Helpers shared by the Smithing units: message boxes (optionally running `then` on continue),
 * hammers, the Smithing level, and cache lookups by gameval name.
 */
const Core = require("./Core.Smithing");

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

function smithingLevel(player) {
  return player.getSkillManager().getCurrentLevel(Core.Skill.SMITHING);
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

/** An Animation of a seq gameval, e.g. "human_smithing". */
function animation(name) {
  return new Core.Animation(required("seq", name, Core.CacheDefinitions.getSeqId(name)));
}

/** The anvil and repair hammering. */
function hammering() {
  return animation("human_smithing");
}

module.exports = { messageBox, itemBox, hasHammer, smithingLevel, obj, varbit, varp, animation, hammering };
