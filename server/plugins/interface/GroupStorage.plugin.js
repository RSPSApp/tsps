"use strict";

/**
 * Group Ironman's shared group storage (server/docs/group-storage.md) behind Grouping's "Group
 * storage" chests: 80 spaces per group (more, up to 200, as content unlocks them through
 * "group-storage:capacity"), one member in it at a time, changes made on copies and kept only by
 * Save, members' items fixed in place on free-to-play worlds, and leavers able only to deposit. The
 * interface is the cache's own (shared_bank 724, shared_bank_side 725).
 *
 * Talks to Grouping only through its events: "grouping:storage" (the door), "grouping:get" (who
 * may still use it), "grouping:can-end" (a group with stored items can't end) and
 * "grouping:changed" (a removed member or an ended group closes the storage).
 */

const Access = require("./groupstorage/Access.GroupStorage");
const Buttons = require("./groupstorage/Buttons.GroupStorage");
const Items = require("./groupstorage/Items.GroupStorage");
const Session = require("./groupstorage/Session.GroupStorage");
const Store = require("./groupstorage/Store.GroupStorage");
const View = require("./groupstorage/View.GroupStorage");

module.exports = {
  name: "GroupStorage",
  description: "Group Ironman's shared group storage at the Group storage chests: 80 spaces (up to 200 with unlocks), one member at a time, Save to keep changes, deposit-only for leavers, members' items fixed on free-to-play worlds.",
  register(api) {
    Access.init(api);
    Buttons.init(api);
    Items.init(api);
    Session.init(api);
    View.init(api);
    api.onCustomEvent("grouping:storage", Access.open);
    api.onCustomEvent("grouping:can-end", Access.canEnd);
    api.onCustomEvent("group-storage:popup-closed", Access.popupClosed);
    api.onCustomEvent("grouping:changed", Access.groupChanged);
    api.onCustomEvent("interface:closed", Access.interfaceClosed);
    api.onCustomEvent("player:widget-action", Buttons.drag);
    api.onInterfaceActionClick(Buttons.click);
    api.onPlayerLogout(Access.logout);
  },
  _test: { Access, Buttons, Items, Session, Store, View },
};
