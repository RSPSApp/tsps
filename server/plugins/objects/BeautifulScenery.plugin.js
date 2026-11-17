"use strict";

/**
 * The Auburn Valley's beautiful scenery (Wiki: Beautiful scenery, Beautiful rock): the beautiful
 * tree stumps, logs and rocks the Vale Totems ents stop to admire. Admire turns the player to it
 * and, a tick later, sits them down (emote_sit_loop) with the message.
 * As RSProx 237/1098 tick 16910 shows: the face at the arrival, the line and the sit at +1, where
 * the league's "Admire some beautiful scenery" completes (`scenery:admired` { player, object }).
 *
 * The message is the Wiki's ("You stop and admire the scenery."); the recording's text is "You stop
 * to admire the scenery." (1098 tick 16911), the recorded difference.
 * Not here: admiring the piece a passing ent admires (20% run energy, the Wiki's other message),
 * which needs the ents' walks between the totem sites.
 */
const NAMES = ["Beautiful tree stump", "Beautiful log", "Beautiful rock"];
const MESSAGE = "You stop and admire the scenery.";
const SIT_TICKS = 1;

let api = null;

function admire({ player, object }) {
  const { core } = api;
  if (object?.getLocation) player.setPositionToFace(object.getLocation());
  const from = player.getLocation().clone();
  core.TaskManager.submit(new core.CountdownTask(player, SIT_TICKS, () => {
    if (!player.isRegistered() || !player.getLocation().equals(from)) return;
    player.getPacketSender().sendTypedMessage(core.ChatType.SPAM, MESSAGE);
    player.performAnimation(new core.Animation(core.CacheDefinitions.getSeqId("emote_sit_loop")));
    api.emitCustomEvent("scenery:admired", { player, object });
  }));
  return true;
}

module.exports = {
  name: "BeautifulScenery",
  description: "Lets players admire the Auburn Valley's beautiful scenery (sitting down to it).",
  members: true,
  _test: { admire, MESSAGE, NAMES },
  register(pluginApi) {
    api = pluginApi;
    for (const name of NAMES) api.onObjectInteraction(name, { Admire: admire });
  },
};
