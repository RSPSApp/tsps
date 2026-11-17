"use strict";

/**
 * ::gim on its own (or ::gim info) says what the player's Group Ironman group is: its mode,
 * whether it is formed, its prestige and lives, and the player's own limits. ::gim form forms it
 * (the leader), ::gim form noprestige without Group Prestige.
 */

const Common = require("./Common.GroupIronman");
const Variants = require("./Variants.GroupIronman");
const Wealth = require("./Wealth.GroupIronman");

const USAGE = "Use ::gim, ::gim info, ::gim form or ::gim form noprestige.";

function describe(player) {
  const { group, member } = Common.groupOf(player);
  if (!group?.ironman) return Common.tell(player, "notIronGroup");
  const record = Variants.recordFor(group);
  const parts = [
    Common.data.variants[record.variant].label,
    record.formed ? "formed" : "forming (::gim form)",
    record.prestige ? "Group Prestige" : "no Group Prestige",
  ];
  if (record.variant === "hardcore" && record.formed) parts.push(`${record.lives} ${record.lives === 1 ? "life" : "lives"} left`);
  if (record.formed) {
    parts.push(record.originals.includes(member?.account) ? "you have Individual Prestige" : "you have no Individual Prestige");
  }
  const left = Wealth.remaining(player);
  if (left !== null) parts.push(`you may receive ${left.toLocaleString("en-GB")} coins' worth more this week`);
  player.getPacketSender().sendMessage(`Group Ironman group: ${parts.join(", ")}.`);
  return true;
}

function run({ player, parts = [] }) {
  const [, word = "", option = ""] = parts.map((part) => String(part).toLowerCase());
  if (word === "" || word === "info") describe(player);
  else if (word === "form") Variants.form(player, option === "noprestige");
  else player.getPacketSender().sendMessage(USAGE);
  return true;
}

module.exports = { USAGE, describe, run };
