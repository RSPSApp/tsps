# Pineapple cutting

Using a knife on a pineapple opens the native skillmulti menu with rings first,
then chunks: "How would you like to cut the pineapple?", "Slice it into 4 rings",
and "Dice it". Slice consumes the selected pineapple, keeps the knife, and gives
four rings without Cooking XP. Space freed by consuming the pineapple counts;
rings that do not fit go to the player's tile through `ItemContainer.forceAdd`.
Dice still gives one set of chunks, and other fruit and cooking recipes retain
their existing capacity checks.

## Sources

- [OSRS Wiki: Pineapple](https://oldschool.runescape.wiki/w/Pineapple): four rings,
  excess rings falling to the ground, and no skill/XP requirement for cutting.
- Local recording `227/01858`, ticks 14993–15004: native skillmulti mode 12,
  title, labels, icons and order; choosing Slice yields four inventory rings.
  This is a Leagues recording, not a retail full-inventory overflow recording.
- Active cache revision 242 confirms Pineapple 2114, Pineapple ring 2118,
  Pineapple chunks 2116 and Knife 946. The pinned clientscript reference establishes
  skillmulti's labelled-item/quantity behavior; the active client renders it.

## Verification and limits

`server/tests/pineapple-ring-overflow.test.cjs` drives decoded native item use and
menu selection with the real Cooking registration, Player, Inventory, World,
CreationMenu and ground-item services. It covers zero through four free slots,
conservation, retained knife/other items, zero XP, repeated/stale selection,
Dice/other-fruit controls, ground ownership, full pickup refusal and partial Take.
The pickup fixture advances the clock only for the existing pickup cooldown.

A fresh worktree server and rendering client were also used with seeded inventory
and location. Native mouse input opened the recorded menu, sliced with a full bag,
and showed one carried ring and three on the ground. Native Take refused a full
bag. Eating one bread freed a slot; native Take then collected one ring and left
two on the ground. Logout followed by the browser's authenticated Play Now flow
restored the two carried rings, knife and zero Cooking XP. Escape closed the
menu without consuming anything; reopening and choosing Dice yielded one set of
chunks and retained the knife. Ground expiry remains the shared system's policy;
no server-restart persistence is claimed for ground items.

No retail overflow recording establishes its exact timing, messages or ground
lifetime. The overflow uses the shared ground policy (initially its owner, normal
public reveal and expiry); manual ring drops in recording 227/01858 show the
usual reveal 100/despawn 300, but are not evidence of overflow-specific timing.
This change makes no claim of complete Cooking or other-fruit UI parity.
