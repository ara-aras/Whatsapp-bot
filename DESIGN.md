# Design System: Dharmachakra Void (Celestial Cyber-Brutalism)

<!-- impeccable:design-schema 1 -->

## Aesthetic Thesis

A dark, atmospheric, high-craft operational dashboard inspired by the divine shikigami **Mahoraga (Eight-Handled Sword Divergent Sila Divine General)**. Replaces flat, generic SaaS layouts with an evocative cosmic void aesthetic: deep obsidian black canvas (`#050811`), ethereal cyan/teal cursed energy (`#38bdf8` / `#06b6d4`), radiant divine gold (`#fbbf24`), on solid deep-indigo surfaces with hairline rules.

## Current build (admin console, `infrastructure/health/adminPage.ts`)

This section describes what ships; where it conflicts with older notes below, it wins.

- **Surfaces:** solid, not glass. `--void #050811` ground, `--surface #0a1020`, `--surface-2 #0e1628`, `--surface-3 #131d33`. Elevation is a 1px `--line rgba(148,163,184,.13)` border, never a border plus a wide shadow. No `backdrop-filter`, no art behind data.
- **Gold is the brand and "healthy":** wheel linework, the wordmark emblem, the primary button, the active filter chip. **Cyan is interaction:** focus rings, switches when on, selection highlight, live-activity dots. Emerald / amber / crimson are state only (chips, arc, reading values), always paired with text or shape.
- **Type:** Cinzel only for the MAHORAGA wordmark and login title. Space Grotesk for all UI at 14px base, headings 19px/28px weight 600, tabular numerals. JetBrains Mono only for JIDs, key prefixes, latencies and ages.
- **The Eight Handles instrument:** a drawn SVG wheel whose eight handles are eight live readings (Socket, Inbound, Outbound, Uptime, Neon, Redis, Groq, Search), clockwise from the top. Handle vocabulary, shared with the list beside it: solid gold with a dark centre = healthy, amber ring with a dot = degraded, crimson ring with a slash = down, dashed ring = no data. The rim arc shows freshness of the last inbound message. Spokes turn only while connecting; nothing moves under reduced motion. Hovering a handle lights its reading and the reverse. Pairing swaps the wheel for the QR in the same slot.
- **Routing ledger:** one table, one row per group or chat: bot, level (DKB only), read and ask (DKB groups only, an inert dash elsewhere), active switch, remove. Persona filter chips and a text filter above it. Below 1000px each row restacks into a labelled card.
- **Controls:** 34px buttons and inputs, 8px radius; 12px radius on tables and panels; pill shape only for chips and switches. Icons are one inline SVG sprite, 1.75 stroke.
- **Art:** `mahoraga_stare.jpg` appears only on the login screen, greyscale and masked. The kanji seal `八握剣異戒神将魔虚羅` runs vertically at low-opacity gold beside the hero and on the login art.

## DFII Evaluation

- **Aesthetic Impact:** 5/5 (Unforgettable anime-mythic divine general theme)
- **Context Fit:** 5/5 (Matches the core identity of the MAHORAGA WhatsApp bot)
- **Implementation Feasibility:** 5/5 (Pure CSS/SVG/HTML with hardware acceleration, zero npm dependencies)
- **Performance Safety:** 5/5 (60fps animation, tiny payload, lightweight mobile rendering)
- **Consistency Risk:** 1/5 (Unified design tokens across all views and tables)
- **DFII Score: 14/15** (Execute fully)

## Design Tokens

### Color Palette

- `--bg-canvas`: `#050811` (Deep cosmic obsidian)
- `--bg-surface`: `rgba(13, 20, 36, 0.72)` (Translucent void card)
- `--bg-surface-elevated`: `rgba(20, 30, 52, 0.85)` (Elevated modal/panel)
- `--border-glass`: `rgba(56, 189, 248, 0.14)` (Subtle celestial border)
- `--border-glass-gold`: `rgba(251, 191, 36, 0.35)` (Divine gold accent border)
- `--color-gold`: `#fbbf24` (Dharmachakra gold)
- `--color-gold-glow`: `rgba(251, 191, 36, 0.3)`
- `--color-cyan`: `#38bdf8` (Cursed energy cyan)
- `--color-cyan-glow`: `rgba(56, 189, 248, 0.3)`
- `--color-emerald`: `#10b981` (Socket open / healthy)
- `--color-emerald-glow`: `rgba(16, 185, 129, 0.35)`
- `--color-crimson`: `#f43f5e` (Socket disconnected / error)
- `--color-crimson-glow`: `rgba(244, 63, 94, 0.35)`
- `--text-heading`: `#ffffff`
- `--text-body`: `#e2e8f0`
- `--text-muted`: `#94a3b8`

### Typography

- **Display & Headings:** `Cinzel`, serif / `Space Grotesk`, sans-serif (Ancient authority & modern technical precision)
- **Body & Controls:** `Instrument Sans` / `Space Grotesk`, sans-serif (High legibility at dense scale)
- **Telemetry & Codes:** `JetBrains Mono`, monospace (JIDs, tokens, hashes, timestamps)

### Visual Anchors

1. **Ambient Wheel of Adaptation:** Fixed, non-intrusive backdrop featuring the high-res eight-handled Dharmachakra wheel (`/admin/asset/mahoraga_wheel.jpg`) with dark vignette masking.
2. **The 8-Spoked Gauge:** The live connection indicator rendered with 8 protruding handles, glowing hub, and fluid state animations.
3. **Sacred Runes & Watermarks:** `八握剣 異戒神将 魔虚羅` embossed in subtle low-opacity vector calligraphy.
