# Run Energy

A port of RuneLite 1.13.5's Run Energy (`runenergy`). It is on by default, as in RuneLite.

Hovering the run orb shows a tooltip: your weight, how long your energy lasts running ("Run Time
Remaining", from weight, Agility, a stamina potion or a ring of endurance) and the time to 100%
energy (from Agility and graceful pieces). **Replace orb text with run time left** puts the run
time in seconds in the orb instead of the energy; the tooltip then shows the energy.

A ring of endurance's charges are read from its chat messages ("Your Ring of endurance is charged
with ...", "You load your Ring of endurance with ...", one less for each doubled stamina dose) and
kept per account. Until they are known, the run time with the ring worn is "?". **Ring of
endurance charge message** warns once when it drops under 500 charges, losing its passive effect.

## Settings

As RuneLite, config group `runenergy`: the charge message and the orb text.

## Differences from RuneLite

- The estimates are RuneLite's, which follow OSRS. This server's run energy doesn't yet: it drains
  1% per tick spent running, whatever the weight or Agility, and restores 1% every
  1700 − 10 × Agility ms, so the times shown won't match how energy actually goes here until the
  server does.
- RuneLite also sets the charges to 0 when the ring is destroyed (its DestroyOnOpKey script
  callback); that patched script isn't here, so a destroyed ring keeps its count until recharged.
- The charges are kept under `rsprofile.<account>.ringOfEnduranceCharges` in the plugin's config
  group, in place of RuneLite's RS profile.
