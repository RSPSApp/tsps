/**
 * The Account Management side tab (interface 109): its three tab buttons, Account, Community and
 * Useful Links, pick the page it shows.
 *
 * rsprox captures (local 1001337, 1001364, 1001399, 1001842, 1001944; 2246): clicking a tab sets
 * varbit 10060 account_current_tab (0 Account, 1 Community, 2 Useful Links) on the same tick, and
 * the client redraws the page from it (the interface's varp 1666 transmit runs script 3268, which
 * reads 10060). Logging in sends the tab the player last chose (tick 0 of 1001337, 1001364, 1001842,
 * 1001944), so it is kept with the save. Clicking the open tab sends nothing new (a varbit is sent
 * only when it changes).
 */

const ACCOUNT_GROUP = 109;
const uid = (child) => (ACCOUNT_GROUP << 16) | child;
/** The cache's tab buttons (109:2, 109:10, 109:18), in tab order. */
const TAB_BUTTONS = [uid(2), uid(10), uid(18)];
const ACCOUNT_CURRENT_TAB_VARBIT = 10060; // account_current_tab (varp 1666 bits 6-7)
const TAB_ATTRIBUTE = "account-management:tab";

function savedTab(player) {
  const tab = Number(player.getAttribute(TAB_ATTRIBUTE));
  return Number.isInteger(tab) && tab >= 0 && tab < TAB_BUTTONS.length ? tab : 0;
}

function sendTab({ player }) {
  if (player.isPlayerBot?.()) return;
  const tab = savedTab(player);
  if (tab !== 0) player.getPacketSender().sendVarbit(ACCOUNT_CURRENT_TAB_VARBIT, tab);
}

function tabClicked({ player, buttonId }) {
  const tab = TAB_BUTTONS.indexOf(buttonId);
  if (tab < 0) return false;
  player.setAttribute(TAB_ATTRIBUTE, tab);
  player.getPacketSender().sendVarbit(ACCOUNT_CURRENT_TAB_VARBIT, tab);
  return true;
}

module.exports = {
  name: "AccountManagement",
  description: "The Account Management tab's Account, Community and Useful Links buttons, with the chosen page kept between logins.",
  register(api) {
    api.persistAttribute(TAB_ATTRIBUTE, 0);
    api.onPlayerLogin(sendTab);
    api.onInterfaceActionButton(TAB_BUTTONS, tabClicked);
  },
  _test: { TAB_BUTTONS, ACCOUNT_CURRENT_TAB_VARBIT, TAB_ATTRIBUTE, tabClicked, sendTab },
};
