const Layout = require("./Layout.AdminPanel");
const Teleports = require("./Teleports.AdminPanel");
const Bots = require("./Bots.AdminPanel");
const BotView = require("./BotView.AdminPanel");
const Testing = require("./Testing.AdminPanel");
const Spawn = require("./Spawn.AdminPanel");
const ContainerView = require("./Containers.AdminPanel");
const V = ContainerView.C;
const Containers = require("../Containers.PlayerTools");
const { randomUUID } = require("node:crypto");
const { describePlayer, searchItems, applyPlayerTool } = require("../PlayerTools");
const { GROUP_ID, MAIN_MODAL_UID, COMPONENT: C, TAB_LABELS, DATA_COMPONENTS, BUTTONS, ROW_SLOTS, PRESETS, SKILL_ORDER, uid } = Layout;
const TAB = { PLAYERS: 0, TELEPORTS: 1, ITEMS: 2, EDITOR: 3, STATS: 3, QUESTS: 3, STAFF: 3, CHEATS: 4, TESTING: 4, GODMODE: 4, SPAWN: 5, NPCS: 5, BOTS: 6 };
const SECTION = { SKILLS: 0, QUESTS: 1, STAFF: 2, INVENTORY: 3, EQUIPMENT: 4, BANK: 5, CHARACTER: 6 };
const CONTAINERS = ["inventory", "equipment", "bank"];
const RANKS = [["NONE", "Player"], ["MODERATOR", "Moderator"], ["ADMINISTRATOR", "Admin"], ["OWNER", "Owner"], ["DEVELOPER", "Developer"]];
const MAINMODAL_BACKGROUND_SCRIPT = 917;
const WORLD_MAP_GROUP_ID = 595;
const EXPANDED_MODAL_SIZE = -3;
const SKILL_ICON_ENUM = 255;
const EQUIPMENT_EMPTY_ICON_ENUM = 904;
const CLOSE_ON_INTERFACE_CLOSE_ATTRIBUTE = "interface:close-on-interface-close";
const TAB_BUTTONS = TAB_LABELS.flatMap((_, i) => [uid(C.TAB_START + i), uid(C.TAB_LABEL_START + i)]);
const ROW_BUTTONS = [C.ROW_LABEL_START, C.ROW_ICON_START, C.ROW_BACKGROUND_START].flatMap(start => Array.from({ length: ROW_SLOTS }, (_, i) => uid(start + i)));
const ACTION_BUTTONS = BUTTONS.flatMap(({ button, label }) => [uid(button), uid(label)]);
const UTILITY_BUTTONS = [uid(C.UTILITY), uid(C.UTILITY_LABEL)];
const SKILL_BUTTONS = SKILL_ORDER.map(index => uid(C.SKILL_BUTTON_START + index));
const PRESET_BUTTONS = PRESETS.flatMap((_, index) => [uid(C.PRESET_START + index), uid(C.PRESET_LABEL_START + index)]);
const sessions = new WeakMap();
let api;
let core;
const safe = value => String(value).replace(/[<>]/g, character => character === "<" ? "<lt>" : "<gt>");
const tell = (player, message) => player.sendMessage(`[Admin] ${message}`);
const registered = player => player && player.isRegistered() &&
  player.getProfile() === (core.GameConstants.WORLD_PROFILE ?? "main") && core.World.getPlayerByName(player.getUsername()) === player;
const online = player => registered(player) && !player.isPlayerBot?.();
const actorOnline = player => registered(player) && (!player.isPlayerBot?.() || player.getSession()?.hasNetworkClient?.());
const eligible = player => core.PlayerRights.hasAdminRights(player) &&
  core.PluginManager.playerHasCommandRights(player, "admin");

// Commands have their registered gate. Clicks and delayed prompts must check it again.
function session(player) {
  const state = sessions.get(player);
  if (!state || player.getInterfaceId() !== GROUP_ID) return null;
  if (!eligible(player) || !actorOnline(player)) {
    sessions.delete(player);
    player.getPacketSender().sendInterfaceRemoval();
    tell(player, "Admin access is no longer available.");
    return null;
  }
  return state;
}

function ready(player) {
  const state = session(player);
  if (state?.busy) { tell(player, "Wait for the current change to finish saving."); return null; }
  return state;
}

function targetOf(player, state) {
  if (!online(state.target)) {
    tell(player, "The selected player is offline. Select an online player.");
    return null;
  }
  return state.target;
}

function visibility(player, state) {
  const sender = player.getPacketSender();
  const editor = state.tab === TAB.EDITOR || state.tab === TAB.ITEMS, skills = state.tab === TAB.EDITOR && state.section === SECTION.SKILLS;
  const teleport = state.tab === TAB.TELEPORTS;
  const botForm = state.tab === TAB.BOTS && Bots.config(state).view !== "browse";
  state.visibility=new Map();
  const hide = (components, value) => components.forEach(component => {
    state.visibility.set(component,value); sender.sendInterfaceDisplayState(uid(component), value);
  });
  const container = state.tab === TAB.EDITOR && state.section >= SECTION.INVENTORY && state.section <= SECTION.BANK;
  const bank = container && state.section === SECTION.BANK;
  hide([C.SEARCH_BOX, C.SEARCH_INPUT, C.STATUS, C.LIST_VIEW, C.LIST_SCROLLBAR], skills || container || botForm);
  hide([V.VIEW, V.SCROLLBAR], !container || bank);
  hide([V.INVENTORY], !container || state.section !== SECTION.INVENTORY);
  hide([V.EQUIPMENT], !container || state.section !== SECTION.EQUIPMENT);
  hide([V.BANK_VIEW, V.BANK_SCROLLBAR, V.BANK_TABS, V.BANK_INFO], !bank);
  hide([C.SKILL_VIEW, C.SKILL_SCROLLBAR], !skills);
  hide([C.PANEL, C.PANEL_BORDER, C.DETAIL_VIEW, C.DETAIL_SCROLLBAR], teleport || skills || bank || botForm);
  hide([C.UTILITY, C.UTILITY_LABEL, C.MAP_TELEPORT, C.MAP_TELEPORT_LABEL], !teleport);
  hide(Layout.SECTION_LABELS.flatMap((_, i) => [C.SECTION_START + i, C.SECTION_LABEL_START + i]), !editor);
  hide(Layout.SPAWN_LABELS.flatMap((_, i) => [C.SPAWN_START + i, C.SPAWN_LABEL_START + i]), state.tab !== TAB.SPAWN);
  Layout.SPAWN_LABELS.forEach((label,i)=>sender.sendString(`${(state.spawnKind??'npc')===(i?'item':'npc')?'<col=ffffff>':'<col=ffd27f>'}${label}</col>`,uid(C.SPAWN_LABEL_START+i)));
  const npcTools = { actor: player, player };
  if (state.tab === TAB.NPCS) api.emitCustomEvent("admin:testing-tools", npcTools);
  hide([C.ADD_ITEMS, C.ADD_ITEMS_LABEL], state.tab!==TAB.ITEMS && !(state.tab === TAB.SPAWN && (state.spawnKind??'npc')==='npc' && npcTools.allowed?.npc));
  sender.sendString(state.tab === TAB.NPCS ? "Clear my NPCs" : state.tab === TAB.ITEMS ? "Back to slots" : "Add items", uid(C.ADD_ITEMS_LABEL));
  hide([C.EDITOR_HINT], editor || teleport || state.tab === TAB.BOTS);
  hide([C.TARGET_BUTTON, C.SELF_BUTTON], state.tab === TAB.BOTS);
  hide([C.TARGET], botForm);
  TAB_LABELS.forEach((_, i) => hide([C.TAB_START + i, C.TAB_LABEL_START + i], botForm || i === TAB.ITEMS));
  hide([C.CONTAINER_ADD,C.CONTAINER_ADD_LABEL], !(container && [SECTION.INVENTORY,SECTION.BANK].includes(state.section)));
  sender.sendString('Add item',uid(C.CONTAINER_ADD_LABEL));
  for (let i = 0; i < Layout.SECTION_LABELS.length; i++) sender.sendString(
    `${(i === state.section) ? "<col=ffffff>" : "<col=ffd27f>"}${Layout.SECTION_LABELS[i]}</col>`, uid(C.SECTION_LABEL_START + i));
  sender.sendString(teleport ? "Click a destination to teleport" : state.tab === TAB.ITEMS
    ? `Add to ${state.target.getUsername()}'s ${state.itemDestination ?? "inventory"}`
    : state.tab === TAB.BOTS ? "Configure and deploy bots as yourself" : state.tab === TAB.SPAWN ? `Spawns under ${safe(player.getUsername())} or nearby` : "", uid(C.EDITOR_HINT));
  sender.sendString("Enter coordinates", uid(C.UTILITY_LABEL));
  BotView.render(api, player, state, uid, hide);
}
function activeContainer(state) {
  return state.tab === TAB.EDITOR && state.section >= SECTION.INVENTORY && state.section <= SECTION.BANK ? CONTAINERS[state.section - SECTION.INVENTORY] : null;
}
function bankTabLimit(target) {
  let last = 0;
  for (let tab = 1; tab < core.Bank.BANK_SEARCH_TAB_INDEX; tab++) {
    if (target.getBank(tab).getItems().some(item => item?.getId() >= 0)) last = tab;
  }
  return Math.min(core.Bank.BANK_SEARCH_TAB_INDEX - 1, last + 1);
}
function clearContainer(player, state) {
  const sender = player.getPacketSender();
  for (const component of state.slotCache?.keys() ?? []) sender.clearItemOnInterface(uid(component));
  state.slotCache = null; state.containerSlots = new Map();
}
function sendContainer(player, state) {
  const name = activeContainer(state);
  if (!name || !online(state.target)) return;
  const sender = player.getPacketSender(), limit = name === "bank" ? bankTabLimit(state.target) : 0;
  const bankTab = name === "bank" ? Math.min(state.bankTab ?? 0, limit) : 0;
  if (name === "bank") state.bankTab = bankTab;
  const held = Containers.container(core, state.target, name, bankTab), items = held.getItems();
  const last = items.reduce((last,item,i)=>item?.getId()>=0 && item.getAmount()>0 ? i : last,-1);
  const count = name === "bank" ? Math.min(ContainerView.BANK_SLOTS, Math.max(64, Math.ceil((last+9)/8)*8)) : name === "inventory" ? 28 : 14;
  const start = name === "bank" ? V.BANK_START : name === "inventory" ? V.INVENTORY_START : V.EQUIPMENT_START;
  const slots = new Map(), cache = state.slotCache ?? new Map();
  for (let slot=0;slot<count;slot++) {
    const component=start+slot;
    if (!ContainerView.slotFor(component)) continue;
    const item=items[slot], occupied=item?.getId()>=0 && item.getAmount()>0;
    const snapshot={container:name,bankTab,slot,itemId:occupied?item.getId():-1,quantity:occupied?item.getAmount():0,signature:Containers.signature(item)};
    slots.set(component,snapshot);
    const stamp=JSON.stringify(snapshot);
    if (cache.get(component)===stamp) continue;
    cache.set(component,stamp);
    if (occupied) sender.sendItemOnInterface(uid(component),snapshot.itemId,0,snapshot.quantity);
    else sender.clearItemOnInterface(uid(component));
    if (name === "bank") sender.sendInterfaceDisplayState(uid(component),false).sendInterfaceDisplayState(uid(V.BANK_FRAME_START+slot),false);
    if (name === "equipment") sender.sendInterfaceDisplayState(uid(V.EQUIPMENT_GHOST_START+slot),occupied);
    const label=occupied?safe(core.ItemDefinition.forId(snapshot.itemId).getName()):name==='equipment'?ContainerView.EQUIPMENT.find(([s])=>s===slot)[3]:'slot '+(slot+1);
    sender.sendInterfaceActions(uid(component),ContainerView.actionsFor(occupied,label));
  }
  if(name==='bank') {
    for(let slot=count;slot<(state.bankVisibleCount??0);slot++) { sender.sendInterfaceDisplayState(uid(start+slot),true).sendInterfaceDisplayState(uid(V.BANK_FRAME_START+slot),true); cache.delete(start+slot); }
    state.bankVisibleCount=count;
    sender.sendString(String(Math.ceil(count/8)*ContainerView.BANK_PITCH_Y),uid(V.BANK_HEIGHT));
    sender.sendString("Click an item to set quantity. Right-click to add or remove. Drag to move.",uid(V.BANK_INFO));
    for(let i=0;i<10;i++) {
      sender.sendInterfaceDisplayState(uid(V.BANK_TAB_START+i), i>limit).sendInterfaceDisplayState(uid(V.BANK_TAB_LABEL_START+i), i>limit);
      const empty = i > 0 && !state.target.getBank(i).getItems().some(item=>item?.getId()>=0);
      sender.sendString(`${i===bankTab?'<col=ffffff>':'<col=ffd27f>'}${empty?'New':i?'Tab '+i:'Main'}</col>`,uid(V.BANK_TAB_LABEL_START+i));
    }
  } else sender.sendString(String(name==='equipment'?202:261),uid(V.HEIGHT));
  state.slotCache=cache; state.containerSlots=slots;
}
function chooseSlotItems(player,state,slot) {
  cancelPrompt(player,state);
  state.itemDestination=slot.container; state.bankTab=slot.bankTab;
  state.pickerSlot=slot.itemId<0?{slot:slot.slot,signature:slot.signature}:null;
  state.tab=TAB.ITEMS; state.selected=null;
  beginSearch(player,state);
  sendRows(player,state,state.tab);
}
function clickSlot({player,buttonId,opId=1}) {
  const state=ready(player), component=buttonId&65535, slot=state?.containerSlots?.get(component);
  if(!state || !slot || slot.container!==activeContainer(state) || !targetOf(player,state)) return true;
  cancelPrompt(player,state);
  if(slot.itemId<0) { if(opId===1) chooseSlotItems(player,state,slot); return true; }
  const held={...slot,name:core.ItemDefinition.forId(slot.itemId).getName()};
  state.selected={tab:TAB.EDITOR,held};
  showSelection(player,state.selected,{title:safe(held.name),info:`${safe(state.target.getUsername())}'s ${held.container}`,info2:`${held.quantity.toLocaleString('en-US')} held`,description:safe(core.ItemDefinition.forId(held.itemId).getExamine()),primary:'Set quantity',secondary:'Add quantity',third:'Remove quantity',fourth:'Cancel'});
  if(opId===4) void apply(player,state,{action:'container',...slot,mode:'remove',quantity:slot.quantity});
  else if(opId>=1 && opId<=3) editSlotQuantity(player,state,held,['set','increase','remove'][opId-1]);
  return true;
}
function editSlotQuantity(player,state,held,mode) {
  const title=mode==='set'?`Set ${held.name} quantity for ${state.target.getUsername()}? (0 removes)`
    :`${mode==='increase'?'Add':'Remove'} how many ${held.name} ${mode==='increase'?'to':'from'} ${state.target.getUsername()}'s ${held.container}?`;
  prompt(player,state,title,true,quantity=>void apply(player,state,{action:'container',...held,mode,quantity}),{acceptsZero:mode==='set'});
}
function clickBankTab({player,buttonId,opId=1}) {
  const state=ready(player);
  if(!state || activeContainer(state)!=='bank' || opId!==1) return true;
  const component=buttonId&65535, tab=component>V.BANK_TAB_LABEL_START-1?component-V.BANK_TAB_LABEL_START:component-V.BANK_TAB_START;
  if(tab<0 || tab>bankTabLimit(state.target)) return true;
  cancelPrompt(player,state); state.bankTab=tab; state.selected=null; state.slotCache=null;
  sendRows(player,state,state.tab);
  return true;
}
function dragSlot(event) {
  const {packet,player}=event;
  if(packet.sourceWidgetId>>>16!==GROUP_ID && packet.targetWidgetId>>>16!==GROUP_ID) return;
  event.handled=true;
  const state=ready(player), name=state&&activeContainer(state);
  if(!name || !targetOf(player,state) || packet.sourceWidgetId>>>16!==GROUP_ID || packet.targetWidgetId>>>16!==GROUP_ID) return;
  const source=state.containerSlots?.get(packet.sourceWidgetId&65535);
  if(!source || source.itemId<0 || source.container!==name) return;
  let destination=state.containerSlots?.get(packet.targetWidgetId&65535);
  const component=packet.targetWidgetId&65535;
  if(name==='bank' && !destination) {
    const tab=component>=V.BANK_TAB_LABEL_START?component-V.BANK_TAB_LABEL_START:component-V.BANK_TAB_START;
    if(tab>=0 && tab<=bankTabLimit(state.target) && tab!==(state.bankTab??0)) {
      const held=Containers.container(core,state.target,name,tab), items=held.getItems();
      let slot=items.findIndex(item=>item?.getId()===source?.itemId && JSON.stringify(item.getMeta?.())===JSON.stringify(Containers.container(core,state.target,name,source.bankTab).getItems()[source.slot]?.getMeta?.()));
      if(slot<0) slot=items.findIndex(item=>!item || item.getId()<0);
      if(slot<0) slot=items.length;
      destination={container:name,bankTab:tab,slot,itemId:items[slot]?.getId()??-1,signature:Containers.signature(items[slot])};
    }
  }
  // IF_BUTTOND carries item IDs as unsigned shorts, including its empty sentinel.
  const targetItemId = packet.targetItemId === 0xffff ? -1 : packet.targetItemId;
  if(!destination || destination.container!==name || packet.sourceItemId!==source.itemId || targetItemId!==destination.itemId && ContainerView.slotFor(component)) return;
  cancelPrompt(player,state);
  void apply(player,state,{action:'container',...source,mode:'move',destinationSlot:destination.slot,destinationBankTab:destination.bankTab,destinationSignature:destination.signature});
}
function emptyPanel(player, state) {
  const sender = player.getPacketSender();
  sender.sendInterfaceDisplayState(uid(C.PANEL_EMPTY), false);
  for (const component of [C.PANEL_TITLE, C.PANEL_INFO, C.PANEL_INFO2, C.PANEL_DESCRIPTION, ...BUTTONS.map(({ label }) => label)]) {
    player.getFrameUpdater().clear(uid(component)); sender.sendString("", uid(component));
  }
  sender.clearItemOnInterface(uid(C.PANEL_ICON));
  sender.sendInterfaceDisplayState(uid(C.PANEL_ICON), true);
  for (const { button, label } of BUTTONS) sender.sendInterfaceDisplayState(uid(button), true).sendInterfaceDisplayState(uid(label), true);
  visibility(player, state);
}

function rowId(state, key) {
  if (!state.ids.has(key)) {
    if (state.nextRowId >= 65534) return null;
    state.ids.set(key, ++state.nextRowId);
  }
  return state.ids.get(key);
}

function itemRow(state, item) {
  const id = rowId(state, `${TAB.ITEMS}:${item.id}`);
  if (!id) return null;
  state.rows.set(id, { id, tab: TAB.ITEMS, item });
  return { id, name: safe(item.name), icon: item.id, detail: item.noted ? " (noted)" : "", terms: String(item.id), panel: {
    title: safe(item.name), info: `For ${safe(state.target.getUsername())}'s ${state.itemDestination ?? "inventory"}`,
    info2: `${item.stackable ? "Stackable" : "One per slot"} / Item ${item.id}`,
    description: safe(core.ItemDefinition.forId(item.id).getExamine()), primary: "Add 1", secondary: "Add quantity", third: "", fourth: "",
  } };
}

function spawnRow(player, state, record) {
  const kind = state.spawnKind ?? 'npc', npc = kind === 'npc';
  const id = rowId(state, `${TAB.SPAWN}:${kind}:${record.id}`);
  if (!id) return null;
  state.rows.set(id, { id, tab: TAB.SPAWN, spawn: { kind, id: record.id, name: record.name }, ...(npc?{npc:record}:{item:record}) });
  const [primary,secondary] = Spawn.actions();
  return { id, name: safe(record.name), ...(npc?{npc:record.id}:{icon:record.id}), terms: String(record.id),
    detail: npc && record.level > 0 ? ` (level ${record.level})` : !npc && record.noted ? ' (noted)' : '', panel: { title: safe(record.name),
      info: `Spawn as ${safe(player.getUsername())}`,
      info2: npc ? `${record.level > 0 ? `Level ${record.level}` : "No combat level"}${record.hp > 0 ? ` / ${record.hp} HP` : ""} / NPC ${record.id}` : `Ground item / Item ${record.id}`,
      description: npc ? 'Temporary NPCs. Removed on logout. Spawn X places each on a separate reachable tile within 10 tiles.'
        : `${safe(core.ItemDefinition.forId(record.id).getExamine())}\nSpawn X places one item on each separate reachable tile.`, primary, secondary } };
}

const SEARCH_PAGE_SIZE = 40;
const SEARCH_RETAINED_PAGES = 3;
function sendItemResponse(player, state, error = false) {
  const matches=state.searchMatches??(state.tab===TAB.SPAWN?((state.spawnKind??'npc')==='npc'?state.npcs:state.spawnItems??[]):state.items);
  const offset=state.searchOffset??0, page=matches.slice(offset,offset+SEARCH_PAGE_SIZE);
  const rows=page.map(record=>state.tab===TAB.SPAWN?spawnRow(player,state,record):itemRow(state,record)).filter(Boolean);
  state.searchPages??=new Map();state.searchPages.set(offset,page);
  const pages=[...state.searchPages.keys()].sort((a,b)=>Math.abs(a-offset)-Math.abs(b-offset));
  for(const old of pages.slice(SEARCH_RETAINED_PAGES))state.searchPages.delete(old);
  const records=[...state.searchPages.values()].flat(),keep=new Set(records.map(r=>r.id));
  for(const [id,entry]of state.rows)if(entry.tab===state.tab&&!keep.has(entry.item?.id??entry.npc?.id)&&id!==state.selected?.id){state.rows.delete(id);state.displayRows?.delete(id);}
  if(state.tab===TAB.SPAWN){if((state.spawnKind??'npc')==='npc')state.npcs=records;else state.spawnItems=records;}
  else state.items=records;
  for (const row of rows) state.displayRows?.set(row.id, row);
  player.getPacketSender().sendString(JSON.stringify({ session: state.searchSession, sequence: state.searchSequence,
    query: state.itemQuery, offset, pageSize: SEARCH_PAGE_SIZE, rows, total: matches.length, error }), uid(C.SEARCH_RESPONSE));
}

function sendRows(player, state, active) {
  const metadata = describePlayer(api, state.target);
  sendContainer(player, state);
  const rows = [];
  const tabs = TAB_LABELS.map(() => []);
  let exhausted = false;
  const selectedId = state.selected?.id;
  state.rows = new Map();
  state.selected = null;
  state.version++;
  const row = (tab, name, detail, data, panel, extra = {}) => {
    if (tab === TAB.EDITOR && data.section !== state.section) return;
    // Native IF_BUTTON slots are unsigned 16-bit, with 65535 reserved for no slot.
    // Never reuse an ID for another entry while this panel is open.
    const key = `${tab}:${data.target?.getUsername() ?? data.place?.key ?? data.item?.id ?? data.skill ?? data.preset ?? data.quest ?? data.rank ?? data.group ?? data.testing ?? data.botKey ?? data.containerKey}`;
    const id = rowId(state, key);
    if (!id) { exhausted = true; return; }
    const entry = { id, tab, ...data };
    state.rows.set(id, entry);
    tabs[tab].push(id);
    rows.push({ id, name: safe(name), detail: safe(detail), terms: name, ...extra, panel: {
      title: safe(name), info: `For ${safe(state.target.getUsername())}`, info2: "", description: "", primary: "", secondary: "", third: "", fourth: "", ...panel,
    } });
    return id;
  };
  const players = core.World.getPlayers().stream().filter(online).sort((a, b) => a.getUsername().localeCompare(b.getUsername()));
  for (const target of players.slice(0, 200)) row(TAB.PLAYERS, target.getUsername(), target === state.target ? " (selected)" : "", { target },
    { info: `Rank: ${RANKS.find(([key]) => core.PlayerRights[key].getId() === target.getRights().getId())?.[1] ?? "Unknown"}`,
      description: "", primary: "Edit player", secondary: "Go to", third: "Bring here" });
  const folders = new Map();
  for (const group of Teleports.destinations(api, state.target)) {
    let children = folders, folder;
    group.path.forEach((label, index) => {
      const key = group.path.slice(0, index + 1).join("/");
      if (!children.has(key)) children.set(key, { key, label, children: new Map(), places: [] });
      folder = children.get(key);
      children = folder.children;
    });
    if (folder) folder.places.push(...group.places);
  }
  function sendFolder(folder, parentId) {
    const id = row(TAB.TELEPORTS, folder.label, "", { group: folder.key }, {},
      { ...(parentId ? { parentId } : {}), expandable: true, collapsed: true });
    for (const place of folder.places) row(TAB.TELEPORTS, place.name, "", { place },
      { info: `${place.x}, ${place.y}, plane ${place.z}`, description: "Admin teleport bypasses travel requirements. Leave private instances in game first." }, { parentId: id });
    for (const child of folder.children.values()) sendFolder(child, id);
  }
  for (const folder of folders.values()) sendFolder(folder);
  for (const item of state.items) {
    const entry = itemRow(state, item);
    if (entry) { rows.push(entry); tabs[TAB.ITEMS].push(entry.id); } else exhausted = true;
  }
  for (const skill of metadata.skills) row(TAB.STATS, skill.name, ` ${skill.current}/${skill.level}`, { skill: skill.name, section: SECTION.SKILLS },
    { info: `Current ${skill.current} / base ${skill.level}`, info2: `XP ${skill.experience.toLocaleString("en-US")}`,
      description: `Level ${skill.minimum}-${skill.maximum}.`,
      primary: "Set level", secondary: "-1 level", third: "+1 level" });
  for (const [preset, name] of [["max", "Max all skills"], ["combat", "Max combat skills"], ["reset", "Reset all skills"]]) {
    row(TAB.STATS, name, "", { preset, section: SECTION.SKILLS }, { description: "Changes base levels, current levels and XP. Reset keeps Hitpoints at 10 and other skills at 1. Confirmation required.", primary: "Apply preset" });
  }
  for (const quest of metadata.quests ?? []) row(TAB.QUESTS, quest.name, quest.complete ? " (complete)" : ` (stage ${quest.stage})`, { quest: quest.key, section: SECTION.QUESTS },
    { info: quest.complete ? "Complete" : `Stage ${quest.stage}`, description: "Reset keeps item/XP rewards. Completing again grants rewards again.", primary: "Complete", secondary: "Reset" });
  if (player.getRights().getId() >= core.PlayerRights.OWNER.getId()) {
    for (const [rank, name] of RANKS.filter(([key]) => core.PlayerRights[key].getId() < player.getRights().getId())) {
      row(TAB.STAFF, name, "", { rank, section: SECTION.STAFF }, { description: "Change the selected player's staff rank. You cannot change your own rank or a rank at or above your own.", primary: "Set rank" });
    }
  }
  if (state.section >= SECTION.INVENTORY && state.section <= SECTION.BANK && online(state.target)) {
    const name = CONTAINERS[state.section - SECTION.INVENTORY];
    state.containerFingerprint = Containers.viewFingerprint(core, state.target, name);
  }
  const cheatGroups = new Map();
  for (const entry of Testing.rows(api, player, state.target)) {
    if (["spawn-npcs", "remove-npcs"].includes(entry.key)) continue;
    const character = entry.key.startsWith("book:") || entry.key.startsWith("prayer:");
    const tab = character ? TAB.EDITOR : TAB.CHEATS;
    const section = character ? SECTION.CHARACTER : undefined;
    if (character && state.section !== section) continue;
    const groupKey = `${tab}:${entry.section}`;
    if (!cheatGroups.has(groupKey)) cheatGroups.set(groupKey,
      row(tab, entry.section, "", { group: groupKey, section }, {}, { expandable: true, collapsed: !character }));
    row(tab, entry.name, entry.detail, { testing: entry.key, section }, { description: entry.description,
      ...Object.fromEntries(["primary", "secondary", "third", "fourth"].map((key, i) => [key, entry.actions[i] ?? ""])) }, { parentId: cheatGroups.get(groupKey) });
  }
  if (state.tab === TAB.BOTS) {
    const groups = new Map();
    for (const entry of Bots.rows(api, player, state)) {
      const id = row(TAB.BOTS, entry.name, entry.detail, entry.group ? { group: entry.key } : { botKey: entry.key },
        { ...entry.panel, info: entry.info ?? `Spawning as ${safe(player.getUsername())}` },
        entry.group ? { expandable: true, collapsed: entry.collapsed ?? false } : entry.parent ? { parentId: groups.get(entry.parent) } : {});
      if (entry.group) groups.set(entry.key, id);
    }
  }
  if (exhausted) {
    sessions.delete(player);
    player.getPacketSender().sendInterfaceRemoval();
    tell(player, "Reopen ::admin to reset the selection limit.");
    return;
  }
  const parts = [[]];
  let bytes = 2;
  for (const entry of rows) {
    const size = Buffer.byteLength(JSON.stringify(entry), "latin1") + 1;
    if (bytes + size > 40000) { parts.push([]); bytes = 2; }
    parts.at(-1).push(entry); bytes += size;
  }
  if (parts.length > DATA_COMPONENTS.length) throw new Error("Admin panel data exceeds its packet budget.");
  state.displayRows = new Map(rows.map(row => [row.id, row]));
  const sender = player.getPacketSender();
  DATA_COMPONENTS.forEach((component, i) => sender.sendString(JSON.stringify(parts[i] ?? []), uid(component)));
  sender.sendString(state.tab === TAB.BOTS ? `Deploying as: ${safe(player.getUsername())}` : state.tab === TAB.SPAWN ? `Spawning as: ${safe(player.getUsername())}` : `Target: ${safe(state.target.getUsername())}`, uid(C.TARGET));
  let total = 0;
  for (const skill of metadata.skills) {
    total += skill.level;
    sender.sendString(String(skill.current), uid(C.SKILL_CURRENT_START + skill.index));
    sender.sendString(`/ ${skill.level}`, uid(C.SKILL_BASE_START + skill.index));
    sender.sendString(skill.name, uid(C.SKILL_NAME_START + skill.index));
    sender.sendInterfaceActions(uid(C.SKILL_BUTTON_START + skill.index), [`Set ${state.target.getUsername()}'s ${skill.name} level`]);
  }
  sender.sendString(`Total level: ${total}`, uid(C.SKILL_TOTAL));
  emptyPanel(player, state);
  if (selectedId && state.rows.get(selectedId)?.tab === state.tab) {
    state.selected = state.rows.get(selectedId);
    const panel = rows.find(entry => entry.id === selectedId)?.panel;
    if (panel) {
      for (const [key, component] of Object.entries({ title: C.PANEL_TITLE, info: C.PANEL_INFO, info2: C.PANEL_INFO2, description: C.PANEL_DESCRIPTION,
        primary: BUTTONS[0].label, secondary: BUTTONS[1].label, third: BUTTONS[2].label, fourth: BUTTONS[3].label })) sender.sendString(panel[key], uid(component));
      showSelection(player, state.selected, panel);
    }
  }
  if ([TAB.ITEMS, TAB.NPCS].includes(state.tab)) sendItemResponse(player, state);
  // This is an acknowledgement as well as data. The client must receive it even
  // when clicking the same tab leaves every row and visibility value unchanged.
  player.getFrameUpdater().clear(uid(C.LAYOUT));
  sender.sendString(JSON.stringify({ tabs, visibility:[...(state.visibility??[])].map(([component,hidden])=>({component,hidden})),
    ...(state.focusSearch ? {focusSearch:true} : {}), ...(active !== undefined ? { active } : {}) }), uid(C.LAYOUT));
  state.focusSearch=false;
}

function openAdmin({ player, tab }) {
  if (!eligible(player) || !actorOnline(player)) return true;
  if (sessions.get(player)?.busy) { tell(player, "Wait for the current change to finish saving."); return true; }
  player.getPacketSender().sendInterfaceRemoval();
  const state = { target: player, tab: tab === "bots" ? TAB.BOTS : TAB.PLAYERS, section: SECTION.SKILLS, itemDestination: "inventory", items: [], npcs: [], undo: null, ids: new Map(), nextRowId: 0, version: 0, selected: null, busy: false,
    searchSession: randomUUID(), searchSequence: 0, itemQuery: "", spawnKind:'npc', spawnItems:[] };
  sessions.set(player, state);
  player.setInterfaceId(GROUP_ID);
  player.setAttribute(CLOSE_ON_INTERFACE_CLOSE_ATTRIBUTE, GROUP_ID);
  const sender = player.getPacketSender();
  sender.sendInterfaceScript(MAINMODAL_BACKGROUND_SCRIPT, [-1, EXPANDED_MODAL_SIZE]);
  sender.sendSubInterface(MAIN_MODAL_UID, GROUP_ID, 0, {
    postScripts: [{ scriptId: MAINMODAL_BACKGROUND_SCRIPT, args: [-1, EXPANDED_MODAL_SIZE] },
      { scriptId: 227, args: [uid(C.FRAME), "Admin tools"] }],
  });
  player.getFrameUpdater().clear(uid(C.SEARCH_INPUT));
  player.getPacketSender().sendString("", uid(C.SEARCH_INPUT));
  sender.sendString(state.searchSession, uid(C.SEARCH_SESSION));
  sendRows(player, state, state.tab);
  return true;
}

function beginSearch(player,state) {
  state.searchSession=randomUUID(); state.searchSequence=0;
  state.itemQuery=''; state.items=[]; state.npcs=[]; state.spawnItems=[];state.searchMatches=undefined;state.searchOffset=0;state.searchPages=new Map();
  state.focusSearch=true;
  const sender=player.getPacketSender();
  sender.sendString(state.searchSession,uid(C.SEARCH_SESSION));
  player.getFrameUpdater().clear(uid(C.SEARCH_INPUT));
  sender.sendString('',uid(C.SEARCH_INPUT));
}

function clickSpawnKind({player,buttonId,opId=1}) {
  const state=ready(player);
  if(!state || state.tab!==TAB.SPAWN || opId!==1) return true;
  const component=buttonId&65535;
  const index=component>=C.SPAWN_LABEL_START?component-C.SPAWN_LABEL_START:component-C.SPAWN_START;
  if(index<0 || index>=Layout.SPAWN_LABELS.length) return true;
  cancelPrompt(player,state);
  state.spawnKind=index?'item':'npc'; state.selected=null; state.version++;
  beginSearch(player,state);
  sendRows(player,state,state.tab);
  return true;
}

function spawnSelection(player,state,entry,count,random) {
  if(ready(player)!==state || state.tab!==TAB.SPAWN || state.selected!==entry || state.spawnKind!==entry.spawn.kind) return;
  try {
    const result=Spawn.apply(api,player,{kind:entry.spawn.kind,id:entry.spawn.id,count,random});
    tell(player,result.message);
  } catch(error) {
    tell(player,error.status?error.message:'Spawn failed. Check the server log before trying again.');
    if(!error.status) console.error('[admin-panel] Spawn failed',error);
  }
}

function clickTab({ player, buttonId, opId = 1 }) {
  const state = session(player);
  if (!state || opId !== 1) return true;
  cancelPrompt(player, state);
  state.mapTarget = null;
  state.pickerSlot = null;
  state.tab = buttonId >= uid(C.TAB_LABEL_START) ? buttonId - uid(C.TAB_LABEL_START) : buttonId - uid(C.TAB_START);

  state.selected = null;
  state.version++;
  state.itemQuery = ""; state.items = []; state.npcs = [];
  if([TAB.ITEMS,TAB.SPAWN].includes(state.tab)) beginSearch(player,state);
  sendRows(player, state, state.tab);
  return true;
}

function selectRow({ player, slot, opId = 1 }) {
  const state = session(player);
  const entry = state?.rows.get(slot);
  if (!entry || entry.group || entry.tab !== state.tab) return true;
  if (opId !== 1) return true;
  cancelPrompt(player, state);
  state.version++;
  state.selected = entry;
  if (entry.target) { useTarget(player, state, entry.target); return true; }
  if (entry.place) { teleportRow(player, state, entry); return true; }
  showSelection(player, entry);
  return true;
}

function showSelection(player, entry, panel) {
  const sender = player.getPacketSender();
  if (!panel) {
    const state = sessions.get(player);
    panel = state?.displayRows?.get(entry.id)?.panel;
  }
  if (!panel) return;
  sender.sendInterfaceDisplayState(uid(C.PANEL_EMPTY), true);
  const fields = { title: C.PANEL_TITLE, info: C.PANEL_INFO, info2: C.PANEL_INFO2, description: C.PANEL_DESCRIPTION };
  for (const [key, component] of Object.entries(fields)) {
    player.getFrameUpdater().clear(uid(component)); sender.sendString(panel[key] ?? "", uid(component));
  }
  BUTTONS.forEach(({ button, label }, i) => {
    const value = panel[["primary", "secondary", "third", "fourth"][i]] ?? "";
    player.getFrameUpdater().clear(uid(label)); sender.sendString(value, uid(label));
    sender.sendInterfaceDisplayState(uid(button), !value).sendInterfaceDisplayState(uid(label), !value);
    const actions = entry.skill && [1, 2].includes(i) ? [value, i === 1 ? "-5 levels" : "+5 levels"] : [value];
    sender.sendInterfaceActions(uid(button), actions).sendInterfaceActions(uid(label), actions);
  });
  sender.sendInterfaceDisplayState(uid(C.PANEL_ICON), !(entry.item || entry.held || entry.npc));
  if (entry.item || entry.held) sender.sendItemOnInterface(uid(C.PANEL_ICON), entry.item?.id ?? entry.held.itemId, 0, 1);
}
function teleportRow(player, state, entry) {
  const target = targetOf(player, state);
  if (!target) return;
  let tile;
  try { tile = entry.place.resolve ? entry.place.resolve(target) : [entry.place.x, entry.place.y, entry.place.z]; } catch { tile = null; }
  if (!Teleports.validTile(tile)) { tell(player, "This destination is unavailable. Refresh the teleports list."); return; }
  void apply(player, state, { action: "teleport", x: tile[0], y: tile[1], z: tile[2], preserveInterface: target === player });
}

function cancelPrompt(player, state) {
  const action = state?.prompt;
  if (!action) return;
  state.prompt = null;
  if (player.getEnteredAmountAction() === action || player.getEnteredSyntaxAction() === action) {
    player.getPacketSender().abortInputPrompt();
  }
  action.cancel();
  if(activeContainer(state)==='bank') player.getPacketSender().sendInterfaceDisplayState(uid(C.ADD_ITEMS),true).sendInterfaceDisplayState(uid(C.ADD_ITEMS_LABEL),true);
}

function prompt(player, state, title, amount, callback, options = {}) {
  cancelPrompt(player, state);
  const version = ++state.version;
  const target = state.target;
  let consumed = false;
  const action = { acceptsZero: options.acceptsZero === true, cancel() { consumed = true; }, execute(input) {
    if (consumed) return;
    consumed = true;
    if (state.prompt === action) state.prompt = null;
    if(activeContainer(state)==='bank') player.getPacketSender().sendInterfaceDisplayState(uid(C.ADD_ITEMS),true).sendInterfaceDisplayState(uid(C.ADD_ITEMS_LABEL),true);
    if (ready(player) !== state || state.version !== version || state.target !== target) return;
    callback(input);
  } };
  state.prompt = action;
  if (amount) {
    player.setEnteredAmountAction(action);
    player.getPacketSender().sendEnterAmountPrompt(title);
  } else {
    player.setEnteredSyntaxAction(action);
    player.getPacketSender().sendEnterInputPrompt(title);
  }
  if(activeContainer(state)==='bank') player.getPacketSender().sendString('Cancel',uid(C.ADD_ITEMS_LABEL))
    .sendInterfaceDisplayState(uid(C.ADD_ITEMS),false).sendInterfaceDisplayState(uid(C.ADD_ITEMS_LABEL),false);
}

function confirm(player, state, title, body) {
  tell(player, title);
  prompt(player, state, "Type CONFIRM to apply this change.", false, input => {
    if (String(input).trim().toUpperCase() === "CONFIRM") void apply(player, state, body);
    else tell(player, "Change cancelled.");
  });
}

async function apply(player, state, body, { targetOverride, teleportCommand } = {}) {
  if (ready(player) !== state) return;
  const target = targetOverride ?? targetOf(player, state);
  if (!target) return;
  state.busy = true;
  const editVersion = ++state.version;
  try {
    const result = body.action === "testing" ? await Testing.apply(api, player, target, body)
      : await applyPlayerTool(api, target, body, { actor: player, teleportCommand });
    if (body.action === "container" && body.mode === "add" && state.tab === TAB.ITEMS && state.target === target && state.version === editVersion) { state.tab = TAB.EDITOR; state.selected = null; state.pickerSlot = null; }
    if (body.action === "container" && state.target === target) state.undo = result.undo ? { ...result.undo, target } : null;
    if (target !== player) tell(player, result.message);
    if (session(player) === state && online(target)) sendRows(player, state, state.tab);
  } catch (error) {
    tell(player, error.status ? error.message : "The action failed. Check the server log before repeating a grant.");
    if (!error.status) console.error("[admin-panel] Action failed", error);
  } finally { state.busy = false; }
}

function changeSkill(player, state, entry, delta) {
  const target = targetOf(player, state);
  if (!target) return;
  const skill = core.Skill.values().find(value => value.getName() === entry.skill);
  if (skill) void apply(player, state, { action: "skill", skill: entry.skill, level: target.getSkillManager().getMaxLevel(skill) + delta });
}

function promptSkill(player, state, entry) {
  prompt(player, state, `New ${entry.skill} level for ${state.target.getUsername()}?`, true,
    level => void apply(player, state, { action: "skill", skill: entry.skill, level }));
}

function clickSkill({ player, buttonId, opId = 1 }) {
  const state = ready(player);
  if (!state || state.tab !== TAB.EDITOR || state.section !== SECTION.SKILLS || opId !== 1 || !targetOf(player, state)) return true;
  const index = buttonId - uid(C.SKILL_BUTTON_START);
  const skill = core.Skill.values().find(skill => skill.getIndex() === index);
  const entry = [...state.rows.values()].find(entry => entry.tab === TAB.STATS && entry.skill === skill?.getName());
  if (!entry) return true;
  state.selected = entry;
  sendRows(player, state);
  promptSkill(player, state, entry);
  return true;
}

function clickPreset({ player, buttonId, opId = 1 }) {
  const state = ready(player);
  if (!state || state.tab !== TAB.EDITOR || state.section !== SECTION.SKILLS || opId !== 1 || !targetOf(player, state)) return true;
  const index = PRESETS.findIndex((_, index) => buttonId === uid(C.PRESET_START + index) || buttonId === uid(C.PRESET_LABEL_START + index));
  if (index < 0) return true;
  const [preset, name] = PRESETS[index];
  if (preset === "restore") void apply(player, state, { action: "restore" });
  else confirm(player, state, `${name} skills for ${state.target.getUsername()}?`, { action: "preset", preset });
  return true;
}

function useTarget(player, state, target) {
  if (!online(target)) { tell(player, "Choose an online human player on this world."); return; }
  cancelPrompt(player, state);
  state.mapTarget = null;
  state.target = target;
  state.targetOffline = false;
  state.ids.clear();
  state.selected = null;
  state.items = [];
  state.npcs = [];
  state.undo = null;
  state.itemDestination = "inventory"; state.bankTab = 0; state.pickerSlot = null; state.slotCache = null;
  sendRows(player, state);
  state.selected = [...state.rows.values()].find(entry => entry.target === target) ?? null;
  if (state.selected?.tab === state.tab) showSelection(player, state.selected);
}

function clickAction({ player, buttonId, opId = 1 }) {
  const state = ready(player);
  const entry = state?.selected;
  if (!entry || entry.tab !== state.tab) return true;
  const index = BUTTONS.findIndex(({ button, label }) => buttonId === uid(button) || buttonId === uid(label));
  if (opId !== 1) {
    if (opId === 2 && entry.skill && [1, 2].includes(index)) changeSkill(player, state, entry, index === 1 ? -5 : 5);
    return true;
  }
  if (entry.target) {
    if (index === 0) { useTarget(player, state, entry.target); state.tab = TAB.EDITOR; state.section = SECTION.SKILLS; state.selected = null; sendRows(player, state, state.tab); }
    else if ([1, 2].includes(index)) {
      if (!online(entry.target)) { tell(player, "This player is offline. Refresh the players list."); return true; }
      const destination = index === 1 ? entry.target : player;
      if (destination.getPrivateArea()) { tell(player, "The destination player must leave their private instance first."); return true; }
      const location = destination.getLocation();
      void apply(player, state, { action: "teleport", x: location.getX(), y: location.getY(), z: location.getZ() },
        { targetOverride: index === 1 ? player : entry.target, teleportCommand: index === 1 ? "teleto" : "teletome" });
    }
  } else if (entry.botKey && index === 0) {
    changeBot(player, state, entry.botKey);
  } else if (entry.spawn && [0, 1].includes(index)) {
    if (index === 0) spawnSelection(player,state,entry,1,false);
    else prompt(player,state,`Spawn how many ${entry.spawn.name}? (1-${Spawn.MAX_BATCH})`,true,
      count=>spawnSelection(player,state,entry,count,true));
  } else if (entry.held && [0, 1, 2, 3].includes(index)) {
    if(index===3) { cancelPrompt(player,state); state.selected=null; emptyPanel(player,state); }
    else editSlotQuantity(player,state,entry.held,['set','increase','remove'][index]);
  } else if (entry.item && [0, 1].includes(index)) {
    const body = { action: "container", mode: "add", container: state.itemDestination ?? "inventory", itemId: entry.item.id, bankTab: state.bankTab ?? 0, ...(state.pickerSlot ?? {}) };
    if (index === 0) void apply(player, state, { ...body, quantity: 1 });
    else prompt(player, state, `Quantity of ${entry.item.name} for ${state.target.getUsername()}'s ${body.container}?`, true,
      quantity => void apply(player, state, { ...body, quantity }));
  } else if (entry.skill) {
    if (index === 0) promptSkill(player, state, entry);
    else if (index === 1 || index === 2) changeSkill(player, state, entry, index === 1 ? -1 : 1);
  } else if (entry.preset && index === 0) confirm(player, state, `Apply ${entry.preset} skills to ${state.target.getUsername()}?`, { action: "preset", preset: entry.preset });
  else if (entry.quest && [0, 1].includes(index)) void apply(player, state,
    { action: "quest", quest: entry.quest, mode: index === 0 ? "complete" : "reset" });
  else if (entry.rank && index === 0) confirm(player, state, `Set ${state.target.getUsername()}'s rank to ${entry.rank}?`, { action: "rank", rank: entry.rank });
  else if (entry.testing) {
    const body = { action: "testing", testing: entry.testing, option: index };
    if (index === 1 && ["hp", "prayer", "run", "special"].includes(entry.testing)) {
      prompt(player, state, `New ${entry.testing === "hp" ? "hitpoints" : entry.testing} amount for ${state.target.getUsername()}?`, true,
        amount => void apply(player, state, { ...body, amount }));
    } else void apply(player, state, body);
  }
  return true;
}

function changeBot(player, state, key, value) {
  const message = Bots.act(api, player, state, key, value);
  if (state.botConfig?.transferred) { logout({ player }); return; }
  if (session(player) !== state) return;
  state.botConfig.feedback = message ?? "";
  if (message) tell(player, message);
  state.selected = null;
  player.getFrameUpdater().clear(uid(C.SEARCH_INPUT));
  player.getPacketSender().sendString("", uid(C.SEARCH_INPUT));
  sendRows(player, state, state.tab);
}

function clickBot({ player, buttonId, opId = 1 }) {
  const state = ready(player);
  if (!state || state.tab !== TAB.BOTS || opId !== 1) return true;
  cancelPrompt(player, state);
  const B = BotView.C, component = buttonId & 65535, config = Bots.config(state);
  const category = component >= B.CATEGORY_LABEL && component < B.CATEGORY_LABEL + Bots.CATEGORIES.length
    ? component - B.CATEGORY_LABEL : component - B.CATEGORY;
  if (category >= 0 && category < Bots.CATEGORIES.length) {
    config.category = Bots.CATEGORIES[category]; config.view = config.category === "self" ? "self" : "browse";
    config.feedback = ""; state.selected = null; state.botButtons = new Map();
    player.getFrameUpdater().clear(uid(C.SEARCH_INPUT)); player.getPacketSender().sendString("", uid(C.SEARCH_INPUT));
    sendRows(player, state, state.tab); return true;
  }
  if ([B.BACK, B.BACK_LABEL].includes(component)) {
    config.view = "browse"; if (config.category === "self") config.category = "spawn";
    config.feedback = ""; state.selected = null; state.botButtons = new Map();
    sendRows(player, state, state.tab); return true;
  }
  let key = state.botButtons?.get(component);
  if (config.view === "setup") {
    if ([B.MINUS, B.MINUS_LABEL].includes(component)) key = "count-down";
    else if ([B.PLUS, B.PLUS_LABEL].includes(component)) key = "count-up";
    else if (component === B.COUNT) key = "count";
    else if ([B.LOCATION, B.LOCATION_LABEL].includes(component)) key = "location";
    else if ([B.LEVELS, B.LEVELS_LABEL].includes(component)) key = "levels";
    else if ([B.PRIMARY, B.PRIMARY_LABEL].includes(component)) key = "deploy";
  } else if (config.view === "self" && [B.PRIMARY, B.PRIMARY_LABEL].includes(component)) key = "control:self";
  if (key === "count") prompt(player, state, `Bots to spawn (1-${state.botSnapshot?.limit ?? 20})?`, true, amount => changeBot(player, state, key, amount));
  else if (key === "control:rename") prompt(player, state, "Enter the bot's new display name (up to 12 characters).", false, name => changeBot(player, state, key, name));
  else if (key) changeBot(player, state, key);
  return true;
}

function clickUtility({ player }) {
  const state = ready(player);
  if (!state) return true;
  if (state.tab === TAB.ITEMS) {
    state.selected = null;
    player.getFrameUpdater().clear(uid(C.SEARCH_INPUT));
    player.getPacketSender().sendString("", uid(C.SEARCH_INPUT));
    emptyPanel(player, state);
  }
  else if (state.tab === TAB.TELEPORTS) prompt(player, state, "Enter X Y plane (X/Y 0-16383, plane 0-3).", false, input => {
    const text = String(input).trim();
    if (!/^\d+\s+\d+\s+[0-3]$/.test(text)) { tell(player, "Enter whole X Y plane, for example 3221 3218 0."); return; }
    const [x, y, z] = text.split(/\s+/).map(Number);
    void apply(player, state, { action: "teleport", x, y, z, preserveInterface: state.target === player });
  });
  else sendRows(player, state);
  return true;
}

function openFromEvent(event) {
  if (!eligible(event.player) || !actorOnline(event.player)) return;
  event.handled = true;
  openAdmin(event);
}

function openTeleportMap({ player, opId = 1 }) {
  const state = ready(player);
  if (!state || state.tab !== TAB.TELEPORTS || opId !== 1 || !targetOf(player, state)) return true;
  cancelPrompt(player, state);
  state.mapTarget = state.target;
  const sender = player.getPacketSender();
  if (!sender.isWorldMapOpen()) sender.toggleWorldMap();
  tell(player, `Choose a map or dungeon, then click a tile to teleport ${state.target.getUsername()}. Drag to pan; scroll to zoom.`);
  return true;
}

function mapTeleport(event) {
  const { player, packet } = event, state = sessions.get(player);
  if (packet.type !== "world_map_click" || !state?.mapTarget || event.handled) return;
  event.handled = true;
  const target = state.mapTarget;
  state.mapTarget = null;
  if (ready(player) !== state || state.tab !== TAB.TELEPORTS || state.target !== target || !player.getPacketSender().isWorldMapOpen()) return;
  if (!Teleports.validTile([packet.x, packet.y, packet.level])) { tell(player, "Choose a valid map tile."); return; }
  player.getPacketSender().closeWorldMap();
  void apply(player, state, { action: "teleport", x: packet.x, y: packet.y, z: packet.level, preserveInterface: target === player });
}

function findPlayer({ player }) {
  const state = ready(player);
  if (state) prompt(player, state, "Enter the online player's full name.", false, input => {
    const name = String(input).trim();
    if (!/^[a-zA-Z0-9 _-]{1,12}$/.test(name)) { tell(player, "Enter a player name of 1-12 characters."); return; }
    useTarget(player, state, core.World.getPlayerByName(name));
  });
  return true;
}

function useSelf({ player }) {
  const state = ready(player);
  if (state) useTarget(player, state, player);
  return true;
}

function start(pluginApi) {
  api = pluginApi;
  core = api.core;
}

function searchSocket(event) {
  const packet = event.packet;
  if (packet?.type === "widget_drag") { dragSlot(event); return; }
  if (packet?.groupId !== GROUP_ID || packet.childId !== C.SEARCH_REQUEST || packet.widgetId !== uid(C.SEARCH_REQUEST)) return;
  event.handled = true;
  const { player } = event;
  const state = session(player);
  if (!state || ![TAB.ITEMS, TAB.NPCS].includes(state.tab) || packet.opId !== 1 || typeof packet.target !== "string" || packet.target.length > 300) return;
  let request;
  try { request = JSON.parse(packet.target); } catch { return; }
  const offset=request.offset??0;
  if (request?.session !== state.searchSession || !Number.isSafeInteger(request.sequence) || request.sequence < state.searchSequence
    || typeof request.query !== "string" || request.query.length > 60 || /[^ -~]/.test(request.query)
    || !Number.isSafeInteger(offset) || offset<0 || offset%SEARCH_PAGE_SIZE!==0) return;
  const fresh=request.sequence>state.searchSequence;
  if(!fresh&&(request.query!==state.itemQuery||!state.searchMatches))return;
  if(fresh){
    if(offset!==0)return;
    state.searchSequence = request.sequence;state.itemQuery = request.query;state.selected = null;state.version++;
    for (const [id, entry] of state.rows) if (entry.tab === state.tab) { state.rows.delete(id); state.displayRows?.delete(id); }
    state.items = [];state.npcs = [];state.spawnItems = [];state.searchMatches=[];state.searchPages=new Map();
    emptyPanel(player, state);
  }
  if(!fresh&&offset>=state.searchMatches.length&&offset!==0)return;
  state.searchOffset=offset;
  try {
    if(fresh)state.searchMatches=state.tab===TAB.SPAWN?Spawn.search(api,player,state.spawnKind??'npc',request.query):searchItems(core,request.query);
    sendItemResponse(player, state);
  }
  catch { state.searchMatches=[];sendItemResponse(player, state, true); }
}

function clickSection({ player, buttonId, opId = 1 }) {
  const state = session(player);
  if (!state || ![TAB.EDITOR, TAB.ITEMS].includes(state.tab) || opId !== 1) return true;
  const index = buttonId >= uid(C.SECTION_LABEL_START) ? buttonId - uid(C.SECTION_LABEL_START) : buttonId - uid(C.SECTION_START);
  if (index < 0 || index >= Layout.SECTION_LABELS.length) return true;
  cancelPrompt(player, state);
  state.section = index; state.tab = TAB.EDITOR; state.selected = null; state.version++;
  sendRows(player, state, state.tab);
  return true;
}
function addItems({ player }) {
  const state = ready(player);
  if(state && activeContainer(state)==='bank' && state.prompt) { cancelPrompt(player,state); state.selected=null; emptyPanel(player,state); return true; }
  if (state?.tab === TAB.SPAWN) {
    if((state.spawnKind??'npc')==='npc') try { tell(player,Spawn.clearNpcs(api,player).message); } catch(error) { tell(player,error.message); }
    return true;
  }
  if (state?.tab === TAB.ITEMS) { state.tab = TAB.EDITOR; state.pickerSlot = null; sendRows(player, state, state.tab); return true; }
  if (!state || state.tab !== TAB.EDITOR || ![SECTION.INVENTORY,SECTION.BANK].includes(state.section) || !targetOf(player,state)) return true;
  const name=CONTAINERS[state.section-SECTION.INVENTORY];
  cancelPrompt(player,state);
  state.itemDestination = name;
  state.pickerSlot = null; state.tab = TAB.ITEMS; state.selected = null;
  beginSearch(player,state);
  sendRows(player, state, state.tab);
  return true;
}
function refreshLive({ player }) {
  const state = sessions.get(player);
  if (!state) return;
  if (player.getInterfaceId() !== GROUP_ID || !actorOnline(player)) { logout({ player }); return; }
  if (!session(player) || state.busy || state.tab !== TAB.EDITOR || state.section < SECTION.INVENTORY || state.section > SECTION.BANK) return;
  if (!online(state.target)) {
    if (!state.targetOffline) {
      state.targetOffline = true; state.selected = null; state.version++; state.rows.clear(); state.displayRows.clear();
      DATA_COMPONENTS.forEach(component => player.getPacketSender().sendString("[]", uid(component)));
      player.getPacketSender().sendString(`Target: ${safe(state.target.getUsername())} (offline)`, uid(C.TARGET));
      clearContainer(player, state);
      emptyPanel(player, state);
    }
    return;
  }
  const name = CONTAINERS[state.section - SECTION.INVENTORY];
  const fingerprint = Containers.viewFingerprint(core, state.target, name);
  if (state.containerFingerprint === fingerprint) return;
  state.containerFingerprint = fingerprint;
  state.selected = null;
  sendRows(player, state);
}
function logout({ player }) {
  cancelPrompt(player, sessions.get(player));
  sessions.delete(player);
  if (player.getAttribute(CLOSE_ON_INTERFACE_CLOSE_ATTRIBUTE) === GROUP_ID) player.setAttribute(CLOSE_ON_INTERFACE_CLOSE_ATTRIBUTE, null);
}
function closed({ player, interfaceId }) {
  if (interfaceId === WORLD_MAP_GROUP_ID && sessions.has(player)) sessions.get(player).mapTarget = null;
  if (interfaceId === GROUP_ID) logout({ player });
}
function opened({ player, groupId }) {
  if (groupId !== GROUP_ID && sessions.has(player) && player.getInterfaceId() !== GROUP_ID) logout({ player });
}

function attach(pluginApi) {
  pluginApi.registerCustomInterface(Layout.buildInterface(pluginApi.core.CacheDefinitions.getEnumValues(SKILL_ICON_ENUM), pluginApi.core.CacheDefinitions.getEnumValues(EQUIPMENT_EMPTY_ICON_ENUM)));
  pluginApi.registerCommand("admin", openAdmin, pluginApi.core.PlayerRights.ADMINISTRATOR, "Open the in-game admin panel");
  pluginApi.onInterfaceActionButton(TAB_BUTTONS, clickTab);
  pluginApi.onInterfaceActionButton(BotView.components.map(uid), clickBot);
  pluginApi.onInterfaceActionButton(ROW_BUTTONS, selectRow);
  pluginApi.onInterfaceActionButton(ACTION_BUTTONS, clickAction);
  pluginApi.onInterfaceActionButton(UTILITY_BUTTONS, clickUtility);
  pluginApi.onInterfaceActionButton(ContainerView.slotComponents().map(uid), clickSlot);
  pluginApi.onInterfaceActionButton(Array.from({length:10}, (_,i)=>[uid(V.BANK_TAB_START+i),uid(V.BANK_TAB_LABEL_START+i)]).flat(), clickBankTab);
  pluginApi.onInterfaceActionButton(uid(C.TARGET_BUTTON), findPlayer);
  pluginApi.onInterfaceActionButton(uid(C.SELF_BUTTON), useSelf);
  pluginApi.onInterfaceActionButton(SKILL_BUTTONS, clickSkill);
  pluginApi.onInterfaceActionButton(PRESET_BUTTONS, clickPreset);
  pluginApi.onCustomEvent("player:widget-action", searchSocket);
  pluginApi.onCustomEvent("player:world-input", mapTeleport);
  pluginApi.onCustomEvent("admin:open", openFromEvent);
  pluginApi.onInterfaceActionButton([uid(C.MAP_TELEPORT), uid(C.MAP_TELEPORT_LABEL)], openTeleportMap);
  pluginApi.onCustomEvent("interface:closed", closed);
  pluginApi.onCustomEvent("interface:opened", opened);
  pluginApi.onPlayerLogout(logout);
  pluginApi.onPlayerProcess(refreshLive);
  pluginApi.onInterfaceActionButton(Layout.SECTION_LABELS.flatMap((_, i) => [uid(C.SECTION_START + i), uid(C.SECTION_LABEL_START + i)]), clickSection);
  pluginApi.onInterfaceActionButton([uid(C.ADD_ITEMS), uid(C.ADD_ITEMS_LABEL)], addItems);
  pluginApi.onInterfaceActionButton([uid(C.CONTAINER_ADD), uid(C.CONTAINER_ADD_LABEL)], addItems);
  pluginApi.onInterfaceActionButton(Layout.SPAWN_LABELS.flatMap((_,i)=>[uid(C.SPAWN_START+i),uid(C.SPAWN_LABEL_START+i)]),clickSpawnKind);
  pluginApi.onServerStartup(start.bind(null, pluginApi));
}

module.exports = attach;
module.exports._test = { Layout, TAB, SECTION, BotView };
