# Party Room (Falador)

Wiki: [Party Room](https://oldschool.runescape.wiki/w/Party_Room), [Party chest](https://oldschool.runescape.wiki/w/Party_chest),
[Party balloon](https://oldschool.runescape.wiki/w/Party_balloon). Code: `plugins/minigames/PartyRoom.plugin.js`,
`plugins/minigames/partyroom/`, and the offer screen shared with Clan Halls in `plugins/interface/partychest/`.

## What it does

- **Chest:** Open the shut chest (loc 26193) or Deposit at the open one (2418). Offer from the inventory, Confirm. Nothing
  comes out except through balloons. 216 individual items: a stackable id counts once, anything else each.
- On a free world a new account can open the chest, but cannot offer items until it has over 20 hours of play time,
  10 quest points and a total level of 100, or has redeemed membership through a bond. Eligibility is checked again
  after the pending save flush and before the chest takes the offer.
- **Lever** (2421, 26194): 1,000 coins, up to 200 balloons (locs 115-122, Burst), on tiles a player can walk to from the
  chest inside a box around the room (found by a flood fill that respects wall edges; the box is ours). The coins are taken
  once balloons are down, so a lever that drops none costs nothing. Balloons last two minutes and live in memory, so a
  restart clears them and keeps the chest.
- **Knight dance:** select Nightly Dance at the lever for 500 coins. Six shared knights dance and sing; the chest can be
  empty. A second request while they dance costs nothing, as does a failed spawn. The song and Talk-to line use the
  generated Knight (Falador Party Room) transcript. The matching cache names the knight's idle animation `partyroom_dance`.
- **Pop:** decided at the pop. The balloon goes first, so one balloon pays once. Chance per balloon is `0.5 * items / 216`
  (ours: the Wiki gives no formula), then a uniform item; a stackable gives uniform 1..all, anything else one. Ironmen pop
  and take nothing. The drop belongs to whoever popped it and is seen by everyone: the Wiki's Ironman page bars receiving
  balloon items, and `Loot.Ironman` turns an Ironman away from anything another player owns. Others can take it.
- League task "Use the Falador Party room" fires on a successful Confirm.

## Not done / ours

- Party Pete removing cheap items.
- The six knight positions and four-tick song cadence follow the Near-Reality reference, not a live OSRS capture; the
  existing map control finds blocked tiles there but does not establish the tabletop or exact retail positions. Pete's
  final line is played when he is nearby. No client rendering or live timing was verified.
- The F2P membership exception currently recognises the server's persisted bond-redemption history; no other source of
  membership purchase history was found, so externally granted membership is not represented by this check.
- Ironmen cannot donate (ours: the Wiki is silent and may allow it; Clan Halls have no such rule).
- Ours: where balloons land (the box), the odds, one drop at a time, the refusal on an empty chest, and all wording.
- No lever, balloon-burst or pop animation or sound (the cache has `balloondrop_lever`, `balloon_burst` and pop locs 124+).
- The shut-to-open chest swap: Open on 26193 and Deposit on 2418 both open the screen.
- The record of a deposit is keyed by the lower-cased username; a rename between a crash and the next login would miss it.
- Evidence: the cache and RSProx 4001, 349, 3237 (open chest at 3054,3376,0; Pete walking). No player using the chest,
  lever or balloons was captured.

## How a deposit stays safe

The chest file `data/saves/party-room.json` (`party-room.<profile>.json` on a league world, chosen when first used
because the league plugin sets the world's profile after this one registers) is the commit point.

1. An offer is saved in the player's save (`partyroom:chest-offer`: items and a random id) beside every change.
2. Confirm marks the offer pending, saves the player, and waits for the save to reach the disk (`flush`).
3. In one step with nothing awaited: the offer is checked again (same id, unchanged, still pending, screen still up),
   the capacity re-read, the chest file written (temp file, fsync, rename), and only then memory updated.
4. While pending, offering, taking back and reopening are refused; closing or logging out leaves the items in the saved offer.
5. At login a saved offer is judged by the chest: if the chest recorded its id, the items are in the chest and the offer is
   dropped (the record goes only after the cleared save is on the disk); otherwise they are returned. If the chest file
   can't be read the offer is kept, neither returned nor dropped, and opening the chest settles it first, so a file that
   reads again can't be written over a held offer.
6. A chest file that can't be read is copied to `.corrupt-<time>` and never overwritten; deposits and pops are refused.

Known limits:
- SQLite runs WAL with `synchronous=NORMAL`. After a power cut a save that `flush` reported can be lost while the chest
  file (fsynced) survives: the save then has the items and no offer, the chest has them too, and they are doubled. A
  narrow risk of the backend; its settings are not changed here.
- Rolling a character back (SaveHistory) past a deposit also doubles the items: the chest keeps them.
- `flush` fails for any player's failed write; deposits are refused with a neutral message and the log names the account.
- A pop writes the chest, then registers the ground item: a crash between loses the item, never doubles it.
