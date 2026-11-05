/**
 * Angler's outfit (OSRS Wiki): hat 0.4%, top 0.8%, waders 0.6%, boots 0.2%, plus 0.5% for all
 * four, so 2.5% more Fishing XP. Spirit angler pieces count the same. Kylie Minnow also asks to
 * see the full set before she lets a player onto her platform.
 *
 * Gita Prymes upgrades an angler piece to its spirit version for 1,200 spirit flakes the first
 * time (https://oldschool.runescape.wiki/w/Angler%27s_outfit#Spirit_angler); once paid, that piece
 * converts both ways for free. The spoken lines and the "Nay, Gita Prymes won't take that."
 * refusal come from Transcript:Gita_Prymes.
 */
const GITA_NPC_ID = 10613;
const SPIRIT_FLAKES_PER_PIECE = 1200;
const PAID_ATTRIBUTE = "fishing:angler-spirit-paid";
const WRONG_ITEM_VARIANT = "if-given-anything-that-isn-t-an-angler-s-outfit-piece";
const CONDITIONS = Object.freeze({
  NO_ANGLER: "CZCdRy",
  FIRST_UPGRADE: "ggPR5n",
  ALREADY_UPGRADED: "Kfgwfn",
  NO_SPIRIT: "rJlxih",
  HAS_SPIRIT: "fkkvI0",
});

let ids = null;
let Equipment = null;
let pieces = [];
let exchangePieces = [];
let api = null;
let core = null;
let gitaNpcId = GITA_NPC_ID;
const pendingBranch = new WeakMap();
const pendingMessage = new WeakMap();

const SET_BONUS = 0.005;

function wornPieces(player) {
  const equipment = player.getEquipment().getItems();
  return pieces.filter((piece) => piece.ids.includes(equipment[Equipment[piece.slot]]?.getId()));
}

function wearsFullOutfit(player) {
  return wornPieces(player).length === pieces.length;
}

function xpMultiplier(player) {
  const worn = wornPieces(player);
  const bonus = worn.reduce((sum, piece) => sum + piece.bonus, 0);
  return 1 + bonus + (worn.length === pieces.length ? SET_BONUS : 0);
}

function itemName(itemId) {
  return core.ItemDefinition.forId(itemId)?.getName?.() ?? "outfit piece";
}

function paid(player) {
  return { ...(player.getAttribute(PAID_ATTRIBUTE) ?? {}) };
}

function isPaid(player, piece) {
  return paid(player)[piece.key] === true;
}

function markPaid(player, piece) {
  const all = paid(player);
  all[piece.key] = true;
  player.setAttribute(PAID_ATTRIBUTE, all);
}

function firstCarried(player, wantSpirit, { unpaidOnly = false } = {}) {
  return exchangePieces.find((piece) => {
    const id = wantSpirit ? piece.spirit : piece.angler;
    return player.getInventory().getAmount(id) > 0 && (!unpaidOnly || !isPaid(player, piece));
  });
}

/** Move one piece between the angler and spirit variants; false when the flakes are short. */
function exchange(player, piece, toSpirit, { announce = true } = {}) {
  const inventory = player.getInventory();
  const from = toSpirit ? piece.angler : piece.spirit;
  const to = toSpirit ? piece.spirit : piece.angler;
  if (inventory.getAmount(from) <= 0) return false;
  const alreadyPaid = isPaid(player, piece);
  if (toSpirit && !alreadyPaid && inventory.getAmount(ids.SPIRIT_FLAKES) < SPIRIT_FLAKES_PER_PIECE) {
    player.sendMessage(`Gita Prymes wants 1,200 spirit flakes to upgrade your ${itemName(from)}. Spirit Angler kit gives the same Fishing XP bonus as the regular Angler kit. If you change it back later, you will not get your spirit flakes back.`);
    return false;
  }
  if (toSpirit && !alreadyPaid) {
    inventory.deleteNumber(ids.SPIRIT_FLAKES, SPIRIT_FLAKES_PER_PIECE);
    markPaid(player, piece);
  }
  inventory.deleteNumber(from, 1);
  inventory.adds(to, 1);
  inventory.refreshItems();
  if (toSpirit) {
    if (announce) player.sendMessage(`Gita Prymes exchanges your ${itemName(from)} for Spirit Angler kit.`);
    api.emitCustomEvent("collection-log:obtain", { player, itemId: to, amount: 1 });
  } else if (announce) {
    player.sendMessage(`Gita Prymes exchanges your ${itemName(from)} for regular Angler kit.`);
  }
  return true;
}

function answerGitaCondition({ npcId, player, stepId }) {
  if (npcId !== gitaNpcId) return null;
  const angler = exchangePieces.filter((piece) => player.getInventory().getAmount(piece.angler) > 0);
  const spirit = exchangePieces.filter((piece) => player.getInventory().getAmount(piece.spirit) > 0);
  switch (stepId) {
    case CONDITIONS.NO_ANGLER: return angler.length === 0;
    case CONDITIONS.FIRST_UPGRADE: return angler.some((piece) => !isPaid(player, piece));
    case CONDITIONS.ALREADY_UPGRADED: return angler.length > 0 && angler.every((piece) => isPaid(player, piece));
    case CONDITIONS.NO_SPIRIT: return spirit.length === 0;
    case CONDITIONS.HAS_SPIRIT: return spirit.length > 0;
    default: return null;
  }
}

function onConditionChosen({ npcId, player, stepId }) {
  if (npcId !== gitaNpcId) return;
  if (stepId === CONDITIONS.FIRST_UPGRADE || stepId === CONDITIONS.ALREADY_UPGRADED || stepId === CONDITIONS.HAS_SPIRIT) {
    pendingBranch.set(player, stepId);
  } else {
    pendingBranch.delete(player);
  }
}

function onDialogueChoice(event) {
  const { npcId, player, option } = event;
  if (npcId !== gitaNpcId || option !== "Proceed") return;
  const branch = pendingBranch.get(player);
  pendingBranch.delete(player);
  if (!branch) return;
  const piece = branch === CONDITIONS.HAS_SPIRIT
    ? firstCarried(player, true)
    : firstCarried(player, false, { unpaidOnly: branch === CONDITIONS.FIRST_UPGRADE });
  if (!piece) return;
  const exchanged = exchange(player, piece, branch !== CONDITIONS.HAS_SPIRIT, { announce: false });
  if (!exchanged) {
    event.end = true;
    return;
  }
  pendingMessage.set(player, piece);
}

function onDialogueAction(event) {
  if (event.npcId !== gitaNpcId || event.kind !== "message") return;
  if (typeof event.step?.text !== "string" || !event.step.text.includes("[outfit piece]")) return;
  // The exchange message uses the piece just converted; the first-time and
  // already-paid warnings name the piece that Proceed will convert.
  const piece = pendingMessage.get(event.player)
    ?? firstCarried(event.player, false, { unpaidOnly: true })
    ?? firstCarried(event.player, false);
  if (!piece) return;
  if (pendingMessage.has(event.player)) pendingMessage.delete(event.player);
  // Transcript message leaves are shared between conversations. Keep the
  // template intact so the next player sees their own outfit piece.
  event.player.sendMessage(event.step.text.replace("[outfit piece]", itemName(piece.angler)));
  event.handled = true;
}

function onItemOnNpc(event) {
  const npcId = event.npcId ?? event.target?.getId?.();
  if (npcId !== gitaNpcId) return;
  const piece = exchangePieces.find((entry) => entry.angler === event.itemId || entry.spirit === event.itemId);
  if (!piece) {
    event.handled = true;
    api.emitCustomEvent("npc-dialogue:start", {
      player: event.player,
      npc: event.npc ?? event.target,
      npcId,
      variant: WRONG_ITEM_VARIANT,
      exact: true,
      handled: false,
    });
    return;
  }
  event.handled = true;
  exchange(event.player, piece, event.itemId === piece.angler);
}

function clearPending({ player } = {}) {
  if (!player) return;
  pendingBranch.delete(player);
  pendingMessage.delete(player);
}

function attach(pluginApi) {
  api = pluginApi;
  core = pluginApi.core;
  ids = core.ItemIdentifiers;
  Equipment = core.Equipment;
  gitaNpcId = core.NpcIdentifiers?.GITA_PRYMES ?? GITA_NPC_ID;
  pieces = [
    { slot: "HEAD_SLOT", ids: [ids.ANGLER_HAT, ids.SPIRIT_ANGLER_HEADBAND], bonus: 0.004 },
    { slot: "BODY_SLOT", ids: [ids.ANGLER_TOP, ids.SPIRIT_ANGLER_TOP], bonus: 0.008 },
    { slot: "LEG_SLOT", ids: [ids.ANGLER_WADERS, ids.SPIRIT_ANGLER_WADERS], bonus: 0.006 },
    { slot: "FEET_SLOT", ids: [ids.ANGLER_BOOTS, ids.SPIRIT_ANGLER_BOOTS], bonus: 0.002 },
  ];
  exchangePieces = [
    { key: "hat", angler: ids.ANGLER_HAT, spirit: ids.SPIRIT_ANGLER_HEADBAND },
    { key: "top", angler: ids.ANGLER_TOP, spirit: ids.SPIRIT_ANGLER_TOP },
    { key: "waders", angler: ids.ANGLER_WADERS, spirit: ids.SPIRIT_ANGLER_WADERS },
    { key: "boots", angler: ids.ANGLER_BOOTS, spirit: ids.SPIRIT_ANGLER_BOOTS },
  ];
  pluginApi.persistAttribute(PAID_ATTRIBUTE, {});
  pluginApi.onItemOnNpc(onItemOnNpc);
  pluginApi.onNpcDialogueCondition(answerGitaCondition);
  pluginApi.onCustomEvent("npc-dialogue:condition", onConditionChosen);
  pluginApi.onCustomEvent("npc-dialogue:choice", onDialogueChoice);
  pluginApi.onCustomEvent("npc-dialogue:action", onDialogueAction);
  pluginApi.onCustomEvent("npc-dialogue:start", clearPending);
}

module.exports = {
  attach, wearsFullOutfit, xpMultiplier,
  _test: { answerGitaCondition, onConditionChosen, onDialogueChoice, onDialogueAction, onItemOnNpc, exchange, CONDITIONS, PAID_ATTRIBUTE },
};
