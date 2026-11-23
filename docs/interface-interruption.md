# What opening an interface interrupts

What live OSRS does to the player's walk, route, combat and skilling when a side-tab button
opens an interface. Sources: rsprox captures (recording ids and ticks below), checked across
348 worn-items clicks and about 2,400 clicks on other side-tab modals in revisions 223-230 (most
of them revision 227 Leagues V worlds), and a further 272 clicks in revisions 231-242. Ticks are the tick the server handled the click, which is
sometimes one tick after the packet's tick in the transcript.

## View equipment stats (worn-items 387:1): a full stop

On the open tick, live:

- **Walk:** stops, and the walk is cleared. It does not resume after close.
  227/1000433 t11626 (a minimap walk), 227/1000226 t4713 (classic layout),
  227/01751 t3614 (closed at t3620, no further step), 227/01723 t11330. Recent revisions do
  the same: 237/01171 t331, 238/01227 t514 and t805.
- **Pending object or NPC route:** cancelled (227/1000561 t12352, a route to a rope;
  237/01107 t2052 and 241/1001440 t6213 in recent revisions).
- **Face target and animation:** cleared. `face_pathingentity` is null (227/1000296 t5356),
  and `sequence -1` is sent on about three quarters of all opens, even idle at a bank.
- **Repeating skill:** stops. Mining's animation resets and no swing follows
  (227/1000507 t226).
- **`busy` varbit 12393:** set to 1 while the screen is open.

It is **refused** with "You cannot open the equip screen while in combat!" while the player is
fighting a living NPC, or being hit by one. The refusal interrupts nothing: the next swing lands
on its normal tick (227/1000539 t1780 refused, t1781 swing; 227/1000194 t4761;
227/00080 t243-244; 238/01225 t235-238 and 238/01227 t480-481 in recent revisions). The player is still refused while walking away from an NPC that keeps hitting them
(227/1000539 t1775). After a kill, the refusal lasts through the NPC's death animation, and the
screen opens on the tick the NPC is removed. In 227/01885 the killing hit lands at t20818, a
click at t20819 is refused while `abyssal_death` plays, and the screen opens at t20821 as the
NPC goes. Opening on the tick after a kill (227/1000296 t5356) is the same case, with a shorter
death animation. tsps keeps the killed NPC as the player's dying opponent until its death ends
(`Combat.noteDyingOpponent`, `CombatFactory.inLiveCombat`).

An NPC's hit closes the open screen server-side on the hit tick, and auto-retaliate swings that
same tick (227/1000296 t5358). `CombatFactory.executeHit` already closes a `busy()` player's
interface on a hit.

Mid-teleport (a passageway, 228/02229 t236), or while dying (227/1000370 t25076-25080), the click
is dropped. Ours: tsps drops it during a forced move such as a ditch jump too, which is not
recorded. On one tick during the passageway, a mix of worn-items clicks got "Please finish
what you're doing before opening this menu." (228/02229 t238). That capture can't tell which
button sent it, so tsps sends nothing.

In tsps this is `Player.stopAction()`, called by `EquipmentStats.plugin.js`
(`openFromWornItems`). Ours: "being hit" uses the combat attacker window (8 ticks after an NPC's
hit, `Combat.ts`). Live's window after walking out of reach is not recorded.

Tests: `server/tests/interface-stop-action.test.cjs`.

## Guide prices (worn-items 387:3)

Refused with "You cannot open the price checker screen while in combat." while fighting
something alive, then opened on a later click once the fight was over (240/1001355 t1964
refused, t1969 opened). tsps uses the same in-combat rule as View equipment stats
(`CombatFactory.inLiveCombat`). No capture shows whether opening it stops a walk or a route.

## Other side-tab interfaces (recorded, not yet changed here)

- **Items kept on death:** walking stops, but there is no `busy` and no animation reset. This
  rests on three recordings (224/01542 t109, 224/01440 t26288, 237/04030 t29).
- **Call follower:** walking continues (227/1000152 t4816), and it works during a delayed action
  (228/02229 t239).
- **Diary journal (`journalscroll`), CA overview:** each opens a main modal with `busy` 1. The
  diary still does in revision 237 (237/01102 t16149). The Collection log did too in revision 227. By
  revision 232 it opens as a `floater` overlay (232/03099, 241/1001409, 242/1001896),
  as tsps does.
  - A repeating skill pauses while one is open and resumes after close without a re-click:
    227/00555 t24898-t24918 (karambwan fishing), 227/00562 t153-t177 (mining),
    227/01757 t8544-t8548 (fishing, the diary). The first two cases were recorded while the
    Collection log was still a modal.
  - Walking depends on the layout:
    - Resizable-modern (`toplevel_pre_eoc`): the walk pauses and resumes on the close tick
      (227/00552 t12937-12940, 227/00100 t8867-8869).
    - Resizable-classic (`toplevel_osrs_stretch`): the walk goes on (227/1000342 t8963,
      227/1000285 t11778).
- **Quest journal, skill guide, All settings:** each opens as a `floater` overlay, not a modal,
  and does not set `busy`. Walking continues on both layouts (226/01694 t5389, 227/00067 t228,
  227/00101 t8689). All settings refuses during a delayed action with "Please finish what you
  are doing before opening the settings menu." (228/02229).

## Mechanism (LostCity, 2004; not evidence of live behaviour)

LostCity's IF_BUTTON handler clears nothing. A main modal makes the player `busy()`, which
pauses op/ap triggers, the queues and repathing until the modal closes. Walking waypoints still
step, and follow keeps going. An NPC hit runs `if_close`.

That matches live's skilling pause under the Collection log, the diary and the CA overview, and
live's hit close. It does not match live's View equipment stats, which stops everything and
refuses in combat. It does not match live's walk pause on the modern layout either.

## Not recorded yet

The following still need deliberate captures:

1. View equipment stats while woodcutting, fishing, during a Make-All and while following:
   does the action resume after close?
2. The in-combat window after walking out of an NPC's reach, and a click during an Attack's
   approach before any hit (tsps refuses then, because the target is set).
3. Guide prices and Items kept on death in each state: walking, a route, attacking, being hit,
   skilling, following.
4. Call follower with a follower out.
5. The Collection log, the diary and the CA overview while attacking or being hit.
6. The same walk with the diary opened on each layout: modern, classic and fixed.
