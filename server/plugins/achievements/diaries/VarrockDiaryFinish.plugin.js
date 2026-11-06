/**
 * The five Varrock Diary tasks whose normal gameplay was still absent: the Apothecary's
 * strength-potion service, Gertrude's colour choice for a kitten, picking a white tree fruit,
 * the Fancy Dress Seller's spottier cape, and the Varrock Palace yew roots.
 *
 * The catalogue and progress dispatch live in AchievementDiaries. The ordinary actions live
 * in their own NPC, quest and skill plugins (Apothecary, Gertrude, Asyff, Garden of
 * Tranquillity, Farming); this file only names these five tasks and listens for their success
 * events. OSRS Wiki: Varrock Diary.
 */
const DIARY = "varrock";

const TASK = {
  apothecary: "have-the-apothecary-in-varrock-make-you-a-streng",
  kittenColour: "select-a-colour-for-your-kitten",
  whiteTreeFruit: "pick-a-white-tree-fruit",
  spottierCape: "trade-furs-with-the-fancy-dress-seller-for-a-spo",
  yewRoots: "collect-at-least-2-yew-roots-from-the-tree-patch",
};

/** Varrock Palace yew tree patch (plugins/skills/data/farming-data.json patch 8390). */
const YEW_ROOTS = 6049;
const VARROCK_TREE_PATCH = { id: 8390, x: 3228, y: 3458, z: 0 };

/** The task is "trade ... for a spottier cape and equip it": Asyff's trade, then the cape worn. */
const SPOTTIER_CAPE = 10071;
const SPOTTIER_TRADED_ATTRIBUTE = "varrock-diary:spottier-cape-traded";

function emit(registry, player, task) {
  if (!player) return;
  registry.emitCustomEvent("diary:task", { player, diary: DIARY, task });
}

function apothecaryPotionMade(registry, event) {
  emit(registry, event?.player, TASK.apothecary);
}

function kittenColourChosen(registry, event) {
  emit(registry, event?.player, TASK.kittenColour);
}

function spottierCapeTraded(registry, event) {
  event?.player?.setAttribute(SPOTTIER_TRADED_ATTRIBUTE, true);
}

function equippedSpottierCape(registry, event) {
  const { player } = event ?? {};
  if (!player?.isRegistered?.() || player.getAttribute(SPOTTIER_TRADED_ATTRIBUTE) !== true) return;
  if (player.getEquipment().get(registry.core.Equipment.CAPE_SLOT)?.getId() !== SPOTTIER_CAPE) return;
  emit(registry, player, TASK.spottierCape);
}

function rootsCollected(registry, event) {
  if (!event?.player || event.crop !== "YEW" || event.itemId !== YEW_ROOTS) return;
  const patch = event.patch;
  if (!patch || patch.id !== VARROCK_TREE_PATCH.id || patch.x !== VARROCK_TREE_PATCH.x
    || patch.y !== VARROCK_TREE_PATCH.y || patch.z !== VARROCK_TREE_PATCH.z) return;
  if ((Number(event.amount) || 0) < 2) return;
  emit(registry, event.player, TASK.yewRoots);
}

function whiteTreeFruitPicked(registry, event) {
  if (!event?.player) return;
  emit(registry, event.player, TASK.whiteTreeFruit);
}

module.exports = {
  name: "VarrockDiaryFinish",
  members: true,
  dependsOn: ["AchievementDiaries"],
  register(registry) {
    registry.persistAttribute(SPOTTIER_TRADED_ATTRIBUTE, false);
    registry.onCustomEvent("apothecary:strength-potion-made", apothecaryPotionMade.bind(null, registry));
    registry.onCustomEvent("gertrude:kitten-colour-chosen", kittenColourChosen.bind(null, registry));
    registry.onCustomEvent("asyff:spottier-cape-traded", spottierCapeTraded.bind(null, registry));
    registry.onCustomEvent("equipment:changed", equippedSpottierCape.bind(null, registry));
    registry.onCustomEvent("farming:roots", rootsCollected.bind(null, registry));
    registry.onCustomEvent("garden-of-tranquillity:white-tree-fruit", whiteTreeFruitPicked.bind(null, registry));
  },
  _test: {
    TASK, YEW_ROOTS, VARROCK_TREE_PATCH, SPOTTIER_CAPE, SPOTTIER_TRADED_ATTRIBUTE,
    apothecaryPotionMade, kittenColourChosen, spottierCapeTraded, equippedSpottierCape, rootsCollected,
    whiteTreeFruitPicked,
  },
};
