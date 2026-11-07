# Arceuus Reanimation

Casting Basic, Adept, Expert or Master Reanimation on an ensouled head
(`ArceuusItemSpells.castOnItem`) spawns the matching reanimated creature, owned by its caster.
`plugins/skills/Reanimation.plugin.js` pays the head's Prayer experience when the owner kills it.

## Zealot's robes

[Ensouled head](https://oldschool.runescape.wiki/w/Ensouled_head) and
[Zealot's robes](https://oldschool.runescape.wiki/w/Zealot%27s_robes): each worn piece (helm, top,
bottom, boots) gives a 1.25% chance, the full set 5%, that the cast spares the head. The cast still
happens: the creature rises and the runes and Magic experience are spent. The message is
"Your Zealot's robes save the ensouled head but still grant you experience."

The cast emits `reanimation:head-consumed` (`{ player, saved }`); the plugin rolls the robes' chance
and sets `saved`. The pieces and chance are the ones `data/bone-altars.json` holds for the bone altars.

## Checked and already correct

- Slayer credit: from the cache's task data, imp, unicorn and dragon creatures count for no task, the
  giant only for Hill Giants, the horror only for Jungle Horrors, the demon only for Lesser Demons, the
  rest for their own category, as the Wiki's "Counts toward Slayer task" column says.

## Not implemented

- The Wiki limits a cast to a 31x31 area around where the head dropped (or the Dark Altar once banked or
  traded). Heads are not tracked back to their drop, so any carried head can be cast anywhere.
- No packet capture of a reanimation's Zealot's-robes save exists; the message and chances are the Wiki's.
