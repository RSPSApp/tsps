const colours = ['#ed796d', '#9dd56e', '#73b9ef'];
const names = ['X', 'Y', 'Z'];
const distance = (x, y, a, b) => {
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / (dx * dx + dy * dy || 1)));
    return Math.hypot(x - a[0] - t * dx, y - a[1] - t * dy);
};
export function drawGizmo(view, configuration) {
    if (!configuration || view.animation)
        return [];
    const { ctx } = view, { origin, directions, partId } = configuration;
    const mode = configuration.mode ?? view.gizmoMode ?? 'move', centre = view.project(origin);
    const units = Math.max(.1, (view.distance + centre[2]) / (view.height * 1.25));
    const size = units * 78, handles = [];
    ctx.save();
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.font = 'bold 12px Trebuchet MS';
    for (let axis = 0; axis < 3; axis++) {
        ctx.globalAlpha = configuration.previewAxis === undefined || configuration.previewAxis === axis ? 1 : .25;
        const direction = mode === 'move' ? [0, 1, 2].map(i => i === axis ? 1 : 0) : directions[axis];
        const end = view.project(origin.map((n, i) => n + direction[i] * size));
        let points = [centre, end];
        if (mode === 'rotate') {
            const a = directions[(axis + 1) % 3], b = directions[(axis + 2) % 3];
            points = Array.from({ length: 65 }, (_, n) => {
                const angle = n / 64 * Math.PI * 2;
                return view.project(origin.map((v, i) => v + size * (a[i] * Math.cos(angle) + b[i] * Math.sin(angle))));
            });
        }
        else if (Math.hypot(end[0] - centre[0], end[1] - centre[1]) < 14)
            continue;
        ctx.strokeStyle = '#100e0a';
        ctx.lineWidth = 6;
        path(ctx, points);
        ctx.stroke();
        ctx.strokeStyle = colours[axis];
        ctx.lineWidth = 3;
        path(ctx, points);
        ctx.stroke();
        ctx.fillStyle = colours[axis];
        if (mode === 'move') {
            const angle = Math.atan2(end[1] - centre[1], end[0] - centre[0]);
            ctx.beginPath();
            ctx.moveTo(end[0] + Math.cos(angle) * 6, end[1] + Math.sin(angle) * 6);
            ctx.lineTo(end[0] + Math.cos(angle + 2.4) * 10, end[1] + Math.sin(angle + 2.4) * 10);
            ctx.lineTo(end[0] + Math.cos(angle - 2.4) * 10, end[1] + Math.sin(angle - 2.4) * 10);
            ctx.closePath();
            ctx.fill();
        }
        else if (mode === 'scale')
            ctx.fillRect(end[0] - 5, end[1] - 5, 10, 10);
        const label = mode === 'rotate' ? points[8] : end;
        ctx.strokeStyle = '#100e0a';
        ctx.lineWidth = 3;
        const text = mode === 'scale' && configuration.scaleLabels ? `${names[axis]} ${configuration.scaleLabels[axis]}` : names[axis];
        ctx.strokeText(text, label[0] + 9, label[1] - 6);
        ctx.fillText(text, label[0] + 9, label[1] - 6);
        // Inspector feedback must not change the active interaction mode.
        if (configuration.previewAxis === undefined) handles.push({ axis, partId, mode, direction, points, units, size });
    }
    ctx.restore();
    return handles;
}
function path(ctx, points) { ctx.beginPath(); points.forEach((p, i) => i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])); }
export function pickGizmo(handles, x, y) {
    let best = null, closest = 9;
    for (const handle of handles ?? [])
        for (let i = 1; i < handle.points.length; i++) {
            const a = handle.points[i - 1], b = handle.points[i], d = distance(x, y, a, b);
            if (d >= closest)
                continue;
            const length = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
            closest = d;
            best = { ...handle, tangent: [(b[0] - a[0]) / length, (b[1] - a[1]) / length], pixelsPerUnit: handle.mode === 'move' ? length / handle.size : 1 };
        }
    return best;
}
export function gizmoDelta(handle, dx, dy) {
    const pixels = dx * handle.tangent[0] + dy * handle.tangent[1];
    if (handle.mode === 'move')
        return { movement: handle.direction.map(n => n * pixels / handle.pixelsPerUnit) };
    if (handle.mode === 'rotate')
        return { angle: pixels * .75 };
    return { factor: Math.exp(pixels / 90) };
}
