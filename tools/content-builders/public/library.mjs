import { extract } from '/shared/mesh.mjs';
import { thumbnail } from '/viewport.mjs';
export function createLibrary({ api, choose, add, report, sequence,place,cancelPlace }) {
    const $ = id => document.getElementById(id);
    let selectToken = 0, token = 0, selected = null, offset = 0, timer, gearGrouping = 'pieces';
    const sources = new Map(), jobs = [];
    let running = 0;
    const request = (kind, id, variant = kind === 'npc' ? 'body' : 'inventory') => {
        const key = `${kind}/${id}/${variant}`;
        if (!sources.has(key)) {
            const promise = api(`source?kind=${kind}&id=${id}&variant=${variant}`).catch(error => { sources.delete(key); throw error; });
            sources.set(key, promise);
            if (sources.size > 24)
                sources.delete(sources.keys().next().value);
        }
        return sources.get(key);
    };
    const pump = () => {
        while (running < 3 && jobs.length) {
            const job = jobs.shift();
            if (!job.canvas.isConnected)
                continue;
            running++;
            request(job.kind, job.id).then(source => { if (job.canvas.isConnected)
                thumbnail(job.canvas, source.mesh, source); }).catch(error => { job.canvas.title = error.message; }).finally(() => { running--; pump(); });
        }
    };
    const observer = new IntersectionObserver(entries => {
        for (const entry of entries)
            if (entry.isIntersecting) {
                const canvas = entry.target;
                observer.unobserve(canvas);
                jobs.push({ canvas, kind: canvas.dataset.kind, id: Number(canvas.dataset.id) });
            }
        pump();
    }, { root: $('results'), rootMargin: '80px' });
    const select = async (kind, id, variant) => {
        const current = ++selectToken;
        report('Loading parts…');
        const source = await request(kind, id, variant);
        if (current !== selectToken)
            return source;
        selected = `${kind}/${id}`;
        document.querySelectorAll('.source-card').forEach(card => card.setAttribute('aria-selected', card.dataset.source === selected));
        await choose(source);
        report(source.warnings.length ? source.warnings.join(' ') : source.name);
        return source;
    };
    const search = async (reset = true, autoSelect = false) => {
        if (reset)
            offset = 0;
        const current = ++token, kind = $('source-kind').value;
        $('creatures-only').parentElement.hidden = kind !== 'npc';
        $('search').placeholder = kind === 'npc' ? 'Search creatures…' : kind === 'item' ? 'Search items…' : 'Search animations…';
        const result = await api(`search?kind=${kind}&q=${encodeURIComponent($('search').value)}&offset=${offset}&creaturesOnly=${$('creatures-only').checked ? 1 : 0}&unique=1`);
        if (current !== token)
            return;
        observer.disconnect();
        jobs.length = 0;
        $('results').replaceChildren();
        $('result-count').textContent = String(result.total);
        $('prev').disabled = offset === 0;
        $('next').disabled = offset + 50 >= result.total;
        for (const row of result.rows) {
            const card = document.createElement('button');
            card.className = 'source-card';
            card.dataset.source = `${kind}/${row.id}`;
            card.title = `${row.name} · ${kind} ${row.id}`;
            card.setAttribute('aria-selected', selected === card.dataset.source);
            card.onclick = () => kind === 'seq' ? sequence(row) : select(kind, row.id).catch(error => report(error.message, true));
            if (kind !== 'seq') {
                const canvas = document.createElement('canvas');
                canvas.width = 132;
                canvas.height = 90;
                canvas.dataset.kind = kind;
                canvas.dataset.id = row.id;
                canvas.setAttribute('aria-label', `${row.name} preview`);
                card.append(canvas);
                observer.observe(canvas);
            }
            const name = document.createElement('strong');
            name.textContent = row.name;
            card.append(name);
            const detail = document.createElement('small');
            detail.textContent = kind === 'seq' ? `${row.frames} frames` : kind === 'npc' && row.level >= 0 ? `Level ${row.level}` : row.wearable ? 'Wearable' : '';
            card.append(detail);
            $('results').append(card);
        }
        if (!result.rows.length)
            $('results').textContent = 'No matches.';
        if (autoSelect && result.rows[0] && kind !== 'seq')
            await select(kind, result.rows[0].id);
    };
    $('search').oninput = () => { clearTimeout(timer); timer = setTimeout(() => search().catch(error => report(error.message, true)), 180); };
    $('search').onkeydown = e => { if (e.key === 'Enter') {
        clearTimeout(timer);
        search().catch(error => report(error.message, true));
    } };
    $('search-go').onclick = () => search().catch(error => report(error.message, true));
    $('source-kind').onchange = () => { $('search').value = $('source-kind').value === 'npc' ? 'goblin' : $('source-kind').value === 'item' ? 'scimitar' : 'walk'; search(true, true).catch(error => report(error.message, true)); };
    $('creatures-only').onchange = () => search().catch(error => report(error.message, true));
    $('prev').onclick = () => { offset = Math.max(0, offset - 50); search(false).catch(error => report(error.message, true)); };
    $('next').onclick = () => { offset += 50; search(false).catch(error => report(error.message, true)); };
    const renderParts = source => {
        $('source-name').textContent = source.name;
        $('source-variant').hidden = source.kind !== 'item';
        $('source-variant').value = source.variant;
        $('source-variant').onchange = () => select('item', source.id, $('source-variant').value).catch(error => report(error.message, true));
        $('part-cards').replaceChildren();
        if(source.kind==='item'&&source.parts.some(p=>p.group)){
            const controls=document.createElement('div');controls.className='row';controls.style.gridColumn='1 / -1';controls.setAttribute('role','group');controls.setAttribute('aria-label','Gear part grouping');
            for(const [group,name] of [['pieces','Whole pieces'],['colours','Colour areas'],['legacy','More pieces']]){
                const choice=document.createElement('button');choice.textContent=name;choice.setAttribute('aria-pressed',String(gearGrouping===group));
                choice.onclick=()=>{gearGrouping=group;renderParts(source);};controls.append(choice);
            }
            $('part-cards').append(controls);
        }
        const extra = document.createElement('details');
        extra.className = 'extra-parts';
        const summary = document.createElement('summary');
        summary.textContent = 'More pieces';
        extra.append(summary);
        const extraGrid = document.createElement('div');
        extraGrid.className = 'part-grid';
        extra.append(extraGrid);
        for (const offer of source.parts) {
            if(source.kind==='item'&&offer.group&&offer.group!==gearGrouping&&offer.key!=='whole')continue;
            const card = document.createElement('div');
            card.className = 'part-card';
            card.draggable = true;
            card.dataset.partKey = offer.key;
            card.title = `${offer.name} (${offer.faces.length} faces)`;
            const canvas = document.createElement('canvas');
            canvas.width = 126;
            canvas.height = 104;
            canvas.setAttribute('aria-label', `${offer.name} preview`);
            thumbnail(canvas, extract(source.mesh, offer.faces), source);
            const label = document.createElement('strong');
            label.textContent = offer.name;
            const button = document.createElement('button');
            button.textContent = 'Add';
            button.setAttribute('aria-label', `Add ${offer.name} from ${source.name}`);
            button.onclick = () => add(source, offer).catch(error => report(error.message, true));
            const placeButton=document.createElement('button');placeButton.textContent='Place';placeButton.setAttribute('aria-label',`Place ${offer.name} from ${source.name}`);placeButton.onclick=()=>place?.(source,offer);
            card.ondragend=()=>cancelPlace?.();
            card.ondragstart = e => {place?.(source,offer); e.dataTransfer.setData('application/x-tsps-part', JSON.stringify({ kind: source.kind, id: source.id, variant: source.variant, key: offer.key })); e.dataTransfer.effectAllowed = 'copy'; };
            const actions=document.createElement('div');actions.className='row';actions.append(button,placeButton);card.append(canvas, label,actions);
            (source.kind!=='item'&&offer.role === 'piece' ? extraGrid : $('part-cards')).append(card);
        }
        if (extraGrid.children.length)
            $('part-cards').append(extra);
    };
    const splitter = $('library-split');
    const setSplit = value => { const fraction = Math.max(.2, Math.min(.65, value)); $('library-body').style.setProperty('--split', `${fraction * 100}%`); try {
        localStorage.setItem('tsps-creator:library-split', String(fraction));
    }
    catch { } };
    try {
        setSplit(Number(localStorage.getItem('tsps-creator:library-split')) || .36);
    }
    catch { }
    splitter.onpointerdown = e => { splitter.setPointerCapture(e.pointerId); splitter.onpointermove = e => { const rect = $('library-body').getBoundingClientRect(); setSplit((e.clientY - rect.top) / rect.height); }; };
    splitter.onpointerup = splitter.onpointercancel = () => splitter.onpointermove = null;
    splitter.onkeydown = e => { if (['ArrowUp', 'ArrowDown'].includes(e.key)) {
        e.preventDefault();
        const rect = $('library-body').getBoundingClientRect();
        const at = (splitter.getBoundingClientRect().top - rect.top) / rect.height;
        setSplit(at + (e.key === 'ArrowUp' ? -.05 : .05));
    } };
    return { request, select, search, renderParts, sequence };
}
