# Busy modals pause gathering

Live sets varbit 12393 (`busy`) while some main modals are open. The diary journal
(`journalscroll`, 741), the CA overview and its screens (717, 715, 716, 713) and View equipment
stats (84) are among them. Sources: rsprox captures 237/01102 t16149 and 240/1001332
t1155-1190 (the diary; busy stays 1 across diary-to-diary swaps), 227/00100 t8867 and
236/03915 t405 (CA), 227/1000296 t5356 (equipment).

While one is open, a repeating gathering action waits. After the modal closes it starts over
without a re-click: its start message and animation come again, then the same first-roll delay
as a fresh click.

- 227/00555 t24898-t24920, karambwan fishing under the Collection log: no catch while open. On
  the tick busy goes to 0 (t24918), "You lower the Karambwan vessel." and the vessel animation
  come again. The first catch is at t24920.
- 227/00562 t153-t182, shooting-star mining under the Collection log: no swing while open. The
  close input is at t176, busy goes to 0 at t177, the mining animation plays again at t179
  (without the swing message), and the first stardust comes at t182. Rock mining is inferred
  from this.
- 227/01757 t8544-t8548, fishing under the diary journal: the diary was open for only two ticks
  between two catches, so it crossed no roll and shows no pause.

All of these pause recordings are from Leagues V worlds. No normal-world recording of gathering
under a busy modal was found. On normal worlds the busy values themselves agree:
240/1001332 for the diary, and Equipment stats on 8 of 10 opens in revisions 239-242.

The Collection log was still a busy modal in revision 227. By revision 232 it opens as a
`floater` overlay without `busy` (232/03099, 241/1001409), which is how tsps shows it, so it
doesn't pause anything here.

Moving between the CA screens keeps busy at 1, with no 0 in between
(237/1001305 t5413-t5434).

## In tsps

- `PacketSender.setBusyModal(open)` sends 12393 when the value changes and keeps the server's
  flag (`Player.inBusyModal()`). Every close route ends it, because it is cleared in
  `resetInterfaceState`.
- `holdBusyModal(swap)` keeps busy across a screen-to-screen swap.
- Content that sends 12393 for a cutscene or a teleport still sends the varbit itself, and
  pauses nothing.
- `SkillActions.modalPause(session, player)` returns one of three values:
  - "paused" while a busy modal is open, or while a level-up dialogue holds the session;
  - "restart" on the first tick after a busy modal closes;
  - "run" otherwise.
- On a restart, woodcutting, mining, fishing, shooting-star mining and dense runestone go back
  through their start path: the start animation (and, for fishing and woodcutting, the start
  message), then a fresh click's first-roll delay. Star and rock mining swing without the
  "You swing your pick" line, as 227/00562 t179 shows. An overdue roll doesn't go off the moment the modal closes.
- Timing: the restart runs on the task tick after the close, one tick later than live's busy-0
  tick in 227/00555.

Tests: `server/tests/busy-modal-pause.test.cjs`.

## Not recorded, so unchanged

- **Make-X skills** (fletching, smithing, cooking, crafting, herblore) under a busy modal.
  Crafting still ends when any interface opens.
- **Attacks** under a busy modal.
- **Walking.** Live splits by layout. On Resizable-modern the walk pauses and resumes on the
  close tick (227/00552 t12937-12940). On Resizable-classic it walks on (227/1000342 t8963),
  as tsps does.
- **Recent revisions and normal worlds.** The skilling captures above are revision 227 Leagues V,
  from before the Collection log change. A revision 242 recording would settle it: fish, open a diary journal for 5 ticks,
  then press Esc without clicking.
