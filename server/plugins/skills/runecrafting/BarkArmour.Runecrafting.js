"use strict";

/**
 * Swampbark and bloodbark armour: the runescrolls that teach the infusion, and splitbark armour
 * infused at the altars (docs/runecrafting.md "Swampbark and bloodbark"; Wiki: Swampbark armour,
 * Bloodbark armour, Runescroll of swampbark, Runescroll of bloodbark).
 *
 * - Read on a runescroll asks on the destroy prompt ("Are you sure you wish to learn from the
 *   scroll?"); Yes sets the unlock varbit, removes the scroll with the chat line and synth 2655,
 *   and shows the scroll in an item box with what it taught (rsprox capture 1632, ticks 168-175
 *   and 1653-1658). Read again once learnt shows only an item box and keeps the scroll (Wiki:
 *   Transcript:Runescroll of swampbark / bloodbark, "Read after the first time").
 * - A splitbark piece used on the Nature Altar (swampbark) or on either Blood Altar (bloodbark)
 *   costs 100 runes for gauntlets and boots, 250 for the helm, 500 for the body and legs, at
 *   Runecraft 42/46/48 (swampbark) or 77/79/81 (bloodbark), and pays 0.05 XP a rune (Wiki; the
 *   capture's XP drops 5/13/25 at ticks 518 and 1552-1573 match). The craft graphic, human_runecraft
 *   and synth 2710 play on the use, the piece, runes, XP and the spam line a tick later (rsprox
 *   capture 1632, tick 516).
 * - Without the scroll read, the altar refuses in a message box (rsprox capture 1636, tick 6625).
 */

/** The piece a splitbark item becomes, its runes and levels. */
let PIECES;
/** The altar kinds by loc id. */
let ALTARS;
/** The two runescrolls by item id. */
let SCROLLS;

const XP_PER_RUNE = 0.05;
const LEARN_QUESTION = "Are you sure you wish to learn from the scroll?";
const LEARN_NOTE = "It will destroy the scroll in the process.";
const LEARN_MESSAGE = "As you close the scroll it starts to disintegrate in your hands.";
/** Synth 2655 as the scroll disintegrates (rsprox capture 1632). */
const LEARN_SOUND = 2655;
/** Spotanim runecrafting at height 92, as the rune altars (rsprox capture 1632, tick 517). */
const INFUSE_GRAPHIC = { id: 186, height: 92 };
const INFUSE_ANIMATION = 791;
const INFUSE_SOUND = 2710;
/** The piece is made a tick after the animation (rsprox capture 1632, ticks 517-518). */
const INFUSE_DELAY_TICKS = 1;

let api;
let core;
const varbitIds = new Map();

function attach(pluginApi) {
  api = pluginApi;
  core = pluginApi.core;
  const { ItemIdentifiers: I, ObjectIdentifiers: O } = core;
  const swamp = {
    key: "swampbark",
    attribute: "runecrafting:swampbark-learnt",
    varbit: "shades_swamp_unlock",
    runeId: I.NATURE_RUNE,
    runeName: "nature runes",
    altarName: "Nature altar",
  };
  const blood = {
    key: "bloodbark",
    attribute: "runecrafting:bloodbark-learnt",
    varbit: "shades_blood_unlock",
    runeId: I.BLOOD_RUNE,
    runeName: "blood runes",
    altarName: "Blood altar",
  };
  ALTARS = new Map([
    [O.ALTAR_46, swamp],
    // The true Blood Altar (the capture's) and Kourend's (Wiki: "either the true Blood Altar or
    // Kourend's Blood Altar").
    [O.ALTAR_83, blood],
    [O.BLOOD_ALTAR, blood],
  ]);
  SCROLLS = new Map([
    [I.RUNESCROLL_OF_SWAMPBARK, {
      kind: swamp,
      text: "Reading through the scroll reveals the secret to infusing<br>Splitbark armour with Nature runes at a Nature altar<br>to create Swampbark armour!",
      knownText: "You've already gained the knowledge to infuse Splitbark armour with Nature runes.",
    }],
    [I.RUNESCROLL_OF_BLOODBARK, {
      kind: blood,
      text: "Reading through the scroll reveals the secret to infusing<br>Splitbark armour with Blood runes at a Blood altar to<br>create Bloodbark armour!",
      knownText: "You've already gained the knowledge to infuse Splitbark armour with Blood runes.",
    }],
  ]);
  PIECES = new Map([
    [I.SPLITBARK_GAUNTLETS, { runes: 100, swampbark: [42, I.SWAMPBARK_GAUNTLETS], bloodbark: [77, I.BLOODBARK_GAUNTLETS] }],
    [I.SPLITBARK_BOOTS, { runes: 100, swampbark: [42, I.SWAMPBARK_BOOTS], bloodbark: [77, I.BLOODBARK_BOOTS] }],
    [I.SPLITBARK_HELM, { runes: 250, swampbark: [46, I.SWAMPBARK_HELM], bloodbark: [79, I.BLOODBARK_HELM] }],
    [I.SPLITBARK_BODY, { runes: 500, swampbark: [48, I.SWAMPBARK_BODY], bloodbark: [81, I.BLOODBARK_BODY] }],
    [I.SPLITBARK_LEGS, { runes: 500, swampbark: [48, I.SWAMPBARK_LEGS], bloodbark: [81, I.BLOODBARK_LEGS] }],
  ]);
  pluginApi.persistAttribute(swamp.attribute, false);
  pluginApi.persistAttribute(blood.attribute, false);
  pluginApi.onPlayerLogin(sendUnlocks);
  pluginApi.onItemAction("Runescroll of swampbark", { Read: readScroll });
  pluginApi.onItemAction("Runescroll of bloodbark", { Read: readScroll });
  pluginApi.onItemOnObject(infuse, { noted: false });
}

function varbitId(name) {
  if (!varbitIds.has(name)) varbitIds.set(name, core.CacheDefinitions.getVarbitId(name));
  return varbitIds.get(name);
}

function learnt(player, kind) {
  return player.getAttribute(kind.attribute) === true;
}

function sendUnlock(player, kind) {
  const id = varbitId(kind.varbit);
  if (Number.isInteger(id) && id >= 0) player.getPacketSender().sendVarbit(id, learnt(player, kind) ? 1 : 0);
}

function sendUnlocks({ player }) {
  if (!player || !ALTARS) return;
  for (const kind of new Set(ALTARS.values())) sendUnlock(player, kind);
}

function itemName(id) {
  return core.ItemDefinition.forId(id)?.getName?.() ?? "item";
}

/** Read: asks on the destroy prompt; Yes learns the infusion and uses the scroll up. */
function readScroll(event) {
  const { player, item } = event;
  const scroll = SCROLLS.get(event.itemId);
  if (!player || !scroll) return false;
  const slot = Number.isInteger(event.slot) ? event.slot : player.getInventory().getItems().indexOf(item);
  const held = player.getInventory().getItems()[slot];
  if (!held || held.getId() !== event.itemId) return true;
  if (learnt(player, scroll.kind)) {
    itemBox(player, event.itemId, scroll.knownText);
    return true;
  }
  api.emitCustomEvent("destroy-item:confirm", {
    player, item: held, slot, question: LEARN_QUESTION, note: LEARN_NOTE, confirm: learnFromScroll,
  });
  return true;
}

/** Yes on the prompt (the scroll is still in its slot). */
function learnFromScroll(player, item) {
  const scrollId = item.getId();
  const scroll = SCROLLS.get(scrollId);
  if (!scroll) return;
  // A prompt left open while another scroll taught the same infusion: keep this one.
  if (learnt(player, scroll.kind)) {
    itemBox(player, scrollId, scroll.knownText);
    return;
  }
  const inventory = player.getInventory();
  const slot = inventory.getItems().indexOf(item);
  if (slot < 0) return;
  player.setAttribute(scroll.kind.attribute, true);
  sendUnlock(player, scroll.kind);
  player.sendMessage(LEARN_MESSAGE);
  inventory.deleteAtSlot(slot, 1);
  player.getPacketSender().sendSound(LEARN_SOUND, 100, 0);
  itemBox(player, scrollId, scroll.text);
  api.emitCustomEvent("runecrafting:bark-learnt", { player, kind: scroll.kind.key });
}

function itemBox(player, itemId, text) {
  const { DialogueChainBuilder, ItemStatementDialogue, EndDialogue } = core;
  player.getDialogueManager().startDialogues(
    new DialogueChainBuilder().add(new ItemStatementDialogue(0, itemId, text)).add(new EndDialogue(1)));
}

function statement(player, text) {
  const { DialogueChainBuilder, StatementDialogue } = core;
  player.getDialogueManager().startDialogues(new DialogueChainBuilder().add(new StatementDialogue(0, text)));
}

/** A splitbark piece used on the Nature Altar or a Blood Altar. */
function infuse(event) {
  if (event.handled) return;
  const kind = ALTARS?.get(event.objectId);
  const piece = PIECES?.get(event.itemId);
  if (!kind || !piece || !core.WorldDefinition.isMembersWorld()) return;
  const { player } = event;
  event.handled = true;
  if (!learnt(player, kind)) {
    statement(player, `You have not gained the knowledge to infuse Splitbark with the power<br>of the ${kind.altarName}.`);
    return;
  }
  const [level, resultId] = piece[kind.key];
  const name = itemName(event.itemId);
  if (player.getSkillManager().getCurrentLevel(core.Skill.RUNECRAFTING) < level) {
    // Ours: no recording shows the level refusal.
    statement(player, `You need a Runecraft level of ${level} to infuse your ${name}.`);
    return;
  }
  const inventory = player.getInventory();
  if (inventory.getAmount(kind.runeId) < piece.runes) {
    // Ours: no recording shows the rune refusal.
    statement(player, `You need ${piece.runes} ${kind.runeName} to infuse your ${name}.`);
    return;
  }
  const slot = Number.isInteger(event.itemSlot) ? event.itemSlot : inventory.getItems().findIndex((it) => it?.getId() === event.itemId);
  const item = inventory.getItems()[slot];
  if (!item || item.getId() !== event.itemId) return;
  const { Graphic, Animation, Task } = core;
  player.performGraphic(new Graphic(INFUSE_GRAPHIC.id, 0, INFUSE_GRAPHIC.height));
  player.performAnimation(new Animation(INFUSE_ANIMATION));
  player.getPacketSender().sendSound(INFUSE_SOUND, 100, 0);
  api.getTaskManager().submit(new (class extends Task {
    constructor() {
      super(INFUSE_DELAY_TICKS, player, false);
    }
    execute() {
      this.stop();
      finishInfusion(player, item, event.itemId, slot, kind, piece, resultId, name);
    }
  })());
}

/** The tick after the use: the piece and runes are checked again, then swapped. */
function finishInfusion(player, item, pieceId, slot, kind, piece, resultId, name) {
  if (player.isRegistered?.() === false) return;
  const inventory = player.getInventory();
  const held = inventory.getItems()[slot];
  // The same splitbark still in its slot (a dropped or moved piece leaves an emptied Item there).
  if (held !== item || held.getId() !== pieceId || inventory.getAmount(kind.runeId) < piece.runes) return;
  // The infused piece takes the splitbark's slot (rsprox capture 1632, tick 518).
  inventory.set(slot, new core.Item(resultId, 1));
  inventory.deleteNumber(kind.runeId, piece.runes);
  inventory.refreshItems();
  player.getSkillManager().addExperiences(core.Skill.RUNECRAFTING, piece.runes * XP_PER_RUNE);
  player.getPacketSender().sendTypedMessage(core.ChatType.SPAM, `You bind the temple's power into your ${name}.`);
  api.emitCustomEvent("runecrafting:bark-infused", { player, itemId: resultId, kind: kind.key });
}

module.exports = { attach, _test: { XP_PER_RUNE } };
