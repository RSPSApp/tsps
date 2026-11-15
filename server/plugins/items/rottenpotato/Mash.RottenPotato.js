"use strict";

/**
 * Rotten potato > Mash (Wiki: Rotten potato): Keep me logged in., Kick me out., Kill me. and Transmogrify me...
 *
 *   Keep me logged in.  "disables the inactivity timer". This server has no inactivity logout, so it
 *                       only says so; live's side effect (the logout button stops working) isn't copied.
 *   Kick me out.        logs out.
 *   Kill me.            the Wiki names it only; hitpoints go to 0 and the normal death follows.
 *   Transmogrify me...  "an NPC/object/item from a pre-defined list". Only NPC forms exist here
 *                       (as ::pnpc), so it asks for an NPC id, or turns the player back.
 */
const Common = require("./Common.RottenPotato");

const TITLE = "Mash";
const TRANSMOGRIFY_TITLE = "Transmogrify me...";
const NO_TRANSFORMATION = -1;

function mash({ player }) {
  if (!Common.permitted(player)) return;
  Common.menu(player, TITLE, [
    ["Keep me logged in.", keepLoggedIn],
    ["Kick me out.", kickOut],
    ["Kill me.", kill],
    ["Transmogrify me...", transmogrifyMenu],
  ]);
}

function keepLoggedIn(player) {
  player.sendMessage("You will not be logged out for inactivity.");
}

function kickOut(player) {
  player.requestLogout();
}

function kill(player) {
  player.setHitpoints(0);
}

function transmogrifyMenu(player) {
  Common.menu(player, TRANSMOGRIFY_TITLE, [
    ["Into an NPC...", askNpc],
    ["Back to normal.", untransform],
  ]);
}

function askNpc(player) {
  Common.askNumber(player, "Enter NPC id:", (id) => transform(player, id));
}

function transform(player, id) {
  if (!Common.npcName(id)) {
    player.sendMessage(`There is no NPC ${id}.`);
    return;
  }
  setTransformation(player, id);
}

function untransform(player) {
  setTransformation(player, NO_TRANSFORMATION);
}

function setTransformation(player, id) {
  player.performAnimation(Common.getCore().Animation.DEFAULT_RESET_ANIMATION);
  player.setNpcTransformationId(id);
}

module.exports = function attach(api) {
  api.onItemAction(Common.POTATO_NAME, { Mash: mash });
};
