/**
 * Tai Bwo Wannai Trio's quest journal. The started page is RSProx capture 75's (revision 227, tick 3142):
 * "I need to find the three sons of Timfraku:", the three names, a gap and "I need to convince them to return
 * to the village.". Ours: the lines for each son's progress and the finished page, which no capture shows.
 */
function brotherLine(name, done) {
  return done ? `<str>${name}</str>` : `<col=800000>${name}`;
}

function buildJournal(t, player) {
  const { STAGE, KEY, TIADECHE, TINSAY, TAMAYU, LUBUFU } = t;
  const stage = t.stage(player);
  if (stage < STAGE.STARTED) {
    return [
      "I can start this quest by speaking to",
      "<col=800000>Timfraku</col> in <col=800000>Tai Bwo Wannai</col>.",
      "",
      "I must have completed <col=800000>Jungle Potion</col>.",
      "I will need 30 Cooking, 15 Agility and 5 Fishing.",
    ];
  }
  if (stage >= STAGE.COMPLETE) {
    return [
      "<str>Trufitus communed with the gods and Tai Bwo Wannai was safe.</str>",
      "<str>I helped Timfraku's three sons return to the village.</str>",
      "",
      "<col=ff0000>QUEST COMPLETE!</col>",
    ];
  }
  const tiadeche = t.state(player, KEY.TIADECHE);
  const tinsay = t.state(player, KEY.TINSAY);
  const tamayu = t.state(player, KEY.TAMAYU);
  const lubufu = t.state(player, KEY.LUBUFU);
  const lines = [
    "<col=000080>I need to find the three sons of <col=800000>Timfraku:",
    brotherLine("Tamayu", tamayu >= TAMAYU.DONE),
    brotherLine("Tinsay", tinsay >= TINSAY.DONE),
    brotherLine("Tiadeche", tiadeche >= TIADECHE.DONE),
    "",
    "<col=000080>I need to convince them to return to the village.",
  ];
  if (tamayu >= TAMAYU.WATCHED && tamayu < TAMAYU.DONE) lines.push("", "Tamayu is having difficulty in his hunt for the Shaikahan.");
  if (tinsay >= TINSAY.BANANA && tinsay < TINSAY.DONE) {
    const wants = tinsay >= TINSAY.BONES ? "burnt Jogre bones marinated in Karambwanji"
      : tinsay >= TINSAY.SANDWICH ? "a seaweed in monkey skin sandwich" : "banana in Karamjan rum";
    lines.push("", `Tinsay wants ${wants}.`);
  }
  if (tiadeche >= TIADECHE.WAITING && tiadeche < TIADECHE.TRAPPED) lines.push("", "Tiadeche will only return once he has caught a Karambwan.");
  if (tiadeche >= TIADECHE.ASKED_MANUAL && tiadeche < TIADECHE.DONE) {
    lines.push("", tiadeche >= TIADECHE.HAS_MANUAL ? "I must take Tinsay's crafting manual to Tiadeche." : "I must take a Karambwan vessel to Tinsay.");
  }
  if (lubufu >= LUBUFU.FETCH && lubufu < LUBUFU.GIVEN) lines.push("", "Lubufu wants 20 raw Karambwanji.");
  if (stage >= STAGE.BROTHERS_DONE) lines.push("", "All three sons have agreed to return. I must speak with <col=800000>Timfraku</col>.");
  return lines;
}

module.exports = { buildJournal };
