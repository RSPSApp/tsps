"use strict";

/**
 * ::group, the group panel (Layout.Grouping.js). Its rows go to the player over the game socket,
 * as Commands' do (the search's dataComponent), not through a public content endpoint: who shows
 * on the Find tab depends on who is asking. Every "grouping:changed" re-sends the rows of each
 * player it concerns who has the panel open, so all members see the same list.
 *
 * A row keeps its id for as long as the player is logged in, so a click on a list that has just
 * been refreshed still names the row the player saw.
 */

const Layout = require("./Layout.Grouping");
const Rows = require("./Rows.Grouping");
const Members = require("./Members.Grouping");
const Store = require("./Store.Grouping");
const Actions = require("./Actions.Grouping");
const Leaving = require("./Leaving.Grouping");
const Leadership = require("./Leadership.Grouping");

const { GROUP_ID, MAIN_MODAL_UID, COMPONENT, BUTTONS, uid } = Layout;
const { KIND, ACTION } = Rows;
const TAB = Object.freeze({ GROUP: 0, INVITES: 1, FIND: 2 });
const TAB_UIDS = Layout.TAB_LABELS.map((_, index) => uid(COMPONENT.TAB_START + index));
const ROW_UIDS = [
  ...Array.from({ length: Layout.ROW_SLOTS }, (_, slot) => uid(COMPONENT.ROW_LABEL_START + slot)),
  ...Array.from({ length: Layout.ROW_SLOTS }, (_, slot) => uid(COMPONENT.ROW_BACKGROUND_START + slot)),
];
const BUTTON_UIDS = BUTTONS.map(({ button, label }) => [uid(button), uid(label)]);
const TITLE = "Grouping";
const EMPTY_DESCRIPTION = "Select a row to see what you can do. A group is a leader and up to four members; only the leader invites.";

/** player -> { ids: "kind:target" -> row id, entries: row id -> entry, nextId, selected } */
const views = new WeakMap();

const isOpen = (player) => player?.getInterfaceId?.() === GROUP_ID;

function viewOf(player) {
  let view = views.get(player);
  if (!view) views.set(player, (view = { ids: new Map(), entries: new Map(), nextId: 1, selected: null }));
  return view;
}

function rowId(view, entry) {
  const key = `${entry.kind}:${entry.account ?? entry.groupId ?? ""}`;
  let id = view.ids.get(key);
  if (id === undefined) {
    id = view.nextId++;
    view.ids.set(key, id);
  }
  view.entries.set(id, entry);
  return id;
}

/** The rows of every tab, once, and each tab's order; `active` only when opening. */
function send(player, active = undefined) {
  const me = Members.identify(player);
  if (!me) return;
  const view = viewOf(player);
  const catalog = [];
  const layout = { tabs: Rows.tabs(player, me).map((rows) => rows.map((row) => {
    if (row.header) return { header: row.header };
    const id = rowId(view, row.entry);
    catalog.push({ id, name: row.name, detail: row.detail, panel: row.panel });
    return id;
  })) };
  if (active !== undefined) layout.active = active;
  const sender = player.getPacketSender();
  sender.sendString(JSON.stringify(catalog), uid(COMPONENT.DATA));
  sender.sendString(JSON.stringify(layout), uid(COMPONENT.LAYOUT));
}

/** Shows the buttons the selected row has an action for, and hides the others. */
function showButtons(player, actions) {
  const sender = player.getPacketSender();
  BUTTONS.forEach(({ button, label }, index) => {
    sender.sendInterfaceDisplayState(uid(button), !actions[index]);
    sender.sendInterfaceDisplayState(uid(label), !actions[index]);
  });
}

function showEmptyPanel(player) {
  showButtons(player, []);
  player.getPacketSender()
    .sendString(TITLE, uid(COMPONENT.PANEL_TITLE))
    .sendString("", uid(COMPONENT.PANEL_SUBTITLE))
    .sendString("", uid(COMPONENT.PANEL_INFO))
    .sendString("", uid(COMPONENT.PANEL_INFO2))
    .sendString(EMPTY_DESCRIPTION, uid(COMPONENT.PANEL_DESCRIPTION));
}

/** Opens on the group, or on the invitations when the player has some and no group. */
function open(player) {
  const me = Members.identify(player);
  if (!me) return true;
  const now = Date.now();
  const tab = !Store.groupOf(me.profile, me.account) && Store.invitationsFor(me.profile, me.account, now).length
    ? TAB.INVITES : TAB.GROUP;
  player.setInterfaceId(GROUP_ID);
  player.getPacketSender().sendSubInterface(MAIN_MODAL_UID, GROUP_ID, 0, {
    postScripts: [{ scriptId: 227, args: [uid(COMPONENT.FRAME), TITLE] }],
  });
  viewOf(player).selected = null;
  send(player, tab);
  showEmptyPanel(player);
  return true;
}

/** "grouping:open" { player }. */
function openFor({ player }) {
  open(player);
}

/** "grouping:changed": every player it concerns who has the panel open gets fresh rows. */
function refresh({ players = [] }) {
  for (const player of players) {
    if (!isOpen(player)) continue;
    send(player);
    const me = Members.identify(player);
    const view = viewOf(player);
    const actions = me ? Rows.actionsFor(me, view.entries.get(view.selected)) : [];
    if (actions.length) showButtons(player, actions);
    else {
      view.selected = null;
      showEmptyPanel(player);
    }
  }
}

/** A tab: the client has switched already; the rows are rebuilt so Find shows who is about now. */
function clickTab({ player }) {
  if (!isOpen(player)) return false;
  send(player);
  return true;
}

/** A row's slot carries the id of the row the client showed there. */
function clickRow({ player, slot }) {
  if (!isOpen(player)) return false;
  const me = Members.identify(player);
  const view = viewOf(player);
  const entry = view.entries.get(slot);
  if (!me || !entry) return true;
  view.selected = slot;
  showButtons(player, Rows.actionsFor(me, entry));
  return true;
}

function perform(player, entry, action) {
  switch (action) {
    case ACTION.CREATE: return Actions.create(player);
    case ACTION.LEAVE: return Leaving.leave(player);
    case ACTION.STAY: return Leaving.stay(player);
    case ACTION.DISBAND: return Leadership.disband(player);
    case ACTION.PROMOTE: return Leadership.promote(player, entry.account);
    case ACTION.KEEP_LEAD: return Leadership.cancel(player);
    case ACTION.CANCEL_KICK: return Leadership.unkick(player, entry.account);
    case ACTION.KICK: return Leaving.kick(player, entry.account);
    case ACTION.WITHDRAW: return Actions.withdraw(player, entry.account);
    case ACTION.ACCEPT: return Actions.accept(player, Store.byId(entry.groupId));
    case ACTION.DECLINE: return Actions.decline(player, Store.byId(entry.groupId));
    case ACTION.INVITE: return Actions.invite(player, entry.account);
    default: return false;
  }
}

/** A panel button acts on the selected row, with the action the store allows now. */
function clickButton(player, index) {
  if (!isOpen(player)) return false;
  const me = Members.identify(player);
  const view = viewOf(player);
  const entry = view.entries.get(view.selected);
  const action = me && entry ? Rows.actionsFor(me, entry)[index] : undefined;
  if (action) perform(player, entry, action);
  return true;
}

const clickPrimary = ({ player }) => clickButton(player, 0);
const clickSecondary = ({ player }) => clickButton(player, 1);

module.exports = {
  TAB, TAB_UIDS, ROW_UIDS, PRIMARY_UIDS: BUTTON_UIDS[0], SECONDARY_UIDS: BUTTON_UIDS[1], KIND, isOpen,
  open, openFor, refresh, clickTab, clickRow, clickPrimary, clickSecondary, perform,
};
