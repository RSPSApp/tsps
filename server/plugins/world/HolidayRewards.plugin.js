"use strict";

// rev241 rareitems_diango: enum_708 indices, script450's eight unlock masks.
const REWARDS_ENUM = 708, RETRIEVAL_SCRIPT = 450, SLOT_LIMIT = 228;
const UNLOCKED_ATTRIBUTE = "holiday-rewards:unlocked";
const TITLE = "Diango's Holiday Item Retrieval";
const NO_SPACE = "You don't have enough inventory space to take that.";
const UNLOCK_MESSAGE = "You've unlocked a holiday item: ";
const sessions = new WeakMap();
const HouseRetrieval = require("../skills/construction/Retrieval.Construction");
const HouseState = require("../skills/construction/StorageState.Construction");
let catalogue;

function data(api) {
  if (catalogue) return catalogue;
  const c = api.core.CacheDefinitions, names = c.getObjNames();
  const rows = new Map([...c.getEnumValues(REWARDS_ENUM)].filter(([slot,id]) => Number.isInteger(slot) && slot >= 0 && slot < SLOT_LIMIT && Number.isInteger(id) && id > 0));
  if (!rows.size) throw new Error("Missing Diango reward catalogue in active cache");
  const graph = new Map();
  function link(ids) {
    for (const id of ids) {
      if (!graph.has(id)) graph.set(id,new Set());
      for (const other of ids) graph.get(id).add(other);
    }
  }
  // Shared cache families, not item-name guesses: transformed styles remain owned.
  const table = c.getDbTableId("item_transmog");
  if (table != null) {
    const groupCol = c.getDbColumn(table,"group"), itemCol = c.getDbColumn(table,"namedobj");
    if (groupCol == null || itemCol == null) throw new Error("Missing item transmog columns");
    const groups = new Map();
    for (const row of c.getDbTableRows(table)) {
      const group=row.int(groupCol),id=row.int(itemCol);
      if (!groups.has(group)) groups.set(group,[]);
      if (id > 0) groups.get(group).push(id);
    }
    for (const ids of groups.values()) link(ids);
  }
  // Costume room cache alternate/alternate-set tables also cover older variants.
  for (const [base,alternate] of c.getEnumValues(3303)) if (alternate > 0) link([base,alternate]);
  for (const [base,enumId] of c.getEnumValues(3304)) link([base,...c.getEnumValues(enumId).values()].filter(id=>Number.isInteger(id)&&id>0));
  const families = new Map();
  for (const id of rows.values()) {
    const family = new Set([id]), pending=[id];
    for (let n=0;n<pending.length;n++) for (const other of graph.get(pending[n])??[]) if (!family.has(other)) {family.add(other);pending.push(other);}
    families.set(id,[...family]);
  }
  catalogue = {rows,families,names,byName:new Map([...rows.values()].map(id=>[names.get(id),id])),
    group:c.getInterfaceId("rareitems_diango"),items:c.getComponentId("rareitems_diango:items")};
  return catalogue;
}

function unlocked(player) {
  const value=player.getAttribute(UNLOCKED_ATTRIBUTE);
  return Array.isArray(value) ? value.filter(name=>typeof name === "string") : [];
}
function unlock(api, request) {
  if (!request?.player || !Array.isArray(request.items)) return;
  const d=data(api);
  if (!request.items.every(name=>typeof name === "string" && d.byName.has(name))) {request.accepted=false;return;}
  request.player.setAttribute(UNLOCKED_ATTRIBUTE,[...new Set([...unlocked(request.player),...request.items])]);
  request.accepted=true;
}
// Rev 232 recording 3200: wearing or playing with a holiday item you hold but never
// unlocked registers it with Diango ("Check rank" on the same wreath does not).
// An item is its own entry; an alternate style counts only when its family holds exactly
// one entry (the 25th anniversary tabards share a family but are separate entries).
function catalogueEntry(api, itemId) {
  const d=data(api);
  if (!d.entryOf) {
    const owners=new Map();
    for (const id of d.rows.values()) for (const member of d.families.get(id)) {
      if (!owners.has(member)) owners.set(member,new Set());
      owners.get(member).add(id);
    }
    d.entryOf=new Map();
    for (const [member,entries] of owners) {
      if (entries.has(member)) d.entryOf.set(member,member);
      else if (entries.size===1) d.entryOf.set(member,[...entries][0]);
    }
  }
  return d.entryOf.get(itemId) ?? null;
}
function used(api, {player, itemId}) {
  if (!player || !Number.isInteger(itemId)) return;
  const entry=catalogueEntry(api,itemId);
  if (entry==null) return;
  const d=data(api), name=d.names.get(entry);
  if (unlocked(player).includes(name)) return;
  player.setAttribute(UNLOCKED_ATTRIBUTE,[...unlocked(player),name]);
  player.sendMessage(`${UNLOCK_MESSAGE}<col=ef1020>${api.core.CacheDefinitions.getItem(entry).name}</col>`);
}
function equipped(api, event) {
  if (event?.equipped === true) used(api, event);
}
function owns(api, player, family, includeInventory=true) {
  const banks=player.getBanks().slice(0,api.core.Bank.BANK_SEARCH_TAB_INDEX);
  const containers=[player.getEquipment(),...banks];
  if(includeInventory)containers.unshift(player.getInventory());
  // A planted Wintumber tree or scarecrow still belongs to the player (dug up, it comes back).
  const planted={player,itemIds:[]};api.emitCustomEvent("construction:planted",planted);
  return family.some(id=>planted.itemIds.includes(id)) || containers.some(container=>container && family.some(id=>container.getAmount(id)>0));
}
function masks(api, player) {
  const d=data(api),keys=new Set(unlocked(player)),result=new Array(8).fill(0);
  for (const [slot,id] of d.rows) {
    const family=d.families.get(id);
    // Scripts450/474 own exact inventory visibility, including showing a lost item again.
    // Captured mask bits must retain that entitlement; only external/alternate owners mask it.
    const alternateHeld=family.some(other=>other!==id&&player.getInventory().getAmount(other)>0);
    if(keys.has(d.names.get(id))&&!owns(api,player,family,false)&&!alternateHeld)result[slot>>5]|=1<<(slot&31);
  }
  return result;
}
function refresh(api,player) {
  const d=data(api),sender=player.getPacketSender();
  sender.sendInterfaceFlagsRange(d.items,0,SLOT_LIMIT-1,(1<<1)|(1<<10));
  sender.sendClientScript(RETRIEVAL_SCRIPT,TITLE,...masks(api,player));
}
function open(api,{player}) {
  if (player.busy() || player.getHitpoints() <= 0) return;
  player.getPacketSender().sendInterface(data(api).group);
  sessions.set(player,true);
  refresh(api,player);
}
function eligible(api,player) {
  return sessions.has(player) && player.getInterfaceId()===data(api).group && player.getStatus()===api.core.PlayerStatus.NONE && player.getHitpoints()>0;
}
function take(api,event) {
  const {player}=event,d=data(api);
  if (event.buttonId!==d.items || !sessions.has(player)) return;
  event.handled=true;
  if ((event.opId??event.action)!==1 || !eligible(api,player)) return;
  const id=d.rows.get(event.slot);
  if (!id || !unlocked(player).includes(d.names.get(id)) || owns(api,player,d.families.get(id))) return;
  const item=new api.core.Item(id,1),inventory=player.getInventory();
  if (inventory.getAddableAmount(item)!==1) {player.sendMessage(NO_SPACE);return;}
  const stored={player,itemIds:d.families.get(id),outputId:id,mode:"inspect",count:0};
  api.emitCustomEvent("construction:costume-retrieve",stored);
  if (stored.count>0) {
    const guard={player,feature:"poh-costume-room",resume:open.bind(null,api,{player})};
    api.emitCustomEvent("bank-pin:guard",guard);
    if (guard.locked) return;
    stored.mode="retrieve";
    api.emitCustomEvent("construction:costume-retrieve",stored);
    if (!stored.taken) return;
  } else inventory.addItem(item);
}
function closed(api,{player,interfaceId}) {if(interfaceId===data(api).group)sessions.delete(player);}
function changed(api,{player,interfaceId}) {if(interfaceId!==data(api).group)sessions.delete(player);}
function logout({player}) {sessions.delete(player);}

module.exports={name:"HolidayRewards",register(api){
  api.persistAttribute(UNLOCKED_ATTRIBUTE,[]);
  api.persistAttribute(HouseState.HOUSE_ATTRIBUTE,HouseState.defaultHouse());
  api.persistAttribute(HouseState.DECORATIONS_ATTRIBUTE,{});
  api.onCustomEvent("holiday-rewards:unlock",unlock.bind(null,api));
  api.onCustomEvent("holiday-rewards:used",used.bind(null,api));
  api.onCustomEvent("equipment:changed",equipped.bind(null,api));
  api.onCustomEvent("construction:costume-retrieve",HouseRetrieval.retrieve.bind(null,api));
  api.onCustomEvent("construction:planted",HouseRetrieval.planted.bind(null,api));
  api.onNpcInteraction("Diango",{"Holiday-items":open.bind(null,api)});
  api.onCustomEvent("holiday-rewards:open",open.bind(null,api));
  api.onInterfaceActionClick(take.bind(null,api));
  api.onCustomEvent("interface:closed",closed.bind(null,api));
  api.onCustomEvent("interface:changed",changed.bind(null,api));
  api.onPlayerLogout(logout);
  api.onPlayerDisconnect(logout);
}};
