# Echo Grotesque Guardians placeholder

The Echo adapter reuses the ordinary four-phase Guardians fight. This is explicitly a
temporary placeholder, not a recreation of live Echo mechanics. The roof spawns the normal
Guardians, and the shared Echo boss service ([docs/echo-bosses.md](../../../../docs/echo-bosses.md))
gives each instance its Echo appearance, HP, levels, bonuses and attack speed. Dawn's
documented melee slash uses her Echo maximum; her ranged/stone attacks and Dusk's ordinary
attacks retain their normal caps. The documented Echo flame cone, multi-orb and wall attacks
are not implemented and their max hits are not assigned to unrelated ordinary attacks.

The normal roof unlock and bell flow are retained. Echo entry waives the Slayer task,
preserves the orb, and runs in a player-private roof. Both guardians take the normal phase
forms and are re-dressed when their Echo role changes; Dusk's size-6 phase 4 has no Echo form
and keeps its normal look. Half-health boundaries use each creature's actual maximum
HP, so Echo Dusk's larger HP is not truncated at the ordinary 225 boundary.

Only the final Dusk defeat completes the Echo encounter. It rolls the normal Guardians table
once, and the central service adds the Echo equipment roll and progression; ordinary guardian KC, personal
bests and Slayer XP are not granted by the placeholder's normal reward handlers. Leaving,
disconnecting, death and roof expiry clear the fight and release the encounter token.

Verification extends `server/tests/grotesque-guardians.test.cjs`, alongside the shared Echo
service suite. No live Echo mechanics should be inferred from this implementation.
