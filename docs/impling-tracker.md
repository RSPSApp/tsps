# Impling Tracker (butterfly net "Check totals")

Butterfly net and Magic butterfly net: inventory "Check totals", worn "Check Totals" (cache param 453) open the Impling
Tracker, which counts implings caught in Puro-Puro and the rest of the world (Wiki, Insect net).

User capture 20261111T231757-5ab63b4 (rev 242), inventory op 4 and worn `wornitems:slot3` op 4:
- `toplevel_mainmodal_open` (2524) [-1, -1], interface 180 `ii_tracker` as the main modal, then `ii_tracker_build`
  (1327) with the Surface World list, the Puro-Puro list, and the tabs' components 180:4/6/5/3 and 180:8/10/9/7
  (scroll layer, text layer, model layer, scrollbar).
- Each list is twelve `|`-separated entries `<Name>:<br><col=ffffff><count>` in the order Baby, Young, Gourmet, Earth,
  Essence, Eclectic, Nature, Magpie, Ninja, Crystal, Dragon, Lucky. Puro-Puro's Crystal entry is
  `<col=a46c19>Crystal:<br><col=a49f99>-`.
- Catching a young and an essence impling in Puro-Puro raised those two Puro-Puro counts.
- The tab buttons (180:13, 180:18) are client-side; live also sets `busy` (varbit 12393) while the modal is open.

`plugins/skills/hunter/ImplingTracker.Hunter.js` counts `hunter:impling-caught` per tab in `hunter:impling-totals`.
Ours: counts start from this server's first catch.
