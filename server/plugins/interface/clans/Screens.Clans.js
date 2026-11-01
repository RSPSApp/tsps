/**
 * The rest of clan Settings: Interests (691), the outfit (694), Events (703, 704) and Hall settings
 * (692). The archive has no recording of any of them, so this follows the cache's scripts and what
 * they read; how a value is chosen on the Events screen is ours (docs/clans.md).
 */

const Core = require("./Core.Clans");
const Store = require("./Store.Clans");

const MODAL_UID = (161 << 16) | 16;
const POPUP_UID = (690 << 16) | 27;
const OP1_FLAG = 1 << 1;
const EDITING_VARP = 3023; // clan_editing_0, which Interests and the outfit edit

const INTERESTS_GROUP = 691;
const INTERESTS_LIST_UID = (INTERESTS_GROUP << 16) | 7;
const INTERESTS_SCRIPT = 4263; // clan_interests(popup)
const INTERESTS_SETTING = 7; // rsprox 3886 has 65535
const LAST_INTEREST = 15;
const PROFILE_SETTING = 13; // Edit public profile

const OUTFIT_GROUP = 694;
const OUTFIT_SCRIPT = 4431; // clan_outfit(popup)
const OUTFIT_SETTING = 11;
const ICONS_SETTING = 25;

const EVENTS_GROUP = 703;
const events = (child) => (EVENTS_GROUP << 16) | child;
const EVENTS_CREATE = 5;
const EVENTS_EDIT = 6;
const EVENTS_LIST = 9;
const EVENTS_EXIT = 21;
const EVENTS_ROW_SCRIPT = 4407; // clan_events_addevent(slot, canEdit, rank, ?, fields)
const MAX_EVENTS = 10; // the list script's rows
const ORGANISE_EVENTS_SETTING = 21;
const EDITING_PERMITTED_VARBIT = 12200; // clan_editing_permitted
const EDIT_SLOT_VARBIT = 12224; // clans_event_edit_menu_slot, slot + 1

const CREATE_GROUP = 704;
const CREATE_SUBTYPE = 5;
const CREATE_DATE = 7;
const CREATE_TYPE = 9;
const CREATE_TIME = 12;
const CREATE_ACTIVITY = 14;
const CREATE_WORLD = 17;
const CREATE_DURATION = 19;
const CREATE_RANK = 21;
const CREATE_SAVE = 23;
const CREATE_DELETE = 24;
const CREATE_EXIT = 25;
const CREATE_POPUP = (CREATE_GROUP << 16) | 26;
const FIELD_VARBITS = {
  world: 12216,
  activity: 12218,
  type: 12219,
  subtype: 12220,
  date: 12221,
  duration: 12222,
  time: 12223,
  rankPlusOne: 10986,
};
const MAX_EVENT_DAYS = 30; // Wiki: Clan Settings, for both the date and the duration
const TYPE_ACTIVITY_ENUMS = { 0: 3809, 1: 3810, 2: 3811, 3: 3812 };
const TYPE_ENUM = 3808;
const SUBTYPE_ENUM = 3813;
const OPTIONS_PER_PAGE = 4;

const HALL_GROUP = 692;
const HALL_BACK = 4;
const HALL_SAVE = 5;
const HALL_VARP = 3027; // clan_editing_4: home world bit 0, locked 1, player count 2-12, theme 13-16
const HALL_LOCKED_BIT = 1;
const HALL_COUNT_SHIFT = 2;
const HALL_COUNT_MASK = 0x7ff;
const HALL_THEME_SHIFT = 13;
const HALL_THEME_MASK = 0xf;
const DEFAULT_HALL_PLAYERS = 2000; // Wiki: Clan Settings, the highest it can be
const EDIT_HALL_SETTING = 24;

let core = null;
let openSettings = null;
let enumEntries = null;
let showRankPopup = null;
let formatRuneDate = null;

/** What a player is part way through: Hall settings' varp, the Events form. */
const hallEdits = new WeakMap();
const eventForms = new WeakMap();

function init(apiCore, reopenSettings, readEnum, rankPopup, runeDateText) {
  core = apiCore;
  openSettings = reopenSettings;
  enumEntries = readEnum;
  showRankPopup = rankPopup;
  formatRuneDate = runeDateText;
}

function allowed(player, clan, setting) {
  const own = Core.memberOf(clan, Core.accountOf(player));
  return !!own && own.rank >= Core.permissionRank(clan, setting);
}

function setEditing(player, value) {
  player.getPacketSender().sendConfig(EDITING_VARP, value);
}

/** A resume with the popup's answer: 0 is always Cancel (script 614). */
function popupAnswer(player, onAnswer) {
  const sender = player.getPacketSender();
  player.setEnteredAmountAction({
    acceptsZero: true,
    execute(value) {
      sender.closeSubInterface(POPUP_UID);
      if (value !== 0) onAnswer(value);
    },
  });
}

// ---------------------------------------------------------------- Interests

const interestEdits = new WeakMap();

function openInterests(player, clan) {
  if (!allowed(player, clan, PROFILE_SETTING)) {
    player.sendMessage("You are not a high enough rank to edit the clan's interests.");
    return;
  }
  const current = Core.settingValue(clan, INTERESTS_SETTING);
  interestEdits.set(player, current);
  setEditing(player, current);
  const sender = player.getPacketSender();
  popupAnswer(player, () => {
    Core.setSettingValue(clan, INTERESTS_SETTING, interestEdits.get(player) ?? current);
    Core.refreshClan(clan);
    openSettings(player);
  });
  sender.sendSubInterface(POPUP_UID, INTERESTS_GROUP, 1);
  sender.sendInterfaceFlagsRange(INTERESTS_LIST_UID, 0, LAST_INTEREST, OP1_FLAG);
  sender.sendClientScript(INTERESTS_SCRIPT, POPUP_UID);
}

function clickInterests(event) {
  if (event.groupId !== INTERESTS_GROUP) return;
  event.handled = true;
  const { player, slot } = event;
  const held = interestEdits.get(player);
  if (held === undefined || !(slot >= 0 && slot <= LAST_INTEREST)) return;
  const next = held ^ (1 << slot);
  interestEdits.set(player, next);
  setEditing(player, next);
}

function interestNames(clan) {
  const names = enumEntries(3792);
  const held = Core.settingValue(clan, INTERESTS_SETTING);
  return names.filter(([id]) => (held >> id) & 1).map(([, name]) => name);
}

// ---------------------------------------------------------------- Outfit

function openOutfit(player, clan) {
  if (!allowed(player, clan, ICONS_SETTING)) {
    player.sendMessage("You are not a high enough rank to edit the clan's icons.");
    return;
  }
  setEditing(player, Core.settingValue(clan, OUTFIT_SETTING));
  const sender = player.getPacketSender();
  // script4432 answers with the edited value itself.
  popupAnswer(player, (value) => {
    Core.setSettingValue(clan, OUTFIT_SETTING, value);
    for (const member of clan.members) {
      const online = Core.onlinePlayer(member.account);
      if (online) wearColours(online, clan);
    }
    openSettings(player);
  });
  sender.sendSubInterface(POPUP_UID, OUTFIT_GROUP, 1);
  sender.sendClientScript(OUTFIT_SCRIPT, POPUP_UID);
}

/** Wiki: Clan cloak and Clan vexillum, in the motif's colour order. */
const CLOAKS = [25712, 25714, 25715, 25716, 25717, 25718, 25719, 25720];
const VEXILLA = [25721, 25723, 25724, 25725, 25726, 25727, 25728, 25729];
const COLOUR_SHIFT = 20;
const COLOUR_MASK = 0x3ff;

function colourIndex(clan) {
  const stored = (Core.settingValue(clan, OUTFIT_SETTING) >> COLOUR_SHIFT) & COLOUR_MASK;
  return Math.max(0, Math.min(CLOAKS.length - 1, stored - 1));
}

function cloakFor(clan) {
  return CLOAKS[colourIndex(clan)];
}

function vexillumFor(clan) {
  return VEXILLA[colourIndex(clan)];
}

function isVexillum(id) {
  return VEXILLA.includes(id);
}

/** Swaps what a member carries and wears for the clan's colour. */
function wearColours(player, clan) {
  const swap = (container) => {
    let changed = false;
    container.getItems().forEach((item, slot) => {
      const id = item?.getId?.();
      const wanted = CLOAKS.includes(id) ? cloakFor(clan) : VEXILLA.includes(id) ? vexillumFor(clan) : id;
      if (wanted !== id) {
        container.setItem(slot, new core.Item(wanted, item.getAmount()));
        changed = true;
      }
    });
    if (changed) container.refreshItems();
  };
  swap(player.getInventory());
  swap(player.getEquipment());
}

// ---------------------------------------------------------------- Events

function canOrganise(player, clan) {
  return allowed(player, clan, ORGANISE_EVENTS_SETTING);
}

function enumName(id, value) {
  return enumEntries(id).find(([key]) => key === value)?.[1] ?? "";
}

function formatTime(minutes) {
  const hour = String(Math.floor(minutes / 60) % 24).padStart(2, "0");
  return `${hour}:${String(minutes % 60).padStart(2, "0")}`;
}

/** Fields in the order clan_events_addevent reads them. */
function eventFields(event) {
  const activityEnum = TYPE_ACTIVITY_ENUMS[event.type];
  return [
    formatRuneDate(event.date),
    formatTime(event.time),
    event.duration,
    event.world,
    enumName(TYPE_ENUM, event.type),
    activityEnum ? enumName(activityEnum, event.activity) : "",
    enumName(SUBTYPE_ENUM, event.subtype),
    "",
    event.creator,
  ].join("|");
}

function listEvents(player, clan) {
  const sender = player.getPacketSender();
  const list = clan.events ?? [];
  const ownRank = Core.memberOf(clan, Core.accountOf(player))?.rank ?? -1;
  for (let slot = 0; slot < MAX_EVENTS; slot++) {
    const event = list[slot] && ownRank >= list[slot].rank ? list[slot] : null;
    sender.sendClientScript(EVENTS_ROW_SCRIPT, slot, event ? 1 : 0, event?.rank ?? 0, 0, event ? eventFields(event) : "");
  }
}

function openEvents(player, clan) {
  const sender = player.getPacketSender();
  sender.sendSubInterface(MODAL_UID, EVENTS_GROUP, 0);
  sender.sendInterfaceFlagsRange(events(EVENTS_LIST), 0, MAX_EVENTS - 1, OP1_FLAG);
  listEvents(player, clan);
}

function sendForm(player, form) {
  const sender = player.getPacketSender();
  sender
    .sendVarbit(FIELD_VARBITS.world, form.world)
    .sendVarbit(FIELD_VARBITS.activity, form.activity)
    .sendVarbit(FIELD_VARBITS.type, form.type)
    .sendVarbit(FIELD_VARBITS.subtype, form.subtype)
    .sendVarbit(FIELD_VARBITS.date, form.date)
    .sendVarbit(FIELD_VARBITS.duration, form.duration)
    .sendVarbit(FIELD_VARBITS.time, form.time)
    .sendVarbit(FIELD_VARBITS.rankPlusOne, form.rank + 1);
}

function openForm(player, clan, slot) {
  const editing = clan.events?.[slot];
  const form = editing
    ? { ...editing }
    : { world: 1, type: 0, activity: 0, subtype: 0, date: Core.runeDay(), duration: 1, time: 720, rank: -1 };
  eventForms.set(player, { form, slot: editing ? slot : -1 });
  const sender = player.getPacketSender();
  sender.sendVarbit(EDIT_SLOT_VARBIT, editing ? slot + 1 : 0);
  sendForm(player, form);
  sender.sendSubInterface(MODAL_UID, CREATE_GROUP, 0);
}

function askNumber(player, title, onValue) {
  player.setEnteredAmountAction({ acceptsZero: true, execute: onValue });
  player.getPacketSender().sendEnterAmountPrompt(title);
}

/** Paged chatbox options for the form's lists. */
function askOption(player, entries, onChoice, page = 0) {
  const { DialogueChainBuilder, OptionDialogue } = core;
  const shown = entries.slice(page, page + OPTIONS_PER_PAGE);
  const more = page + OPTIONS_PER_PAGE < entries.length;
  const labels = shown.map(([, name]) => name);
  if (more) labels.push("More...");
  player.getDialogueManager().startDialogues(new DialogueChainBuilder().add(
    new OptionDialogue(0, {
      executeOption(option) {
        player.getPacketSender().sendInterfaceRemoval();
        const index = Number(option) - 1;
        if (index === shown.length && more) askOption(player, entries, onChoice, page + OPTIONS_PER_PAGE);
        else if (shown[index]) onChoice(shown[index][0]);
      },
    }, ...labels).setTitle("Select an Option"),
  ));
}

function parseTime(text) {
  const match = /^(\d{1,2}):?(\d{2})$/.exec(text.trim());
  if (!match) return null;
  const [hour, minute] = [Number(match[1]), Number(match[2])];
  return hour < 24 && minute < 60 ? hour * 60 + minute : null;
}

function changeField(player, form) {
  sendForm(player, form);
}

function clickForm(event) {
  if (event.groupId !== CREATE_GROUP) return;
  const { player, childId } = event;
  event.handled = true;
  const clan = Core.clanOf(player);
  const state = eventForms.get(player);
  if (childId === CREATE_EXIT) {
    eventForms.delete(player);
    if (clan) openEvents(player, clan);
    return;
  }
  if (!clan || !state || !canOrganise(player, clan)) return;
  const { form } = state;
  const today = Core.runeDay();
  if (childId === CREATE_TYPE) {
    askOption(player, enumEntries(TYPE_ENUM), (value) => {
      form.type = value;
      form.activity = 0;
      changeField(player, form);
    });
  } else if (childId === CREATE_ACTIVITY) {
    const id = TYPE_ACTIVITY_ENUMS[form.type];
    if (id) {
      askOption(player, enumEntries(id), (value) => {
        form.activity = value;
        changeField(player, form);
      });
    }
  } else if (childId === CREATE_SUBTYPE) {
    askOption(player, enumEntries(SUBTYPE_ENUM), (value) => {
      form.subtype = value;
      changeField(player, form);
    });
  } else if (childId === CREATE_DATE) {
    askNumber(player, `Days from today (up to ${MAX_EVENT_DAYS}):`, (value) => {
      form.date = today + Math.min(value, MAX_EVENT_DAYS);
      changeField(player, form);
    });
  } else if (childId === CREATE_DURATION) {
    askNumber(player, `Duration in days (up to ${MAX_EVENT_DAYS}):`, (value) => {
      form.duration = Math.max(1, Math.min(value, MAX_EVENT_DAYS));
      changeField(player, form);
    });
  } else if (childId === CREATE_WORLD) {
    askNumber(player, "Enter the world:", (value) => {
      form.world = value;
      changeField(player, form);
    });
  } else if (childId === CREATE_TIME) {
    player.setEnteredSyntaxAction({
      execute(text) {
        const minutes = parseTime(String(text ?? ""));
        if (minutes === null) player.sendMessage("Enter the time as 24-hour HH:MM.");
        else {
          form.time = minutes;
          changeField(player, form);
        }
      },
    });
    player.getPacketSender().sendEnterInputPrompt("Enter the UTC time (HH:MM):");
  } else if (childId === CREATE_RANK) {
    showRankPopup(player, "Rank to view this event:", form.rank, -1, Core.RANK_OWNER, false, CREATE_POPUP, (rank) => {
      form.rank = rank;
      changeField(player, form);
    });
  } else if (childId === CREATE_SAVE) saveForm(player, clan, state);
  else if (childId === CREATE_DELETE) deleteEvent(player, clan, state);
}

function saveForm(player, clan, { form, slot }) {
  const list = [...(clan.events ?? [])];
  if (slot < 0 && list.length >= MAX_EVENTS) {
    player.sendMessage("The clan already has as many events as it can list.");
    return;
  }
  const saved = { ...form, creator: list[slot]?.creator ?? player.getUsername() };
  if (slot >= 0) list[slot] = saved;
  else list.push(saved);
  clan.events = list;
  Store.save();
  eventForms.delete(player);
  openEvents(player, clan);
}

function deleteEvent(player, clan, { slot }) {
  if (slot < 0) return;
  clan.events = (clan.events ?? []).filter((_, index) => index !== slot);
  Store.save();
  eventForms.delete(player);
  openEvents(player, clan);
}

function clickEvents(event) {
  if (event.groupId !== EVENTS_GROUP) return;
  const { player, childId, slot } = event;
  event.handled = true;
  const clan = Core.clanOf(player);
  if (!clan) return;
  if (childId === EVENTS_EXIT) openSettings(player);
  else if (!canOrganise(player, clan)) player.sendMessage("You are not a high enough rank to organise events.");
  else if (childId === EVENTS_CREATE) openForm(player, clan, -1);
  else if (childId === EVENTS_EDIT) {
    const editing = player.getAttribute("clans:editing-events") !== true;
    player.setAttribute("clans:editing-events", editing);
    player.getPacketSender().sendVarbit(EDITING_PERMITTED_VARBIT, editing ? 1 : 0);
    openEvents(player, clan);
  } else if (childId === EVENTS_LIST) openForm(player, clan, slot);
}

// ---------------------------------------------------------------- Hall settings

function hallValue(clan) {
  const players = clan.hall?.players ?? DEFAULT_HALL_PLAYERS;
  const locked = clan.hall?.locked ? 1 : 0;
  const theme = clan.hall?.theme ?? 0;
  return (locked << HALL_LOCKED_BIT) | ((players & HALL_COUNT_MASK) << HALL_COUNT_SHIFT) | ((theme & HALL_THEME_MASK) << HALL_THEME_SHIFT);
}

function openHall(player, clan) {
  const value = hallValue(clan);
  hallEdits.set(player, value);
  const sender = player.getPacketSender();
  sender.sendVarbit(EDITING_PERMITTED_VARBIT, allowed(player, clan, EDIT_HALL_SETTING) ? 1 : 0);
  sender.sendConfig(HALL_VARP, value);
  sender.sendSubInterface(MODAL_UID, HALL_GROUP, 0);
}

function clickHall(event) {
  if (event.groupId !== HALL_GROUP) return;
  const { player, childId } = event;
  event.handled = true;
  const clan = Core.clanOf(player);
  if (!clan) return;
  if (childId === HALL_BACK) {
    hallEdits.delete(player);
    openSettings(player);
  } else if (childId === HALL_SAVE) {
    const value = hallEdits.get(player);
    if (value === undefined || !allowed(player, clan, EDIT_HALL_SETTING)) return;
    clan.hall = {
      locked: ((value >> HALL_LOCKED_BIT) & 1) === 1,
      players: (value >> HALL_COUNT_SHIFT) & HALL_COUNT_MASK,
      theme: (value >> HALL_THEME_SHIFT) & HALL_THEME_MASK,
    };
    Store.save();
    hallEdits.delete(player);
    openSettings(player);
  }
}

function varpTransmitted(event) {
  if (event.varpId !== HALL_VARP || !hallEdits.has(event.player)) return;
  hallEdits.set(event.player, event.value);
  event.handled = true;
}

module.exports = {
  cloakFor,
  isVexillum,
  vexillumFor,
  wearColours,
  clickEvents,
  clickForm,
  clickHall,
  clickInterests,
  init,
  interestNames,
  openEvents,
  openHall,
  openInterests,
  openOutfit,
  varpTransmitted,
};
