# Optional banking between Maggot King trips

The Sangvesti chest is an optional rebanking stop on the Maggot trip route. It is not a new prerequisite for entering the lair or reclaiming a grave. The existing quest/world access routes remain responsible for access.

The OSRS Wiki Maggot King/Strategies revision15402578 describes banking here or elsewhere before returning to the scout. Bank chest (amenity) revision15402269 specifies boostable70Construction, a hammer and saw,1magic stone,2cupronickel bars,2adamantite bars and4ironwood planks,1787baseConstructionXP and3ticks. IDs and anchor come from the retained cache2757/rev242: root62185 at2576,7833,0, visible62186/62187, player varbit15621 in varp4968 bit28.

The plugin keeps a registered boolean attribute per player and projects it into that one varbit. It leaves the shared cache object in place. The existing generic Bank action handles the built chest; Collect remains outside this module. Construction tools, crystal-saw boost/needed charge, carried storage and material-discount hooks retain their existing helper behavior. The outfit multiplier is requested once before the ordinary XP policy.

The three-tick deferred commit is a repository decision: once the ordinary reached Build operation starts, ticks1/2 have no costs; tick3 revalidates and consumes the full recipe once before publishing built state and XP. Movement, another interaction, attack/item interruption, logout/disconnect, death or shutdown cancel pending work. Losing tools, materials or the needed boost before commit prevents payment. Repeated/stale/reentrant operations cannot reopen a committing token. This is synchronous game-state handling, not a promise of arbitrary hook-error rollback or crash-atomic backend persistence.

Inspect/refusal/completion lines are repository-owned. No exact retail message, animation or commit-order capture is claimed.

The existing native Maggot fixture is extended with map/listener/dispatch/route/task checks and explicit supplied-state edge controls. At source preparation it has passed syntax checking only: no resupply baseline, native run, gameplay success or Ready result exists yet. Future save evidence must distinguish registered snapshot/attribute JSON/apply/login hooks from actual disk/backend/socket/fullfile relog. Supplied eligible standing/quest state does not prove scout rescue/travel, decoded packets or client rendering. Earlier exactc327135PASS concerns the separate merged restore bridge, not this source or its current-main integration.
