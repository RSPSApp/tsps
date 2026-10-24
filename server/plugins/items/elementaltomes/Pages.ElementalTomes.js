const Common = require('./Common.ElementalTomes');
let core;
let interactions = new WeakMap();

function initialize(api) { core = api.core; interactions = new WeakMap(); }

// Retain the exact container, slot, item and charge state across each modal.
function snapshot(player, item) {
  const definition = Common.getDefinition(item?.getId?.());
  if (!definition || item.getAmount() !== 1) return null;
  for (const container of [player.getInventory(), player.getEquipment()]) {
    const slot = container.getItems().indexOf(item);
    if (slot >= 0) {
      const token = {};
      interactions.set(player,token);
      return { player, item, definition, container, slot, token, id:item.getId(), state:Common.read(item) };
    }
  }
  return null;
}

function current(saved) {
  if (!saved || interactions.get(saved.player) !== saved.token ||
      saved.container.getItems()[saved.slot] !== saved.item || saved.item.getAmount() !== 1 ||
      saved.item.getId() !== saved.id) return false;
  const state = Common.read(saved.item);
  return state.charges === saved.state.charges && state.pageId === saved.state.pageId;
}

function compatible(definition, pageId) {
  return pageId === definition.pageId || (definition.specialPageId !== undefined && pageId === definition.specialPageId);
}

function promptAdd(saved, pageId) {
  if (!current(saved) || !compatible(saved.definition,pageId)) return;
  const { player, item, definition, state } = saved;
  if (state.charges > 0 && state.pageId !== pageId) {
    player.sendMessage('Remove the existing pages before adding a different page type.');
    return;
  }
  const inventory = player.getInventory();
  const most = Math.min(Math.floor((Common.MAX_CHARGES-state.charges)/Common.CHARGES_PER_PAGE),inventory.getAmount(pageId));
  if (most <= 0) { player.sendMessage('You need matching pages and room in your tome to add pages.'); return; }
  player.setEnteredAmountAction({ execute(amount) {
    if (!Number.isInteger(amount) || amount <= 0 || !current(saved)) return;
    const count = Math.min(amount,most,inventory.getAmount(pageId));
    if (count <= 0) return;
    inventory.deleteNumber(pageId,count);
    Common.set(item,definition,state.charges+count*Common.CHARGES_PER_PAGE,pageId);
    Common.refresh(player);
    player.sendMessage(`Your ${definition.name.toLowerCase()} now has ${Common.read(item).charges.toLocaleString('en-US')} charges.`);
  }});
  player.getPacketSender().sendEnterAmountPrompt(`How many pages would you like to add? (1 - ${most})`);
}

function removeAll(saved) {
  if (!current(saved)) return;
  const {player,item,definition,state} = saved;
  const count = Common.wholePages(state);
  const inventory = player.getInventory();
  const refund = count > 0 ? new core.Item(state.pageId,count) : null;
  if (refund && inventory.getAddableAmount(refund) !== count) {
    player.sendMessage('You do not have enough inventory space to remove these pages.');
    return;
  }
  Common.set(item,definition,0,state.pageId);
  if (refund) inventory.add(refund,false);
  Common.refresh(player);
  player.sendMessage(`You remove ${count} whole pages from your tome.`);
}

function check({player,item}) {
  const saved = snapshot(player,item);
  if (!saved) return false;
  const kind = core.ItemDefinition.forId(saved.state.pageId).getName().toLowerCase();
  const pages = saved.state.charges > 0 ? ` (${kind}s)` : '';
  player.sendMessage(`Your ${saved.definition.name.toLowerCase()} has ${saved.state.charges.toLocaleString('en-US')} charges remaining${pages}.`);
  return true;
}

// Functional page controls; exact historical dialogue wording is unverified.
function pages({player,item}) {
  const saved = snapshot(player,item);
  if (!saved) return false;
  const special = saved.definition.specialPageId !== undefined;
  const labels = special ? ['Add burnt pages','Add searing pages','Remove all pages','Cancel'] : ['Add pages','Remove all pages','Cancel'];
  player.getDialogueManager().startDialogues(new core.DialogueChainBuilder().add(
    new core.OptionDialogue(0,{executeOption(option) {
      player.getPacketSender().sendInterfaceRemoval();
      if (!current(saved)) return;
      if (Number(option) === 1) promptAdd(saved,saved.definition.pageId);
      else if (special && Number(option) === 2) promptAdd(saved,saved.definition.specialPageId);
      else if (Number(option) === (special ? 3 : 2)) removeAll(saved);
    }},...labels).setTitle('Tome pages')));
  return true;
}

function usePages(event) {
  const {player} = event;
  const item = Common.getDefinition(event.usedItem?.getId?.()) ? event.usedItem : event.usedWithItem;
  const page = item === event.usedItem ? event.usedWithItem : event.usedItem;
  const saved = snapshot(player,item);
  if (!saved || saved.container !== player.getInventory() ||
      !player.getInventory().getItems().includes(page) || page.getAmount() <= 0 ||
      !compatible(saved.definition,page.getId())) return false;
  promptAdd(saved,page.getId());
  return true;
}

function attach(api) {
  const I = core.ItemIdentifiers;
  const definitions = [I.TOME_OF_FIRE,I.TOME_OF_WATER,I.TOME_OF_EARTH].map(Common.getDefinition);
  const names = new Set();
  for (const definition of definitions) {
    for (const id of [definition.chargedId,definition.emptyId]) {
      const name = core.ItemDefinition.forId(id).getName();
      if (!names.has(name)) { api.onItemAction(name,{Check:check,Pages:pages}); names.add(name); }
      for (const page of [definition.pageId,definition.specialPageId].filter(id=>id!==undefined)) {
        // Different cache variants can share a name, so register each name pair only once.
        const key = `${page}:${name}`;
        if (names.has(key)) continue;
        names.add(key);
        api.onItemOnItem(core.ItemDefinition.forId(page).getName(),name,usePages,{noted:false});
      }
    }
  }
}

module.exports = { initialize, attach };
