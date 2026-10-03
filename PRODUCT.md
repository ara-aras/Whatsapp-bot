# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Primary user is the owner/administrator (Rafan), managing a multi-bot WhatsApp system running on an Android phone (Termux) and communicating with DK24 college student communities, Hackathon teams, EmbedClub members, and personal assistant workflows.

## Product Purpose

MAHORAGA is a multi-tenant, single-number WhatsApp bot ecosystem and personal executive assistant that adapts to all phenomena. It operates multiple specialized bot personas (Generic, ECB, DKB, MAHORAGA group bot, and MAHORAGA owner bot), paired with an administrative control plane (`/admin`) for real-time health telemetry, allowlist routing, bot assignment, Level switching, audit logging, and pairing management.

## Positioning

Unlike typical third-party WhatsApp wrappers, MAHORAGA runs entirely locally on an Android device via Termux with minimal resource footprint (Baileys lightweight socket), zero-cloud dependency for core operations, adaptive model failover across Groq, and specialized multi-level personas with an 8-stage Dharmachakra adaptation engine.

## Operating Context

- Runtime: Node.js / TypeScript in Termux (Debian proot) on Android phone, with continuous automated updates from git.
- Storage: Serverless Postgres (Neon) for persistent relational entities (mentors, allowlists, audit logs) + Redis (Upstash) for ephemeral caching, rate limits, and context windows.
- Admin Surface: Web dashboard at `/admin` accessible via private token, featuring real-time health metrics, active bot management, allowlist manipulation, and pairing QR visualizer.

## Capabilities and Constraints

- Capabilities:
  - 5 Bot personas: Generic (0), EmbedClub (1), DKB (2), MAHORAGA Tech (3), MAHORAGA Owner (`!!`).
  - Level switching: DKB supports Level 1 (Static DK24 DB) and Level 2 (Agentic Live Search); other bots locked to Level 1.
  - Telemetry: Real-time latency tracking for Neon DB, Redis cache, Groq AI models, and search providers.
  - Allowlist management: Instant addition/editing of groups and direct chats with bot assignments and level configuration.
  - Audit logging with single-click restoration of historical allowlist state.
- Constraints:
  - WhatsApp Baileys protocol limits, single-process memory ceiling on mobile devices.
  - Admin page is served as a self-contained, high-performance HTML/CSS/JS payload with zero external script bloat.

## Brand Commitments

- Name: MAHORAGA (Eight-Handled Sword Divergent Sila Divine General).
- Aesthetic: Celestial Divine Void / Dharmachakra sacred geometry, mythic adaptation, sharp technical typography, deep void canvas with glowing celestial accents (cyan, gold, teal).
- Voice: Direct, sharp, authoritative, zero fluff, concise.

## Product Principles

1. **Adapt to All Phenomena:** Resilient execution; graceful degradation when external services fail.
2. **Ruthless Performance on Mobile:** Everything must load and execute instantly with zero sluggishness on mobile networks and phones.
3. **Clarity & High-Information Density:** Every UI widget must convey critical state immediately without clutter.
