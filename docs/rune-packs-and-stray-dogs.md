# Rune packs and Varrock stray dogs

## Sources and behavior

- [Rune packs](https://oldschool.runescape.wiki/w/Item_pack) and the
  [earth rune pack](https://oldschool.runescape.wiki/w/Earth_rune_pack): the six shop rune
  packs open into 100 runes. Rev 241 cache items 12728–12739 confirm that the actual packs
  have Open, their notes do not, and none has an equipment slot. The legacy helmet flags
  in `item-gameplay.json` caused the fallback equip behavior. This is the old server-owned
  export with no generator (see `cache-revision-update.md`), not an osrsreboxed-db import.
  The equipment slot now always comes from the cache wearPos, never that export
  (`tests/item-wear-slots.test.cjs`).
- [Stray dog](https://oldschool.runescape.wiki/w/Stray_dog): Pet and feeding bones or meat
  make the public Varrock dogs follow temporarily; Shoo-away makes them whine and retreat.
  Inedible items, notes, Shaikahan bones and marinated j' bones are retained. Cat ears scare
  the dog. Normal bones complete the existing Varrock diary task. Cache NPCs 2902 and 2922
  have Pet and Shoo-away; the A Ruff Situation actors have different actions and are excluded.
  The Wiki documents pet/shoo sounds 652/911.
- Varlamore's dogs (Molossus, Xolo, Chiribaya, Techichi) share the stray dog's Pet, Shoo-away and
  feeding (`StrayDogs.plugin.js`), but not its Varrock diary bone. From rsprox captures (rsprox.net
  recording 1098, revision 237): Pet plays `human_pickupfloor` on arrival and the dog's "Woof!"
  with sound 652 two ticks later (Chiribaya ticks 9807/9825, Molossus 10602, Xolo 14820).
  Feeding bones to a Chiribaya (tick 10200) plays `human_pickupfloor` and "Woof woof!" on
  arrival; a tick later the bones leave the slot, synth 2393 plays and the two lines arrive as
  one message joined by `<br>`. Every Varlamore dog feeds that way; meat uses the stray dog's
  meat lines in the same message (Ours). Techichi was never captured being petted or fed and
  takes the Chiribaya's responses; the cat-ears line for Chiribaya and Techichi is Molossus' (Ours).
  The option-less forms (the cabbage and corn dogs, the Aldarin villa and Kastori Techichis) stay
  examine-only.

## Verification

After `yarn --cwd server build`, run from `server`:

```sh
node --test tests/rune-packs.test.cjs tests/stray-dogs.test.cjs
```

The packet-handler tests open all six packs with a full inventory, merge existing stacks,
preserve a pack at the stack limit, and reject notes/invalid slots. Dog tests cover both
public variants, feeding the exact slot, rejected items, quest isolation, indoor waiting,
cat ears, expiry and logout.

The shared item-on-NPC packet handler also revalidates the offered item and target on
arrival. Rearranging inventory or removing the NPC during the walk cancels the old action;
feeding cannot consume an unrelated item moved into the original slot.

Live agent MCP on this branch confirmed Open changes an air rune pack into 100 air runes
without equipping it. The naturally spawned Varrock dog accepted Pet, consumed bones,
credited the diary and responded to Shoo-away.

The 100-tick follow duration is an explicit calibration shortcut until captured from live
OSRS. Ambient dog/cat encounters and spontaneous following are outside these interaction
fixes; no unverified petting animation was added.
