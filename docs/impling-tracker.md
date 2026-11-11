# Impling Tracker (butterfly net "Check totals")

Butterfly net and Magic butterfly net: inventory "Check totals", worn "Check Totals" (cache param 453) open the Impling
Tracker, which counts implings caught in Puro-Puro and the rest of the world (Wiki, Insect net).

- Interface 180 `ii_tracker`: Surface World tab (scroll layer 180:4, scrollbar 180:3, children 180:5-6) and Puro-Puro tab
  (180:8, 180:7, children 180:9-10); the tab buttons (180:13, 180:18) run script 1330.
- Clientscript 1327 takes the two tabs' four components each and then two `|`-separated count lists. Script 1329 gives
  the Nth entry the model `enum_1316[N]` (12 entries) and the count as its text.
- `plugins/skills/hunter/ImplingTracker.Hunter.js` counts `hunter:impling-caught` per tab in `hunter:impling-totals`.

Not captured: no recording opens the tracker, so the order of enum 1316 (which impling each model is) and the
component order passed to 1327 are inferred (lucky 31742 and crystal 38801 follow those implings' own model ids; the
rest is unconfirmed), and whether live's Puro-Puro list omits the crystal impling is unknown. Counts start from this
server's first catch.
