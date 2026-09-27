# Swap Tip frontend

A single static page for Swap Tip (STIP), its ETH/STIP Uniswap v4 pool, optional ETH tips, and recipient claims on Sepolia. Source lives in `web/`; the complete, already-built website is in repository-root `dist/`. No backend, private credentials, CDN scripts, external fonts, or WalletConnect project ID are required. Use an injected EIP-1193 browser wallet.

## Install, build, preview

Node 22 and npm 10 were used. From the repository root:

```sh
npm --prefix web ci
npm --prefix web run build
npm --prefix web run preview
```

The build includes TypeScript checking, Vite's relative `./` base, pinned ABI validation, ABI copying, and generation of `dist/imd-deployment.json` **after** Vite exports the final assets. Keep the whole `dist/` directory together. The page supports a gateway subpath and requires no server rewrites. Never change an exported file without rebuilding its manifest. The publisher hosts the committed export without rebuilding.

`npm --prefix web run dev` is useful for source editing, but runtime configuration must be available at the served root: use production build/preview for deployment validation. The supported development loop is edit → build → preview. `web/scripts/browser-test.mjs --inspect` can also provide a bounded local production preview for up to ten minutes.

## Deployment is one runtime configuration

`dist/imd-deployment.json` is the application's only runtime address, chain, public RPC, pool and ABI-path configuration. `src/config.ts` fetches it relative to `document.baseURI`, fetches its referenced ABI arrays, and verifies each canonical Keccak hash before rendering the application. It defines only shared protocol interfaces, not another deployed-address map.

Build inputs are the unchanged handoff snapshots in `config/deployment-handoff.json` and `config/network-handoff.json`. Both implementation ABIs in `config/abi/` were obtained with `git show <handoff.sourceCommit>:docs/abi/<Contract>.json`. The exporter compares their raw bytes against that pinned Git source and their recursively key-sorted canonical JSON Keccak-256 against the attested hashes. A full Git checkout with that commit is required to rebuild.

The output copies the complete exact contract set and handoff identifiers. Its `network` and `walletAddChain` objects preserve the supplied values. Additional `pool`, `token` and `deploymentBlock` metadata also come from the handoff. Every other exported file is inventoried with SHA-256; the manifest excludes itself. No contract source or root build configuration was changed.

Before transaction controls become available, reads check RPC chain ID, nonempty code for the deployed token/hook, PoolManager, StateView, quoter, Universal Router and Permit2, the hook's actual PoolManager and token decimals. This is binding/configuration validation, not a bytecode audit or signature verification of the attestation. Verification repeats immediately before each simulated transaction. Reads use the supplied public RPCs with a chain-checked injected-wallet fallback; signatures use only the visitor's wallet. Wrong-network state offers one switch action, using the exact add-chain handoff if switching returns 4902/unknown chain.

## Swap and claim behavior

Buy and sell are exact-input swaps. The tip slider encodes precisely `abi.encode(uint16,address)` with a 0–500 bps rate; 0% ignores the recipient. Invalid, zero, hook and PoolManager recipients are rejected when a tip is requested. Amount precision uses token decimals read onchain. For buys the tip is included in the ETH input; for sells the hook deducts it from ETH proceeds. Gas is extra.

The mandatory network acceptance rule takes precedence over the older workflow sentence naming PoolSwapTest. This frontend uses the handoff's **Universal Router**, not PoolSwapTest. The network handoff has no PoolSwapTest address. No guessed/independently hardcoded router was introduced. This conflict remains an explicit assignment deviation, rather than a claim that both incompatible requirements were met.

Quotes use `quoteExactInputSingle` through `simulateContract` with the same pool and hook data. The form applies configurable 0.1–5% slippage, shows the exact minimum received, and invalidates quotes on any input/account/chain change or after 60 seconds. `execute` uses `0x10` and `0x060c0f` (swap exact input single, settle all, take all) with an onchain minimum output and five-minute deadline. It uses the handoff-compatible five-field single-swap tuple. Current upstream `main` also describes a newer tuple with `minHopPriceX36`; do not silently substitute that newer interface for this deployed router.

Native ETH buys need no approval. Sells require two explicit, amount-limited transactions: STIP approval to Permit2, then Permit2 approval to the supplied Universal Router for 30 minutes. Existing sufficient approvals skip those steps. Approval, swap and claim requests are simulated before signing. Wallet account/chain are checked again after simulation. Receipts must report success; errors/rejections and explorer links remain visible. Claim withdraws the connected wallet's entire hook balance; zero balances disable it. There are no hook admin actions.

Zero liquidity at the current tick is **not** treated as proof that swapping is impossible: a swap may cross into a funded range. The form explains this state and asks the quoter to establish availability. Live read-only validation demonstrated this case.

## Observability

Public pool views load before connecting; personal balances, `tippedBy`, `receivedBy`, and claimable ETH load after connection. StateView supplies slot0, spot price and current active liquidity. Reads refresh every 30 seconds, on connection/network changes, after confirmed transactions and manually. Read errors keep old data visibly stale and disable transactions. The spot price is informational; the quote determines output.

`Tipped` logs are filtered by the attested pool ID, scanned from the earliest deployment block through the same snapshot block, in bounded ranges (with adaptive smaller ranges on provider errors). Each scan replaces the previous scan, avoiding duplicate accumulation and allowing recent reorganizations to be reflected on refresh. Top five tippers and recipients are ranked using exact bigint sums; the indexed block range and partial-history errors are shown. This browser-only scanner can become slow over a long history; it does not silently cap the history or label partial results all-time. Pool totals come directly from `totalTipped(poolId)`; personal views aggregate addresses across hook pools by the deployed contract's semantics.

`tx.origin` is used by the hook solely as a tipper display label, never authorization. Recipients in hookData are unauthenticated. The page states this; leaderboard addresses are not verified identities.

## Validation

```sh
npm --prefix web run typecheck
npm --prefix web test
npm --prefix web run check:export
npm --prefix web run test:browser
npm --prefix web run check:live
```

`test:browser` uses Playwright, Chromium and axe-core. Set `CHROMIUM_PATH` to your installed Chromium executable if needed; the default is this worker's provided headless shell. The test serves the exact export bytes through request fixtures at `/preview/` and intercepts wallet/RPC calls. This worker denied direct localhost browser navigation, so it does not claim successful direct HTTP browser hosting. The test creates its own short-lived server/browser and closes them on completion. Screenshots and JSON evidence are written to `docs/frontend/`. No mocked data or test wallet code is bundled into the production app.

`check:live` performs public RPC reads and quoter simulations only; it never broadcasts. See [validation](../docs/frontend/VALIDATION.md) for actual outcomes, limitations, interface review and evidence. Hosted CID/named entrypoint checks belong to the subsequent publisher and have not run here.

## Source and size discipline

The explicit ignore-file budget is **one file: `web/.gitignore`**. It excludes generated dependencies/caches at every nesting level within `web/`; dependency installation uses a cache outside the repository. No other ignore file was changed. Deliver source, npm lockfile, static assets and evidence; omit `node_modules`, caches, npm archives and submodules. The final submission must remain under 8 MiB.

Root `DESIGN.md` is excluded by the authoritative write scope. Its requested content is delivered at [docs/DESIGN.md](../docs/DESIGN.md).

Protocol references: [Uniswap swap routing](https://developers.uniswap.org/docs/protocols/v4/guides/swapping/routing), [official IV4Quoter interface](https://github.com/Uniswap/v4-periphery/blob/main/src/interfaces/IV4Quoter.sol). These were used to review the interfaces; deployed addresses come exclusively from the handoff.
