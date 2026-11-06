/**
 * Asyff's Custom Fur Clothing in south-east Varrock
 * (https://oldschool.runescape.wiki/w/Asyff).
 *
 * The right-click "Fur Clothing" option and the transcript's "Custom Fur Clothing" action
 * open the made-to-order trade: two dashing kebbit furs and 800 coins at 66 Hunter make a
 * spottier cape. Only Asyff runs this service; Nia and Pellem share the transcript target
 * but keep their own trade. A successful trade emits the ordinary success event the Varrock
 * diary listens for.
 */
const ASYFF_NPC_ID = 2887;
const CUSTOM_FUR_TARGET = "Custom Fur Clothing";
const DASHING_KEBBIT_FUR = 10127;
const SPOTTIER_CAPE = 10071;
const SPOTTIER_FURS = 2;
const SPOTTIER_COST = 800;
const SPOTTIER_HUNTER_LEVEL = 66;
const SPOTTIER_CAPE_TRADED_EVENT = "asyff:spottier-cape-traded";

function tradeSpottierCape(api, player) {
  const inventory = player.getInventory();
  if (player.getSkillManager().getCurrentLevel(api.core.Skill.HUNTER) < SPOTTIER_HUNTER_LEVEL) {
    player.sendMessage(`You need ${SPOTTIER_HUNTER_LEVEL} Hunter to make a spottier cape.`);
    return false;
  }
  if (inventory.getAmount(DASHING_KEBBIT_FUR) < SPOTTIER_FURS) {
    player.sendMessage(`You need ${SPOTTIER_FURS} dashing kebbit furs.`);
    return false;
  }
  if (inventory.getAmount(api.core.ItemIdentifiers.COINS) < SPOTTIER_COST) {
    player.sendMessage(`You need ${SPOTTIER_COST} coins.`);
    return false;
  }
  inventory.deleteNumber(DASHING_KEBBIT_FUR, SPOTTIER_FURS);
  inventory.deleteNumber(api.core.ItemIdentifiers.COINS, SPOTTIER_COST);
  inventory.adds(SPOTTIER_CAPE, 1);
  player.sendMessage("Asyff makes you a spottier cape.");
  api.emitCustomEvent(SPOTTIER_CAPE_TRADED_EVENT, { player, capeId: SPOTTIER_CAPE });
  return true;
}

/** Asyff's own "Fur Clothing" option opens the same made-to-order trade. */
function onAsyffFurClothing(api, event) {
  const { player } = event ?? {};
  if (!player) return false;
  event.handled = true;
  openSpottierCapeMenu(api, player);
  return true;
}

function openSpottierCapeMenu(api, player) {
  const menu = new api.core.OptionDialogue(0, {
    executeOption(option) {
      player.getPacketSender().sendInterfaceRemoval();
      if (Number(option) === 1) tradeSpottierCape(api, player);
    },
  }, `Spottier cape (${SPOTTIER_FURS} dashing kebbit furs, ${SPOTTIER_COST} coins)`, "Cancel")
    .setTitle("Custom Fur Clothing");
  player.getDialogueManager().startDialogues(new api.core.DialogueChainBuilder().add(menu));
}

function onDialogueAction(api, event) {
  const { player } = event ?? {};
  if (!player || event.handled) return;
  if (event.npcId === ASYFF_NPC_ID && event.action === "open_interface" && event.target === CUSTOM_FUR_TARGET) {
    event.handled = true;
    openSpottierCapeMenu(api, player);
  }
}

module.exports = {
  name: "Asyff",
  members: true,
  register(api) {
    api.onNpcInteraction("Asyff", { "Fur Clothing": onAsyffFurClothing.bind(null, api) });
    api.onCustomEvent("npc-dialogue:action", onDialogueAction.bind(null, api));
  },
  _test: {
    ASYFF_NPC_ID, CUSTOM_FUR_TARGET, DASHING_KEBBIT_FUR, SPOTTIER_CAPE, SPOTTIER_FURS,
    SPOTTIER_COST, SPOTTIER_HUNTER_LEVEL, SPOTTIER_CAPE_TRADED_EVENT, tradeSpottierCape,
    onAsyffFurClothing, openSpottierCapeMenu, onDialogueAction,
  },
};
