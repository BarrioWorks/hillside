# Open verification issues

## Existing atmosphere test

Before pedestrian changes, `npm test` passed 227 tests and failed `web/tests/atmosphere.test.ts:175`. The regional light test expects `lights.sun.color.equals(light.sun)` to be true. The baseline output and failure location are recorded in `baseline-checks.json`. Pedestrian work does not change lighting or material source. This failure remains outside the path replacement scope.

## Pathless homes

The frozen twenty-tile scene contains three homes with null Rust entrance assignments. They have explicit door anchors and unserved diagnostics. They do not receive decorative routes to nonexistent local crossings. Serving them would require a separate game-rule decision about adding crossings on pathless tiles. The pedestrian validation reports them separately from failed required routes.

## Missing external reference

The screenshot mentioned in the request was not attached. Comparison uses `docs/screenshots/classic/12-paths-joined.png` and the captured pre-change scenes. Comparison against the absent image remains unverified.

## Independent review availability

Both configured Claude reviewers, `claude-opus-5-5` and `claude-fable-5-1`, failed immediately with `Claude API rate limit reached. Try again later.` One fresh retry per seat failed with the same error. Their review seats and the cross-family audit review remain blocked. Available Codex review findings are retained and handled. No merge or shipping approval is claimed.

## Test-runner timeout

A full parallel post-change run reported a Vitest `onTaskUpdate` RPC timeout. The affected suite exited cleanly in a sequential run. A subsequent full sequential run passed 241 tests and failed only the preexisting atmosphere assertion, with no worker-control timeout. The final post-correction full sequential run reports 250 passing tests, the same atmosphere assertion failure, and another `onTaskUpdate` RPC timeout. This harness error remains unresolved. The final focused pedestrian run passes 51 tests cleanly, and the separate rendered acceptance and expansion gates pass.
