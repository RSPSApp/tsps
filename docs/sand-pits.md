# Sandpit bucket filling

Using an unnoted empty bucket on ordinary scenery named **Sand pit** or **Sandpit**
fills the used bucket on the following tick, then fills the remaining empty
buckets every two ticks. Each conversion keeps its inventory slot and item
metadata, so a full inventory can still be filled. Walking away, logging out, or
losing the bucket before conversion stops the action. Filling grants no XP and
does not deplete the pit.

`SandPits` owns the conversion. It emits `sand-pit:filled` only after a bucket is
filled. `ArdougneBertSandDiary` listens for that event to preserve the Ultimate
Ironman alternative at Bert's public Yanille pit, at (2542, 3103, 0).
Ultimate Ironmen use the same filling action as other players.

## Live evidence

The [rsprox captures](https://rsprox.net/database) establish these facts:

- **3196**, revision 232, Dorgesh-Kaan: two bucket-on-pit actions. The stationary
  attempt fills at ticks +1, +3 and +5; the approach attempt fills at +2, +4 and
  subsequent two-tick intervals. Each fill consumes one empty bucket and gives
  one bucket of sand, with animation `human_fillbucket_sandpit`, sound 2584 and
  “You fill the bucket with sand.” No XP or scenery change appears in those
  response windows.
- **4283**, revision 239, Entrana: a bucket-on-pit action after walking fills one
  bucket at +2, with the same animation, sound, message and item conversion.

The active revision 242 cache confirms animation 895 and the captured pit names
and IDs: Entrana 14890 and Dorgesh-Kaan 22726. The named handlers also cover
Yanille 10814 and the other cache variant 50733. The chartable Sailing landmark
also named “Sand pit” keeps its existing interaction; bucket filling there has no capture
coverage in the evidence above.

## Regression coverage

`sand-pits.test.cjs` exercises the registered handlers with real cache definitions,
players, inventories and scheduled tasks. It checks the four pit variants,
first-fill delay and repeat cadence, exact messages/animation/sound, unchanged XP,
a full inventory, item metadata, cancellation, missing buckets, noted buckets,
the separate charting landmark, and UIM diary credit after conversion.
`ardougne-bert-sand-diary.test.cjs` checks the diary event's location and account
mode boundaries alongside the existing delivery regressions.

The conversion, cadence and UIM timing regressions fail against the original
production code. No generated data is changed.


Live server verification used an ordinary account, supplied buckets and
positioning beside the existing scenery. At Yanille, Entrana and Dorgesh-Kaan,
each action converted three empty buckets, sent three fill messages and left
all skill XP unchanged. The fourth cache variant is covered by the registered
handler tests rather than a separate location run.
A full inventory also accepted a fill; walking away then stopped the loop with
one bucket filled and 27 still empty. The account logged out normally afterward.
Animation and sound identifiers are checked in the regression tests; rendered
animation timing was not visually reviewed.
