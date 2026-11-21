# Account Management tab

The Account Management side tab is interface 109. `server/plugins/interface/AccountManagement.plugin.js`
handles its three tab buttons; the Name Changer (109:51) is in `commands/DisplayName.plugin.js` and
the Bond Pouch (109:37) in `items/Bonds.plugin.js`.

## Tabs

| Button | Component | `account_current_tab` (varbit 10060) |
|---|---|---|
| Account | 109:2 | 0 |
| Community | 109:10 | 1 |
| Useful Links | 109:18 | 2 |

From rsprox captures (local 1001337, 1001364, 1001399, 1001842, 1001944, and rsprox.net 2246):

- The click sets the varbit on the same tick. The client redraws the page from it: the
  interface's onLoad (script 2497) hooks a transmit on varp 1666, which runs script 3268, and that
  reads varbit 10060 into script 3269 (which page and tab highlight show).
- Logging in sends the tab chosen last (tick 0 of 1001337, 1001364, 1001842, 1001944), so the
  choice is saved (attribute `account-management:tab`). The Account tab is the varbit's default, so
  nothing is sent for it at login.

## Not covered

- Live also runs script 2498 `account_info_update` (int, boolean, boolean) on the tab click and
  at many other moments. It sets client varcs (script 1446 sets varc 103 from the first argument)
  for the membership details the pages draw. The server sends none of it today; what the
  arguments mean per account isn't known yet.
- The pages' own buttons (Inbox, Store, polls, news, the Useful Links entries) are client-side or
  open web pages.
