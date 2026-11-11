# Kharedst's memoirs and the Book of the Dead: Read and Check

`plugins/items/KourendTravelItems.plugin.js`.

- Check (inventory and worn): rsprox capture 363 (rev 231) ticks 37 and 3595, Book of the Dead, opens the objectbox with
  the book (zoom 400) and "On the inside of the cover a message is displayed in<br>dark ink. It reads:
  <col=800080>33/250 memories remain.<col=800080>". The memoirs use their own charges out of 100.
- Read: capture 363 ticks 494-507 (also recordings 1441, 603, 3792) play `human_readbook` and open book 392 titled
  "The Book of the Dead"; the 16 spreads of that fully unlocked account are in
  `plugins/items/data/kharedsts-memoirs-pages.json`.

Ours: no capture reads Kharedst's memoirs, so they show the same spreads under "Kharedst's Memoirs" (the Wiki transcript
has the same dedication and entries but no title), and every spread shows whichever pages are attached.
