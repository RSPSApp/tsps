---
quest: Desert Treasure I
key: desert_treasure_i
status: untested
tested:
tester:
model:
commit:
cache:
start:
travel:
---

# Desert Treasure I

Deferred on 2026-10-23 as long/complex; no native playthrough recorded.

## Findings

- **Fixed** exterior Pyramid entrance Open ([#2163](https://github.com/RSPSApp/tsps/issues/2163)).
  The two top entrance leaves remain outdoor passages, separate from Ladder6497 and
  the postquest southern altar shortcut. Each clicked leaf opens for the acting player,
  who walks onto its tile and steps off the other side two ticks later; the closed model
  then returns. The four-diamond prerequisite and the separate ladder progress remain.
- Primary packet evidence: [RSProx3017](https://rsprox.net/download/3017), revision231,
  records6547→6548 at3232,2899,0 (ticks955–957 northbound,1014–1016 southbound), and
  6545→6546 at3233,2899,0 (4288–4290 northbound). Every replacement is shape10,
  rotation1; opening sends sound62,loops1,delay0, with no player animation or teleport.
  [3020](https://rsprox.net/download/3020), revision231, corroborates the two-tick passage.
  [1858](https://rsprox.net/download/1858), revision227, separately records the exterior
  crossing8845–8847 and the6497 ladder animation828/underground arrival8853–8854.
- These recordings use completed accounts; they establish passage mechanics, not early
  quest refusal text. The prerequisite follows the existing quest gate and
  [Wiki top-entrance route](https://oldschool.runescape.wiki/w/Desert_Treasure_I).
  The [southern altar shortcut](https://oldschool.runescape.wiki/w/Ancient_Magicks)
  is a different entrance. Revision241 cache confirms the two 1×1 leaf pairs and their
  Open actions; no generated definitions were changed.
- Offline native regression coverage extends `server/tests/qh728-q020.test.cjs`:
  real four-diamond hand-ins, client object-option dispatch, both leaves/directions,
  ordinary movement and native sync/sound, scene replay, cancellation/disconnect,
  independent players, and the connected entrance ladder. This is not a live playthrough
  or visual rendering check; the quest's overall status remains untested.

## Runs

### 2026-11-03 — bounded native ladder regression

- The real cache, PlayerSession object input, movement/reach and generic-before-quest dispatch are covered for the entrance and every interior ascent/descent. Zero and three placed diamonds retain the entrance barrier; consuming all four enters the first floor and sets stage 13. Every landing is walkable and reaches its paired return ladder.
- The quest claims its ladder links through `ladders:climb` before the generic underground search can skip to the basement. Exact ladder anchors and adjacent landing tiles come from the active cache; no live playthrough or captured landing side is claimed.
- Exterior door-opening behavior remains unresolved in [#2163](https://github.com/RSPSApp/tsps/issues/2163). This ladder check does not establish full quest, trap or door parity.

No full live run yet. Tracked in issue [#728](https://github.com/RSPSApp/tsps/issues/728) deferred (q020); PRs: [#1110](https://github.com/RSPSApp/tsps/pull/1110).
