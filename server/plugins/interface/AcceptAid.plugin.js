// Accept Aid (settings side panel, 116:29 settings_side:acceptaid).
//
// The cache's own script (settings_accept_aid_op) flips varbit option_acceptaid on the client and
// transmits op1; the server owns the setting. It lives in the `accept-aid` attribute that Lunar
// spells, Lunar cures, the clan vexillum and Hunter's shared boosts read (`!== false` accepts).
// Wiki "Accept Aid": Ironmen can't enable it, so they are always set to off and the click is
// refused. The message is the cache's (proc settings_accept_aid); the Wiki's trivia gives it as
// "Iron Women/Men do not accept aid.".
const ACCEPT_AID_ATTRIBUTE = "accept-aid";
const ACCEPT_AID_BUTTON = "settings_side:acceptaid";
const ACCEPT_AID_VARBIT = "option_acceptaid";
const IRONMEN_REFUSED = "Ironmen do not accept aid.";

let pluginApi;

function isIron(player) {
  const query = { player, mode: "none" };
  pluginApi.emitCustomEvent("ironman:mode", query);
  return query.mode !== "none";
}

function acceptsAid(player) {
  return player.getAttribute(ACCEPT_AID_ATTRIBUTE) !== false;
}

function setAcceptAid(player, on) {
  player.setAttribute(ACCEPT_AID_ATTRIBUTE, on);
  const varbit = pluginApi.core.CacheDefinitions.getVarbitId(ACCEPT_AID_VARBIT);
  if (varbit != null) player.getPacketSender().sendVarbit(varbit, on ? 1 : 0);
}

/** The click: the client has already flipped its own copy, so the server's value is sent back either way. */
function toggleAcceptAid({ player }) {
  if (isIron(player)) {
    setAcceptAid(player, false);
    player.sendMessage(IRONMEN_REFUSED);
    return true;
  }
  setAcceptAid(player, !acceptsAid(player));
  return true;
}

/** Login, and an account that becomes an Ironman: Ironmen never accept aid. */
function syncAcceptAid({ player }) {
  setAcceptAid(player, !isIron(player) && acceptsAid(player));
}

function acceptAidButton(api) {
  const id = api.core.CacheDefinitions.getComponentId(ACCEPT_AID_BUTTON);
  if (id == null) throw new Error(`AcceptAid: the cache has no component ${ACCEPT_AID_BUTTON}`);
  return id;
}

module.exports = {
  name: "AcceptAid",
  ACCEPT_AID_ATTRIBUTE,
  register(api) {
    pluginApi = api;
    api.persistAttribute(ACCEPT_AID_ATTRIBUTE, true);
    api.onPlayerLogin(syncAcceptAid);
    api.onCustomEvent("ironman:mode-changed", syncAcceptAid);
    api.onInterfaceActionButton(acceptAidButton(api), toggleAcceptAid);
  },
};
