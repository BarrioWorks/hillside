import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from '@playwright/test';

// Renders documentation screenshots of Classic runs in the real engine. Each shot writes a PNG and a JSON
// file with renderer metrics and the run state it shows. Scenario shots search seeded runs for the
// situation they document (a staircase, a three-way crossing, two walks about to join) instead of faking it.
const baseURL = process.env.BARRIO_URL ?? 'http://127.0.0.1:5173';
const out = process.argv[2] ?? 'docs/screenshots/classic';
const only = process.argv[3]?.split(',');
await mkdir(out, { recursive: true });

/** In the page: the frontier spot and rotation worth the most points for the tile in hand. */
function bestSpot(mode) {
  const api = window.__barrio;
  let best = null;
  for (const cell of api.snapshot().frontier)
    for (let rotation = 0; rotation < 6; rotation++) {
      const p = api.preview(cell.q, cell.r, rotation);
      const score =
        mode === 'invalid'
          ? p.valid
            ? -1
            : p.reason.includes('stream') ? 2 : 1
          : p.valid
            ? p.points.total * 10 + p.paths.joined
            : -99;
      if (!best || score > best.score) best = { ...cell, rotation, score };
    }
  return best;
}

/** In the page: grows seeded runs until a placed tile shows `want`, then frames it. */
function findTile(want) {
  const api = window.__barrio;
  for (let seed = 1; seed < 400; seed++) {
    api.command({ type: 'newGame', seed });
    if (want === 'pair') {
      const snapshot = api.snapshot();
      if (snapshot.current?.kind !== 'casas') continue;
      for (const cell of snapshot.frontier)
        for (let rotation = 0; rotation < 6; rotation++) {
          const p = api.preview(cell.q, cell.r, rotation);
          if (p.valid && p.paths.joined >= 1 && p.paths.homesGained >= 2) return { seed, q: cell.q, r: cell.r, rotation };
        }
      continue;
    }
    for (let step = 0; step < 30; step++) {
      api.command({ type: 'autoplay', count: 1 });
      const snapshot = api.snapshot();
      const byKey = new Map(snapshot.tiles.map((tile) => [`${tile.q},${tile.r}`, tile]));
      const dirs = [
        [1, 0],
        [0, 1],
        [-1, 1],
        [-1, 0],
        [0, -1],
        [1, -1],
      ];
      for (const tile of snapshot.tiles) {
        const sides = tile.meets.map((meet, side) => {
          const [dq, dr] = dirs[side];
          const other = byKey.get(`${tile.q + dq},${tile.r + dr}`);
          return { meet, edge: tile.edges[side], group: tile.paths[side], rise: other ? other.elevation - tile.elevation : 0 };
        });
        const joinedPaths = sides.filter((side) => side.edge === 'path' && side.meet === 'match');
        if (want === 'stairs' && joinedPaths.some((side) => side.rise === 1) && joinedPaths.length >= 2)
          return { seed, q: tile.q, r: tile.r };
        if (want === 'crossing') {
          const groups = new Map();
          for (const side of joinedPaths) groups.set(side.group, (groups.get(side.group) ?? 0) + 1);
          if ([...groups.values()].some((count) => count >= 3)) return { seed, q: tile.q, r: tile.r };
        }
      }
      if (want === 'merge' && snapshot.stats.walks >= 2 && snapshot.current) {
        for (const cell of snapshot.frontier)
          for (let rotation = 0; rotation < 6; rotation++) {
            const p = api.preview(cell.q, cell.r, rotation);
            if (p.valid && p.paths.joined >= 2 && p.paths.homesGained >= 2)
              return { seed, q: cell.q, r: cell.r, rotation, step };
          }
      }
    }
  }
  return null;
}

/**
 * In the page: plays seeds with the planner, one tile at a time, until a single placement can reach `goal`
 * (a quest completion, or victory). Returns that placement without making it, so the capture can place it
 * the way a player would and show the live feedback.
 */
function findMoment(goal) {
  const api = window.__barrio;
  const seeds = goal === 'victory' ? [0, 1, 2, 3, 8, 9, 11, 15, 17, 22] : [2026, 1, 2, 3];
  for (const seed of seeds) {
    api.command({ type: 'newGame', seed });
    for (let step = 0; step < 80; step++) {
      const snapshot = api.snapshot();
      if (snapshot.finished) break;
      for (const cell of snapshot.frontier)
        for (let rotation = 0; rotation < 6; rotation++) {
          const p = api.preview(cell.q, cell.r, rotation);
          if (!p.valid) continue;
          const bonus = p.completes.reduce((sum, quest) => sum + quest.points, 0);
          const hit =
            goal === 'victory'
              ? !snapshot.victory && snapshot.score + p.points.total + bonus >= 6000
              : p.completes.length > 0 && snapshot.placements >= 6;
          if (hit) return { seed, step, q: cell.q, r: cell.r, rotation };
        }
      api.command({ type: 'autoplay', count: 1, policy: 'planner' });
    }
  }
  return null;
}

const shots = [
  { name: '01-start-medellin', seed: 2, zoom: 3.2, ui: false },
  { name: '02-start-salento', seed: 1, zoom: 3.2, ui: false },
  { name: '03-start-bogota', seed: 4, zoom: 3.2, ui: false },
  { name: '04-start-cartagena', seed: 3, zoom: 3.2, ui: false },
  { name: '05-opening-ui', seed: 2, ui: true },
  { name: '06-hover-preview', seed: 2026, grow: 6, ui: true, hover: 'best' },
  { name: '07-invalid-hover', seed: 7, grow: 12, ui: true, hover: 'invalid' },
  { name: '08-placed-feedback', seed: 2026, grow: 6, ui: true, hover: 'best', place: true },
  { name: '09-ten-tiles', seed: 2026, grow: 10, ui: true },
  { name: '10-thirty-tiles', seed: 2026, grow: 30, ui: true },
  { name: '11-run-complete', seed: 2026, grow: 400, ui: true },
  { name: '12-paths-joined', scenario: 'pair', ui: false, zoom: 2.8 },
  { name: '13-three-way-crossing', scenario: 'crossing', ui: false, zoom: 3.4 },
  { name: '14-hillside-stairs', scenario: 'stairs', ui: false, zoom: 3.6 },
  { name: '15-walks-before-joining', scenario: 'merge', ui: true, zoom: 2.4 },
  { name: '16-walks-after-joining', scenario: 'merge', ui: true, zoom: 2.4, place: true },
  { name: '17-mobile', seed: 2026, grow: 6, ui: true, mobile: true },
  { name: '18-quest-complete', moment: 'quest', ui: true },
  { name: '19-victory', moment: 'victory', ui: true },
  { name: '20-results-after-victory', moment: 'victory', ui: true, finish: true },
].filter((shot) => !only || only.includes(shot.name));

const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.BARRIO_BROWSER_PATH,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const errors = [];
for (const shot of shots) {
  const page = await browser.newPage(
    shot.mobile
      ? { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }
      : { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 },
  );
  page.on('pageerror', (error) => errors.push(`${shot.name}: ${error.message}`));
  await page.goto(`${baseURL}/?quality=high&seed=${shot.seed ?? 1}`);
  await page.waitForFunction(() => window.__barrio?.ready, null, { timeout: 60000 });
  let found = null;
  if (shot.moment) {
    found = await page.evaluate(findMoment, shot.moment);
    if (!found) {
      errors.push(`${shot.name}: no seed reached ${shot.moment}`);
      await page.close();
      continue;
    }
    // The search left the run one placement short of the moment; frame it and place like a player.
    await page.evaluate(() => window.__barrio.home());
    await page.waitForTimeout(600);
    await page.evaluate(({ q, r, rotation }) => window.__barrio.hover(q, r, rotation), found);
    const point = await page.evaluate(({ q, r }) => window.__barrio.hexToScreen(q, r), found);
    await page.mouse.click(point.x, point.y);
    await page.waitForTimeout(shot.moment === 'quest' ? 700 : 1200);
    if (shot.finish) {
      await page.click('[data-action="finish"]');
      await page.waitForTimeout(800);
    }
    await page.screenshot({ path: `${out}/${shot.name}.png` });
    const run = await page.evaluate(() => {
      const s = window.__barrio.snapshot();
      return { seed: s.seed, region: s.region, score: s.score, placements: s.placements, victory: s.victory, end: s.end, last: s.last, quests: s.quests.history.map((q) => q.id) };
    });
    await writeFile(`${out}/${shot.name}.json`, JSON.stringify({ found, run }, null, 2));
    console.log(shot.name, `seed=${run.seed}`, `score=${run.score}`, `victory=${run.victory}`, `end=${run.end}`);
    await page.close();
    continue;
  }
  if (shot.scenario) {
    found = await page.evaluate(findTile, shot.scenario);
    if (!found) {
      errors.push(`${shot.name}: no seed showed ${shot.scenario}`);
      await page.close();
      continue;
    }
    // Replay to the found state so the scene is built from a clean reconcile.
    await page.evaluate(
      ({ seed, step }) => {
        window.__barrio.command({ type: 'newGame', seed });
        // Autoplay seeds its choice per call, so replay one tile at a time exactly as the search did.
        for (let i = 0; i <= (step ?? -1); i++) window.__barrio.command({ type: 'autoplay', count: 1 });
      },
      { seed: found.seed, step: shot.scenario === 'merge' ? found.step : undefined },
    );
    if (shot.scenario === 'crossing' || shot.scenario === 'stairs')
      await page.evaluate(
        async ({ q, r, seed }) => {
          const api = window.__barrio;
          api.command({ type: 'newGame', seed });
          for (let i = 0; i < 30 && !api.snapshot().tiles.some((t) => t.q === q && t.r === r); i++)
            api.command({ type: 'autoplay', count: 1 });
        },
        found,
      );
  } else if (shot.grow) await page.evaluate((count) => window.__barrio.autoplay(count), shot.grow);
  await page.evaluate(() => window.__barrio.home());
  if (shot.zoom && !found) await page.evaluate((zoom) => window.__barrio.view({ zoom }), shot.zoom);
  if (found && shot.zoom) await page.evaluate(({ q, r, zoom }) => window.__barrio.focus(q, r, zoom), { ...found, zoom: shot.zoom });
  if (!shot.ui) await page.addStyleTag({ content: '#app > :not(canvas){display:none!important}' });
  if (shot.closeResults) await page.evaluate(() => document.querySelector('[data-action="view"]')?.click());
  let spot = shot.hover ? await page.evaluate(bestSpot, shot.hover) : null;
  if (found?.rotation !== undefined) spot = found;
  if (spot && (shot.hover || shot.scenario === 'merge' || shot.scenario === 'pair')) {
    await page.evaluate(({ q, r, rotation }) => window.__barrio.hover(q, r, rotation), spot);
    if (shot.place || shot.scenario === 'pair') {
      const point = await page.evaluate(({ q, r }) => window.__barrio.hexToScreen(q, r), spot);
      await page.mouse.click(point.x, point.y);
      await page.waitForTimeout(shot.scenario === 'pair' ? 900 : 420);
      if (shot.scenario !== 'pair') await page.mouse.move(point.x, point.y);
    }
  }
  if (shot.scenario === 'pair') await page.evaluate(({ q, r, zoom }) => window.__barrio.focus(q / 2, r / 2, zoom), { ...found, zoom: shot.zoom });
  await page.evaluate(() => window.__barrio.updateShadows());
  await page.waitForTimeout(shot.place ? 120 : 1500);
  await page.screenshot({ path: `${out}/${shot.name}.png` });
  const metrics = await page.evaluate(() => {
    const snapshot = window.__barrio.snapshot();
    return {
      ...window.__barrio.metrics(),
      run: {
        seed: snapshot.seed,
        region: snapshot.region,
        score: snapshot.score,
        placements: snapshot.placements,
        remaining: snapshot.remaining,
        finished: snapshot.finished,
        last: snapshot.last,
        stats: snapshot.stats,
      },
    };
  });
  await writeFile(`${out}/${shot.name}.json`, JSON.stringify({ found, ...metrics }, null, 2));
  console.log(shot.name, `seed=${metrics.run.seed}`, `tiles=${metrics.tiles}`, `score=${metrics.run.score}`, `walks=${metrics.run.stats.walks}`);
  await page.close();
}
await browser.close();
if (errors.length) {
  console.error(errors.join('\n'));
  process.exitCode = 1;
}
