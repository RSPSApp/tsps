// Authored progress summaries, not verbatim vanilla journals. Sources are the eight
// OSRS Wiki Transcript:Recipe for Disaster/Freeing ... pages and the existing quest
// milestone handlers. Thresholds describe what the player has already learned/done.
// Cache display-name suffixes identify the native child rows without hard-coded ids.
// Revision-qualified dialogue sources (not journal transcripts):
// Mountain Dwarf: https://oldschool.runescape.wiki/w/Special:PermanentLink/15315379
// Goblin generals: https://oldschool.runescape.wiki/w/Special:PermanentLink/15263689
// Pirate Pete: https://oldschool.runescape.wiki/w/Special:PermanentLink/15342716
// Lumbridge Guide: https://oldschool.runescape.wiki/w/Special:PermanentLink/15263696
// Evil Dave: https://oldschool.runescape.wiki/w/Special:PermanentLink/15263695
// Skrach Uglogwee: https://oldschool.runescape.wiki/w/Special:PermanentLink/15263699
// Sir Amik Varze: https://oldschool.runescape.wiki/w/Special:PermanentLink/15320992
// King Awowogei: https://oldschool.runescape.wiki/w/Special:PermanentLink/15263700
module.exports = {
  "Mountain Dwarf": [
    [0, "I need to inspect the Mountain Dwarf in the Lumbridge Castle dining room."],
    [10, "The Mountain Dwarf needs a rock cake. I should ask Rohak under White Wolf Mountain about making one."],
    [20, "Adding a coin to Asgarnian ale makes Asgoldian ale. I need to get Rohak drunk enough to help me."],
    [30, "Rohak has agreed to make a rock cake for a price. I should ask him what ingredients he needs."],
    [40, "I need to bring Rohak an egg, a bucket of milk, a pot of flour and a bowl of water."],
    [50, "I need to cool the dwarven rock cake, then use it on the Mountain Dwarf in the dining room."],
    [60, "I freed the Mountain Dwarf with a dwarven rock cake."],
  ],
  "Wartface & Bentnoze": [
    [0, "I need to inspect the goblin generals in the Lumbridge Castle dining room."],
    [5, "I need a meal both goblin generals will eat. I should ask the goblins in Goblin Village for help."],
    [10, "The Goblin Cook needs charcoal before he can help me."],
    [15, "I should talk to the Goblin Cook about food that Wartface and Bentnoze will both eat."],
    [30, "The Goblin Cook needs orange slices dyed blue, spicy maggots and soggy bread."],
    [35, "I need to use the slop of compromise on the goblin generals in the dining room."],
    [40, "I freed Wartface and Bentnoze with slop of compromise."],
  ],
  "Pirate Pete": [
    [0, "I need to inspect Pirate Pete in the Lumbridge Castle dining room."],
    [10, "Pirate Pete needs fishcakes. I should ask the Cook how to make them."],
    [20, "I need ground cod, breadcrumbs, ground kelp and ground giant crab meat. Murphy at Port Khazard can help me dive for the underwater ingredients."],
    [30, "Murphy has given me diving gear. I need to wear it and ask him to take me diving."],
    [40, "I can gather kelp underwater. I should talk to Nung about entering the crab pen."],
    [50, "Nung wants five mudskipper hides before he will help me get giant crab meat."],
    [60, "I have given Nung the mudskipper hides. I should talk to him again."],
    [70, "Nung needs a needle and three bronze wires to make his clothes."],
    [80, "Nung has let me into the crab pen. I need giant crab meat for the fishcakes."],
    [90, "I should take the fishcake ingredients to the Cook, then combine them and cook the fishcake on a range."],
    [100, "I need to use a cooked fishcake on Pirate Pete in the dining room."],
    [110, "I freed Pirate Pete with a fishcake."],
  ],
  "Lumbridge Guide": [
    [0, "I need to inspect the Lumbridge Guide in the Lumbridge Castle dining room."],
    [1, "The Lumbridge Guide needs a cake of guidance. I should ask Wizard Traiborn in the Wizards' Tower for help."],
    [2, "Traiborn needs an egg, flour and milk. I must answer his questions to enchant each ingredient."],
    [3, "I have enchanted the ingredients. I need to combine them and bake the cake of guidance."],
    [4, "I need to use the cake of guidance on the Lumbridge Guide in the dining room."],
    [5, "I freed the Lumbridge Guide with a cake of guidance."],
  ],
  "Evil Dave": [
    [0, "I need to inspect Evil Dave in the Lumbridge Castle dining room."],
    [1, "Evil Dave needs a perfectly spiced stew. I should find him in Doris's basement in Edgeville."],
    [2, "Dave described his stew. I should ask Doris how to make it."],
    [3, "My cat can catch hell-rats for spices. I need Dave to taste stews to work out the right amount of each spice."],
    [4, "Dave has confirmed the right stew. I need to use a stew with that mixture of spices on him in the dining room."],
    [5, "I freed Evil Dave with a perfectly spiced stew."],
  ],
  "Skrach Uglogwee": [
    [0, "I need to inspect Skrach Uglogwee in the Lumbridge Castle dining room."],
    [10, "Skrach needs cooked jubbly. I should ask Rantz in the Feldip Hills how to hunt one."],
    [20, "I agreed to help Rantz make a boat. I should meet him by the coast."],
    [30, "Rantz wants help making a boat. I should follow him to the coast."],
    [40, "I should use an axe on the tree Rantz has knocked down by the coast."],
    [50, "I need to hollow out Rantz's fallen tree with an axe."],
    [60, "The boat is ready. I should talk to Rantz again."],
    [70, "I should follow Rantz's instructions for marking the tree and firing an arrow towards Karamja."],
    [80, "I cooked a chompy on Karamja's coast. I should take the ogre boat back to Rantz."],
    [90, "I returned on the ogre boat. I should ask Rantz about hunting jubbly."],
    [100, "I need a balloon toad to lure a jubbly: a bloated toad, swamp gas, a rock and a ball of wool."],
    [110, "My bellows contain swamp gas. I need a bloated toad, a rock and a ball of wool for the bait."],
    [120, "I have inflated a toad. I need a rock and a ball of wool to make balloon bait."],
    [130, "I have collected a rock. I need to make a balloon toad with swamp gas and a ball of wool."],
    [140, "I should place a balloon toad as bait, then hunt the jubbly that it attracts."],
    [150, "I should hunt the jubbly attracted by my balloon toad, then cook its meat on Rantz's spit roast."],
    [160, "I need to use cooked jubbly on Skrach Uglogwee in the dining room."],
    [170, "I freed Skrach Uglogwee with cooked jubbly."],
  ],
  "Sir Amik Varze": [
    [0, "I need to inspect Sir Amik Varze in the Lumbridge Castle dining room."],
    [5, "Sir Amik needs a creme brulee supreme. I should ask the Cook for the recipe."],
    [10, "I need milk, cream, cornflour, vanilla, an Evil Chicken's egg and cinnamon from a dramen branch. The Wise Old Man knows about the Evil Chicken; a dragon must flambe the finished mixture."],
    [20, "I freed Sir Amik Varze with a creme brulee supreme."],
  ],
  "King Awowogei": [
    [0, "I need to inspect King Awowogei in the Lumbridge Castle dining room."],
    [1, "I should ask King Awowogei on Ape Atoll about his favourite food."],
    [5, "King Awowogei will not tell me his favourite food. I should ask the three wise monkeys."],
    [10, "I should bring a banana and monkey nuts to the three wise monkeys to find out the real recipe."],
    [15, "I need a large snake corpse, a red banana and tchiki monkey nuts. The three wise monkeys can explain where to find them."],
    [20, "I need to stuff the snake with sliced red banana and tchiki nut paste."],
    [30, "I need to cook the stuffed snake on the hot rocks in the Ape Atoll dungeon while disguised as a zombie monkey."],
    [40, "I need to use the cooked stuffed snake on King Awowogei in the dining room."],
    [50, "I freed King Awowogei with a stuffed snake."],
  ],
};
