import { expect, type Page, test } from '@playwright/test';
import { FAMILY_NAME, KIND_INFO } from '../src/tileArt';

test.setTimeout(120000);

/** Opens the game and collects page errors; every test ends by asserting there were none. */
async function open(page: Page): Promise<string[]> {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/?quality=low');
  await page.waitForFunction(() => window.__barrio?.ready, undefined, { timeout: 60000 });
  await settle(page);
  return errors;
}

/** Waits until the camera stops moving, judged by where an outer hex lands on screen. */
async function settle(page: Page) {
  let last = '';
  await expect
    .poll(
      async () => {
        await page.waitForTimeout(400);
        const now = JSON.stringify(await page.evaluate(() => window.__barrio.hexToScreen(3, -3)));
        const still = now === last;
        last = now;
        return still;
      },
      { timeout: 30000, intervals: [0] },
    )
    .toBe(true);
}

const state = (page: Page) =>
  page.evaluate(() => {
    const snapshot = window.__barrio.snapshot();
    return {
      tiles: snapshot.tiles.length,
      remaining: snapshot.remaining,
      score: snapshot.score,
      rotation: window.__barrio.rotation(),
    };
  });

interface Spot {
  q: number;
  r: number;
  x: number;
  y: number;
  rotations: number[];
}

/** Open frontier hexes clear of the interface, with the rotations at which the tile in hand fits. */
function visibleSpots(page: Page): Promise<Spot[]> {
  return page.evaluate(() => {
    const api = window.__barrio;
    return api
      .snapshot()
      .frontier.map((ground) => {
        const point = api.hexToScreen(ground.q, ground.r);
        return { ...ground, ...point, rotations: api.preview(ground.q, ground.r, 0).validRotations };
      })
      .filter(({ x, y }) => x > 110 && x < innerWidth - 110 && y > 110 && y < innerHeight - 260);
  });
}

/** Turns the tile in hand with the R key until it faces `rotation`. */
async function turnTo(page: Page, rotation: number) {
  for (let i = 0; i < 6 && (await state(page)).rotation !== rotation; i++) await page.keyboard.press('r');
  expect((await state(page)).rotation).toBe(rotation);
}

test('places a tile on a fitting spot for the previewed points', async ({ page }) => {
  const errors = await open(page);
  const spot = (await visibleSpots(page)).find((candidate) => candidate.rotations.length > 0);
  if (!spot) throw new Error('No visible frontier hex fits the tile in hand.');
  const rotation = spot.rotations[0] as number;
  await turnTo(page, rotation);
  const before = await state(page);
  const points = await page.evaluate(
    ({ q, r, rotation }) => window.__barrio.preview(q, r, rotation).points.total,
    { q: spot.q, r: spot.r, rotation },
  );
  await page.mouse.move(spot.x, spot.y);
  const feedback = page.locator('#placement-feedback');
  await expect(feedback).toBeVisible();
  await expect(feedback).not.toHaveClass(/invalid/);
  await expect(feedback).toContainText(`+${points}`);
  await page.mouse.click(spot.x, spot.y);
  await expect
    .poll(() => state(page))
    .toMatchObject({
      tiles: before.tiles + 1,
      remaining: before.remaining - 1,
      score: before.score + points,
    });
  expect(
    await page.evaluate(
      ({ q, r }) => window.__barrio.snapshot().tiles.some((t) => t.q === q && t.r === r),
      spot,
    ),
  ).toBe(true);
  await expect(page.locator('#score')).toHaveText(String(before.score + points));
  await expect(page.locator('#remaining')).toHaveText(`${before.remaining - 1} tiles left`);
  expect(errors).toEqual([]);
});

test('shows the region, the tile in hand, and turns it with the tray buttons', async ({ page }) => {
  const errors = await open(page);
  const { current, regionName, seed } = await page.evaluate(() => window.__barrio.snapshot());
  if (!current) throw new Error('A new run has a tile in hand.');
  await expect(page.locator('#region')).toHaveText(`${regionName} · seed ${seed}`);
  await expect(page.locator('#hand-title')).toHaveText(
    `${KIND_INFO[current.kind].name} · ${FAMILY_NAME[current.family]}`,
  );
  await expect(page.locator('#remaining')).toHaveText('30 tiles left');
  await expect(page.locator('#score')).toHaveText('0');
  expect((await state(page)).rotation).toBe(0);
  await page.getByRole('button', { name: 'Turn tile (R)', exact: true }).click();
  await expect.poll(async () => (await state(page)).rotation).toBe(1);
  await expect(page.locator('#hand-tile')).toHaveAttribute('aria-label', /turned 1 of 6/);
  await page.getByRole('button', { name: 'Turn tile back (Shift R)', exact: true }).click();
  await page.getByRole('button', { name: 'Turn tile back (Shift R)', exact: true }).click();
  await expect.poll(async () => (await state(page)).rotation).toBe(5);
  expect(errors).toEqual([]);
});

test('refuses a spot where the tile in hand cannot go', async ({ page }) => {
  const errors = await open(page);
  let spot: Spot | undefined;
  // Only streams refuse a spot; grow the run until one does where it can be seen.
  for (let attempt = 0; attempt < 10 && !spot; attempt++) {
    const rotation = (await state(page)).rotation;
    spot = (await visibleSpots(page)).find((candidate) => !candidate.rotations.includes(rotation));
    if (!spot) {
      await page.evaluate(() => window.__barrio.autoplay(2));
      await settle(page);
    }
  }
  if (!spot) throw new Error('No visible frontier hex refuses the tile in hand.');
  const before = await state(page);
  await page.mouse.move(spot.x, spot.y);
  const feedback = page.locator('#placement-feedback');
  await expect(feedback).toBeVisible();
  await expect(feedback).toHaveClass(/invalid/);
  await expect(feedback).toContainText('Cannot place here');
  await page.mouse.click(spot.x, spot.y);
  await page.waitForTimeout(500);
  expect(await state(page)).toEqual(before);
  expect(errors).toEqual([]);
});

test('skips the tile in hand once per run', async ({ page }) => {
  const errors = await open(page);
  const before = await page.evaluate(() => window.__barrio.snapshot());
  const skip = page.locator('#skip');
  await expect(skip).toBeEnabled();
  await skip.click();
  await expect.poll(() => page.evaluate(() => window.__barrio.snapshot().skipUsed)).toBe(true);
  const after = await page.evaluate(() => window.__barrio.snapshot());
  expect(after.current).toEqual(before.upcoming[0]);
  expect(after.remaining).toBe(before.remaining);
  expect(after.score).toBe(before.score);
  await expect(skip).toBeDisabled();
  await expect(skip).toHaveText('Skip used');
  expect(errors).toEqual([]);
});

test('shows the results when the deck runs out', async ({ page }) => {
  const errors = await open(page);
  await page.evaluate(() => window.__barrio.autoplay(400));
  const done = await page.evaluate(() => window.__barrio.snapshot());
  expect(done.finished).toBe(true);
  expect(done.end).toBe('deckEmpty');
  expect(done.placements).toBe(30 + done.rewards - done.discarded);
  expect(done.tiles).toHaveLength(done.placements + 1);
  const results = page.locator('#results');
  await expect(results).toBeVisible();
  await expect(page.locator('#results-score')).toHaveText(done.score.toLocaleString('en-US'));
  await expect(page.locator('#results-reason')).toHaveText(
    'The deck is empty: every tile has found its place.',
  );
  await expect(page.locator('#results-stats')).toContainText(`${done.regionName} · ${done.seed}`);
  await expect(page.locator('#results-stats')).toContainText(`Quests completed${done.quests.history.length}`);
  await expect(page.locator('#results-best')).not.toBeEmpty();
  await expect(results.locator('[data-action="share"]')).toBeVisible();
  await expect(page.locator('#victory')).toBeHidden();
  await expect(page.locator('#remaining')).toHaveText('0 tiles left');
  await expect(page.locator('#hand-title')).toHaveText('The deck is empty');
  expect(errors).toEqual([]);
});

/** A visible frontier hex, and a rotation there, where placing the tile in hand completes a quest. */
function completingSpot(page: Page) {
  return page.evaluate(() => {
    const api = window.__barrio;
    for (const ground of api.snapshot().frontier) {
      const { x, y } = api.hexToScreen(ground.q, ground.r);
      if (x < 110 || x > innerWidth - 110 || y < 110 || y > innerHeight - 260) continue;
      for (let rotation = 0; rotation < 6; rotation++) {
        const preview = api.preview(ground.q, ground.r, rotation);
        if (preview.valid && preview.completes.length > 0)
          return {
            q: ground.q,
            r: ground.r,
            x,
            y,
            rotation,
            points: preview.points.total,
            questPoints: preview.completes.reduce((sum, quest) => sum + quest.points, 0),
            ids: preview.completes.map((quest) => quest.id),
          };
      }
    }
    return null;
  });
}

test('shows three quests and pays one on the placement that completes it', async ({ page }) => {
  const errors = await open(page);
  const cards = page.locator('#quest-list li.quest[data-id]');
  await expect(cards).toHaveCount(3);
  const quests = await page.evaluate(() => window.__barrio.snapshot().quests.current);
  expect(quests.map((quest) => quest.tier)).toEqual(['small', 'small', 'small']);
  for (const [index, quest] of quests.entries()) {
    await expect(cards.nth(index)).toHaveAttribute('data-id', quest.id);
    await expect(cards.nth(index)).toContainText(
      quest.state === 'active' ? `${quest.progress} / ${quest.target}` : 'Out of reach for now',
    );
  }
  await expect(page.locator('#milestone-text')).toHaveText('Next: Settlement at 1,000');
  let spot = await completingSpot(page);
  // Grow the run until a placement on screen would complete a quest.
  for (let attempt = 0; attempt < 25 && !spot; attempt++) {
    await page.evaluate(() => window.__barrio.autoplay(1));
    await settle(page);
    spot = await completingSpot(page);
  }
  if (!spot) throw new Error('No visible placement completes a quest.');
  await turnTo(page, spot.rotation);
  const before = await state(page);
  await page.mouse.move(spot.x, spot.y);
  const feedback = page.locator('#placement-feedback');
  await expect(feedback).toBeVisible();
  await expect(feedback).toContainText('Completes “');
  await page.mouse.click(spot.x, spot.y);
  // The completed card shows briefly, then its successor takes its place.
  const completed = page.locator(`#quest-list li[data-id="${spot.ids[0]}"]`);
  await expect(completed).toHaveClass(/done/, { timeout: 1000 });
  await expect
    .poll(async () => (await state(page)).score)
    .toBe(before.score + spot.points + spot.questPoints);
  await expect(page.locator('#status')).toContainText('Quest complete: +');
  const after = await page.evaluate(() => window.__barrio.snapshot());
  expect(after.last?.completed.map((done) => done.quest.id)).toEqual(spot.ids);
  expect(after.quests.history.map((quest) => quest.id)).toEqual(expect.arrayContaining(spot.ids));
  await expect(completed).toHaveCount(0, { timeout: 5000 });
  await expect(page.locator('#score')).toHaveText(
    (before.score + spot.points + spot.questPoints).toLocaleString('en-US'),
  );
  expect(errors).toEqual([]);
});

test('keeps the run across a reload', async ({ page }) => {
  const errors = await open(page);
  await page.evaluate(() => window.__barrio.autoplay(6));
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  const saved = await page.evaluate(() => ({
    snapshot: window.__barrio.snapshot(),
    autosave: localStorage.getItem('barrio.autosave.v3'),
    save: localStorage.getItem('barrio.saved.v3'),
  }));
  expect(saved.snapshot.tiles).toHaveLength(7);
  expect(JSON.parse(saved.autosave ?? '{}').version).toBe(3);
  expect(saved.save).toBe(saved.autosave);
  await page.reload();
  await page.waitForFunction(() => window.__barrio?.ready, undefined, { timeout: 60000 });
  const restored = await page.evaluate(() => window.__barrio.snapshot());
  expect(restored.tiles).toEqual(saved.snapshot.tiles);
  expect(restored.current).toEqual(saved.snapshot.current);
  expect(restored.upcoming).toEqual(saved.snapshot.upcoming);
  expect(restored.score).toBe(saved.snapshot.score);
  await expect(page.locator('#remaining')).toHaveText(`${saved.snapshot.remaining} tiles left`);
  expect(await page.evaluate(() => localStorage.getItem('barrio.autosave.v2'))).toBeNull();
  expect(await page.evaluate(() => localStorage.getItem('barrio.autosave.v1'))).toBeNull();
  expect(errors).toEqual([]);
});

test('turns the camera with the view buttons', async ({ page }) => {
  const errors = await open(page);
  const where = () =>
    page.evaluate(() => {
      // A hex well away from the orbit center moves visibly when the view turns.
      const far = window.__barrio
        .snapshot()
        .frontier.reduce((a, b) => (Math.abs(b.q) + Math.abs(b.r) > Math.abs(a.q) + Math.abs(a.r) ? b : a));
      return { far, point: window.__barrio.hexToScreen(far.q, far.r) };
    });
  const before = await where();
  await page.getByRole('button', { name: 'Turn the view right (E)', exact: true }).click();
  await page.waitForTimeout(800);
  await settle(page);
  const after = await page.evaluate(({ q, r }) => window.__barrio.hexToScreen(q, r), before.far);
  expect(Math.hypot(after.x - before.point.x, after.y - before.point.y)).toBeGreaterThan(20);
  await page.getByRole('button', { name: 'Turn the view left (Q)', exact: true }).click();
  await page.waitForTimeout(800);
  await settle(page);
  const back = await page.evaluate(({ q, r }) => window.__barrio.hexToScreen(q, r), before.far);
  expect(Math.hypot(back.x - before.point.x, back.y - before.point.y)).toBeLessThan(4);
  expect(errors).toEqual([]);
});

for (const [name, grow] of [
  ['opening', 0],
  ['developed', 50],
] as const)
  test(`matches the ${name} neighborhood baseline`, async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(`/?quality=low&seed=2026${grow ? `&autoplay=${grow}` : ''}`);
    await page.waitForFunction(() => window.__barrio?.ready, undefined, { timeout: 60000 });
    await page.evaluate(() => window.__barrio.home());
    await page.addStyleTag({ content: '#app > :not(canvas){display:none!important}' });
    await page.evaluate(() => window.__barrio.updateShadows());
    await page.waitForTimeout(1500);
    await expect(page).toHaveScreenshot(`${name}.png`, { maxDiffPixelRatio: 0.02 });
    expect(errors).toEqual([]);
  });
