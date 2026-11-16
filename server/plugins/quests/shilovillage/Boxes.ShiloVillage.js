/**
 * Which of Shilo Village's transcript messages live shows in a box rather than the chatbox (RSProx capture
 * ShiloVillage, revision 242.1; the tick each was first seen). A message box (229) is `null`; an object box (193)
 * names the item it shows. Every other transcript message is a game message, as captured. The texts are the
 * captured ones with the colour tags dropped; the transcript's text is matched the same way.
 */
const BOXES = new Map([
  ["You see a broken cart has been placed here. You suspect it's intended to keep people out.", null], // t672
  ["You think you could climb over the cart, but you see undead creatures gathered by the gates. A note attached to the cart reads: Danger: Deadly green mist! DO NOT ENTER IF YOU VALUE YOUR LIFE!", null], // t678
  ["The gate feels very cold to your touch! Are you sure you want to go through?", null], // t693
  ["Mosol seems to be looking around very cautiously. He jumps a little when you approach and talk to him.", null], // t747
  ["Mosol looks at you and shakes his head in bewilderment.", null], // t812
  ["Mosol lowers his head in deep concentration.", null], // t1232
  ["He scratches his head...", null], // t1234
  ["Mosol strains to remember something...", null], // t1237
  ["Mosol gives you a Wampum belt.", 625], // t1442
  ["You show Trufitus the Wampum belt, he studies it for a long time.", 625], // t1750
  ["Trufitus looks at you blankly...", null], // t1801
  ["It looks as if something is buried here.", null], // t2454
  ["It looks as if something is buried here. You may need some tools to excavate further.", null], // t2459
  ["You see a small fissure in the granite that you might just be able to crawl through. Beyond the fissure is a long fall. Do you want to try to crawl through the fissure?", null], // t2483
  ["You think better of attempting to squeeze into the fissure.", null], // t2490
  ["You see a small fissure in the granite that you might just be able to crawl through. Beyond the fissure is a long fall.", null], // t2496
  ["You drop the torch into the fissure and see that there is quite a large drop after you get through the hole. There is a good anchor point nearby onto which you could tie a rope.", 594], // t2508
  ["The torch burns out.", null], // t2511
  ["Some rope might help here.", null], // t2513
  ["You have already excavated this area. Your spade clangs against the granite.", null], // t2543
  ["You see where to attach the rope very clearly. You secure the rope well.", 954], // t2547
  ["You see a small fissure in the granite that you might just be able to crawl through. You can see that a rope is attached nearby.", null], // t2553
  ["You see a small fissure in the granite that you might just be able to crawl through. You can see that a rope is attached nearby, would you like to climb down?", null], // t2559
  ["You see that there is a narrow gap through into the darkness. You could try to wriggle through and see where it takes you.", null], // t2587
  ["You can see that there is something hidden behind some rocks. Do you want to have a look? It looks a bit dangerous as the ceiling doesn't look at all safe.", null], // t2635
  ["You start to slowly move the rocks to one side.", null], // t2642
  ["You carefully manage to remove enough rocks to see a book shelf. You gingerly remove a delicate scroll from the shelf and place it in your inventory.", 607], // t2644
  ["You see nothing here but an empty bookcase behind some rocks.", null], // t2648
  ["This looks like part of a scroll about someone called Bervirius. Would you like to read it?", null], // t2653
  ["You find a tattered but very ornate scroll, which you place carefully in your inventory.", 608], // t2695
  ["This looks like a scroll about Rashiliyia. Would you like to read it?", null], // t2702
  ["You take a look at the gallows. It's pretty eerie looking.", null], // t2727
  ["A grisly sight meets your eyes. A human corpse hangs from the noose. His hands have been tied behind his back.", null], // t2729
  ["You find a human corpse hanging in the noose. It looks as if the corpse can be removed easily. Would you like to remove the corpse from the noose?", null], // t2733
  ["You gently support the frame of the skeleton and lift the skull through the noose.", 610], // t2749
  ["You find an old sack and place the skeleton in it. Maybe Trufitus can give you some tips on what to do with it.", 610], // t2750
  ["You sense that there is a spirit that needs to be put to rest.", null], // t2751
  ["The gallows look pretty eerie. You search but find nothing.", null], // t2758
  ["You hear a ghostly wailing sound coming from the corpse and a whispering voice says,'Let me rest in a sacred place and assist you I will'", null], // t2765
  ["You show Trufitus the corpse.", null], // t3107
  ["Trufitus pulls away from you...", null], // t3143
  ["You hand the tattered scroll to Trufitus.", null], // t3157
  ["Trufitus hands the tattered scroll back to you.", null], // t3164
  ["You hand the crumpled scroll to Trufitus.", null], // t3171
  ["Trufitus gives back the scroll.", null], // t3177
  ["Trufitus seems to drift off in thought.", null], // t3185
  ["You hear an unearthly moaning sound as you see an apparition materialise right in front of you.", null], // t3205
  ["The apparition disappears into the ground where you buried the corpse. You see the ground in front of you shake as a shard of bone forces its way to the surface. You take the bone shard and place it in your", 604], // t3221
  ["inventory.", 604], // t3225
  ["You look at the shard of bone. The words of Zadimus come back to you. 'I am the key, but only kin may approach her.'", null], // t3239
  ["You show Trufitus the Bone Shard.", null], // t3249
  ["Trufitus looks at the object for a moment.", null], // t3252
  ["These rocks look like they have been stacked uniformly.", null], // t3498
  ["You investigate the rocks and find a dank, narrow crawl-way. Do you want to crawl into this dank, dark, narrow, possibly dangerous hole?", null], // t3505
  ["You contort your body and prepare to squirm worm like into the hole.", null], // t3513
  ["You struggle through the narrow crevice in the rocks.", null], // t3515
  ["And drop to your feet into a narrow underground corridor.", null], // t3519
  ["The dolmen is intricately decorated with the symbol of two crossed palm trees. It might be the family crest? You can see that there are some items on the dolmen.", null], // t3589
  ["You find a rusty sword with an ivory pommel. You take the Ivory pommel and place it in your inventory.", 623], // t3600
  ["You find a Crystal Sphere. You take the crystal and place it carefully in your inventory.", 611], // t3602
  ["You find some writing on the dolmen, you grab some nearby scraps of delicate paper together and copy the text as best you can and collect them together as a scroll.", 624], // t3604
  ["You prepare the ivory pommel and the chisel to start crafting...", 623], // t3614
  ["You successfully craft some of the ivory into beads. They may look good as part of a necklace.", 618], // t3616
  ["You successfully craft the beads and bronze wire into a necklace which you name, 'Beads of the Dead'", 616], // t3620
  ["You feel the crystal trying to draw upon your spiritual energy. Do you want to let it?", 611], // t3660
  ["The crystal glows faintly.", 612], // t3666
  ["This scroll is a collection of writings. Some of them are just scraps of papyrus with what looks like random scribblings. Which would you like to read?", 624], // t3679
  ["You show Trufitus the 'Beads of the Dead'.", null], // t3777
  ["You show Trufitus the Locating Crystal.", null], // t3785
  ["You hand the notes over to Trufitus.", null], // t3793
  ["There seems to be some sort of recepticle on the door. Perhaps it needs a key?", null], // t3992
  ["Examining the door, you see that it has a very strange lock. You're shocked to find that it seems to be made out of bone!", null], // t4000
  ["Remembering Zadimus' words and the strange bone lock, you start to craft the bone. You successfully make a key out of the bone shard.", null], // t4011
  ["The doors close behind you with the sound of crunching bone. Before you stretches a winding tunnel blocked by an ancient gate.", null], // t4025
  ["You place the bone into the skeletal door and it fits. There are two recesses left now.", 526], // t4575
  ["You place the bone into the skeletal door and it fits. There is just one recess left now.", 526], // t4584
  ["You place the bone into the last recess on the skeletal door and it fits. All the recesses are filled...", 526], // t4592
  ["The door seems to change slightly. Two depictions of skeletal warriors turn their heads towards you. They are alive! The Skeletons wrench themselves free of the door. Stepping out of the door, with grinning teeth they push the huge doors open.", null], // t4594
  ["You touch the dolmen, and the ground starts to shake. You hear an unearthly voice booming and you step away from the dolmen in anticipation.", null], // t4605
  ["You defeat Nazastarool and the corpse falls to the ground. The bones start to move again and soon they reform into a grisly giant skeleton.", null], // t4678
  ["You defeat Nazastarool and the skeleton falls to the ground. An ethereal form starts taking shape above the bones and you soon face the vengeful ghost of Nazastarool.", null], // t4743
  ["You hear a disembodied voice fading away into the distance, 'May you perish in the fires of Zamorak's furnace! Rashiliyia's curse is upon you!'", null], // t4837
  ["You see something appear on the dolmen.", null], // t4840
  ["You take the mummified remains of a human female. You feel certain that these are Rashiliyia's remains. You carefully place the remains in your inventory.", 609], // t4850
  ["You show Trufitus the remains...", null], // t5090
  ["You carefully place Rashiliyia's remains on the dolmen. You feel a strange vibration in the air.", 609], // t5245
  ["Mosol leads you into the village and walks back out into the jungle.", null], // t5392
  ["Yanni looks through your items...", null], // t5508
]);

function key(text) {
  return String(text ?? "").replace(/<br>/g, " ").replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
}

/** The `box` a message step needs, or null when live sends it to the chatbox. */
function boxFor(text) {
  const k = key(text);
  if (!BOXES.has(k)) return null;
  const item = BOXES.get(k);
  return item == null ? { statement: true } : { items: [item] };
}

module.exports = { BOXES, boxFor, key };
