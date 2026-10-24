const Common = require('./Common.ElementalTomes');
const CONFIG_ATTRIBUTE = 'elemental-tomes:bank-charge-targets';
let core;
let interactions = new WeakMap();

function initialize(api) { core = api.core; interactions = new WeakMap(); }

function config(player, definition) {
  const entry = player.getAttribute(CONFIG_ATTRIBUTE)?.[definition.element];
  if (!entry || !Number.isInteger(entry.target) || entry.target < 0 || entry.target > Common.MAX_CHARGES ||
      ![definition.pageId,definition.specialPageId].filter(id=>id!==undefined).includes(entry.pageId)) return null;
  return entry;
}

function bankPages(player, pageId) {
  const stacks = [];
  for (let tab=0; tab<core.Bank.BANK_SEARCH_TAB_INDEX; tab++) {
    const bank = player.getBank(tab);
    for (let slot=0; slot<bank.getItems().length; slot++) {
      const item = bank.getItems()[slot];
      if (item.getId() === pageId && Number.isInteger(item.getAmount()) && item.getAmount() > 0) stacks.push({bank,item,slot});
    }
  }
  return stacks;
}

function current(saved) {
  return interactions.get(saved.player) === saved.token && core.Bank.isOpen(saved.player) && saved.player.getBank(saved.tab) === saved.bank &&
    saved.bank.getItems()[saved.slot] === saved.item && saved.item.getAmount() > 0 && saved.item.getId() === saved.id;
}

function prompt(saved, pageId) {
  if (!current(saved)) return;
  const {player,definition} = saved;
  player.setEnteredAmountAction({acceptsZero:true,execute(target) {
    if (!current(saved) || !Number.isInteger(target) || target < 0 || target > Common.MAX_CHARGES) return;
    const previous = player.getAttribute(CONFIG_ATTRIBUTE);
    const entries = previous && typeof previous === 'object' && !Array.isArray(previous) ? previous : {};
    player.setAttribute(CONFIG_ATTRIBUTE,{...entries,[definition.element]:{target,pageId}});
    interactions.delete(player);
    player.sendMessage(`Your ${definition.name.toLowerCase()} will fill to ${target.toLocaleString('en-US')} charges when withdrawn.`);
  }});
  player.getPacketSender().sendEnterAmountPrompt(`Set withdrawal charges (0 - ${Common.MAX_CHARGES}; 0 disables):`);
}

function configure(event) {
  const {player,item,tab,slot,op} = event;
  const definition = Common.getDefinition(item?.getId?.());
  if (op !== 9 || !definition) return;
  event.handled = true;
  if (!Number.isInteger(tab) || tab < 0 || tab >= core.Bank.BANK_SEARCH_TAB_INDEX || !Number.isInteger(slot) || slot < 0) return;
  const token = {};
  interactions.set(player,token);
  const saved = {player,item,tab,slot,bank:player.getBank(tab),id:item.getId(),definition,token};
  if (!current(saved)) return;
  const state = Common.read(item);
  if (state.charges > 0) return prompt(saved,state.pageId);
  const ordinary = bankPages(player,definition.pageId).length > 0;
  const special = definition.specialPageId !== undefined && bankPages(player,definition.specialPageId).length > 0;
  if (ordinary && special) {
    player.getDialogueManager().startDialogues(new core.DialogueChainBuilder().add(new core.OptionDialogue(0,{
      executeOption(option) {
        if (Number(option) === 1) prompt(saved,definition.pageId);
        else if (Number(option) === 2) prompt(saved,definition.specialPageId);
      },
    },'Burnt pages','Searing pages','Cancel').setTitle('Withdrawal page type')));
  } else prompt(saved,special ? definition.specialPageId : ordinary ? definition.pageId : config(player,definition)?.pageId ?? definition.pageId);
}

function withdrawn({player,items}) {
  if (!core.Bank.isOpen(player) || !Array.isArray(items)) return;
  for (const item of new Set(items)) {
    const definition = Common.getDefinition(item?.getId?.());
    if (!definition || item.getAmount() !== 1 || !player.getInventory().getItems().includes(item)) continue;
    const entry = config(player,definition), state = Common.read(item);
    if (!entry || entry.target <= state.charges) continue;
    // Never convert a partially used tome into the other fire-page variant.
    const pageId = state.charges > 0 ? state.pageId : entry.pageId;
    const stacks = bankPages(player,pageId);
    const available = stacks.reduce((sum,{item})=>sum+item.getAmount(),0);
    // Provisional: round the deficit up to whole pages, bounded by actual free capacity.
    const wanted = Math.min(Math.ceil((entry.target-state.charges)/Common.CHARGES_PER_PAGE),
      Math.floor((Common.MAX_CHARGES-state.charges)/Common.CHARGES_PER_PAGE));
    const count = Math.min(wanted,available);
    let remaining = count;
    for (const {bank,item:page,slot} of stacks) {
      const amount = Math.min(remaining,page.getAmount());
      if (amount > 0) bank.deletedItem(new core.Item(pageId,amount),slot,false);
      remaining -= amount;
      if (remaining === 0) break;
    }
    if (count > 0) Common.set(item,definition,state.charges+count*Common.CHARGES_PER_PAGE,pageId);
    if (count < wanted) player.sendMessage(`You do not have enough matching pages in your bank to fill your ${definition.name.toLowerCase()}.`);
  }
}

function attach(api) {
  api.persistAttribute(CONFIG_ATTRIBUTE,{});
  api.onCustomEvent(core.Bank.ITEM_OP_EVENT,configure);
  api.onCustomEvent(core.Bank.WITHDRAWN_ITEMS_EVENT,withdrawn);
}

module.exports = {initialize,attach};
