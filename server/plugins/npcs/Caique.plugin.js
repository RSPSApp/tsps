/**
 * The sitting caiques of Kastori and the north of the Tlati Rainforest peck the hand that pets
 * them (Wiki: Caique, Transcript:Caique). RSProx 237/1098, from the arrival: busy goes on; two
 * ticks later the player plays vmq4_human_caique_pet and the bird vmq4_caique_peck; two more and
 * the player takes 1 damage (none at 1 Hitpoints), sound 521 plays and busy goes off; the message
 * box follows a tick later, then the player's "Ouch!".
 *
 * Only the sitting variants (varlamore_parrot_caique_rock_*) offer Pet; the flying ones have no
 * options. The Leagues task "Pet a Caique" isn't hooked up.
 */
const SEQUENCES = { player: "vmq4_human_caique_pet", bird: "vmq4_caique_peck" };
const PECK_SOUND = 521;
const PECK_SOUND_DELAY = 20;
const BUSY_VARBIT = "busy";
const ANIMATE_TICKS = 2;
const PECK_TICKS = 4;
const MESSAGE_TICKS = 5;
const PECKED = "You try to pet the bird, but it pecks your hand in return.";
const OUCH = "Ouch!";

const petting = new WeakSet();

function setBusy(core, player, on) {
  const id = core.CacheDefinitions.getVarbitId(BUSY_VARBIT);
  if (id != null) player.getPacketSender().sendVarbit(id, on ? 1 : 0);
}

function animate(core, entity, sequence) {
  entity.performAnimation(new core.Animation(core.CacheDefinitions.getSeqId(sequence)));
}

function peck(core, player) {
  const damage = player.getHitpoints() > 1 ? 1 : 0;
  player.getCombat().getHitQueue().addPendingDamage([new core.HitDamage(damage, damage > 0 ? core.HitMask.RED : core.HitMask.BLUE)]);
  player.getPacketSender().sendSoundEffect(PECK_SOUND, 1, PECK_SOUND_DELAY, 255);
}

function complain(core, player) {
  const { DialogueChainBuilder, StatementDialogue, PlayerDialogue, EndDialogue } = core;
  player.getDialogueManager().startDialogues(new DialogueChainBuilder()
    .add(new StatementDialogue(0, PECKED))
    .add(new PlayerDialogue(1, OUCH))
    .add(new EndDialogue(2)));
}

/** The captured steps, by ticks from the arrival. A logout, death or move ends them early. */
function steps(core, player, npc) {
  return {
    [ANIMATE_TICKS]: () => {
      animate(core, player, SEQUENCES.player);
      if (npc.isRegistered()) animate(core, npc, SEQUENCES.bird);
    },
    [PECK_TICKS]: () => {
      peck(core, player);
      setBusy(core, player, false);
      player.getMovementQueue().setBlockMovement(false);
    },
    [MESSAGE_TICKS]: () => complain(core, player),
  };
}

function pet(core, { player, npc }) {
  if (petting.has(player) || player.getMovementQueue().isMovementBlocked()) return true;
  petting.add(player);
  setBusy(core, player, true);
  player.getMovementQueue().setBlockMovement(true).reset();
  const timeline = steps(core, player, npc);
  const start = player.getLocation().clone();
  let tick = 0;
  core.TaskManager.submit(new (class extends core.Task {
    constructor() { super(1, player, false); }
    execute() {
      if (!player.isRegistered() || player.getHitpoints() <= 0 || !player.getLocation().equals(start)) {
        this.stop();
        return;
      }
      tick++;
      timeline[tick]?.();
      if (tick >= MESSAGE_TICKS) this.stop();
    }
    stop() {
      super.stop();
      if (!petting.has(player)) return;
      petting.delete(player);
      if (tick < PECK_TICKS) {
        setBusy(core, player, false);
        player.getMovementQueue().setBlockMovement(false);
      }
    }
  })());
  return true;
}

module.exports = {
  name: "Caique",
  members: true,
  _test: { pet, PECKED, OUCH },
  register(api) {
    api.onNpcInteraction("Caique", { Pet: pet.bind(null, api.core) });
  },
};
