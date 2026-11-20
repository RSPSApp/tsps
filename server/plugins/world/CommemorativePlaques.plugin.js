"use strict";

/**
 * The commemorative plaques that open interface cba_plaque: a title and two text columns, the
 * names on the left and what they won on the right, filled by client script
 * killdeathratio_init (498). Both are "Read" locs with fixed text, so the text below is what live
 * sent (rsprox captures):
 *
 * - cba_trophy_2013 "Clan Cup Trophy" on the Giants' Plateau, south of the Emir's Arena
 *   (recording 3172, rev 232, ticks 2856-2870). Wiki (Clan Cup Trophy): "can be read to see all
 *   the winners of the various Clan Cup events".
 * - crackclue_2022_noticeboard "Noticeboard" in Falador (recording 3237, rev 233, ticks
 *   1873-1876): the Crack the Clue III solvers.
 *
 * Live sends, on the tick the player arrives: toplevel_mainmodal_open [-1, -1], the modal, the
 * title, then killdeathratio_init [left, right]. The plaque's Close button (cba_plaque:com_6)
 * closes it on the tick it is clicked (if_closesub, recording 3172 tick 3042).
 */

const INTERFACE_NAME = "cba_plaque";
const TITLE_COMPONENT = "cba_plaque:title";
const CLOSE_COMPONENT = "cba_plaque:com_6";
const SCRIPT_MAINMODAL_OPEN = 2524; // toplevel_mainmodal_open
const SCRIPT_PLAQUE_TEXT = 498; // killdeathratio_init

/** Each plaque loc: its cache name, the title, and the two columns live sent. */
const PLAQUES = [
  {
    loc: "cba_trophy_2013",
    name: "Clan Cup Trophy",
    title: "Old School Clan Cup Winners",
    left:
      "Ancient Fury:<br><br><br><br><br><br>Fatality:<br><br><br><br>Hexis:<br><br><br><br>Stud Unit:<br><br><br><br>" +
      "Final Ownage Elite<br><br><br>Damage Incorperated<br><br><br>Mayhem Makers<br><br><br><br>",
    right:
      "<br>P2P All-Out Champions 2014<br>P2P 30 v 30 Champions 2014<br>P2P 20 v 20 Champions 2014<br>P2P 10 v 10 Champions 2014<br><br><br>" +
      "F2P Pure Champions 2014<br>P2P Pure Champions 2014<br><br><br>" +
      "Skilling Cup Champions 2014<br>Skilling Cup Champions 2015<br><br><br>" +
      "PvM Cup Champions 2014<br>PvM Cup Champions 2015<br><br><br>" +
      "Pure Cup Champions 2015<br><br><br>" +
      "F2P All-Out Champions 2013<br><br><br>" +
      "P2P Pure Champions 2013<br>F2P Pure Champions 2013<br><br><br>",
  },
  {
    loc: "crackclue_2022_noticeboard",
    name: "Noticeboard",
    title: "Crack the Clue III",
    left: "Player who first solved the event:<br><br><br><br><br>Players who contributed to earlier steps:",
    right:
      "<br><br>Spider1357<br><br><br><br><br>wendyes<br><br>dddvlot<br><br>Spider1357<br><br>Detael<br><br>K1SSIN<br><br>" +
      "Juoppokeke<br><br>Xaigg<br><br>1FrostySOB<br><br>GODSLIFE<br><br>Winterpropht<br><br>rururupert<br><br>" +
      "Mistereman22<br><br>Ily Btw<br><br>Belt<br><br>Agent Yolo<br><br>Kexsa<br><br>Fleur de Lis<br><br>lowli fe<br><br>" +
      "MusaUkko<br><br>And a huge shout out to the Crack the Clue discord.<br><br><br><br>",
  },
];

let cache = null;

/** Opens `plaque` for the player in live's packet order. */
function open(player, plaque) {
  const sender = player.getPacketSender();
  sender.sendInterfaceScript(SCRIPT_MAINMODAL_OPEN, [-1, -1]);
  sender.sendInterface(cache.getInterfaceId(INTERFACE_NAME));
  sender.sendString(plaque.title, cache.getComponentId(TITLE_COMPONENT));
  sender.sendClientScript(SCRIPT_PLAQUE_TEXT, plaque.left, plaque.right);
}

/** "Noticeboard" is many locs' name: only the plaque's own loc id opens it. */
function reader(plaque) {
  return (event) => {
    if (event.objectId !== cache.getLocId(plaque.loc)) return false;
    open(event.player, plaque);
    return true;
  };
}

/** The plaque's Close button. */
function close({ player }) {
  player.getPacketSender().sendInterfaceRemoval();
  return true;
}

module.exports = {
  name: "CommemorativePlaques",
  description:
    "Reading the Clan Cup Trophy on the Giants' Plateau or the Crack the Clue III noticeboard in Falador opens the cba_plaque winners list with live's text.",
  members: false,
  register(api) {
    cache = api.core.CacheDefinitions;
    for (const plaque of PLAQUES) api.onObjectInteraction(plaque.name, { Read: reader(plaque) });
    api.onInterfaceActionButton(cache.getComponentId(CLOSE_COMPONENT), close);
  },
  PLAQUES,
};
