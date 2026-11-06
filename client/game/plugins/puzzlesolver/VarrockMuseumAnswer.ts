/*
 * Copyright (c) 2018, Viktor <Viktor.horsmanheimo@teknik.io>
 * Copyright (c) 2018, Tomas Slusny <slusnucky@gmail.com>
 * All rights reserved.
 * Ported to TypeScript from RuneLite. BSD 2-Clause License, see ./LICENSE.
 */

/** The Natural History quiz: each question and its correct answer (RuneLite's VarrockMuseumAnswer). */
const ANSWERS: ReadonlyArray<readonly [question: string, answer: string]> = [
    ["How does a lizard regulate body heat?", "Sunlight."], // LIZARD_1
    ["Who discovered how to kill lizards?", "The Slayer Masters."], // LIZARD_2
    ["How many eyes does a lizard have?", "Three."], // LIZARD_3
    ["What order do lizards belong to?", "Squamata."], // LIZARD_4
    ["What happens when a lizard becomes cold?", "It becomes sleepy."], // LIZARD_5
    ["Lizard skin is made of the same substance as?", "Hair."], // LIZARD_6
    ["What is the name of the oldest tortoise ever recorded?", "Mibbiwocket."], // TORTOISE_1
    ["What is a tortoise's favourite food?", "Vegetables."], // TORTOISE_2
    ["Name the explorer who discovered the world's oldest tortoise.", "Admiral Bake."], // TORTOISE_3
    ["How does the tortoise protect itself?", "Hard shell."], // TORTOISE_4
    ["If a tortoise had twenty rings on its shell, how old would it be?", "Twenty years."], // TORTOISE_5
    ["Which race breeds tortoises for battle?", "Gnomes."], // TORTOISE_6
    ["What is considered a delicacy by dragons?", "Runite."], // DRAGON_1
    ["What is the best defence against a dragon's attack?", "Anti dragon-breath shield."], // DRAGON_2
    ["How long do dragons live?", "Unknown."], // DRAGON_3
    ["Which of these is not a type of dragon?", "Elemental."], // DRAGON_4
    ["What is the favoured territory of a dragon?", "Old battle sites."], // DRAGON_5
    ["Approximately how many feet tall do dragons stand?", "Twelve."], // DRAGON_6
    ["How did the wyverns die out?", "Climate change."], // WYVERN_1
    ["How many legs does a wyvern have?", "Two."], // WYVERN_2
    ["Where have wyvern bones been found?", "Asgarnia."], // WYVERN_3
    ["Which genus does the wyvern theoretically belong to?", "Reptiles."], // WYVERN_4
    ["What are the wyverns' closest relations?", "Dragons."], // WYVERN_5
    ["What is the ambient temperature of wyvern bones?", "Below room temperature."], // WYVERN_6
    ["What is special about the shell of the giant Morytanian snail?", "It is resistant to acid."], // SNAIL_1
    ["How do Morytanian snails capture their prey?", "Spitting acid."], // SNAIL_2
    ["Which of these is a snail byproduct?", "Fireproof oil."], // SNAIL_3
    ["What does 'Achatina Acidia' mean?", "Acid-spitting snail."], // SNAIL_4
    ["How do snails move?", "Contracting and stretching."], // SNAIL_5
    ["What is the 'trapdoor', which snails use to cover the entrance to their shells called?", "An operculum."], // SNAIL_6
    ["What is snake venom adapted from?", "Stomach acid."], // SNAKE_1
    ["Aside from their noses, what do snakes use to smell?", "Tongue."], // SNAKE_2
    ["If a snake sticks its tongue out at you, what is it doing?", "Seeing how you smell."], // SNAKE_3
    ["If some snakes use venom to kill their prey, what do other snakes use?", "Constriction."], // SNAKE_4
    ["Lizards and snakes belong to the same order - what is it?", "Squamata."], // SNAKE_5
    ["Which habitat do snakes prefer?", "Anywhere."], // SNAKE_6
    ["We assume that sea slugs have a stinging organ on their soft skin - what is it called?", "Nematocysts."], // SLUG_1
    ["Why has the museum never examined a live sea slug?", "The researchers keep vanishing."], // SLUG_2
    ["What do we think the sea slug feeds upon?", "Seaweed."], // SLUG_3
    ["What are the two fangs presumed to be used for?", "Defense or display."], // SLUG_4
    ["Off of which coastline would you find sea slugs?", "Ardougne."], // SLUG_5
    ["In what way are sea slugs similar to snails?", "They have a hard shell."], // SLUG_6
    ["Which type of primates do monkeys belong to?", "Simian."], // MONKEY_1
    ["Which have the lighter colour: Karamjan or Harmless monkeys?", "Harmless."], // MONKEY_2
    ["Monkeys love bananas. What else do they like to eat?", "Bitternuts."], // MONKEY_3
    ["There are two known families of monkeys. One is Karamjan, the other is...?", "Harmless."], // MONKEY_4
    ["What colour mohawk do Karamjan monkeys have?", "Red."], // MONKEY_5
    ["What have Karamjan monkeys taken a deep dislike to?", "Seaweed."], // MONKEY_6
    ["Kalphites are ruled by a...?", "Pasha."], // KALPHITE_1
    ["What is the lowest caste in kalphite society?", "Worker."], // KALPHITE_2
    ["What are the armoured plates on a kalphite called?", "Lamellae."], // KALPHITE_3
    ["Are kalphites carnivores, herbivores or omnivores?", "Carnivores."], // KALPHITE_4
    ["What are kalphites assumed to have evolved from?", "Scarab beetles."], // KALPHITE_5
    ["Name the prominent figure in kalphite mythology?", "Scabaras."], // KALPHITE_6
    ["What is a terrorbird's preferred food?", "Anything."], // TERRORBIRD_1
    ["Who use terrorbirds as mounts?", "Gnomes."], // TERRORBIRD_2
    ["Where do terrorbirds get most of their water?", "Eating plants."], // TERRORBIRD_3
    ["How many claws do terrorbirds have?", "Four."], // TERRORBIRD_4
    ["What do terrorbirds eat to aid digestion?", "Stones."], // TERRORBIRD_5
    ["How many teeth do terrorbirds have?", "0."], // TERRORBIRD_6
    ["Which sense do penguins rely on when hunting?", "Sight."], // PENGUIN_1
    ["Which skill seems unusual for the penguins to possess?", "Planning."], // PENGUIN_2
    ["How do penguins keep warm?", "A layer of fat."], // PENGUIN_3
    ["What is the preferred climate for penguins?", "Cold."], // PENGUIN_4
    ["Describe the behaviour of penguins?", "Social."], // PENGUIN_5
    ["When do penguins fast?", "During breeding."], // PENGUIN_6
    ["What habitat do moles prefer?", "Subterranean."], // MOLE_1
    ["Why are moles considered to be an agricultural pest?", "They dig holes."], // MOLE_2
    ["Who discovered giant moles?", "Wyson the Gardener."], // MOLE_3
    ["What would you call a group of young moles?", "A labour."], // MOLE_4
    ["What is a mole's favourite food?", "Insects and other invertebrates."], // MOLE_5
    ["Which family do moles belong to?", "The Talpidae family."], // MOLE_6
    ["What is produced by feeding chilli to a camel?", "Toxic dung."], // CAMEL_1
    ["If an ugthanki has one, how many does a bactrian have?", "Two."], // CAMEL_2
    ["Camels: herbivore, carnivore or omnivore?", "Omnivore."], // CAMEL_3
    ["What is the usual mood for a camel?", "Annoyed."], // CAMEL_4
    ["Where would you find an ugthanki?", "Al Kharid."], // CAMEL_5
    ["Which camel byproduct is known to be very nutritious?", "Milk."], // CAMEL_6
    ["What is the favoured habitat of leeches?", "Water."], // LEECH_1
    ["What shape is the inside of a leech's mouth?", "'Y'-shaped."], // LEECH_2
    ["Which of these is not eaten by leeches?", "Apples."], // LEECH_3
    ["What contributed to the giant growth of Morytanian leeches?", "Environment."], // LEECH_4
    ["What is special about Morytanian leeches?", "They attack by jumping."], // LEECH_5
    ["How does a leech change when it feeds?", "It doubles in size."], // LEECH_6
];

const MATCHES: ReadonlyMap<string, string> = new Map(ANSWERS);

/** The correct answer to a quiz question, or undefined for a question RuneLite does not know. */
export function correctMuseumAnswer(question: string): string | undefined {
    return MATCHES.get(question);
}

/** Every question RuneLite knows, for cross-checks. */
export function museumQuestions(): string[] {
    return ANSWERS.map(([question]) => question);
}
