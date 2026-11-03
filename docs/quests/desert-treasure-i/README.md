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

None recorded.

## Runs

### 2026-11-03 — bounded native ladder regression

- The real cache, PlayerSession object input, movement/reach and generic-before-quest dispatch are covered for the entrance and every interior ascent/descent. Zero and three placed diamonds retain the entrance barrier; consuming all four enters the first floor and sets stage 13. Every landing is walkable and reaches its paired return ladder.
- The quest claims its ladder links through `ladders:climb` before the generic underground search can skip to the basement. Exact ladder anchors and adjacent landing tiles come from the active cache; no live playthrough or captured landing side is claimed.
- Exterior door-opening behavior remains unresolved in [#2163](https://github.com/RSPSApp/tsps/issues/2163). This ladder check does not establish full quest, trap or door parity.

No full live run yet. Tracked in issue [#728](https://github.com/RSPSApp/tsps/issues/728) deferred (q020); PRs: [#1110](https://github.com/RSPSApp/tsps/pull/1110).
