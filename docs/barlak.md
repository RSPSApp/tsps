# Barlak: long and curved bones, giant shells

Barlak, in the Dorgesh-Kaan market, buys long bones, curved bones and giant shells
(`server/plugins/npcs/Barlak.plugin.js`). Talk-to plays his transcript from `npc-dialogues.json`
(page "Barlak"), choosing the variant for what the player carries; the plugin answers the
transcript's shell conditions, fills its `[X] gp` and pays.

## What he pays (OSRS Wiki)

| Item | Coins | Experience |
| --- | --- | --- |
| Long bone | 1,000 | 4,500 Construction |
| Curved bone | 2,000 | 6,750 Construction |
| Snail shell, Tortoise shell | 600 | none |
| Perfect snail shell, Perfect shell | 600 | 500 Crafting |

- Bones are taken from the inventory **and the bank**; shells from the inventory only, unnoted.
- The Construction experience needs a house and an unboosted level 30 Construction. Below that he
  still buys the bones, for coins only. The Carpenter's outfit does not apply.
- Variant order: bones (inventory or bank) first, then tortoise shells, then snail shells.

## rsprox captures

- Rec 2964 (rev 230), t350-395: nine long bones. "I'll give you 9000gp for the bones you're
  carrying and for any you have in your bank. ..." (the price as `9000gp`, no space or thousands
  separator), the menu, "No thanks." on the second option. Accepting: the coins and 40,500
  Construction XP arrive as "Thanks! Now, let me explain..." is shown, then the lecture is a message
  box. With shells still carried he goes straight on to "That giant shell...what is it?"; two
  tortoise shells, "1200gp", paid as "Thanks. If you find any more shells like these, please bring
  them to me!" is shown.
- Rec 4263 (rev 239), t1111-1118: one tortoise shell, "600gp", paid with the same line.

## Recorded differences (the Wiki transcript is followed)

- The bones offer: live sends one line, "I'll give you 9000gp for the bones you're carrying and
  for any you have in your bank. I'll try to teach you something about Construction as well."
  (rec 2964 t358, 99 Construction). The transcript has the price line, then "I'll try to teach you
  something about Construction as well, but it's highly technical so you won't understand if you
  don't already have level 30 Construction."
- The menus: live "Okay." / "No, I'll keep the bones." for bones, and "Okay." / "No thanks." (once
  "Okay" / "No thanks") for shells; the transcript has "Okay." / "No. I'll keep the bones." for
  both.

## Ours

- A full inventory with every bone banked (no room for the coins): nothing is sold, the chat
  closes and "You don't have enough inventory space." is sent.
- The items gone before his "Thanks" line: nothing is paid and the chat closes.
- The transcript's "same as above" after "It's a giant snail shell!" (his tortoise variant, every
  branch) goes on as his snail shell variant; the perfect-shell branches reach it through a called
  branch, which the dialogue runtime resolves against the player line shown before the call.
- The Wiki's "You need to have a house and a Construction level of at least 30 before I can teach
  you anything." (Transcript:Barlak, marked incomplete) has no known place in the conversation, so
  it is not said.
