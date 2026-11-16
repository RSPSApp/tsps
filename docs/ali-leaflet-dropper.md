# Ali the Leaflet Dropper and the Al kharid flyer

Ali the Leaflet Dropper (npc 5956, `ali_leaflet_dropper`) stands by Al Kharid's north gate
(spawn 3284, 3328) handing out the Al kharid flyer (obj 7922, `leaflet_dropper_flyer`) for
Ali Morrisane. Plugin: `server/plugins/npcs/AliLeafletDropper.plugin.js`.

## From rsprox captures (rsprox.net rec 3172, rev 232)

- **Take-flyer** (tick 807): on the click tick the flyer goes into the backpack and Ali says
  "Here! Take one and let me get back to work." (head anim `chatbored1`, 562). The next line,
  two ticks later after the continue, is "I still have hundreds of these flyers to hand out, I
  wonder if Ali would notice if I quietly dumped them somewhere?" (`chatquiz3`, 556).
- **Read** (tick 1454): the object box (193) shows the flyer at zoom 400 with
  "<col=000080>Come to the Al Kharid Market place! High quality<br><col=000080>produce at low,
  low prices! Show this flyer to a<br><col=000080>merchant for money off your next purchase,
  courtesy<br><col=000080>of Ali Morrisane!". After the continue (tick 1456) the message box
  (229) says "You notice that the money off voucher is out of date." The flyer stays.
- **Talk-to** (tick 785) opens with "I don't have time to talk right now! ..." and the three
  options of the Wiki transcript.

## Wiki ("Ali the Leaflet Dropper" transcript, in npc-dialogues.json)

"What are the flyers for?" -> "Which shops?" hands one over under "If the player does not have
an Al kharid flyer:" (receive step `WQ9ux6`). With one held: "Are you trying to be funny or has
age turned your brain to mush? Look at the flyer you already have!". With a full backpack: "I'd
give you a flyer but it looks like your hands are full. Come back when you have space for my
flyer." The plugin answers those three conditions and the receive step.

## Ours

- Take-flyer with a flyer already held, or with a full backpack, isn't captured. It uses the
  Talk-to transcript's lines for the same cases and gives nothing.
- Only a flyer in the backpack counts as held. Neither source says whether a banked one counts.
- Using the flyer on Ali (the transcript's "using an Al Kharid leaflet on him" variant) isn't
  part of this.
