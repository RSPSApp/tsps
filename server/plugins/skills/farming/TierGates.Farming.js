/**
 * Farming Guild tier gates. Wiki (Farming Guild): the guild needs 45 Farming, the west wing (intermediate tier) 65 and the
 * north wing (advanced tier) 85, and "a boost can be used to enter" either. Dropping below the level once inside does not
 * expel anyone, so only the step inwards is refused, never the step out.
 *
 * The cache map holds both gates already open (kebos_farming_guild gate leaves 34471/34472 at 1243,3729-3730 and
 * 34475/34476 at 1248-1249,3745, between the posts 34467/34468): the wiki says the guild's doors "remain open with
 * invisible barriers", and a barrier that depends on the player's level is not something the clipping map can hold. So
 * each gate is an Area around its approach that vetoes the queued step across it (Area.canPlayerStep).
 * No capture or wiki quote shows the refusal line, so it is TSPS wording, as for the guild entrance (Guild.Farming).
 */
const core = require("./Core.Farming");

const THROTTLE_TICKS = 10;
const lastRefusal = new WeakMap();

/**
 * `from`/`into` say which step crosses the gate: a step from the tile row/column `from` onto `into`, between `across`.
 * `area` covers the approach so a run of two tiles starts inside it; the step itself is the only thing refused.
 */
const GATES = [
    {
        name: "intermediate tier", level: 65, axis: "x", from: 1244, into: 1243, across: [3729, 3730],
        area: [1244, 1249, 3727, 3733],
    },
    {
        name: "advanced tier", level: 85, axis: "y", from: 3744, into: 3745, across: [1248, 1249],
        area: [1246, 1251, 3738, 3744],
    },
];

function crosses(gate, source, destination) {
    const [a, b] = gate.axis === "x" ? [source.getX(), destination.getX()] : [source.getY(), destination.getY()];
    if (a !== gate.from || b !== gate.into) return false;
    const along = gate.axis === "x" ? destination.getY() : destination.getX();
    return along >= gate.across[0] && along <= gate.across[1];
}

/** Whether the player stands on the tile in front of the gate, facing the veto. */
function atGate(gate, location) {
    const [a, along] = gate.axis === "x" ? [location.getX(), location.getY()] : [location.getY(), location.getX()];
    return a === gate.from && along >= gate.across[0] && along <= gate.across[1];
}

function allowed(player, gate) {
    return player.getSkillManager().getCurrentLevel(core.Skill.FARMING) >= gate.level;
}

function refuse(player, gate) {
    const cycle = core.World.getProcessCycle();
    if (cycle - (lastRefusal.get(player) ?? -THROTTLE_TICKS) < THROTTLE_TICKS) return;
    lastRefusal.set(player, cycle);
    player.sendMessage(`You need a Farming level of ${gate.level} to enter the ${gate.name} of the Farming Guild.`);
}

class TierGateArea extends core.Area {
    canPlayerStep(player, source, destination) {
        const gate = GATES.find((candidate) => crosses(candidate, source, destination));
        return gate && !allowed(player, gate) ? false : null;
    }

    process(mobile) {
        if (!mobile.isPlayer()) return;
        const player = mobile.getAsPlayer();
        if (!player.getMovementQueue().wasRouteInvalidated()) return;
        const gate = GATES.find((candidate) => atGate(candidate, player.getLocation()));
        if (gate && !allowed(player, gate)) refuse(player, gate);
    }
}

function area() {
    return new TierGateArea(GATES.map(({ area: [x, x2, y, y2] }) => new core.Boundary(x, x2, y, y2, 0)));
}

module.exports = { area, GATES };
