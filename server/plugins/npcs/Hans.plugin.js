// https://oldschool.runescape.wiki/w/Hans
const AGE_QUESTION = "Can you tell me how long I've been here?";
const AGE_LINE = "You've spent [amount] days, [amount] hours, [amount] minutes in the world since you arrived [amount] days ago.";
const AGE_TASK = "learn-your-age-from-hans-in-lumbridge";
const DAY_MS = 86400_000;

function ageSteps(steps) {
  return steps.find(step => step.type === "choice")?.options
    .find(option => option.text === AGE_QUESTION)?.steps.slice(1);
}

function showAge(api, { player, npc, npcId }) {
  const request = { player, npc, npcId, variant: { page: "Hans", variant: "standard-dialogue" }, exact: true, select: ageSteps };
  api.emitCustomEvent("npc-dialogue:start", request);
  return request.handled === true;
}

function fillAge(api, request) {
  if (request.npcId !== api.core.NpcIdentifiers.HANS || request.text !== AGE_LINE
    || !request.pages.some(page => page.page === "Hans")) return;
  const { player } = request;
  const time = { player, milliseconds: 0 };
  api.emitCustomEvent("account:play-time", time);
  const minutes = Math.max(0, Math.floor(time.milliseconds / 60000));
  const amounts = [Math.floor(minutes / 1440), Math.floor(minutes / 60) % 24, minutes % 60,
    Math.max(0, Math.floor((Date.now() - player.getCreationDate().getTime()) / DAY_MS))];
  request.text = AGE_LINE.replace(/\[amount\]/g, () => amounts.shift());
  request.before = () => {
    const location = player.getLocation();
    if (player.getPrivateArea() === null && (location.getX() >> 6) === 50 && (location.getY() >> 6) === 50) {
      api.emitCustomEvent("diary:task", { player, diary: "lumbridge", task: AGE_TASK });
    }
  };
}

module.exports = {
  name: "Hans",
  register(api) {
    api.onNpcInteraction("Hans", { Age: showAge.bind(null, api) });
    api.onCustomEvent("npc-dialogue:line", fillAge.bind(null, api));
  },
};
