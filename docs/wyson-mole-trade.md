# Wyson's mole-part trade

Wyson the gardener (Falador Park) trades Giant Mole parts for bird nests.
Code: `server/plugins/npcs/Wyson.plugin.js` (the trade) and
`server/plugins/skills/Woodcutting.plugin.js` (searching the nests).

## Trade

- OSRS Wiki, "Wyson the gardener" (Mole parts): one nest per mole claw or mole skin,
  five per immaculate mole skin. Each nest is a Wyson seed nest (72%), a ring nest (20%)
  or an empty nest (8%) (Mod Ash, quoted there).
- The transcript's variants play: with a claw or skin in the inventory he opens with the
  trade offer; with an immaculate skin he adds "I see you also have an immaculate mole
  skin with you, ...". The trade is the variants' action step (`T0rsOq`, `XwNH58`).
- rsprox capture local 1000323 (revision 227), ticks 13633-13641: Talk-to, the opening
  line, the three-option menu, the player's "Okay, I will trade the mole parts.", and on
  its continue the inventory update puts the nests in the parts' own slots and the chat
  closes. That capture is a Leagues world: its `league_mole_claws_traded` varbit and the
  part count are Leagues-only and not reproduced.

## Wyson seed nest (`bird_nest_decentseeds_jan2019`, 22800)

- OSRS Wiki, "Bird nest (Wyson)": its own 684-slot seed table, with quantities (6
  sweetcorn, 6 strawberry, 2 limpwurt, 2 watermelon, 2 snape grass, the rest 1), and an
  empty nest always.
- rsprox capture local 1000323, ticks 13646-13648: "You take 6 sweetcorn seeds out of the
  bird's nest.", "You take a cadantine seed out of the bird's nest." and "You take a
  Spirit Tree seed out of the bird's nest." (spam), the nest becoming an empty nest.
- rsprox capture 1002026 (revision 242), tick 31877: a magic seed reads "a Magic Tree
  seed"; the regular seed nest's line was corrected to match.

## Not implemented

- Noted parts and nest boxes: live gives nest boxes for noted parts, and when an
  immaculate skin's extra nests don't fit. Nest boxes (Extract/Check) have no handler yet,
  so noted parts aren't offered and an immaculate skin without room for its four extra
  nests stays in the inventory ("You don't have enough inventory space."; ours).
- Ours: the herb and allotment seed lines other than sweetcorn and cadantine are
  unrecorded and follow those two.
