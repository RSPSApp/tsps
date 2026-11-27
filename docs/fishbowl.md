# Fishbowls and pet fish

Plugin: `server/plugins/items/Fishbowl.plugin.js`. Tests: `server/tests/fishbowl.test.cjs`,
`server/tests/pet-fishbowl.test.cjs`, `server/tests/harry-seaweed-fishbowl.test.cjs`.

## Bowls without a fish

- Seaweed on a fishbowl of water (6668) makes the fishbowl with seaweed (6669); one seaweed is used.
- Empty (cache iop3) on either gives back the empty fishbowl (6667).
- No message, sound or animation (none in the Wiki or the rsprox captures).

## Pet fish (bluefish 6670, greenfish 6671, spinefish 6672)

The cache's inventory options are Talk-At, Play-With and Feed (iop1-3) and Drop.

| Option | What happens | Source |
| --- | --- | --- |
| Talk-At | Player: "Good fish. Just keep swimming...swimming...swimming..."; text box: "The fish swims. It is clearly an obedient fish." | Wiki, Transcript:Fishbowl (pet) |
| Play-With | Player: "Jump! Come on fishy, jump!"; text box: "The fish bumps into the side of the fishbowl. Then it swims some more."; Player: "Good fish..." | Wiki, Transcript:Fishbowl (pet) |
| Feed | Needs fish food (272) | Wiki, Fishbowl (pet) ("Pet fish eat fish food"); the cache's feed sequence holds fish food |
| Any item used on the bowl | "Your fish looks at you strangely. You get the feeling this will not work." The bowl used on another item keeps the default reply. | Wiki, Fishbowl (pet), trivia |

Each option plays the cache's own sequence for that fish, started with the option:
`human_talk_to_pet_fish_<fish>` (2782 / 2785 / 2788), `human_play_with_pet_fish_<fish>`
(2780 / 2783 / 2786) and `human_feed_pet_fish_<fish>` (2781 / 2784 / 2787), with `<fish>` =
`blue`, `green`, `spine`. Each sequence's right hand holds that fish's bowl, and the feed
sequence's left hand holds fish food.

No rsprox capture has any of these options: the index has the three bowls only as bank and
inventory contents (local 1001238, 1001250, 1001293, 1001295, 1001350).

### Ours

- Feed's messages, "You feed your fish." and "You don't have any fish food.", and that each feed
  uses one fish food. No source gives either.
- When the animation starts relative to the dialogue (with the click), and the player's chat-head
  expression (the default calm one).

Not done: the drop warning ("If you drop your fishbowl it will break!", "Drop it regardless" /
"Keep hold"). The Wiki doesn't say what is left after a confirmed drop.
