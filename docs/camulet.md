# Camulet

Plugin: `server/plugins/items/Camulet.plugin.js`. Quest reward of Enakhra's Lament; four shared
charges (unlimited after Lazim's upgrade) to teleport into Enakhra's Temple.

## Confirmed behaviour

Live (rsprox recordings 3021, 3160, 3165, 3175):

- Rub sends the spam message `You rub the amulet...` on the click, before any teleport.
- With the hard Desert Diary, Rub opens the chatbox menu `Where would you like to teleport to?`
  with `Enakhra's Temple.`, `Enakhra's Temple Entrance.` and `Nowhere.` (recording 3021). The
  entrance landings in 3160 and 3165 are within two tiles of (3191, 2924).
- Rub on an empty Camulet shows a message box: `Your Camulet has run out of teleport charges.
  You can renew them by applying camel dung.` (3021).
- Check-charge (inventory) on an empty Camulet sends the game message `Your Camulet has no
  charges left.<br>You can recharge it by applying camel dung.` (3021).

Wiki (https://oldschool.runescape.wiki/w/Camulet, https://oldschool.runescape.wiki/w/Ugthanki_dung):

- A bucket of ugthanki dung used on the Camulet fully recharges it (four charges); dung is not
  wasted on an already full Camulet. The Wiki does not say what the bucket becomes; we return an
  empty bucket (our choice).
- The entrance is at (3191, 2924), "Enakhra's Temple entrance" with the hard Desert Diary.

## Implementation notes

- Only the temple teleport credits the "Teleport to Enakhra's Temple with the Camulet" task.
- The rev 241 cache lists only `Check` and `Teleport` as worn options (the Wiki also names
  `Temple` and `Surface`), so the worn Teleport follows Rub.
- Without the hard diary Rub goes straight to the temple; no recording shows that case.

## Not covered

- Entrance landing tile scatter (live varies within two tiles).
- A remaining-charges message after teleporting, and the Check-charge text with charges left:
  no recording shows either.
- Dung recharge animation/sound/message: no capture.
