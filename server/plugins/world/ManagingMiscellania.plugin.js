"use strict";

/**
 * Managing Miscellania: the kingdom Throne of Miscellania hands the player. Subjects paid from
 * the coffers gather coal, maple logs, herbs or flax, fish, and (after Royal Trouble) hardwood and
 * farm seeds every day, more with higher approval; Advisor Ghrim collects it to the bank. Each
 * unit lives in ./managingmiscellania/; add one line per unit.
 *
 * Wiki: https://oldschool.runescape.wiki/w/Managing_Miscellania
 */

const Common = require("./managingmiscellania/Common.ManagingMiscellania");
const Interface = require("./managingmiscellania/Interface.ManagingMiscellania");
const Ghrim = require("./managingmiscellania/Ghrim.ManagingMiscellania");
const Approval = require("./managingmiscellania/Approval.ManagingMiscellania");
const Session = require("./managingmiscellania/Session.ManagingMiscellania");

module.exports = {
  name: "ManagingMiscellania",
  description: "Managing Miscellania: pay the kingdom's coffers and Advisor Ghrim collects daily coal, logs, herbs, flax, fish, hardwood and seeds, scaled by approval.",
  members: true,
  register(api) {
    Interface(api);
    Ghrim(api);
    Approval(api);
    Session(api);
  },
  /** For server/tests/managing-miscellania.test.cjs. */
  _test: {
    Common,
    Interface: Interface._test,
    Ghrim: Ghrim._test,
    Approval: Approval._test,
    Session: Session._test,
  },
};
