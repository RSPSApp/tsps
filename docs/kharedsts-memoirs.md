# Kharedst's memoirs and the Book of the Dead: Read and Check

`plugins/items/KourendTravelItems.plugin.js`, pages in `plugins/items/data/kharedsts-memoirs-pages.json`.

- Check (inventory and worn) opens the objectbox with the book (zoom 400): "On the inside of the cover a message is
  displayed in<br>dark ink. It reads: <col=800080>N/MAX memories remain.<col=800080>". Book of the Dead: 33/250
  (rsprox.net 363, rev 231, ticks 37 and 3595). Memoirs with no page attached: 0/0 (user capture
  20261111T231757-5ab63b4, rev 242), so the memoirs hold 20 charges per attached page (Wiki).
- Read plays `human_readbook` and opens book 392. The Book of the Dead (rsprox.net 363 ticks 494-507, also 1441, 603,
  3792) reads all 32 pages: the dedication, the five entries in full, and Tread Carefully. "Kharedst's Memoirs" with no
  page attached (user capture above) reads three spreads: the dedication, then each entry as one page of its heading,
  "...", and red "This entry seems to be missing." lines. Pages run on in order, so an attached entry takes its full
  pages.
- Reminisce on an empty book opens the messagebox "Kharedst's Memoirs holds no charge." (user capture above, subops 0
  and 1), before any page check.

Ours: the Book of the Dead's no-charge line names that book; it always reads in full; the memoirs leave Tread Carefully
out (no capture reads fully attached memoirs).
