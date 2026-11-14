/**
 * NPC Contact's contact list (lunar_contact_npc, interface 75) and what a contact does (docs/npc-contact.md).
 *
 * The spell (LunarSpells.ts) pays 7 ticks after the click and emits magic:npc-contact; this opens the list in the main
 * modal as live does (rsprox 4045, rev 237: toplevel_mainmodal_open [-1, -1], then the modal). The client builds the
 * list itself from the cache's npc_contact table (cs2 1190/2094, its heads and greyed-out contacts from quest state,
 * 9733), and a contact's "Contact" op runs cs2 9732, which sends if_triggeroplocal on 75:4 with [contact_id, alt]
 * (alt is 1 only for Amy's contract op). Picking one sets lunar_contact_lastid to the contact_id, closes the list and
 * opens the contact's conversation at once (rsprox 4045 tick 716, 4056 tick 808).
 *
 * A contact the cache shows locked (cs2 9733's conditions, LOCKED below) is refused here too: the greyed-out row still
 * has its Contact op, so the trigger alone proves nothing.
 *
 * magic:npc-contact-selected { player, name, contactId, handled } lets content answer a contact first (While Guthix
 * Sleeps' recruitment); otherwise the contact's NPC talks through npc-dialogue:start, from data/npc-contact.json.
 */
const fs = require("fs");
const path = require("path");
const { triggerInts } = require("./widgetGroup");

const INTERFACE = 75;
/** lunar_contact_npc:scrolllayer, the component cs2 9732 triggers. */
const CONTACT_LIST = (INTERFACE << 16) | 4;
const SCRIPT_MAINMODAL_OPEN = 2524;
const LAST_CONTACT_VARBIT = 5006; // lunar_contact_lastid
const TABLE = "npc_contact";

/**
 * cs2 9733, contact_id -> when the contact is locked (its greyed-out head, npc_contact column 7, with no alternate name).
 * Its other conditions pick an alternate NPC, not a lock: Turael/Mazchna/Duradel (wgs_hero_part_1_vis) and Nieve
 * (mm2_slayer_master). Lanthus, Vannaka and Chaeldar are never locked.
 */
const LOCKED = {
  1: (p) => base(p, "COOKING") < 40, // Honest Jimmy
  2: (p) => varbit(p, "handsand_quest") < 160, // Bert the Sandman
  4: (p) => varp(p, 359) < 100, // Advisor Ghrim
  5: (p) => varp(p, 492) < 4, // Dark Mage
  22: (p) => varbit(p, "porcine") < 40, // Spria
  18: (p) => varbit(p, "wilderness_master_warning") === 0, // Krystilia
  20: (p) => varbit(p, "konar_spoken") === 0, // Konar
  23: (p) => varbit(p, "mortimer_introduction") === 0, // Mortimer
  12: (p) => base(p, "FISHING") < 15, // Murphy
  13: (p) => varbit(p, "dream_prog") < 16 || varbit(p, "wgs") > 660, // Cyrisus
  14: (p) => varbit(p, "zeah_playerhasvisited") === 0, // Smoggy
  15: (p) => varbit(p, "zeah_shayzien_metcrimefighter") === 0, // Ginea
  16: (p) => varbit(p, "trail_watson_spoken") === 0, // Watson
  19: (p) => varp(p, 77) !== 2 && varp(p, 76) < 6, // Barbarian Guard
  21: (p) => varbit(p, "con_contract_discussed") === 0, // Amy
  17: (p) => varbit(p, "dream_prog") < 28, // Random
};

let core = null;
let api = null;
/** contact_id -> { name, npcId, variant }. */
let contacts = null;

function loadContacts() {
  const { CacheDefinitions } = core;
  const config = JSON.parse(fs.readFileSync(path.join(__dirname, "data", "npc-contact.json"), "utf8")).contacts;
  const table = CacheDefinitions.getDbTableId(TABLE);
  if (table === null) throw new Error(`NPC Contact: the cache has no ${TABLE} table`);
  const contactColumn = CacheDefinitions.getDbColumn(table, "contact_id");
  const nameColumn = CacheDefinitions.getDbColumn(table, "name");
  const loaded = new Map();
  for (const row of CacheDefinitions.getDbTableRows(table)) {
    const contactId = row.int(contactColumn, -1);
    const entry = config[String(contactId)];
    let npcId = null;
    if (entry) {
      npcId = CacheDefinitions.getNpcId(entry.npc);
      if (npcId === null || npcId === undefined) throw new Error(`NPC Contact: no NPC ${entry.npc}`);
    }
    loaded.set(contactId, { contactId, name: row.string(nameColumn), npcId, variant: entry?.variant });
  }
  return loaded;
}

function getContacts() {
  contacts ??= loadContacts();
  return contacts;
}

function base(player, skill) {
  return player.getSkillManager().getMaxLevel(core.Skill[skill]);
}

function varbit(player, name) {
  const id = core.CacheDefinitions.getVarbitId(name);
  if (id === null || id === undefined) throw new Error(`NPC Contact: no varbit ${name}`);
  return player.getPacketSender().getVarbit(id);
}

function varp(player, id) {
  return player.getPacketSender().getVarp(id);
}

/** Whether the cache shows this contact locked (greyed out) for the player. */
function locked(player, contactId) {
  return LOCKED[contactId]?.(player) === true;
}

function open({ player }) {
  const sender = player.getPacketSender();
  sender.sendInterfaceScript(SCRIPT_MAINMODAL_OPEN, [-1, -1]);
  sender.sendInterface(INTERFACE);
}

function talk(player, contact) {
  if (contact.npcId === null) return false;
  const request = { player, npc: null, npcId: contact.npcId, handled: false };
  if (contact.variant) {
    request.variant = contact.variant;
    request.exact = true;
  }
  api.emitCustomEvent("npc-dialogue:start", request);
  return request.handled === true;
}

function choose(event) {
  if (!event.scriptTrigger || event.buttonId !== CONTACT_LIST) return;
  const { player } = event;
  if (player.getInterfaceId?.() !== INTERFACE) return;
  const [contactId] = triggerInts(event.argsData);
  const contact = getContacts().get(contactId);
  if (!contact) return;
  event.handled = true;
  // Ours: no capture clicks a locked contact; the list stays open and nothing is sent.
  if (locked(player, contactId)) return;
  player.getPacketSender().sendVarbit(LAST_CONTACT_VARBIT, contactId).sendInterfaceRemoval();
  const selected = { player, name: contact.name, contactId, handled: false };
  api.emitCustomEvent("magic:npc-contact-selected", selected);
  if (selected.handled || talk(player, contact)) return;
  // Ours: no capture or transcript gives these contacts' answers yet (docs/npc-contact.md, "Not covered").
  player.sendMessage(`You contact ${contact.name}.`);
}

module.exports = {
  name: "NpcContact",
  description: "NPC Contact's contact list (interface 75) and the conversation each contact opens.",
  members: true,
  _test: { open, choose, talk, locked, getContacts, LOCKED, INTERFACE, CONTACT_LIST, LAST_CONTACT_VARBIT,
    init(pluginApi) { api = pluginApi; core = pluginApi.core; contacts = null; } },
  register(pluginApi) {
    api = pluginApi;
    core = pluginApi.core;
    api.onCustomEvent("magic:npc-contact", open);
    api.onInterfaceActionClick(choose);
  },
};
