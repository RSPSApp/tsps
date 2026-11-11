# The Ides of Milk

Sources: [issue 600](https://github.com/RSPSApp/tsps/issues/600), [RSProx 4153](https://rsprox.net/download/4153), [OSRS Wiki quest guide](https://oldschool.runescape.wiki/w/The_Ides_of_Milk), [Brutus](https://oldschool.runescape.wiki/w/Brutus), and [Brutus strategy](https://oldschool.runescape.wiki/w/Brutus/Strategies). The Wiki strategy was also accessible through its [attributed mirror](https://osrsindex.com/wiki/brutus-strategies?site=osrs_wiki). Only sanitized gameplay facts are retained; recordings and account information are excluded.

## Captured progression

Recording 4153 uses revision 238. Revision 241 cache gamevals confirm `cowquest` varbit 20106 in parent 5412, with Gillie/Seth information at 20107/20108, reward collection at 20109 and lamp use at 20110. These sibling fields must survive every quest update.

| Event | Main state |
| --- | --- |
| Accept Cassius's proposal | 1 |
| Player says “Of milk.” | 2 |
| Cassius explains the research | 3 |
| Learn from both Groatses | 4 |
| Hand over the book | 5 |
| Receive first milk sample | 6 |
| Drink it | 8 |
| Receive the permit sample | 10 |
| Duke refers the player to Gillie | 12 |
| Gillie asks the player to drink | 14 |
| Drink the second sample | 16 |
| Agree to deal with the bull | 18 |
| Kill Brutus | 20 |
| Tell Gillie whose bull it was | 21 |
| Confront Cassius and complete | 22 |

The first sample plays animation 829 immediately, then cough 11267 and one nonlethal poison-coloured hit three ticks later. Resuming its dialogue never deals the damage twice. The second drink requires the player to be near Gillie on the same plane and deals no damage. Dialogue state changes run when their line appears, so closing an earlier line cannot advance the quest.

The four-page Groats book uses interface 392 and the shared book reader. Shelf access requires Seth's information; reading the book does not advance the quest. Cassius takes the book before giving the first sample. Completion awards one quest point, uses sample model 33130 and jingle 154, and requires Gillie's report before the final confrontation. Gillie supplies the amulet and lamp afterward. The lamp grants 1,000 XP to a combat skill, including Prayer; duplicate or forged noncombat confirmations are rejected.

Existing saved internal stages migrate once to the captured state values. Existing information and reward attributes remain compatible, and all client fields synchronize at login.

Recording 4153 contains no camera movement, look-at or shake packets during the quest route (cycles 111–734). Its bull-release transition uses fades and scene actors while retaining the player's camera.

## Bull encounter

The north-east Release gate starts a private copy of the cow field. At two ticks, the player moves to (3262,3294), the pen and south-west exit leaves change locally, and Brutus 15626 appears at (3261,3287) with 58 Hitpoints and animation 13790. Controls unlock at four ticks. The local replacements hide the world's current leaves, including gates already swung open onto other tiles; leaving restores the current world state, including changes during the fight. Other players' gates, cows and fights are unaffected. The mapped pen bull is not a combat shortcut. Cassius and the mapped bull have canonical world spawns; their spawn anchors are inferred from the recording's roaming envelope.

Melee uses animation 13783, five-tick recovery and a maximum hit of three. During the quest, melee cannot take the player below one Hitpoint. Specials use eight-tick recovery, the captured overheads, charge animation 13778 and stomp 13785. Delayed damage checks the player's new position. The recorded charge moves four tiles south; the implementation also handles the horizontal facing axis. Stomp graphic 3588 follows the selected three-tile row or five-tile corner. Each snort selects a fresh footprint from the bull and target's current positions, then holds it through that stomp's windup. In recording 4153, the third snort at tick 602 turns and impacts a different corner at tick 606. Special damage can kill.

Recording 4153 sends an exact move at cycle 562, from four tiles north to the destination over 60 client cycles (two ticks), after its cycle-558 growl. A plain NPC teleport is excluded from the player's local list for its placement tick; Brutus now uses the existing exact-move path so the charge stays visible. Ordinary pursuit remains blocked until the glide finishes. The postquest three-tick windup remains the existing behavior; this recording covers the quest's four-tick windup.

The boss temporarily owns coordinate facing through `combat:keep-facing`, clearing entity tracking during its telegraph. Live restores entity tracking at cycle 564 after that charge and six ticks after each recorded stomp (586 to 592, 594 to 600). Recovery releases the held heading and restores the same living encounter's current target; death, leaving, replacement or retargeting cannot reattach the old player. This also forces a fresh native entity-face update instead of leaving the proxy's coordinate-facing state until the next movement.

Charges check the bull's swept 3x3 footprint against the cache's walls, including diagonal fences, and keep it inside its existing private field. The bull holds its position during the charge windup even if the player sidesteps. A blocked charge is rejected in full: adjacent players get a stomp, while a distant player brings ordinary melee pursuit back into range. Interior scenery remains passable during a charge, as the Wiki describes; the Plant at (3257,3289) is a regression control. The private field's southern boundary remains an instance constraint, not a claimed OSRS fence location.

Quest kills suppress normal loot, return the player from the private field, and show the Brutus tag once as both game message and continued statement. Postquest kills retain the field and its loot; canonical respawn is 36 ticks and ringing the cowbell restarts the wait at 13 ticks. Cancelled timers cannot spawn duplicates after a subsequent kill. The reported RuneLite respawn-overlay mismatch is tracked separately in [issue 2164](https://github.com/RSPSApp/tsps/issues/2164); retest after the charge visibility repair before assuming a separate integration defect. Brutus grants double normal combat XP. Leaving or logging out clears private actors, tasks and busy flags.

Cowbell charging, worn actions, Ring sounds and milking are documented in [the Lumbridge/Vampyre evidence notes](f2p-lumbridge-vampyre.md#cowbell-amulet-follow-up).

## Brutus after the quest (2026-11-11)

The progress tracker's Brutus rows (4 November) listed the repeatable post-quest fight, the Demonic variant and the drop
tables as not built. All three are on main (this page, `npc-drops.json`: `brutus` and `demonic_brutus`, the Wiki's tables),
so those rows were stale. The Wiki names more, built in `plugins/bosses/Brutus.plugin.js` (its numbers and texts are in
`plugins/bosses/data/brutus.json`) and the quest plugin's Demonic branches. Read on 2026-11-11 from the Wiki revisions
[Brutus](https://oldschool.runescape.wiki/?title=Brutus&oldid=15396646),
[Demonic Brutus](https://oldschool.runescape.wiki/?title=Demonic_Brutus&oldid=15384017),
[Brutus/Strategies](https://oldschool.runescape.wiki/?title=Brutus/Strategies&oldid=15354867) and
[Demonic Brutus/Strategies](https://oldschool.runescape.wiki/?title=Demonic_Brutus/Strategies&oldid=15354884).
No rsprox capture of the post-quest or the Demonic fight was found (4153 is the quest route only), so these are the Wiki's
numbers and texts:

- Slayer experience on a Cows task is 116, twice his Hitpoints (the Slayer plugin gave 58): Brutus infobox "slayxp = 116",
  and the generated `monsters-complete.json` has `slayer_xp` 116.0 for 15626 and 15627. Nothing says it differs during the
  quest, so it is not gated on it.
- An item used on Brutus says "Brutus doesn't want that." and an empty bucket "You do not want to do that." (Brutus,
  Trivia); the abyssal potato stays the quest plugin's.
- Killing Brutus or Demonic Brutus wearing Cow31337Killer's outfit (rune boots, rune platebody, rune plateskirt, Klank's
  gauntlets, Dharok's helm, Dharok's greataxe; degraded forms included) says "You are but an imitation of a true legend."
  (Brutus, Trivia).
- Demonic Brutus: "Once Demonic Brutus' health reaches 0, it will exclaim moo moo! and heal itself for 487 health" (he
  heals 487 and shouts when first brought to 0 Hitpoints), "Getting hit by any of the bulls will deal 45-56 damage each"
  (each bull of his specials deals 45-56), his basic melee "can hit through Protect from Melee" (it does, and is not held to
  the quest's cap of 3) and he "is immune to stat drains" (he is). The Strategies page gives his melee maximum as 4; the
  infobox says 43, and so does `monsters-complete.json` (`max_hit` 43), which stands. With one bull per special, a Demonic
  special is a single 45-56 hit, so he can kill a low-Hitpoints player in the private field in one or two hits.

Not modelled: Demonic Brutus's three ghost bulls and their clockwise order, the faster specials at two thirds of his
Hitpoints, the counter-clockwise order at one third, the phase-two orbs, his enchanted-bolt immunity (no immunity flag
exists), the pushing of players away from obstacles, and Brutus's 15-tick anti-safespot behaviour. The Wiki gives no
tick counts or positions for them.

## 2026-11-02 audit

A fresh account replayed the complete 4153 route. The captured state sequence, first-sample
damage, private bull field, Brutus identity and Hitpoints, rewards and post-quest hand-outs
all matched. Three presentation issues were fixed:

- **Low-combat warning:** the transcript's recommendation box is unconditional, but live
  sends it only below combat 15 and before the start menu. The quest now sets the shared
  start-menu warning and consumes the transcript box, matching the other recommended-combat
  quests. A low-level account sees the box before "Start The Ides of Milk quest?".
- **Gillie's line:** 4153 says "I'm sure he'll **be** happy to share some information with
  you"; the wiki transcript has "he'll he happy". The dumper correction and regenerated
  export carry the captured wording.
- **Chat-heads:** the captured Cassius, Gillie, Seth and Duke animations are in
  `plugins/quests/data/chathead-animations.json`, together with Professor Oddenstein's
  captured post-quest lines from 3209.

The lamp's exact confirmation text, alternate full-inventory branches and every combat roll
remain outside this run's evidence.

## Verification and limits

From `server/`, after building:

```sh
node --test tests/ides-of-milk-parity.test.cjs tests/cowbell-amulet-parity.test.cjs tests/npc-dialogues.test.cjs
```

The worktree's own agent MCP verified the real Release interaction, transition into a private field containing just Brutus, captured bull identity/Hitpoints, four local gate replacements, the south-west Quick-escape, the canonical Cassius spawn, and the real Groats book interface. Focused tests cover progression, reaction timing, resumed dialogue, information flags, lamp validation, book layout, per-player combat state, retargeted stomps with frozen windup tiles, vertical/horizontal charge dodges, postquest respawn timers and logout cleanup.

The recording covers one quest route and one fight, not every dialogue branch, attack roll or postquest cycle. The Wiki's quest and strategy pages describe different special-selection intervals; the implementation uses three initial melee attacks and 1–6 between quest specials, then the strategy's 4–5 and alternating specials after completion. Exact random distributions, low-level special-damage rounding, diagonal charges and the 15-tick anti-safespot behavior still need targeted OSRS measurements. Special damage uses the documented approximate 30–40% Hitpoints range, capped at 19, rather than a proven formula. Some transient cow-scatter/fade presentation and unrecorded journal text remain approximate. These limits prevent a claim of complete packet, visual or combat parity. The charged amulet's exact teleport tile and timing are also unrecorded.
