# Pineapple cutting

Using a knife on a pineapple opens the native skillmulti menu with rings first,
then chunks: "How would you like to cut the pineapple?", "Slice it into 4 rings",
and "Dice it". Slice consumes the selected pineapple, keeps the knife, and gives
four rings without Cooking XP. Space freed by consuming the pineapple counts;
rings that do not fit go to the player's tile through `ItemContainer.forceAdd`.
Dice gives one set of chunks per pineapple. Both choices accept the native quantity
controls: 1 cuts one fruit, a specific amount stops at that amount, and All offers
the number of eligible ordinary pineapples currently carried. The first cut runs
in the task turn after selection closes the menu; subsequent cuts run every two
turns. The originally selected fruit is consumed first. Each repeat chooses a
fresh eligible fruit and rechecks the retained knife's original object and slot.
Walking, new item use, a replacement interface, logout, disconnect and death
stop production. Other fruit and cooking recipes retain their existing behavior
and capacity checks.
Successful Slice and Dice send the spam-channel lines "You cut the pineapple into
rings." and "You cut the pineapple into chunks." once, before the inventory update.
Cancelled, stale or invalid choices send neither success line.

## Sources

- [OSRS Wiki: Pineapple](https://oldschool.runescape.wiki/w/Pineapple): four rings,
  excess rings falling to the ground, and no skill/XP requirement for cutting.
- Local recording `227/01858`, ticks 14993–15004: native skillmulti mode 12,
  title, labels, icons and order; choosing Slice yields four inventory rings.
  This is a Leagues recording, not a retail full-inventory overflow recording.
- Local recordings `227/910449` (Slice 18202–18203) and `227/910356`
  (Dice 7038–7039): the respective spam success lines precede the inventory delta.
  Both are Leagues recordings with ample free inventory space.
- [Public pineapple demonstration, 00:40](https://www.youtube.com/watch?v=HpxMQYpRfcY&t=40s):
  at normal speed before 00:46.2, All is selected and the menu closes by 00:42.8;
  the inventory is unchanged through 00:43.2, then has four/eight/twelve rings
  by 00:43.4/00:44.6/00:45.8 without further ingredient selection. The visible
  clock calibrates this interval. This supports delayed first output and automatic
  two-tick Slice repeats in ordinary gameplay; world flags and network phase are
  not exposed. The accelerated later footage is excluded.
- [OSRS Wiki: Pineapple ring](https://oldschool.runescape.wiki/w/Pineapple_ring)
  and [Pineapple chunks](https://oldschool.runescape.wiki/w/Pineapple_chunks):
  Creation lists two ticks. Dice uses that supported repeat rate and the same
  initial scheduling as Slice; the initial Dice phase is a shared-menu inference,
  not independently filmed Dice timing.
- [2018 automatic pineapple demonstration](https://www.youtube.com/watch?v=qkacVaDcw44&t=44s):
  six pineapples become 24 rings with the cursor stationary over a banker.
  This corroborates automatic batches; it has no clock calibration.
- Active cache revision 242 confirms Pineapple 2114, Pineapple ring 2118,
  Pineapple chunks 2116 and Knife 946. The pinned clientscript reference establishes
  skillmulti's labelled-item/quantity behavior; the active client renders it.

## Verification and limits

`server/tests/pineapple-ring-overflow.test.cjs` drives decoded native item use and
menu selection with the real Cooking registration, Player, Inventory, World,
CreationMenu and ground-item services. It covers zero through four free slots,
conservation, retained knife/other items, zero XP, repeated/stale selection,
Dice/other-fruit controls, ground ownership, full pickup refusal and partial Take.
Queued real World cycles verify no selection-turn output, next-turn first output,
two-turn repeats and quantities 1, 2 and All for both pineapple choices. Additional
checks cover selected-first order, repeated full-bag spill, flagged-fruit exclusion,
real inventory empty/refill, same-ID replacement, movement, new item use, interface
replacement, lifecycle hooks, and real Bank deposit/withdraw followed by a fresh
successful selection. Only transport is captured; containers/tasks are real.
The pickup fixture advances the clock only for the existing pickup cooldown.
Encoded outgoing chat checks establish exact text, spam type 105, message-before-inventory
ordering and one message per committed cut. A real `World.process()` test queues native
selection through the player turn and inspects owner and observer ground-item frames:
the ground pass precedes the cut, so the creation turn counts as floor age 1. The pile
is private through age 99, becomes public at age 100 (99 elapsed ticks after the cut),
survives age 299 and is removed at age 300 (299 elapsed ticks). The encoded timing
fields agree with these boundaries. These are measured TSPS behavior under controlled
World cycles, not evidence that retail pineapple overflow uses this lifetime.

Before the automatic-cutting correction, a fresh worktree server and rendering
client were used with seeded inventory
and location. Native mouse input opened the recorded menu, sliced with a full bag,
and showed one carried ring and three on the ground. Native Take refused a full
bag. Eating one bread freed a slot; native Take then collected one ring and left
two on the ground. Logout followed by the browser's authenticated Play Now flow
restored the two carried rings, knife and zero Cooking XP. Escape closed the
menu without consuming anything; reopening and choosing Dice yielded one set of
chunks and retained the knife. Ground expiry remains the shared system's policy;
no server-restart persistence is claimed for ground items.

Current-main production-client QA used native mouse and keyboard input for quantities
1, X=2 and All, with a six-pineapple batch producing 24 rings. Production events
were exactly two server cycles apart; sampled client state showed menu closure
with unchanged inventory, then first output 608 ms later. A native world click
after the first cut stopped the remaining batch. Three full-bag cuts preserved
three carried rings plus nine in three separate ground stacks. Native All Dice
produced two chunks from two pineapples. The knife and zero Cooking XP persisted
through native logout and authenticated Play Now relog. These were seeded QA
inventories, not natural acquisition; no exact retail network-phase claim is made.
No retail overflow recording establishes a special ground lifetime. The overflow uses the shared ground policy (initially its owner, normal
public reveal and expiry); manual ring drops in recording 227/01858 show the
usual reveal 100/despawn 300, but are not evidence of overflow-specific timing.
This change makes no claim of complete Cooking or other-fruit UI parity.
