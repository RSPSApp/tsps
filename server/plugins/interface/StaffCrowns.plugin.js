/**
 * The icon before a player's name in chat: a staff crown from their rights, else their account's
 * icon (an Ironman's helmet), which content answers through "account:chat-icon" { player, icon }.
 * A staff crown wins, as in OSRS. "account:refresh-chat-icons" { player } recomputes it when
 * either changes.
 */
const PLAYER_MODERATOR_CROWN = 0;
const JAGEX_MODERATOR_CROWN = 1;

let core;
let pluginApi;
let crownsByRightsId = new Map();

function crownsFor(player) {
  return crownsByRightsId.get(player.getRights?.().getId?.()) ?? [];
}

function applyChatIcons({ player }) {
  const crowns = crownsFor(player);
  if (crowns.length) {
    player.setChatIcons(crowns);
    return;
  }
  const request = { player, icon: null };
  pluginApi.emitCustomEvent("account:chat-icon", request);
  player.setChatIcons(Number.isInteger(request.icon) ? [request.icon] : []);
}

module.exports = {
  name: "StaffCrowns",
  description: "Shows the right chat icon before a player's name: a moderator or admin crown from their rights, else the Ironman icon.",
  register(api) {
    core = api.core;
    pluginApi = api;
    const { PlayerRights } = core;
    crownsByRightsId = new Map([
      [PlayerRights.MODERATOR.getId(), [PLAYER_MODERATOR_CROWN]],
      [PlayerRights.ADMINISTRATOR.getId(), [JAGEX_MODERATOR_CROWN]],
      [PlayerRights.OWNER.getId(), [JAGEX_MODERATOR_CROWN]],
      [PlayerRights.DEVELOPER.getId(), [JAGEX_MODERATOR_CROWN]],
    ]);
    api.onPlayerLogin(applyChatIcons);
    api.onCustomEvent("account:refresh-chat-icons", applyChatIcons);
  },
};
