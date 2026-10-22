import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve('docs/screenshots/environment');
const captureStage = process.env.BARRIO_REVIEW_STAGE ?? 'candidates';
const selected = captureStage === 'candidates' ? 'balanced' : 'warm';
await mkdir(`${root}/review`, { recursive: true });
const names = { cool: 'A · Cool Painterly', warm: 'B · Warm Painterly', balanced: 'C · Balanced Barrio' };
const notes = {
  cool: 'Sage canopy · cool shadows · muted meadow',
  warm: 'Golden ground · olive canopy · warm sun',
  balanced: 'Cool ground · warm architecture · turquoise water',
};
const images = {};
for (const seed of [909352, 2])
  for (const view of ['overview', 'closeup']) {
    const key = `${seed}-${view}`;
    images[key] = {};
    for (const variant of ['legacy', 'cool', 'warm', 'balanced']) {
      const stage = variant === 'legacy' ? 'baseline' : captureStage;
      const source = `${root}/${stage}/${key}-${variant}.png`;
      const destination = `${root}/review/${captureStage}-${key}-${variant}.webp`;
      execFileSync('magick', [source, '-resize', '960x600', '-quality', '85', destination]);
      images[key][variant] = destination;
    }
  }
const toneImages = {};
for (const tone of ['neutral', 'agx', 'aces']) {
  const source = `${root}/tone-${tone}/909352-overview-balanced-${tone}.png`;
  const destination = `${root}/review/tone-${tone}.webp`;
  execFileSync('magick', [source, '-resize', '960x600', '-quality', '85', destination]);
  toneImages[tone] = destination;
}
const html = `<!doctype html><html><head><meta charset="utf-8"><style>
*{box-sizing:border-box}body{font-family:var(--font-sans,system-ui);color:var(--foreground,#222);margin:0}button,select,input{font:inherit}button,select{padding:8px 12px;border:1px solid var(--border,#ccc);border-radius:8px;background:var(--secondary,#eee);color:inherit;min-height:40px}button{cursor:pointer}button[aria-pressed=true]{background:var(--primary,#245beb);color:var(--primary-foreground,#fff)}.controls{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin:0 0 14px}.grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px}figure{margin:0}figure img{display:block;width:100%;border-radius:8px}figcaption{font-size:12px;line-height:1.4;margin-top:8px;color:var(--muted-foreground,#555)}figcaption strong{display:block;color:var(--foreground,#222);font-size:14px;margin-bottom:4px}.comparison{position:relative;overflow:hidden;border-radius:8px;margin:12px 0 8px;aspect-ratio:1.6}.comparison img{width:100%;height:100%;object-fit:cover;position:absolute;inset:0}.comparison .after{clip-path:inset(0 0 0 50%)}.label{position:absolute;top:12px;padding:5px 8px;border-radius:5px;background:#17212fe8;color:white;font-size:12px}.before-label{left:12px}.after-label{right:12px}input[type=range]{width:100%;accent-color:var(--primary,#245beb)}p{line-height:1.5;font-size:14px;margin:14px 0}.muted{color:var(--muted-foreground,#666);font-size:12px}h3{font-size:16px;margin:22px 0 12px}.tone{margin-top:12px}@media(max-width:500px){.grid{gap:6px}figcaption strong{font-size:12px}figcaption{font-size:11px}.controls{gap:6px}button,select{padding:7px 8px;font-size:12px}}
</style></head><body>
<div class="controls"><label>Region <select id="region"><option value="909352">Salento · 909352</option><option value="2">Medellín · 2</option></select></label><button id="overview" aria-pressed="true">Gameplay overview</button><button id="closeup" aria-pressed="false">Environmental close-up</button></div>
<div class="grid">${Object.keys(names)
  .map(
    (v) =>
      `<figure><img id="${v}" src="${images['909352-overview'][v]}" alt="${names[v]} actual game capture"><figcaption><strong>${names[v]}</strong>${notes[v]}</figcaption></figure>`,
  )
  .join('')}</div>
<p class="muted">Actual engine captures. All candidates use the same 30-tile board, camera, 1440 × 900 frame, and exposure 1.0. ${captureStage === 'candidates' ? 'Trees retain their baseline geometry at this milestone.' : 'The final environment uses the reviewed palette, new tree families, and regional atmosphere.'}</p>
<h3>Before and candidate</h3><div class="controls">${Object.keys(names)
  .map(
    (v) =>
      `<button class="variant" data-variant="${v}" aria-pressed="${v === selected}">${names[v]}</button>`,
  )
  .join('')}</div>
<div class="comparison"><img id="before" src="${images['909352-overview'].legacy}" alt="Original rendering"><img id="after" class="after" src="${images['909352-overview'][selected]}" alt="Candidate rendering"><span class="label before-label">Original</span><span class="label after-label" id="candidate-label">${names[selected].slice(4)}</span></div><label class="muted" for="wipe">Drag to compare the identical scene</label><input id="wipe" type="range" min="0" max="100" value="50" aria-label="Before and candidate comparison divider">
${captureStage === 'candidates' ? '' : `<h3>Five tree silhouettes · actual engine</h3><figure><img src="${root}/gallery/tree-families-color.png" alt="Compact, spreading, Andean, woodland and flowering trees"><figcaption>Compact rounded · broad spreading · tall Andean · irregular woodland · flowering accent. Diagnostic gallery; board comparisons above use the unchanged gameplay cameras.</figcaption></figure>`}
<h3>Milestone 1 tone study · same palette and exposure</h3><div class="grid tone">${Object.keys(toneImages)
  .map(
    (t) =>
      `<figure><img src="${toneImages[t]}" alt="${t} tone mapping actual game capture"><figcaption><strong>${t === 'agx' ? 'AgX' : t === 'aces' ? 'ACES Filmic' : 'Neutral'}</strong>Salento · same camera</figcaption></figure>`,
  )
  .join('')}</div>
<p class="muted">${selected === 'warm' ? 'User-selected direction: B, Warm Painterly with Neutral.' : 'Milestone 1 recommendation: C, Balanced Barrio with Neutral.'} Alternatives remain configurable. Runtime originals and measurements are saved with the art-direction document.</p>
<script>
const shots=${JSON.stringify(images)};let framing='overview',variant='${selected}';function update(){const images=shots[document.querySelector('#region').value+'-'+framing];for(const v of ['cool','warm','balanced'])document.getElementById(v).src=images[v];document.querySelector('#before').src=images.legacy;document.querySelector('#after').src=images[variant];document.querySelector('#candidate-label').textContent=${JSON.stringify(names)}[variant].slice(4);for(const view of ['overview','closeup'])document.getElementById(view).setAttribute('aria-pressed',view===framing);for(const b of document.querySelectorAll('.variant'))b.setAttribute('aria-pressed',b.dataset.variant===variant)}document.querySelector('#region').onchange=update;for(const view of ['overview','closeup'])document.getElementById(view).onclick=()=>{framing=view;update()};for(const b of document.querySelectorAll('.variant'))b.onclick=()=>{variant=b.dataset.variant;update()};document.querySelector('#wipe').oninput=e=>document.querySelector('#after').style.clipPath='inset(0 0 0 '+e.target.value+'%)';
</script></body></html>`;
await writeFile(`${root}/review${captureStage === 'candidates' ? '' : '-final'}.html`, html);
console.log(`${root}/review${captureStage === 'candidates' ? '' : '-final'}.html`);
