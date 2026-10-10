# Music progress

Track titles, song archive IDs, unlock-varp banks/bits, and automatically unlocked tracks come from cache DB table 44. Track rows without an unlock slot (or a parent row with a slot) are variants and do not count toward the cape requirement. Rows that share a slot are counted once.

On a successful song packet or an authoritative region change, the Music plugin persists the track's canonical unlock slot and updates its complete native varp bitfield. A successful song packet also sets native current-track varp 3883 to the track's DB-table row ID, then runs cache script 3936 to refresh the Music tab's `Playing:` field. The same script runs when Music actions are bootstrapped after login or the welcome-screen Play button. Login restores unlock bitfields and tracks marked automatically unlocked by the cache. The Music sidebar uses native widget group 239, whose player-side jukebox reads those same unlock varps and only permits playback for unlocked entries.

Olaf the Bard sells the Music cape and hood for 99,000 coins after every non-holiday unlock slot is complete. The cape's Air Guitar emote flag is permanently granted on purchase. Using the cape requires the non-holiday tracks to remain complete; its teleport leads to Falo. Trimming additionally requires every cache-listed music unlock slot, every quest, and every Achievement Diary tier. Holiday status is determined by matching cache track titles against the current OSRS Wiki holiday-track list.

Track unlocks send a message once. No music-unlock jingle is played because its ID has not been verified. Missing quest, event and holiday unlock sources still need implementation; cape requirements include their native slots.
