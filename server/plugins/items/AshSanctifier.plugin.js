/**
 * Ash sanctifier (https://oldschool.runescape.wiki/w/Ash_sanctifier), the hard Kourend & Kebos
 * diary's reward from Tyss at the Dark Altar (plugins/npcs/Tyss.plugin.js). Death runes charge it,
 * 10 charges each. Carried in the inventory with charges and active, it scatters the demonic ashes
 * a demonic creature other than Skotizo drops, one charge each, for half their scattering
 * experience (all of it with the elite Kourend & Kebos diary). Uncharge and Destroy give back the
 * death runes; in the bank, Configure-Charges sets the charges from the banked death runes.
 *
 * Ours: the Wiki quotes none of its messages or prompts, so they follow the bonecrusher's.
 * Not modelled: its death rules (always kept on a PvM death).
 */
const CHARGES_ATTRIBUTE = "ash-sanctifier:charges";
const INACTIVE_ATTRIBUTE = "ash-sanctifier:inactive";

const CHARGES_PER_RUNE = 10;
const MAX_CHARGES = 2147483647;
const CONFIGURE_CHARGES_OP = 9; // bankmain item op, cache param 2257
const HALF_EXPERIENCE = 0.5;
const DEMON_ATTRIBUTE = "demon";
const SKOTIZO = "Skotizo";

const DIARY = "kourend";
const NOT_HARD_STEP = "5fxbwj";
const FULL_INVENTORY_STEP = "-Gwngq";
const NO_SANCTIFIER_STEP = "Qq8FOu";
const HAS_SANCTIFIER_STEP = "JJzaV6";
const HAND_OVER_LINE = "Thanks for your efforts throughout the tasks set. Here, you may have this.";
const TYSS_NPC_ID = 7050;

let api = null;
let core = null;

const charges = (player) => Number(player.getAttribute(CHARGES_ATTRIBUTE)) || 0;
const active = (player) => !player.getAttribute(INACTIVE_ATTRIBUTE);
const format = (count) => count.toLocaleString("en-GB");
const sanctifierId = () => core.ItemIdentifiers.ASH_SANCTIFIER;
const deathRuneId = () => core.ItemIdentifiers.DEATH_RUNE;

function setCharges(player, count) {
  player.setAttribute(CHARGES_ATTRIBUTE, count);
}

function diaryComplete(player, tier) {
  const request = { player, diary: DIARY, tier, complete: false };
  api.emitCustomEvent("diary:is-complete", request);
  return request.complete === true;
}

function status(player) {
  const count = charges(player);
  if (count <= 0) return "The ash sanctifier has no charges. It can be charged with death runes.";
  return active(player)
    ? `The ash sanctifier has ${format(count)} charges. It is active and ready to scatter ashes.`
    : `The ash sanctifier has ${format(count)} charges. It has been deactivated, and will not scatter ashes now.`;
}

function check({ player }) {
  player.sendMessage(status(player));
}

function toggleActivity({ player }) {
  const activating = !active(player);
  player.setAttribute(INACTIVE_ATTRIBUTE, activating ? 0 : 1);
  player.sendMessage(activating
    ? "The ash sanctifier is active and ready to scatter ashes."
    : "The ash sanctifier has been deactivated, and will not scatter ashes now.");
}

/** Uncharge: the unused death runes come back; charges short of a whole rune stay. */
function uncharge({ player }) {
  const runes = Math.floor(charges(player) / CHARGES_PER_RUNE);
  const inventory = player.getInventory();
  if (runes > 0 && inventory.getAddableAmount(new core.Item(deathRuneId(), runes)) >= runes) {
    inventory.adds(deathRuneId(), runes);
    setCharges(player, charges(player) - runes * CHARGES_PER_RUNE);
  }
  player.sendMessage(status(player));
}

function addRunes(player, wanted) {
  const inventory = player.getInventory();
  if (!inventory.contains(sanctifierId()) || !Number.isInteger(wanted) || wanted <= 0) return;
  const room = Math.ceil((MAX_CHARGES - charges(player)) / CHARGES_PER_RUNE);
  const runes = Math.min(wanted, inventory.getAmount(deathRuneId()), room);
  if (runes <= 0) return;
  inventory.deleteNumber(deathRuneId(), runes);
  setCharges(player, Math.min(MAX_CHARGES, charges(player) + runes * CHARGES_PER_RUNE));
  player.sendMessage(status(player));
}

/** Death runes used on it: asks how many to add. */
function charge({ player }) {
  const most = Math.min(player.getInventory().getAmount(deathRuneId()),
    Math.ceil((MAX_CHARGES - charges(player)) / CHARGES_PER_RUNE));
  if (most <= 0) return;
  player.setEnteredAmountAction({ execute: (amount) => addRunes(player, amount) });
  player.getPacketSender().sendEnterAmountPrompt(`How many death runes do you want to add? (1 - ${format(most)})`);
}

function destroyed({ player, itemId }) {
  if (itemId !== sanctifierId()) return;
  const runes = Math.floor(charges(player) / CHARGES_PER_RUNE);
  setCharges(player, 0);
  if (runes > 0) core.ItemOnGroundManager.registers(player, new core.Item(deathRuneId(), runes));
}

// ------------------------------------------------------------------ bank

const bankRunes = (player) => player.getBank(core.Bank.getTabForItem(player, deathRuneId())).getAmount(deathRuneId());

function refreshBank(player) {
  const { Bank } = core;
  if (!Bank.isOpen(player)) return;
  const tab = player.isSearchingBank() ? Bank.BANK_SEARCH_TAB_INDEX : player.getCurrentBankTab();
  player.getBank(tab).refreshItems();
}

/**
 * Moves the charges towards `wanted`, a death rune per 10 charges from or back to the bank. As
 * with Uncharge, charges short of a whole rune stay; the status line shows where it ended.
 */
function configureCharges(player, wanted) {
  const current = charges(player);
  const target = Math.min(Math.floor(Number(wanted)), MAX_CHARGES);
  if (!(target >= 0) || target === current) return;
  const bank = player.getBank(core.Bank.getTabForItem(player, deathRuneId()));
  if (target > current) {
    const runes = Math.min(Math.ceil((target - current) / CHARGES_PER_RUNE), bankRunes(player));
    if (runes > 0) {
      bank.delete(deathRuneId(), runes);
      setCharges(player, Math.min(MAX_CHARGES, current + runes * CHARGES_PER_RUNE));
    }
  } else {
    const runes = Math.floor((current - target) / CHARGES_PER_RUNE);
    const refund = new core.Item(deathRuneId(), runes);
    if (runes > 0 && bank.getAddableAmount(refund) < runes) {
      bank.full();
      return;
    }
    if (runes > 0) {
      bank.add(refund, false);
      setCharges(player, current - runes * CHARGES_PER_RUNE);
    }
  }
  refreshBank(player);
  player.sendMessage(status(player));
}

function bankItemOp(event) {
  const { player, item } = event;
  if (event.op !== CONFIGURE_CHARGES_OP || item?.getId?.() !== sanctifierId()) return;
  event.handled = true;
  const most = Math.min(MAX_CHARGES, charges(player) + bankRunes(player) * CHARGES_PER_RUNE);
  player.setEnteredAmountAction({
    acceptsZero: true,
    execute(amount) {
      const { Bank } = core;
      if (!Bank.isOpen(player) || item.getId() !== sanctifierId() || item.getAmount() <= 0) return;
      const stillBanked = player.getBanks().some((bank, tab) =>
        tab !== Bank.BANK_SEARCH_TAB_INDEX && bank?.getItems().includes(item));
      if (stillBanked) configureCharges(player, amount);
    },
  });
  player.getPacketSender().sendEnterAmountPrompt(`How many charges do you want your ash sanctifier to have? (0 - ${format(most)})`);
}

// ------------------------------------------------------------------ scattering

/** "npc-drops:generated": a demon's ashes are scattered before the loot lands. */
function scatterDrops({ player, npc, drops }) {
  if (!player || !Array.isArray(drops) || charges(player) <= 0 || !active(player)) return;
  const definition = npc?.getCurrentDefinition?.();
  if (definition?.hasAttribute?.(DEMON_ATTRIBUTE) !== true || definition.getName?.() === SKOTIZO) return;
  if (!player.getInventory().contains(sanctifierId())) return;
  let scale = null;
  for (const drop of drops) {
    if (drop.noted) continue;
    while (drop.amount > 0 && charges(player) > 0) {
      scale ??= diaryComplete(player, "elite") ? 1 : HALF_EXPERIENCE;
      const request = { player, itemId: drop.itemId, scale, ashes: true, handled: false };
      api.emitCustomEvent("prayer:bury", request);
      if (!request.handled) break;
      setCharges(player, charges(player) - 1);
      drop.amount--;
    }
  }
  for (let i = drops.length - 1; i >= 0; i--) if (drops[i].amount <= 0) drops.splice(i, 1);
}

// ------------------------------------------------------------------ Tyss

const isTyss = (event) => event?.npcId === TYSS_NPC_ID;

function ownsSanctifier(player) {
  const id = sanctifierId();
  return player.getInventory().contains(id) ||
    player.getBanks?.()?.some((bank) => bank && bank.getAmount(id) > 0) === true;
}

function claimCondition(event) {
  if (!isTyss(event)) return null;
  const { player } = event;
  switch (event.stepId) {
    case NOT_HARD_STEP: return !diaryComplete(player, "hard");
    case FULL_INVENTORY_STEP: return !ownsSanctifier(player) && player.getInventory().getFreeSlots() <= 0;
    case NO_SANCTIFIER_STEP: return !ownsSanctifier(player);
    case HAS_SANCTIFIER_STEP: return ownsSanctifier(player);
    default: return null;
  }
}

function handOver(request) {
  if (!isTyss(request) || request.text !== HAND_OVER_LINE) return;
  const { player } = request;
  request.before = () => {
    if (!ownsSanctifier(player) && player.getInventory().getFreeSlots() > 0) player.getInventory().adds(sanctifierId(), 1);
  };
}

module.exports = {
  name: "AshSanctifier",
  description: "Ash sanctifier: Tyss gives it after the hard Kourend & Kebos diary; charged with death runes, it scatters the ashes demons drop for Prayer XP.",
  members: true,
  register(pluginApi) {
    api = pluginApi;
    core = pluginApi.core;
    api.persistAttribute(CHARGES_ATTRIBUTE, 0);
    api.persistAttribute(INACTIVE_ATTRIBUTE, 0);
    api.onItemAction("Ash sanctifier", { Check: check, Activity: toggleActivity, Uncharge: uncharge });
    api.onItemOnItem("Death rune", "Ash sanctifier", charge);
    api.onCustomEvent("destroy-item:destroyed", destroyed);
    api.onCustomEvent(core.Bank.ITEM_OP_EVENT, bankItemOp);
    api.onCustomEvent("npc-drops:generated", scatterDrops);
    api.onNpcDialogueCondition(claimCondition);
    api.onCustomEvent("npc-dialogue:line", handOver);
  },
  _test: { CHARGES_ATTRIBUTE, INACTIVE_ATTRIBUTE, NOT_HARD_STEP, FULL_INVENTORY_STEP, NO_SANCTIFIER_STEP, HAS_SANCTIFIER_STEP, HAND_OVER_LINE },
};
