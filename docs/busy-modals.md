# Busy modals pause gathering

Live sets varbit 12393 (`busy`) while some main modals are open. The diary journal
(`journalscroll`, 741), the CA overview and its screens (717, 715, 716, 713) and View equipment
stats (84) are among them. Sources: rsprox captures 237/01102 t16149 (the diary),
227/00100 t8867 and 236/03915 t405 (CA), 227/1000296 t5356 (equipment). While one is open, a
repeating gathering action waits. It picks up again after the modal closes, without a re-click:

- 227/01757 t8544-t8548: fishing under the diary journal.
- 227/00555 t24898-t24918: karambwan fishing under the Collection log.
- 227/00562 t153-t177: mining under the Collection log.

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
- `SkillActions.isPaused(session, player)` is true under a level-up dialogue or a busy modal.
  Woodcutting, mining and fishing skip such ticks without advancing their clocks, so a roll that
  fell due goes off on the first tick after the close.

Tests: `server/tests/busy-modal-pause.test.cjs`.

## Not recorded, so unchanged

- **Make-X skills** (fletching, smithing, cooking, crafting, herblore) under a busy modal.
  Crafting still ends when any interface opens.
- **Attacks** under a busy modal.
- **Walking.** Live splits by layout. On Resizable-modern the walk pauses and resumes on the
  close tick (227/00552 t12937-12940). On Resizable-classic it walks on (227/1000342 t8963),
  as tsps does.
- **Recent revisions.** The skilling captures above are revision 227, from before the Collection
  log change. A revision 242 recording would settle it: fish, open a diary journal for 5 ticks,
  then press Esc without clicking.
