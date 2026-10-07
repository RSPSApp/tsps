# Energy threshold to re-enable running

Settings → Controls → "Energy threshold to re-enable running" (setting 389) is handled by `server/plugins/interface/RunAutoEnable.plugin.js`. Its tooltip (cache struct 1013): "After your run energy has naturally depleted, you will automatically start running again once you have this much energy. Set to 0 to stop auto-enabling." At 0 the setting reads "Do not enable".

## From an rsprox capture

**Changing the setting:**
1. Clicking the row (134:20) sets `floater_chatbox_opened` (varbit 16075) = 1 and `busy` = 1, then asks "Set energy threshold for auto-enabling run mode:" (script 108, a number prompt).
2. On the answer (`resume_p_countdialog`), `runenergy_autoenable` (varbit 11031) is set to the number, which is the energy percentage. Then 16075 and `busy` go back to 0.
3. Answering 0 turns it off. The server's amount handler drops 0 unless the prompt accepts it (`acceptsZero`).

**The auto-enable:**
- Running out of energy switched run off (`option_run`, varp 173: 1 → 0), and the player walked on.
- 22 ticks later, with the threshold at 5%, run switched back on (`option_run` 0 → 1) while still walking.
- There was no message, and the walk simply carried on as a run, so movement isn't interrupted.

## Rules

- **Only run that ran out counts:** the player was running last tick and isn't now, at 1% energy or less. On the tick run runs out, the same tick's recovery has often already added 1%: once the player stops running, energy starts coming back straight away.
- **Turning run off by hand is never overridden.** Turning it on by hand clears the wait.
- **The threshold is saved** and sent on login.

Other plugins can own a setting the same way. Settings emits `settings:setting-clicked` `{ player, settingId, handled }` for every row clicked.
