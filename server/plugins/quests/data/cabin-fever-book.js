// The Little Book o' Piracy, from Transcript:Book o' Piracy (oldid 15295173).
// The book widget gives each page 15 lines, so the wiki paragraphs are wrapped
// to the page width and paired into left/right spreads here rather than stored
// as hand-broken lines.
const WIDTH = 36;
const LINES_PER_PAGE = 15;

const CHAPTERS = [
  {
    heading: "Chapter 1; So you've decided to become a pirate.",
    paragraphs: [
      "Piracy; a life of adventure and romance. The stuff of legends and tales told all over the world. And you, humble reader, have decided to join these brave men and women in the exciting field of unlicensed privateering and wholesale plunder redistribution. I congratulate you on making the correct lifestyle choice.",
      "While many consider pirates to be unwashed, ignorant, thieving brigands, the truth is that they are a valued and important part of the economy. Without them, the architects that design sea-defences against their attacks would be unemployed. The guards in sea ports would be laid off, and the honest merchants that buy their second-hand goods would lose a small portion of their income. So you see, by living a life filled with adventure, thievery, romance, plundering, danger and stealing, they are adding to the happiness of the community as a whole. Surely these brave individuals have nothing to be ashamed of for selling their hard-earned loot to respectable merchants in exchange for a reasonable sum of gold. I would go as far as to say it is their duty to redistribute such wealth that they come across in this way, so as to uphold the noble, ancient and profitable honour of the pirates.",
    ],
  },
  {
    heading: "Chapter 2; Looking like a pirate",
    paragraphs: [
      "First, to be recognised as a pirate, you have to look like a pirate. If you look like an accountant, then people will be confused when you begin talking about 'briny deep' this and 'plundering' that. It also saves time explaining at parties and other social gatherings exactly what you do for a living, allowing precious extra hours of plundering and looting. Pirates must look nautical. This look can be achieved by wearing trousers made from old sails, usually striped. You can also wear an old, tattered naval uniform, as this makes you look like you have been trained by the navy before you left for your own, dark and grim reasons. I suggest you come up with at least two good reasons why you left, as customs and excise tend to alert naval officials to 'deserters'.",
      "Piracy is a dangerous profession, and can be hazardous to the pirates' extremities. Preventing such injuries with either a hand-covering hook or a patch to protect your eye is always a good plan. This also leaves you prepared for the eventual loss of the extremity, as you are already carrying a replacement around with you. Piratical accessories can also include (but are not limited to) cutlasses and scimitars, pirate hats, face masks, bandanas and flashy jewellery.",
    ],
  },
  {
    heading: "Chapter 3; Pirate -> Gielinorian Phrasebook.",
    paragraphs: [
      "Arr -> Good Morning/Hello/I agree.",
      "Scurvy -> 1. Disease contracted when sailing, caused by lack of fresh fruit and vegetables. Eg, 'Cap'n, the gunners be a bunch of scurvy dogs.' 2. Inferior/untrustworthy. Eg, 'Cap'n, the gunners be a bunch of scurvy dogs.'",
      "Cap'n -> Captain.",
      "Plunder -> Anything of value that can be traded with any honest Al Kharidian merchants for a reasonable sum of money.",
      "Landlubber -> Non-Pirate.",
      "Garr! -> I am going to attack you/Take this!/It is time for fisticuffs and no mistake.",
      "I say we keelhaul 'em! -> I propose we do unpleasant things to them until they are dead, very sorry or both.",
      "Aye aye! -> I am in emphatic or otherwise exuberant agreement with your statement.",
      "Say that again and I'll kill ye! -> I deny the truth of your statement.",
      "Ye/Yer/Ye'll/Ye've -> You/Your/You'll/You've",
      "Want a sip of 'rum'? -> I would like to poison you.",
      "Grog -> Alcohol, with the exception of 'rum'.",
      "'Rum' -> 1. Anything poisonous/Acidic or caustic substance. 2. The concentrated, liquid form of all that is foul.",
      "Go see Ali -> Travel to Al Kharid to sell loot and purchase top-quality products.",
      "Broadside -> 1. To fire all cannons on one side of the ship at the same time. 2. A pirate of great size.",
      "I'm not a pirate, I'm a privateer -> I am a pirate, and I'm getting paid for it.",
      "Parle -> I have become tired of life, kill me at your leisure.",
      "Widdershins -> A debilitating disease caused by eating mouldy biscuits for a month. Symptoms include weakness in the limbs, spinning vision, spontaneous combustion and implosion of the earlobes.",
      "Forbye -> A common greeting said (be)for(e) (good)bye. 'Forbye, Cap'n! Lovely day!'",
      "Hornswaggle -> To swaggle (or cover with soft cloth) the ship's horn (or compass) to keep it safe and dry during storms.",
      "Drivelswigger -> Small metal implement used for removing weevils from hard tack rations.",
      "Abaft -> Direct polar opposite of avast.",
      "Binnacled -> Condition relating to the consumption of excessive quantities of cheap alcohol, or small quantities of 'rum'. 'Sound the alarm Mr Bosun, pirates off the starboard bow!' 'Not so loud Cap'n, I be feelin' a little binnacled.'",
      "Duffle -> Somewhat like a seafaring goblin, only not.",
      "Athwartships -> A period spent apprenticed to a pirate, learning piracy, getting drunk, and culminating in the loss of a leg, eye or hand.",
      "Davy's Grip -> Popular drinking game involving mangoes, a hammer, and all the corkscrews that players can get their hands on.",
    ],
  },
];

function wrap(text, width = WIDTH) {
  const words = String(text).split(/\s+/).filter(Boolean);
  const lines = [];
  let line = "";
  for (const word of words) {
    if (!line) {
      line = word;
    } else if (line.length + 1 + word.length <= width) {
      line += ` ${word}`;
    } else {
      lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);
  return lines;
}

function bookLines() {
  const lines = [];
  for (const chapter of CHAPTERS) {
    lines.push(...wrap(chapter.heading), "");
    for (const paragraph of chapter.paragraphs) {
      lines.push(...wrap(paragraph), "");
    }
  }
  return lines;
}

const lines = bookLines();
const pages = [];
for (let index = 0; index < lines.length; index += LINES_PER_PAGE * 2) {
  const left = lines.slice(index, index + LINES_PER_PAGE);
  const right = lines.slice(index + LINES_PER_PAGE, index + LINES_PER_PAGE * 2);
  pages.push(Object.fromEntries([
    ...left.map((text, line) => [44 + line, text]),
    ...right.map((text, line) => [60 + line, text]),
  ]));
}

module.exports = {
  title: "The Little Book o' Piracy",
  pages,
};
