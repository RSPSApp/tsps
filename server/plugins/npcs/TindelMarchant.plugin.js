const NPC_ID = 1358;
const FEE = 100;
const MAX_STACK_AMOUNT = 0x7fffffff;
const DIARY_TASK = "have-tindel-marchant-identify-a-rusted-sword-for";
const WEAPON_OUTCOMES = {
  sword: [
    [20, 1279], [37, 1293], [17, 1277], [7, 1291], [6, 1281],
    [4, 1295], [1, 1285], [1, 1299], [3, 1283], [2, 1297],
  ],
  scimitar: [
    [24, 1321], [57, 1323], [10, 1325], [5, 1327], [2, 1329],
  ],
};
const INPUTS = new Map([[686, "sword"], [6721, "scimitar"]]);
const COINS = 995;
const DIALOGUE_PAGE = "Tindel Marchant";
const BOTH_MENU_INTERFACE_ID = 219;
const STANDARD_ACTIONS = new Map([["Yaf6pt", 686], ["S0wGie", 6721]]);
const STANDARD_CONDITIONS = new Map([
  ["KHTz9R", "no-rusty-weapons"],
  ["TtonTv", "insufficient-coins"],
  ["GjeAqP", "both-weapons"],
  ["uNIJeT", "rusty-sword"],
  ["VfWqwb", "rusty-scimitar"],
]);
const BOTH_MENU_CONDITION = "GjeAqP";
const ITEM_RESULT_CONDITIONS = new Map([
  [1277, "t2ALiu"], [1291, "XTxAae"], [1279, "rzO8OF"], [1293, "lPav9s"],
  [1281, "B8ehz0"], [1295, "6rYzMa"], [1283, "gDZE-w"], [1297, "M187jP"],
  [1285, "y0K81W"], [1299, "JX-xY_"], [1321, "4DiFbe"], [1323, "6IKZs2"],
  [1325, "gvdiwd"], [1327, "Liuvlc"], [1329, "rw4Tfe"],
]);
let dialogueData;
const pendingBothMenus = new WeakMap();
const handledChoices = new WeakSet();
const deferredOutcomes = new Map();

function chooseOutcome(kind, roll) {
  const outcomes = WEAPON_OUTCOMES[kind];
  if (!outcomes || !Number.isInteger(roll) || roll < 0 || roll >= 100) return null;
  let boundary = 0;
  for (const [weight, itemId] of outcomes) {
    boundary += weight;
    if (roll < boundary) return { type: "item", itemId };
  }
  // The last two results on each table are coins and nothing.
  return roll < 99 ? { type: "coins" } : { type: "nothing" };
}

function rollOutcome(kind, random = Math.random) {
  const roll = Math.floor(random() * 100);
  const outcome = chooseOutcome(kind, roll);
  if (outcome?.type === "coins") {
    return { ...outcome, amount: 1500 + Math.floor(random() * 500) };
  }
  return outcome;
}

function canAddAfterPayment(inventory, outcome) {
  if (outcome.type === "nothing") return true;
  const heldCoins = inventory.getAmount(COINS);
  const freeSlots = inventory.getFreeSlots();
  const inputSlot = 1;
  const paymentSlot = heldCoins === FEE ? 1 : 0;
  if (outcome.type === "item") return freeSlots + inputSlot >= 1;
  const currentAfterPayment = heldCoins - FEE;
  if (currentAfterPayment > 0) return currentAfterPayment + outcome.amount <= MAX_STACK_AMOUNT;
  return freeSlots + inputSlot + paymentSlot >= 1 && outcome.amount <= MAX_STACK_AMOUNT;
}

function identify(player, itemId, random = Math.random) {
  const kind = INPUTS.get(itemId);
  if (!kind) return { ok: false, reason: "unsupported-item" };
  const inventory = player.getInventory();
  if (inventory.getAmount(itemId) < 1 || inventory.getAmount(COINS) < FEE) {
    return { ok: false, reason: "missing-resources" };
  }

  const outcome = rollOutcome(kind, random);
  if (!outcome || !canAddAfterPayment(inventory, outcome)) {
    return { ok: false, reason: "no-room" };
  }

  inventory.deleteNumber(itemId, 1);
  inventory.deleteNumber(COINS, FEE);
  if (outcome.type === "item") {
    const before = inventory.getAmount(outcome.itemId);
    inventory.adds(outcome.itemId, 1);
    if (inventory.getAmount(outcome.itemId) !== before + 1) {
      inventory.adds(itemId, 1);
      inventory.adds(COINS, FEE);
      return { ok: false, reason: "no-room" };
    }
  }
  if (outcome.type === "coins") {
    const before = inventory.getAmount(COINS);
    inventory.adds(COINS, outcome.amount);
    const added = inventory.getAmount(COINS) - before;
    if (added !== outcome.amount) {
      if (added > 0) inventory.deleteNumber(COINS, added);
      inventory.adds(itemId, 1);
      inventory.adds(COINS, FEE);
      return { ok: false, reason: "no-room" };
    }
  }

  if (outcome.type === "item" && kind === "sword") {
    return { ok: true, outcome, diaryCredit: true };
  }
  return { ok: true, outcome, diaryCredit: false };
}

function isTindelDialogue(event) {
  return event.npcId === NPC_ID && event.pages?.some(({ page }) => page === DIALOGUE_PAGE);
}

function dialogueRecord() {
  if (!dialogueData) dialogueData = require("../../data/definitions/npc-dialogues.json")["Tindel Marchant"];
  return dialogueData;
}

function outcomeSteps(kind, outcome) {
  const variant = kind === "sword"
    ? "using-items-on-tindel-marchant-using-a-rusty-sword-on-tindel-marchant"
    : "using-items-on-tindel-marchant-using-a-rusty-scimitar-on-tindel-marchant";
  const steps = dialogueRecord().variants[variant];
  if (outcome.type === "item") {
    const conditionId = ITEM_RESULT_CONDITIONS.get(outcome.itemId);
    return steps.find((step) => step.type === "condition" && step.id === conditionId)?.steps;
  }
  if (outcome.type === "nothing") {
    const conditionId = kind === "sword" ? "g4tLv_" : "N9ns6n";
    return steps.find((step) => step.type === "condition" && step.id === conditionId)?.steps;
  }
  if (outcome.type === "coins") {
    const message = steps.find((step) => step.type === "condition" && step.text === "If the result is a rare antique:")
      ?.steps?.find((step) => step.type === "message" && step.text.includes("[number] coins."));
    return message ? [{ ...message, text: message.text.replace("[number]", String(outcome.amount)) }] : undefined;
  }
  return undefined;
}

function dialogueCondition(event) {
  if (event.player && event.stepId !== BOTH_MENU_CONDITION) pendingBothMenus.delete(event.player);
  if (!isTindelDialogue(event)) return null;
  const condition = STANDARD_CONDITIONS.get(event.stepId);
  const inventory = event.player.getInventory();
  if (condition === "no-rusty-weapons") {
    return inventory.getAmount(686) === 0 && inventory.getAmount(6721) === 0;
  }
  if (condition === "insufficient-coins") return inventory.getAmount(COINS) < FEE;
  if (condition === "both-weapons") return inventory.getAmount(686) > 0 && inventory.getAmount(6721) > 0;
  if (condition === "rusty-sword") return inventory.getAmount(686) > 0;
  if (condition === "rusty-scimitar") return inventory.getAmount(6721) > 0;

  return null;
}

function dialogueConditionChosen(event) {
  if (!event.player) return;
  if (event.npcId === NPC_ID && event.stepId === BOTH_MENU_CONDITION
    && event.text === "If the player has both a rusty sword and rusty scimitar:") {
    pendingBothMenus.set(event.player, {});
    return;
  }
  clearPlayerState(event.player);
}

function dialogueChoice(api, event) {
  if (!event.player || handledChoices.has(event)) return;
  const playerIndex = event.player.getIndex();
  deferredOutcomes.get(playerIndex)?.task.stop();
  const belongsToBothMenu = pendingBothMenus.has(event.player);
  pendingBothMenus.delete(event.player);
  deferredOutcomes.delete(playerIndex);
  if (event.npcId !== NPC_ID || !belongsToBothMenu) return;
  const itemId = event.option === "The sword" ? 686 : event.option === "The scimitar" ? 6721 : undefined;
  if (itemId === undefined) return;
  handledChoices.add(event);

  const inventory = event.player.getInventory();
  if (inventory.getAmount(686) < 1 || inventory.getAmount(6721) < 1 || inventory.getAmount(COINS) < FEE) return;
  const result = identify(event.player, itemId);
  if (!result.ok) return;

  const kind = INPUTS.get(itemId);
  const npcEvent = { player: event.player, npc: event.npc, npcId: NPC_ID };
  const token = {};
  const state = { token };
  const task = new (class extends api.core.CountdownTask {
    constructor() {
      super(playerIndex, 1, () => {
        if (deferredOutcomes.get(playerIndex)?.token !== token) return;
        deferredOutcomes.delete(playerIndex);
        if (!event.player.isRegistered?.() || event.player.getHitpoints?.() <= 0) return;
        showOutcome(api, npcEvent, kind, result.outcome);
      });
    }

    stop() {
      super.stop();
      if (deferredOutcomes.get(playerIndex)?.token === token) deferredOutcomes.delete(playerIndex);
    }
  })();
  state.task = task;
  deferredOutcomes.set(playerIndex, state);
  api.core.TaskManager.submit(task);
  awardDiaryCredit(api, event.player, NPC_ID, result, event.npc);
}

function dialogueAction(api, event) {
  const itemId = STANDARD_ACTIONS.get(event.stepId);
  if (itemId === undefined || !isTindelDialogue(event)) return;
  if (handledEvents.has(event)) return;
  handledEvents.add(event);
  const inventory = event.player.getInventory();
  // The choice hook handles the both-item menu before its label-based jump.
  // Ignore any later action for that menu to prevent a second charge.
  if (inventory.getAmount(686) > 0 && inventory.getAmount(6721) > 0) return;
  const result = identify(event.player, itemId);
  if (!result.ok) return;
  const kind = INPUTS.get(itemId);
  const steps = outcomeSteps(kind, result.outcome);
  if (!steps) return;
  event.handled = true;
  event.steps = steps;
  awardDiaryCredit(api, event.player, event.npcId, result, event.npc);
}

function showOutcome(api, event, kind, outcome) {
  const variant = kind === "sword"
    ? "using-items-on-tindel-marchant-using-a-rusty-sword-on-tindel-marchant"
    : "using-items-on-tindel-marchant-using-a-rusty-scimitar-on-tindel-marchant";
  api.emitCustomEvent("npc-dialogue:start", {
    player: event.player,
    npc: event.npc ?? event.target,
    npcId: event.npcId ?? event.target?.getId?.(),
    variant: { page: "Tindel Marchant", variant },
    exact: true,
    select: () => outcomeSteps(kind, outcome),
    handled: false,
  });
}

function clearPlayerState(player) {
  if (!player) return;
  pendingBothMenus.delete(player);
  const playerIndex = player.getIndex();
  deferredOutcomes.get(playerIndex)?.task.stop();
  deferredOutcomes.delete(playerIndex);
}

function clearStateOnInterfaceClose({ player, interfaceId }) {
  if (!player || interfaceId !== BOTH_MENU_INTERFACE_ID) return;
  const token = pendingBothMenus.get(player);
  if (token) queueMicrotask(() => {
    if (pendingBothMenus.get(player) === token) pendingBothMenus.delete(player);
  });
}

function clearStateOnLogout({ player }) {
  clearPlayerState(player);
}

function clearStateOnDeath({ player }) {
  clearPlayerState(player);
}

function clearStateOnTalkTo(event) {
  if (event.npcId === NPC_ID) clearPlayerState(event.player);
  return false;
}

function clearStateOnDialogueStart(event) {
  clearPlayerState(event.player);
}

function handleItemOnNpc(api, event) {
  const npcId = event.npcId ?? event.target?.getId?.();
  if (npcId !== NPC_ID || !INPUTS.has(event.itemId)) return;
  if (handledEvents.has(event)) return;
  handledEvents.add(event);
  event.handled = true;
  const result = identify(event.player, event.itemId);
  if (!result.ok) return;
  showOutcome(api, event, INPUTS.get(event.itemId), result.outcome);
  awardDiaryCredit(api, event.player, npcId, result, event.npc ?? event.target);
}

function awardDiaryCredit(api, player, npcId, result, npc) {
  if (!result.diaryCredit) return;
  if (typeof player.getPrivateArea !== "function" || typeof npc?.getPrivateArea !== "function") return;
  if (player.getPrivateArea() !== null || npc.getPrivateArea() !== null) return;
  api.emitCustomEvent("diary:task", { player, npcId, diary: "ardougne", task: DIARY_TASK });
}

function giveSword(api, event) {
  const npcId = event.npcId ?? event.npc?.getId?.();
  if (npcId !== NPC_ID) return false;
  if (handledEvents.has(event)) return false;
  handledEvents.add(event);
  const result = identify(event.player, 686);
  if (!result.ok) return false;
  showOutcome(api, event, "sword", result.outcome);
  awardDiaryCredit(api, event.player, npcId, result, event.npc);
  return true;
}

const handledEvents = new WeakSet();

module.exports = {
  name: "TindelMarchant",
  members: true,
  register(api) {
    api.onItemOnNpc(handleItemOnNpc.bind(null, api));
    api.onNpcInteraction("Tindel Marchant", {
      "Give-Sword": giveSword.bind(null, api),
      "Talk-to": clearStateOnTalkTo,
    });
    api.onNpcDialogueCondition(dialogueCondition);
    api.onCustomEvent("npc-dialogue:action", dialogueAction.bind(null, api));
    api.onCustomEvent("npc-dialogue:condition", dialogueConditionChosen);
    api.onCustomEvent("npc-dialogue:choice", dialogueChoice.bind(null, api));
    api.onCustomEvent("npc-dialogue:start", clearStateOnDialogueStart);
    api.onCustomEvent("interface:close", clearStateOnInterfaceClose);
    api.onCustomEvent("interface:closed", clearStateOnInterfaceClose);
    api.onPlayerLogout(clearStateOnLogout);
    api.onPlayerDeath(clearStateOnDeath);
  },
  _test: { chooseOutcome, rollOutcome, canAddAfterPayment, identify, handleItemOnNpc, giveSword, dialogueCondition, dialogueAction, outcomeSteps },
};
