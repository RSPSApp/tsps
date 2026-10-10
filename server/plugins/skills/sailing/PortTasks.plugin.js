// Port tasks (courier tasks; bounty tasks show on the boards but can't be taken yet): notice
// boards, ledger tables, the cargo hold's crates, port masters and the reward bags. See
// docs/port-tasks.md.
const common = require("./porttasks/Common.PortTasks");

function sendState({ player }) {
  common.sendSlots(player);
  const completed = player.getAttribute(common.COMPLETED_ATTRIBUTE);
  if (completed) player.getPacketSender().sendConfig(common.VARP_TASKS_COMPLETED, completed.total ?? 0);
}

function answerOpenSlot(request) {
  const { player } = request;
  const slots = common.slots(player);
  request.available = slots.slice(0, common.slotLimit(player)).some((slot) => !slot);
}

module.exports = {
  name: "SailingPortTasks",
  members: true,
  register(api) {
    common.init(api);
    api.persistAttribute(common.SLOTS_ATTRIBUTE);
    api.onCustomEvent("sailing:has-port-task-slot", answerOpenSlot);
    api.onPlayerLogin(sendState);
    require("./porttasks/Board.PortTasks")(api);
    require("./porttasks/Ledger.PortTasks")(api);
    require("./porttasks/PortMaster.PortTasks")(api);
    require("./porttasks/Bags.PortTasks")(api);
  },
};
