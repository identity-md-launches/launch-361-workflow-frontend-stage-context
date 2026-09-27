# Swap Tip design

## Overview

Swap Tip is a single-page Sepolia swap and ETH-tip interface for visitors with a browser wallet. A warm paper background, dark green text, lime impact panel and compact transaction controls create a calm, personal interface. Consequential amounts, recipients and recovery instructions stay explicit.

This file lives under `docs/` because the authoritative path budget excludes root `DESIGN.md`. It documents the final implementation in `web/src/App.tsx` and `web/src/styles.css`.

## Colors

CSS uses one hex palette. Primitives feed semantic roles at `web/src/styles.css:1`; components use the semantic roles.

| Semantic token     | Value     | Use                                            |
| ------------------ | --------- | ---------------------------------------------- |
| `--bg`             | `#f5f3ed` | Page and amount surfaces                       |
| `--surface`        | `#fffefa` | Swap card and controls                         |
| `--text`           | `#202d27` | Text, numbers, final confirmation action       |
| `--secondary`      | `#59635b` | Supporting text                                |
| `--border`         | `#dbded5` | Structural dividers and card boundaries        |
| `--control-border` | `#858c80` | Editable fields and secondary buttons          |
| `--accent`         | `#245c40` | Primary action, slider, network indicator      |
| `--accent-hover`   | `#1c4933` | Primary hover                                  |
| `--impact`         | `#d9ed91` | Community impact and STIP symbol               |
| `--subtle`         | `#eef1e8` | Segmented-control bed and disabled backgrounds |
| `--error`          | `#9e302e` | Errors, always accompanied by words            |
| `--on-accent`      | `#fffefa` | Primary action text                            |
| `--focus`          | `#315fc0` | Keyboard outline                               |

Only a light theme exists. Measured rendered text/background pairs: secondary/page 5.63:1, primary-button text/green 7.76:1, impact heading/lime 11.24:1, hint/paper 6.19:1. These refer to specific tested states, not every possible state. See `frontend/contrast.json`.

## Typography

The system stack is `Arial, Helvetica, sans-serif`; addresses use system monospace. There are no downloaded fonts. Body is 16px/1.5. `--small` is 13px, `--body` 16px and `--section` 22px. Dense captions use 11–12px and weights of at least 400. Input text stays at least 16px on mobile. Headings use 500–700 weights, balanced wrapping and negative tracking; descriptions use pretty wrapping.

The hero scales from 43.2px to 70px, with 1.02 line height and −3.2px tracking (−2px on mobile). Section headings use 22px/1.2; community title is 26.4px desktop and 24px mobile. ETH total scales from 44px to 64px with smaller units. Amount entry uses 33.6px. Changing numbers use `font-variant-numeric: tabular-nums`. Addresses stay selectable. Explorer links carry full addresses in accessible names and titles; quote review shows the full recipient with wrapping.

## Layout

`.shell` caps the page at 1216px including 48px inline padding. Major groups use 24–32px gaps; related controls/labels generally use 8–12px. Header, price strip and footer share edges. Explanatory text is capped around 60–75 characters.

`.workspace` uses a 1.38:1 two-column grid with a 32px gap. Overview contains tips, price and leaderboards; the actions column contains swap and claim. At 1000px, shell padding becomes 28px, grid gap 22px, ratio 1.1:1 and leaderboards stack. At 740px, workspace becomes one column with actions visually first, padding becomes 20px, and the decorative hero seal disappears. The DOM retains overview before actions; keyboard and screen-reader order follows the DOM. At 390px, padding becomes 16px, cards use 20px padding and leaderboards stack again.

Cards grow with content and controls remain inset. Long addresses wrap. The native recipient input scrolls long values internally; quote review additionally exposes the full address. No sticky primary action obscures content. Overflow checks passed at 1440, 900, 740, 390 and 320 CSS pixels. A 200% root-font test at 740px passed; native browser zoom and physical-device rendering were not tested.

## Elevation & Depth

The system is mostly flat. Card borders communicate grouping. The swap card has `0 8px 24px #202d2705` shadow; the selected direction has `0 1px 3px #202d2710`. No modal, backdrop, staged entrance or layered overlay exists. The arrow between amount fields is decorative.

## Shapes

Cards share `--radius: 24px`. Amount surfaces and buttons use 12px; text inputs 9px; numeric inputs 7px; pool labels 6px. Badges are pills. Brand marks and coin symbols use inline SVG/CSS with no external images. The rising line in the impact card is decorative, hidden from assistive technology, and is not a historical chart.

## Components

- `Mark` in `web/src/App.tsx` renders the decorative swap-arrow identity. `.brand` supplies accessible link text.
- `AddressLink` renders an explorer link with full-address accessible text and an abbreviated visible address isolated with `bdi`.
- `Board` accepts a title, address field, events, config and history status. It renders an ordered top-five list or loading/empty/error state. Ranking uses bigint sums from `domain.ts`.
- `.segmented` groups native Buy STIP/Sell STIP buttons with `aria-pressed`. Selection uses a paper surface and border; keyboard activation is native.
- The form uses labels, inputs, a native range, fieldset and inline alert. Invalid amount/recipient/slippage receives focus; `aria-invalid` and descriptions connect errors to controls. Range values announce percent.
- `.primary` is the green next-step action; `.wallet` and secondary buttons are outlined. Quote refresh becomes secondary during a current review. `.confirm` names the final transaction. Disabled states use native `disabled`.
- `.quote-review` shows exact input, minimum output, full tip recipient and expiry. `.approval-steps` exposes each sell approval. Input/account/chain changes invalidate the review.
- `.claim-card` shows claimable ETH, cumulative given/received and a claim-all control gated by wallet, verification and positive balance.
- `.feedback` contains persistent transaction status and explorer links. `.deployment-details` uses native `details/summary`. No focus trap is needed.

Keyboard outlines are 3px solid `--focus` with 4px offset (2px for inputs). Buttons are generally at least 44px tall; direction controls are 40px. Under `prefers-reduced-motion: no-preference`, button background/transform transitions use 120ms `cubic-bezier(.2,0,0,1)` and 0.96 press scale. Reduced motion disables these changes. Forced-colors mode retains system borders and focus. The skip link is first in keyboard order.

## Do's and Don'ts

- Reuse `.shell`, semantic tokens, `.section-heading` and native controls for new sections.
- Keep exact amounts and full recipients in consequential reviews; do not substitute rounded display figures.
- Distinguish loading, empty, stale, rejected and confirmed states. An unread value is `—`, never a fabricated zero.
- Consume the runtime manifest and checked ABI loader; never add a second address/RPC map.
- Keep the lime panel informational, controls inset, labels visible and addresses selectable. Decorative arrows are not performance data.
- Add a semantic section to the appropriate workspace column, reuse the documented tokens, then check 320px reflow and keyboard order.

## Design-reference attribution

Design review adapted from Jakub Krehel's [Better Interface](https://github.com/jakubkrehel/skills/tree/267330e1adfc66a718fb65fa6918c1f06d0a689e/skills/better-interface), commit `267330e1adfc66a718fb65fa6918c1f06d0a689e` (MIT), supplied in the pinned guide. Documentation structure adapted from Paul Bakaus's [Impeccable document reference](https://github.com/pbakaus/impeccable/blob/9d715cc4f5564a990ca8345abfdd5df6dc9b41c8/skill/reference/document.md), commit `9d715cc4f5564a990ca8345abfdd5df6dc9b41c8` (Apache-2.0). Each upstream retains its respective license; this document does not republish the guide.
