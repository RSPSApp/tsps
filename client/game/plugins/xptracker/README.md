# XP Tracker

Enable **XP Tracker** and open its sidebar button. Each skill appears after gaining XP, with session gain and XP/hour. **Reset** resets one skill; **Reset all** resets every tracked skill to its current XP. Rates use online session time, with a one-second minimum denominator.

Sessions are held in memory. Disabling the plugin starts a fresh session when re-enabled. A different local-player account always starts fresh. By default the same account retains gains across relogs: offline time and XP in the login snapshot are excluded. The optional **Reset on logout** setting instead clears gains on reaching the login screen; region loading alone does not clear gains. XP rollback rebases the affected skill. No experience is written to the game/server.

The sidebar is registered and removed through ClientToolbar in plugin lifecycle. Skill values are read from the client's CS2 stat API after ordered game ticks, using the first connected tick as a baseline.
