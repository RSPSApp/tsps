# XP Tracker

Enable **XP Tracker** and open its sidebar button. Each skill appears after gaining XP, with session gain and XP/hour. **Reset** resets one skill; **Reset all** resets every tracked skill to its current XP. Rates use online session time, with a 60-second minimum denominator, including after reset. This minimum matches `XpStateSingle.getTimeElapsedInSeconds` in the pinned RuneLite 1.13.3 runtime.

Sessions are held in memory. Disabling the plugin starts a fresh session when re-enabled. A different local-player account always starts fresh. By default the same account retains gains across relogs: offline time and XP in login/reconnect snapshots are excluded. The optional **Reset on logout** setting instead clears gains on reaching the login screen. A normal region load retains its online time and XP gains; loading after a login or reconnect still waits for a fresh baseline. XP rollback rebases the affected skill. No experience is written to the game/server.

The sidebar is registered and removed through ClientToolbar in plugin lifecycle. Skill values are read from the client's CS2 stat API after ordered game ticks, using the first connected tick as a baseline.

This is a session-gain/rate tracker, not a complete RuneLite XP Tracker port: saved sessions, overall tracking, goals/actions and canvas overlays are not implemented. Regression checks: `tsx tests/xp-tracker-session.test.ts` and `tsx tests/offline-utility-plugins.test.ts` from `client`.
