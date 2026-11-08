/**
 * Ring of recoil (https://oldschool.runescape.wiki/w/Ring_of_recoil; docs/ring-of-recoil.md): the
 * reflect itself is core (`CombatFactory.handleRecoil`: 10% + 1 of the hit, 40 damage points
 * counted per player, not per ring). This adds the options the Wiki lists for it: the worn
 * Check, and the inventory Break, which spends the ring so the next one starts with all 40
 * (the Wiki's transcript gives every line). It also keeps the monsters on the Wiki's immune
 * list from being recoiled (`combat:recoil-target`).
 */
const IMMUNE_NPCS = new Set(require("./data/recoil-immune-npcs.json").names);

const RING_OF_RECOIL_CHARGE = 40;
const FULL_MESSAGE = "The ring is fully charged. There would be no point in breaking it.";
const BROKEN_MESSAGE = "The ring shatters. Your next ring of recoil will start afresh from 40 damage points.";

let core;

function damageLeft(player) {
  const used = Math.max(0, Number(player.getAttribute(core.CombatFactory.RECOIL_DAMAGE_ATTRIBUTE) ?? 0) || 0);
  return Math.max(0, RING_OF_RECOIL_CHARGE - used);
}

function isRing(item) {
  return item?.getId?.() === core.ItemIdentifiers.RING_OF_RECOIL;
}

function showStatement(player, text) {
  player.getDialogueManager().startDialogues(new core.DialogueChainBuilder().add(
    new core.ItemStatementDialogue(0, core.ItemIdentifiers.RING_OF_RECOIL, text),
  ));
}

/** Worn "Check": the Wiki transcript's line. */
function checkRing({ player, item }) {
  if (!isRing(item)) return false;
  player.sendMessage(`You can inflict ${damageLeft(player)} more points of damage before a ring will shatter.`);
}

function breakRing(player, ring) {
  const inventory = player.getInventory();
  const slot = inventory.getItems().indexOf(ring);
  if (slot < 0 || !isRing(inventory.getItems()[slot])) return;
  inventory.deleteAtSlot(slot, 1);
  player.setAttribute(core.CombatFactory.RECOIL_DAMAGE_ATTRIBUTE, 0);
  showStatement(player, BROKEN_MESSAGE);
}

/** Inventory "Break": a full ring is refused; a used one asks, then shatters. */
function askToBreak({ player, item, interfaceId }) {
  if (!isRing(item) || interfaceId === core.Equipment.INVENTORY_INTERFACE_ID) return false;
  const left = damageLeft(player);
  if (left >= RING_OF_RECOIL_CHARGE) {
    showStatement(player, FULL_MESSAGE);
    return;
  }
  player.getDialogueManager().startDialogues(new core.DialogueChainBuilder().add(
    new core.OptionDialogue(0, {
      executeOption(option) {
        player.getPacketSender().sendInterfaceRemoval();
        if (Number(option) === 1) breakRing(player, item);
      },
    }, "Break the ring.", "Cancel.").setTitle(`Status: ${left} damage points left.`),
  ));
}

/** `combat:recoil-target`: the Wiki's immune monsters take no recoil. */
function recoilTarget(check) {
  if (check.target?.isNpc?.() && IMMUNE_NPCS.has(check.target.getAsNpc().getCurrentDefinition().getName())) {
    check.allow = false;
  }
}

module.exports = {
  name: "RingOfRecoil",
  description: "Adds the ring of recoil's Check and Break options and exempts the Wiki's list of immune monsters from the reflected damage.",
  members: true,
  register(api) {
    core = api.core;
    api.onItemAction("Ring of recoil", { Check: checkRing, Break: askToBreak });
    api.onCustomEvent("combat:recoil-target", recoilTarget);
  },
};
