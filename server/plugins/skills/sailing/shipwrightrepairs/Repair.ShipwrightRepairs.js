// Wiki: Seb alone repairs for50coins/missing HP, inventory first then the bank.
// Canonical dialogue supplies the menus/lines. No Repair-boat action exists in local captures.
const yard = require('../Shipyard.Sailing');
const hp = require('../seacombat/BoatHp.SeaCombat');
const QUESTION = 'Could you help me repair my boat?';
const PAGE = 'Shipwright Seb';
const BEGIN = 'sailing-seb-repair-begin';
const COMMIT = 'sailing-seb-repair-commit';
const DECLINE = 'sailing-seb-repair-decline';
const DISMISSED_ATTRIBUTE = 'sailing:repair-warning-dismissed';
const WARNING_VARBIT = 'boat_repair_cost_warning_dismissed';
const COST_PER_HP = 50;
const quotes = new WeakMap();
let api, nextSession = 0;

function core() { return api.core; }
function sebId() { return core().CacheDefinitions.getNpcId('sailing_shipyard_manager_vis'); }
function coinsId() { return core().CacheDefinitions.getObjId('coins'); }
function nearby(player, npc) {
  return player.isRegistered() && player.getHitpoints() > 0 && !player.busy()
    && npc?.isRegistered() && player.getLocation().isWithinDistance(npc.getLocation(), 5);
}
function eligible(player, npc, boat) {
  return nearby(player, npc) && boat && yard.visitedBoat(player) === boat
    && player.getSailing().boats.includes(boat) && boat.location.kind === 'docked'
    && Number.isSafeInteger(boat.damage ?? 0) && (boat.damage ?? 0) >= 0
    && (boat.damage ?? 0) < hp.maxHitpoints(boat);
}
function say(player, text) {
  player.getDialogueManager().startDialogues(new (core().DialogueChainBuilder)()
    .add(new (core().StatementDialogue)(0, text)));
}
function transcript(player, npc, select) {
  const request = { player, npc, npcId: sebId(), variant: { page: PAGE }, exact: true, select };
  api.emitCustomEvent('npc-dialogue:start', request);
  return request;
}
function repairBranch(steps) {
  for (const step of steps) {
    const option = step.options?.find(option => option.text === QUESTION);
    if (option) return structuredClone(option.steps);
  }
  throw new Error('Shipwright Seb canonical repair branch is missing');
}
function projectTalk(steps) {
  return steps.map(step => step.type === 'choice' ? { ...step,
    options: step.options.map(option => option.text === QUESTION
      ? { ...option, steps: [{ type: 'action', action: BEGIN }] } : option),
  } : step);
}
function talk(event) {
  return transcript(event.player, event.npc, projectTalk).handled === true;
}
function quoteSteps(steps, quote) {
  const branch = repairBranch(steps);
  if (quote.damage === 0) return branch.find(step => step.type === 'condition').steps;
  const choice = branch.find(step => step.type === 'choice');
  quote.completion = structuredClone(choice.options[0].steps);
  choice.prompt = choice.prompt.replace('[..]', quote.fee.toLocaleString('en-GB'));
  choice.options = choice.options.map((option, index) => ({ ...option, steps: [
    { type: 'action', action: index === 2 ? DECLINE : COMMIT,
      repairSession: quote.session, remember: index === 1 }, ...option.steps,
  ] }));
  if (quote.player.getAttribute(DISMISSED_ATTRIBUTE) === true) return choice.options[0].steps;
  return branch.filter(step => step.type !== 'condition').map(step => typeof step.npc === 'string'
    ? { ...step, npc: step.npc.replace('[..]', quote.fee.toLocaleString('en-GB')) } : step);
}
function begin(player, npc) {
  quotes.delete(player);
  const boat = yard.visitedBoat(player);
  if (!eligible(player, npc, boat)) {
    say(player, 'Bring a boat to the shipyard before asking for repairs.');
    return;
  }
  const quote = { player, npc, boat, damage: boat.damage ?? 0,
    fee: (boat.damage ?? 0) * COST_PER_HP, session: ++nextSession };
  if (quote.damage > 0) quotes.set(player, quote);
  const request = transcript(player, npc, steps => quoteSteps(steps, quote));
  quote.cancel = request.cancel;
}
function repair(event) {
  begin(event.player, event.npc);
  return true;
}
function validQuote(quote) {
  return quotes.get(quote.player) === quote && eligible(quote.player, quote.npc, quote.boat)
    && quote.boat.damage === quote.damage;
}
function syncPreference({ player }) {
  player.getPacketSender().sendVarbit(core().CacheDefinitions.getVarbitId(WARNING_VARBIT),
    player.getAttribute(DISMISSED_ATTRIBUTE) === true ? 1 : 0);
}
function takeFee(container, coins, fee) {
  const removals = [];
  let remaining = fee;
  // getAmount sums matching IDs, while deleteNumber touches only the first slot.
  // Plan across the actual stacks, preserving metadata on every unspent remainder.
  for (let slot = 0; slot < container.getItems().length && remaining > 0; slot++) {
    const item = container.getItems()[slot];
    if (item.getId() !== coins || item.getAmount() <= 0) continue;
    const amount = Math.min(remaining, item.getAmount());
    removals.push({ slot, amount }); remaining -= amount;
  }
  if (remaining !== 0) return false;
  for (const { slot, amount } of removals) container.deleteAtSlot(slot, amount, false);
  return true;
}
function finish(quote, remember, resumed = false) {
  const { player, npc, boat, fee } = quote;
  if (!validQuote(quote)) {
    if (quotes.get(player) === quote) quotes.delete(player);
    if (!resumed) say(player, 'That repair quote is no longer valid. Ask me for a new quote.');
    return false;
  }
  const inventory = player.getInventory(), coins = coinsId();
  let funds = inventory;
  if (inventory.getAmount(coins) < fee) {
    const current = player.getDialogueManager().getCurrent();
    const pin = { player, feature: 'repair-boat', resume: () => finish(quote, remember, true) };
    // The PIN is an intentional transfer to a main modal; unrelated modals cancel the quote.
    quote.authorising = true;
    try { api.emitCustomEvent('bank-pin:guard', pin); }
    finally { quote.authorising = false; }
    if (pin.locked) {
      // Leave the keypad intact; stop this old transcript from continuing behind it.
      quote.cancel?.();
      if (player.getDialogueManager().getCurrent() === current) player.getDialogueManager().reset();
      return false;
    }
    funds = player.getBank(core().Bank.getTabForItem(player, coins));
    if (funds.getAmount(coins) < fee) {
      quotes.delete(player);
      say(player, `You need ${fee.toLocaleString('en-GB')} coins in your inventory or bank to repair this boat.`);
      return false;
    }
  }
  // Synchronous payment and healing commit together; no delayed retained currency reference.
  quotes.delete(player);
  if (!takeFee(funds, coins, fee)) {
    say(player, 'Your payment could not be completed. Ask me for a new quote.');
    return false;
  }
  hp.heal(player, boat, quote.damage);
  if (remember) { player.setAttribute(DISMISSED_ATTRIBUTE, true); syncPreference({ player }); }
  yard.refreshShownBoat(player);
  funds.refreshItems();
  if (resumed) transcript(player, npc, () => quote.completion);
  return true;
}
function action(event) {
  if (event.definition?.getName() !== PAGE) return;
  if (event.action === BEGIN) {
    event.handled = true;
    begin(event.player, event.npc);
    return;
  }
  if (event.action !== COMMIT && event.action !== DECLINE) return;
  event.handled = true;
  const quote = quotes.get(event.player);
  if (!quote || quote.npc !== event.npc || quote.session !== event.step.repairSession) {
    say(event.player, 'That repair quote is no longer valid. Ask me for a new quote.');
    return;
  }
  if (event.action === DECLINE) quotes.delete(event.player);
  else finish(quote, event.step.remember === true);
}
function logout({ player }) { quotes.get(player)?.cancel?.(); quotes.delete(player); }
function interfaceChanged({ player, interfaceId }) {
  const quote = quotes.get(player);
  if (interfaceId < 0 || !quote || quote.authorising) return;
  quotes.delete(player);
  quote.cancel?.(); // Scoped chatbox cancellation preserves the newly opened bank/trade/modal.
}
function attach(registry) {
  api = registry;
  registry.persistAttribute(DISMISSED_ATTRIBUTE, false);
  registry.onNpcInteraction(PAGE, { 'Repair-boat': repair, 'Talk-to': talk });
  registry.onCustomEvent('npc-dialogue:action', action);
  registry.onPlayerLogin(syncPreference);
  registry.onPlayerLogout(logout);
  registry.onCustomEvent('interface:changed', interfaceChanged);
}
module.exports = { attach };
