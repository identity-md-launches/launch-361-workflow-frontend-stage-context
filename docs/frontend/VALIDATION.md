# Frontend validation — Swap Tip

Worker validation of the single-page source/export on 2026-09-27. This is not independent certification. Contracts were preserved, no transactions were broadcast and no site was published.

## Scope and requirement decisions

- Vite, React and TypeScript source/lockfile/configuration in `web/`; relative static export in root `dist/`.
- Injected EIP-1193 wallet, public reads with wallet fallback, exact-input buy/sell, optional 0–5% tip, recipient, slippage, two sell approvals, claim-all, live views, StateView price, event leaderboards and transaction feedback.
- **Router conflict:** the older workflow names PoolSwapTest, but mandatory acceptance requires the unchanged network handoff's Uniswap addresses. It supplies Universal Router and no PoolSwapTest. The implementation follows the mandatory rule. PoolSwapTest was neither added nor represented as tested. This conflict was surfaced for clarification; no replacement instruction was received.
- **Documentation conflict:** root `DESIGN.md` is outside the authoritative path budget; its content is delivered at `docs/DESIGN.md`.
- English/light theme and pointer/keyboard/mobile reflow. No admin controls: the deployed hook has no admin interface.

## Checks and outcomes

| Check                               | Result                                                                                                                                                  |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm --prefix web run build`        | Passed: strict typecheck, Vite export, pinned ABI verification and manifest generation                                                                  |
| `npm --prefix web test`             | 9 passed: ABI binding, validation/precision, exact hookData, swap encoding/minimum output, aggregation, chain-add/rejection, paths and decimal slippage |
| `npm --prefix web run test:browser` | 16 passed; `browser-results.json` records named checks                                                                                                  |
| `npm --prefix web run check:export` | Verifies exact handoff/network, ABIs, full inventory, every SHA-256, relative entrypoint and limits                                                     |
| `npm --prefix web run check:live`   | All three supplied RPCs returned Sepolia, nonempty code, pool state and a successful read-only buy quote; `live-check.json`                             |

Browser tests execute production export bytes with wallet/RPC fixtures at `/preview/index.html`. Direct HTTP navigation initially failed with `net::ERR_ACCESS_DENIED`; the assigned browser tool also timed out on localhost. The working test uses Playwright route fulfillment for the unchanged HTML, JS, CSS, manifest and ABIs. It exercises actual Chromium JavaScript, layout and interactions, but **does not establish direct HTTP browser hosting or public RPC CORS behavior**. The provided headless shell avoided a subsequent Chromium thread-exhaustion failure. These obstacles are not reported as successful direct navigation.

The tests cover wallet rejection/recovery; unknown-chain add/switch with exact parameters; invalid amount/recipient and focus; quote revert/retry; keyboard slider and quote invalidation; simulation failure before signing; native buy encoding; separate token/Permit2 approvals and sell; claim and balance refresh; disconnect/account change; missing wallet/code; and RPC outage. The wallet records requests in memory, has no real funds and never broadcasts. Screenshots contain fixture data, not live-chain results.

Tests are in `web/tests/domain.test.ts` and `web/scripts/browser-test.mjs`. The final run had no uncaught page errors or unexpected RPC methods. Resource resolution is tested through fixtures, not a live browser network audit.

### Live read observations

At approximately blocks 11,791,607–11,791,608, STIP had 1,723 runtime bytes, SwapTipHook 4,416, Universal Router 19,540; all supplied Uniswap addresses had code. Pool ID: `0xd1ea37df22c151c818c2509541ba7c1a6d9007212f1ef9d01aee7db70f1d754c`. Total tips and current active liquidity were zero; slot0 was initialized. Each endpoint quoted `49630160823989818792` raw STIP for `1000000000000` wei ETH with no tip. This was `eth_call`, not an executed swap or future output guarantee. The timestamped JSON is authoritative for this observation.

## Better Interface review

The pinned workflow and core principles of all six domains were read before implementation, and documentation guidance before the final design record.

| Domain        | Checked                                                                                                                                                                            | Limits                                                                                                             |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Accessibility | Native controls/labels, headings, landmarks, skip link, focus, keyboard slider, validation focus, disabled gates, live status; axe WCAG 2 A/AA and 2.1 AA found zero violations    | No screen reader or physical-device session; axe returned an incomplete contrast item; no claim of full compliance |
| Layout        | Rendered reflow/no document overflow at 1440, 900, 740, 390 and 320px; 200% root-font enlargement at 740px                                                                         | Native 200% browser zoom, RTL and translated strings untested                                                      |
| Writing       | Action labels, exact input/minimum output, tip mechanics, gas, recipient warning, empty/partial/error recovery states                                                              | No external usability or translation study                                                                         |
| Typography    | Actual desktop/320px wrapping, system stack, tabular figures, input sizes and long addresses                                                                                       | No iOS/Safari or other-OS font verification                                                                        |
| Colors        | Four actual text/background measurements: 5.63:1, 7.76:1, 11.24:1, 6.19:1, all above 4.5:1                                                                                         | Not every focus/hover/disabled/forced-color pair measured; axe's incomplete contrast item remains disclosed        |
| UI details    | Selected, loading, error, empty, disconnected, connected, approval, confirmed and claim-disabled states; source-reviewed reduced-motion guard, 120ms transitions, 0.96 press scale | No slowed animation replay or real reduced-motion device; no overlays to review                                    |

### Findings and fixes

| Severity | Source                             | Finding and impact                                                                            | Fix and recheck                                                                                                  |
| -------- | ---------------------------------- | --------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| High     | `web/src/App.tsx:742`              | Initially disabled quotes at zero current-tick liquidity; live quoter succeeded in that state | Allow quotes for initialized price; explain reachable liquidity. Live quote, final build and interactions passed |
| Medium   | `web/src/domain.ts:39` (`parseTrade`) | Float multiplication could reject 0.29% slippage                                              | Exact decimal parsing; regression passed                                                                         |
| Medium   | `web/src/App.tsx:746`              | Form error initially appeared far away in footer                                              | Move alert into form, connect descriptions and focus invalid field; browser validation/focus passed              |
| Medium   | `web/src/App.tsx:419`              | 320px screenshot joined words when desktop line break was hidden                              | Preserve spaces; corrected mobile screenshot inspected                                                           |
| Medium   | `web/src/App.tsx:332` (`run`)      | Previous confirmation lingered during a new action's initial reads                            | Immediately show current-check status; final approval/swap/claim flow passed                                     |
| Low      | `web/src/App.tsx:161` (wallet effect)  | Anonymous disconnect handler could not be removed                                             | Named handler and cleanup; final account-change check passed                                                     |

### Evidence

- `1440-disconnected.png`, `390-disconnected.png`, `320-disconnected.png`: responsive layout, public data and fixture leaderboard.
- `1440-connected.png`: connected sell form and post-claim zero balance.
- `browser-results.json`: 16 checks, no uncaught page errors/unexpected RPC methods.
- `accessibility.json`: zero violations, passes and incomplete contrast item.
- `contrast.json`: computed foreground/background values and ratios.
- `live-check.json`: actual chain/code/state/quote reads.

Desktop and 320px screenshots, including the corrected narrow version, were opened and visually inspected. The 390px screenshot was generated by the test; physical-device review is not claimed. Screenshots are not screen-reader sessions.

## Delivery integrity and limits

Both ABI arrays match pinned source `7f83c0ed3b0480db307d5552c88ecf771a51fd1b` and the supplied canonical Keccak hashes. The export contains six assets plus its self-excluding manifest, roughly 0.53 MB total. Its exact contract set, handoff fields and unchanged network/add-chain objects are consumed by the frontend at runtime. `check:export` validates its inventory and bytes.

The only ignore-file change is `web/.gitignore` (explicit budget: one file), excluding nested generated dependencies/caches within `web/`. No node_modules, cache, dependency archive, submodule, root lockfile, deployed-source or root configuration change is included. Final path/size results are in `integrity.json`.

**Useful implementation and worker checks complete within the allowed scope, with acceptance conflicts and hosting limitations.** Literal root DESIGN.md and PoolSwapTest clauses are not satisfied because they conflict with the path/network constraints. Direct local HTTP browser hosting, public RPC CORS, native zoom, screen readers, real wallet extensions and funded live swaps/approvals/claims remain untested. Read-only code and quote checks do not certify router settlement. IPFS, named entrypoint, immutable HTTP hashes and publisher verification are subsequent work and are not claimed here.

### Git metadata limitation

The workspace mounts `.git` read-only. `git add -- web dist docs` failed to create `.git/index.lock`, so the working repository could not be staged or committed. All deliverables remain present in the permitted paths for the publisher. A disposable checkout under `test/scratch/` was used to assemble and commit the same deliverable set solely to measure a complete full-history Git bundle; it is not an assertion that the working repository was committed. The measured bundle is below 2 MiB (and the required 8 MiB limit). Scratch data is not submitted.
