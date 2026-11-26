# Splitbark armour: Wizard Jalarast

Wizard Jalarast (NPC 3232, `armourmaking_wizard`) stands on the first floor of the Wizards' Tower
and makes splitbark armour from bark (`hollow_bark`), fine cloth (`fine_cloth`) and coins.
Plugin: `server/plugins/npcs/WizardJalarast.plugin.js`; test: `server/tests/wizard-jalarast.test.cjs`.

## Facts

From rsprox captures (rsprox.net recording 3202, rev 232, tick 2369-2370):

- Trade (op3) opens `skillmulti` in the chatbox modal on arrival, with no dialogue first.
  `skillmulti_setup` gets verb argument 20, the text
  `How many do you wish to buy?|Helm|Body|Legs|Gauntlets|Boots`, a maximum amount of 1, the
  objects `splitbark_helm`, `splitbark_body`, `splitbark_legs`, `splitbark_gauntlets`,
  `splitbark_greaves`, and an amount of 1.

From the Wiki (Wizard Jalarast and her transcript, `npc-dialogues.json` "Wizard Jalarast",
`shop-dialogue`):

| Piece | Bark | Fine cloth | Coins |
|---|---:|---:|---:|
| Helm | 2 | 2 | 6,000 |
| Body | 4 | 4 | 37,000 |
| Legs | 3 | 3 | 32,000 |
| Gauntlets | 1 | 1 | 1,000 |
| Boots | 1 | 1 | 1,000 |

- With the supplies: "There you go, enjoy your new armour!" (Wizard Jalarast).
- Without them, her line names them, e.g. "You need 2 pieces of bark, 2 pieces of fine cloth and
  6,000 coins for a splitbark helm.", with a sad head (`chatsad2`; rsprox.net recording 3202,
  tick 2736). The made line has no recording and keeps the default head.
- On a non-members world: "I'm sorry, but I can't do that right now." The plugin is members-only,
  so on a free world the transcript's unanswered condition plays that line.

## Ours

- Only unnoted bark and fine cloth count; no recording shows a purchase or noted materials.
- The materials and coins go before the piece is added, so it always has room.
- Talk-to's "Can you make me some armour please?" carries on into the same menu ("Continues
  with shop dialogue."), and the plugin handles that action. The Wiki transcript writes the
  non-members branch before it as an option (`{{topt|If the player is on a non-members world:}}`);
  the dumper (osrsreboxed-db) reads a lone `{{topt|If the player ...}}` as a condition, so the
  branch is answered like the shop dialogue's and no option shows it (#6292). Live goes from
  "Certainly, what would you like me to make?" straight into the same skillmulti on the tick after
  the continue (rsprox.net recording 3202, ticks 2377-2381).

## Crafting it yourself

Players at Crafting 60-62 sew the pieces themselves with a needle and thread or a costume needle
(Leather.Crafting.js; values in docs/crafting.md, Wiki-only).
