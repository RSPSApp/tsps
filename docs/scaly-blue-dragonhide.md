# Scaly blue dragonhide

Plugin: `server/plugins/items/ScalyBlueDragonhide.plugin.js`. Members only.

A knife used on a scaly blue dragonhide (either way round) in a bank scrapes it into 50 noted blue
dragon scales.

## Facts (rsprox captures, rev 227)

Recordings 1757, 1834 and local 1000323, 1000380, 1000459, 1000497 (16 knife/hide uses, all at a
bank booth or banker):

- Each use takes one hide and gives `cert_blue_dragon_scale` x50 on the same tick, with the spam
  line `You scrape the scales off of the dragonhide.` No animation, sound or experience.
- The hide removed is the first one in the pack, whichever was clicked (1000380 t4994: the knife on
  slot 18 removed slot 14). The scales take the first free slot, or join the noted stack already
  carried (1000380 t4996: slot 14 went 50 -> 100 and slot 15 emptied).
- Uses repeat every 1-2 ticks; there is no make-X.

## Facts (OSRS Wiki, Scaly blue dragonhide)

- Only in a bank or near the Grand Exchange; elsewhere: `You can only do this whilst in a bank.`
  The bank check is the shared `league:near-bank` query (a bank booth, chest or banker nearby).

## Not covered

- Every capture is on a Leagues world (the Leagues task line and points are not ours).
- The refusal line has no capture; it is the Wiki's text.
- The Wiki says most bank chests will not work. Ours: the shared bank check also counts a bank chest
  within reach, as the other bank-only items (giant egg sac) do. No recording scrapes at a chest.
- Ours: a noted-scale stack within 50 of the stack cap is not checked; the add caps it.
