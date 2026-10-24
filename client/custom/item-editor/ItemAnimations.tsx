import { useEffect, useState } from 'react';
import { request } from './ItemAuthoring';
type Combat = {
    weapon: boolean;
    category: string;
    idle: number;
    walk: number;
    run: number;
    block: number;
    styles: {
        name: string;
        stance: string;
        attackType: string;
        rapid: boolean;
        animation: number;
        npcAnimation: number;
        xp: string[];
    }[];
    special: {
        name: string;
        energy: number;
        animations: number[];
    } | null;
};
const label = (value: string) => value.toLowerCase().replace(/_/g, ' ').replace(/^./, first => first.toUpperCase());
export function ItemAnimations({ id, inherited, onPlay, equipable }: {
    id: number;
    inherited: boolean;
    onPlay: (id: number) => void;
    equipable: boolean;
}) {
    const [data, setData] = useState<Combat>();
    const [error, setError] = useState('');
    const [retry, setRetry] = useState(0);
    const [previewId, setPreviewId] = useState('');
    const [previewError, setPreviewError] = useState('');
    const play = (id: number) => <button className="item-editor-animation-play" disabled={!equipable} aria-label={`Play animation ${id}`} onClick={() => onPlay(id)}>Play</button>;
    useEffect(() => {
        let cancelled = false;
        setData(undefined);
        setError('');
        request(`/${id}/animations`).then(value => { if (!cancelled)
            setData(value); })
            .catch(error => { if (!cancelled)
            setError(error.message); });
        return () => { cancelled = true; };
    }, [id, retry]);
    return <details className="item-editor-effective-details item-editor-animations" open>
        <summary>Animations & combat styles</summary>
        <form className="item-editor-animation-input" onSubmit={event => {
            event.preventDefault();
            const value = previewId.trim();
            if (!/^\d+$/.test(value) || Number(value) > 65535) {
                setPreviewError('Enter a whole Animation ID from 0 to 65535.');
                return;
            }
            setPreviewError('');
            onPlay(Number(value));
        }}>
            <label>Preview animation ID<input type="text" inputMode="numeric" value={previewId} placeholder="e.g. 9460" aria-invalid={!!previewError} aria-describedby="item-editor-animation-input-note" onChange={event => { setPreviewId(event.target.value); setPreviewError(''); }}/></label>
            <button type="submit" disabled={!equipable} aria-label="Play preview animation">Play</button>
            <p id="item-editor-animation-input-note">Preview only · plays once · does not change this item.</p>
            {previewError && <p role="alert">{previewError}</p>}
        </form>
        {!equipable && <p>Animation preview requires an equipable item.</p>}
        {error ? <p>{error} <button onClick={() => setRetry(value => value + 1)}>Retry</button></p>
            : !data ? <p>Loading weapon animations…</p> : !data.weapon ? <p>No weapon combat styles. Animation preview is available for worn models.</p> : <>
                <p>{label(data.category)}{inherited ? ` · Inherited from base item #${id}` : ''} · Read only</p>

                <dl><dt>Idle Animation ID</dt><dd>{data.idle} {play(data.idle)}</dd><dt>Walk Animation ID</dt><dd>{data.walk} {play(data.walk)}</dd>
                    <dt>Run Animation ID</dt><dd>{data.run} {play(data.run)}</dd><dt>Block without shield</dt><dd>{data.block} {play(data.block)}</dd></dl>
                {data.styles.map((style, index) => <article className="item-editor-combat-style" key={index}>
                    <strong>{style.name} · {label(style.stance)}</strong>
                    <p>{label(style.attackType)}{style.rapid ? ' · Rapid' : ''}</p>
                    <dl><dt>Animation ID</dt><dd>{style.animation} {play(style.animation)}</dd>
                        {style.npcAnimation !== style.animation && <><dt>Against NPCs</dt><dd>{style.npcAnimation} {play(style.npcAnimation)}</dd></>}
                        <dt>XP skills</dt><dd>{style.xp.join(' + ')}</dd></dl>
                </article>)}
                <p>Damaging attacks also award Hitpoints XP. XP shown describes the weapon styles; spell casting and its XP depend on the selected spell.</p>
                <h3>Special attack</h3>
                {data.special ? <><p>{label(data.special.name)} · {data.special.energy}% energy</p>
                    <p>Animation IDs in combat plugin: {data.special.animations.length ? data.special.animations.map(id => <span key={id}>{id} {play(id)} </span>) : 'Not exposed as literal IDs'}</p>
                    <p>Plugin IDs may include conditional sequences. A custom's base special is a reference; copying the item does not register that special for its new ID.</p></> : <p>No registered special attack.</p>}
                <p>Play runs the sequence once on Model A or B. A shield can replace the block animation. Special graphics and projectiles are not included in sequence playback.</p>
            </>}
    </details>;
}
