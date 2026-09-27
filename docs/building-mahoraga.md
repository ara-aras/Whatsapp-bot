# Building MAHORAGA: four months, one WhatsApp number

MAHORAGA is a WhatsApp bot. One phone number runs four chat bots, a personal assistant that only its owner can use, and a small HTTP control plane. This post covers:

1. [How it began](#1-how-it-began)
2. [How it went](#2-how-it-went)
3. [Where it stands](#3-where-it-stands)
4. [Who it is for](#4-who-it-is-for)
5. [What comes next](#5-what-comes-next)
6. [Current problems](#6-current-problems)
7. [Alternatives](#7-alternatives)
8. [Lessons and loose ends](#8-lessons-and-loose-ends)

All of it is reconstructed from the git history, from a single 618-line `bot.js` on 18 May 2026 to the TypeScript codebase of about 16k lines that runs on an Android phone today.

![MAHORAGA command map](./command-map.svg)

---

## 1. How it began

The first commit landed on 18 May 2026: `feat: WhatsApp bot allowlist, admin controls, and deploy setup`. It is one `bot.js` file plus two config modules, `chatConfig.js` and `groupConfig.js`.

From day one it used [Baileys](https://github.com/WhiskeySockets/Baileys) (`7.0.0-rc11`). Baileys speaks WhatsApp's multi-device protocol directly instead of driving a browser. The core rule from that first commit is still in the code: **the bot says nothing unless the owner has allowlisted the chat or group.**

The same day, the project went through three deployment ideas:

1. a Render background worker,
2. then a Render web service with a health endpoint (Render's free tier wants something listening on a port),
3. then a commit titled simply:

> Transition to TS / Multi Bot / Remove from list

That commit set the course for everything after it. The code moved to TypeScript, and one number would host *several* bots, with each chat assigned to one of them.

The first real bot was **DKB**, an assistant for DK24 (Developer Kommunity 24), a network of college tech communities in Mangaluru. By 22 May it had:

- a mentor directory in Postgres (Neon), with flag-based `!addmentor` and `!editmentor`,
- club and event lookups, scraped from the DK24 site with Puppeteer and cached,
- a system prompt covering DK24's history, its umbrella-network model and its TEAM (Techie/Explorer/Advisor/Mentor) growth model,
- a rule for ambiguous questions: if "devfest" matches several events, *ask which one* instead of guessing.

## 2. How it went

The work came in bursts, not a steady stream:

```
May 18    ▏██████                     first commit, JS → TS, Render
May 22    ▏████████████████████████████  DKB bot, Neon, mentor directory
May 24    ▏██████████████████████████████████████████████  the big modular split
May 26-27 ▏████████████████████████   the 408 disconnect war
May 31    ▏█████████████████████████████████████████████████████████████████████████████████████████████████████ (101)
Jul 04    ▏███████████████████████████████████████████████  audit follow-up, PRs #1–#9
Jul 05-08 ▏██████████████████████████████████████████████  PATCHES Fix #1 and #2
            … two quiet months …
Sep 20-22 ▏██████████████             MAHORAGA: dashboard, API, watchdog
Sep 26-27 ▏███████████████            moves onto a phone
```

### The great split and the LID problem (24 May)

There were 46 commits on 24 May, and most of them belong to one refactor. A single `dk24Store` file and the monolithic services were split into three layers:

- `storage/` repositories for events, community, mentors, RBAC, audit logs, allowlists and cache,
- `services/` on top of them,
- Redis-backed distributed state, rate limiting and idempotency checks.

The same refactor added an LLM-based prompt-injection classifier, and all dynamic context got wrapped in CDATA so data in the prompt is never read as instructions.

The same day went into **LIDs**, a WhatsApp detail that anyone building on Baileys runs into. WhatsApp increasingly identifies group participants by an opaque "linked ID" instead of their phone number. It took six commits to handle it:

1. look the ID up through Baileys' `signalRepository`,
2. fall back to group metadata,
3. finally, keep a persistent LID→phone mapping in the database.

Without that mapping, role checks like "is this person a mentor?" cannot work.

### The 408 war (26–27 May)

The WhatsApp session keys were stored in Neon, and the bot kept falling into a 408 disconnect loop. The commit log from those two days reads like a debugging diary:

1. Warm the Neon pool before the WhatsApp handshake.
2. Replace the parallel key writes with one bulk `UPSERT`.
3. Raise the pool idle timeout to 120 s so it survives the QR scan.
4. Add exponential backoff and a crash-loop breaker.
5. Add TCP keepalive and a 45 s heartbeat so Neon doesn't suspend.
6. Try a dedicated auth pool, then a persistent singleton, then never closing it on reconnect.
7. **`revert: rollback to pre-security state entirely to restore working connection`**

The revert's message is honest: *"This guarantees a working connection while we regroup."* Encryption came back the same day, this time with a plaintext-to-encrypted migration path. That pattern shows up again and again in this repo: get back to something that works, then rebuild carefully.

### The marathon (31 May)

31 May has **101 commits**, the most of any day. It brought:

- **A common interface.** `BotHandler` and `BotContext`, with PARAG, ECB and DKB migrated onto them. `!help` is now built from the registry instead of hardcoded text.
- **Router cleanup.** The command registry got RBAC middleware, and the message router was split into middleware (`lidResolver`, `antiReplay`, `introDetector`).
- **SELF.** The owner-only assistant on the `!!` prefix, with reminders, translation, thread summaries, voice notes (Groq Orpheus TTS with a daily cap) and web search through Firecrawl and Tavily.
- **ECB.** The foundation of the EmbedClub bot.
- **The first vitest suites.**
- **A Puppeteer versus Nixpacks fight.** It went from system chromium, to an explicit `executablePath`, to a Dockerfile that caches the Chromium layer.

### Audit follow-up and PATCHES (4–8 July)

After a quiet June, 4 July opened with a security fix: **Baileys rc11 → rc13 for CVE-2026-48063**. A batch of audit items followed:

- per-message failure isolation in the router,
- a global cap on outgoing messages, to lower the ban risk,
- fail closed if the encryption key for the session is missing,
- an outbound secret scrubber,
- the DK24 site's `/api/v1` replacing Puppeteer scraping entirely.

This is also when the project started using pull requests, and the bot line-up was reshuffled: **Generic** took slot 0 and PARAG moved to slot 3.

Two rounds of fixes tracked in `PATCHES.md` followed:

- an offline auto-responder for the owner's DMs, reached with `!chat`,
- unified allowlist commands that infer their target from the chat they're sent in,
- a `!manage mentor` rewrite.

A side project also came out of this: `laptop-notifier/`, which shows a desktop toast when the auto-responder answers someone. Working out whether the owner was actually at their desk took five PRs in one evening. The detection went from "any window naming WhatsApp", to the real WhatsApp app, to the `(N) WhatsApp` unread-badge title, to a strict WhatsApp Web match.

### MAHORAGA (20–22 September)

After two months of silence, PR #34 renamed the project to **MAHORAGA** and made it something you can operate:

- a watchdog, and an honest `/health` that returns 503 when WhatsApp is actually down,
- an admin dashboard that shows the pairing QR code in the browser,
- a public REST API (`/api/v1/status|groups|chats|messages`) with scoped `mhk_` API keys,
- allowlist CRUD over HTTP.

View-once handling also got an Android-companion identity, so view-once media is delivered to the bot at all.

### Living on a phone (26–27 September)

The last stretch moved the bot off Render and onto an Android phone. The setup is:

- Termux, with Debian under `proot-distro`,
- a supervisor script standing in for Render's restarts,
- `botctl.sh` to start, stop and read logs in tmux,
- auto-update from `origin/main`,
- a Termux:Boot entry so it starts with the phone.

The owner-away auto-responder was switched off by default in the same change.

A phone on mobile data is a slower link than a data centre, and the final fixes deal with that:

- the DK24 calendar is fetched once and cached by content hash,
- Neon connection failures on slow links now log the real cause,
- a racy `SET statement_timeout` was replaced with pg's `query_timeout`.

The latest change made every help text match the commands that exist. That is also why the map at the top could be drawn straight from them.

## 3. Where it stands

| | 18 May | 27 Sep |
|---|---|---|
| Language | JavaScript, one 618-line file | TypeScript, ~16k lines |
| Bots | 1 | Generic, ECB, DKB, PARAG + SELF |
| Storage | JSON config | Postgres (Neon) + Redis |
| Security | allowlist | allowlist, RBAC, prompt firewall, rate limits, secret scrubber, encrypted session |
| Ops | `console.log` | `/health`, watchdog, dashboard, REST API |
| Host | Render | an Android phone |
| Tests | none | 36 files, 217 tests, all passing; typecheck clean |
| Pull requests merged | 0 | 47 |

What works today:

- **DKB** is the most complete bot. It has clubs, events (from the dk24.org calendar), projects, a paginated mentor directory and mentor-role management.
- **SELF** is the most useful day to day: questions with web search, reminders, Google Calendar, translation, thread summaries, tone detection, reply drafts and voice notes to any saved chat.
- **Admin control** lets the owner steer everything from WhatsApp itself: allowlists, bot assignment, roles and view-once reveal.
- **Ops**: health checks, a watchdog, a browser dashboard, and a REST API with scoped keys.

## 4. Who it is for

| Who | What they get | Bot |
|---|---|---|
| DK24 members and students in Mangaluru | answers about clubs, events, projects and mentors | DKB (bot 2) |
| DK24 mentors | a way to manage the mentor directory from WhatsApp | DKB mentor commands |
| EmbedClub members | projects, events, deadlines | ECB (bot 1) |
| Hackathon participants | a tech and hackathon helper that stays on topic | PARAG (bot 3) |
| People DMing the owner | a polite "away" reply (currently off) | Generic (bot 0) |
| The owner | a personal assistant and full control of the bot | SELF (`!!`) and admin |
| Other projects | send messages over HTTP with a scoped key | REST API |

What ties them together: WhatsApp is where these groups already talk. A bot that lives there gets used. A website or a separate app has to be remembered.

## 5. What comes next

Some of these ideas are new. Others are half-built already, and that's noted.

### Proper security

The prompt firewall is an LLM judge sitting in front of the models. The July roadmap plans to replace it with an action-level guard (Agent Defender), which blocks tool calls, outbound requests and leaked secrets instead of scanning for words. Other items worth adding:

- CI (see [problems](#6-current-problems)),
- rotating the API keys and the session encryption key,
- an audit view in the dashboard.

### Translation models

`!!translate` already exists, but it sends the text to the general chat model. Possible upgrades:

- a dedicated translation model, for better Kannada, Tulu, Konkani and Hindi,
- voice-note transcription and then translation,
- an opt-in "auto-translate this group" mode.

### Drive upload

Save media and documents sent in a chat to Google Drive with a command, for example `!!save` on a reply. A Google service account is already wired in for `!!gcal`, so most of the plumbing exists.

### DK24 events and hackathon updates

Today DKB only **reads** dk24.org (`/api/v1/calendar`, `/communities`, `/projects`). The next step is two-way:

- announce new events and hackathons to groups when they appear,
- let authorised organisers post updates from WhatsApp.

Posting updates needs a write endpoint on the DK24 side, so it is not something this repo can do alone.

### PDF and other resources

`knowledge/` has been reserved since 31 May for document ingestion. The idea: index PDFs (syllabi, event handbooks, guides) and answer from them with page references, or send the file itself.

### Recovering deleted messages

The idea is to keep every message for 24 hours, so that a deleted one can be brought back from the cache. Technically it's simple: the router already sees revoke `protocolMessage`s and currently just drops them.

Be careful with this one, though. The sender deleted that message on purpose. Keeping it anyway, especially in groups full of people who never agreed to it, sits badly with India's DPDP Act and with basic trust in the bot. If it gets built, keep it to the owner's own DMs, encrypt the cache, delete entries after 24 hours for real, and say openly that the feature exists.

### Automation

Scheduled messages, recurring announcements, and replies that fire on a keyword or an event. The scheduler and the global outgoing cap are already there. The cap matters here, because bulk automated sending is the fastest way to get the number banned.

### A "Telegram bot" for other projects

The idea: other projects get a WhatsApp bot the way they would get a Telegram bot. Half of this exists already. `POST /api/v1/messages` with a scoped `mhk_` key lets a project **send**. What's missing is the other direction:

- **inbound webhooks**: forward messages from a project's assigned chat to its URL, signed with HMAC,
- per-project command prefixes,
- self-service key creation.

With those, a project is just "bot N" with its own endpoint.

## 6. Current problems

Honest list, as of 27 September:

1. **It isn't WhatsApp's official API.** Baileys is reverse-engineered and still a release candidate (`7.0.0-rc14`). Meta can change the protocol or ban the number at any time. CVE-2026-48063 in rc11 shows that the library itself can be a risk.
2. **One number, one process, one phone.** When the phone dies, loses signal or Android kills Termux, every bot goes down together. The watchdog reports the failure; it can't prevent it.
3. **No CI.** 217 tests exist and they pass, but nothing runs them on a pull request. There is no `.github/workflows`. Every merge relies on someone remembering to run `npm test`.
4. **`npm ci` depends on the npm version.** The lockfile works with npm 11 (Node 24, as in the Dockerfile) but npm 10 rejects it (`picomatch` mismatch), even though `package.json` claims `node >= 20`. The Termux setup and auto-update both run `npm ci`.
5. **Everything runs on free tiers.** Neon, Upstash Redis and Groq all have limits. Groq limits show up as the daily TTS cap. Neon's cold starts are what caused the 408 war.
6. **The auto-responder is parked.** Bot 0's away replies are off "pending optimisation", so the Generic bot currently does almost nothing.
7. **ECB is thin.** It has three commands compared with DKB's ten or so.
8. **LID resolution can still fail.** A participant whose LID has never been mapped can't be role-checked until they are. That's why the logs have a throttled `lid_unresolved` warning.
9. **The firewall is a model judging a model.** An LLM judge catches most injections but not all of them. The action-level replacement is still on the roadmap.
10. **Everything goes through one owner.** Allowlists, roles and the hosting phone all belong to one person. There's no second admin and no handover plan.

## 7. Alternatives

MAHORAGA is not the only way to put a bot on WhatsApp.

### OpenWA (rmyndharis/OpenWA)

[OpenWA](https://github.com/rmyndharis/OpenWA) is an MIT-licensed, self-hosted **WhatsApp API gateway** (about 14.6k stars). It runs on either whatsapp-web.js or Baileys underneath.

What it does better than MAHORAGA:
- **Multi-session**: many numbers from one server.
- **Webhooks with HMAC signatures**: exactly the inbound half that MAHORAGA's API is missing.
- **Swagger/OpenAPI docs** and a real dashboard.
- **An MCP server** for AI agents (51 tools, read-only by default).
- **Pluggable storage**: SQLite or Postgres, local/S3/MinIO media, memory or Redis cache.
- **Plugins** such as Chatwoot and Typebot.
- **Docker images** for amd64 and arm64.

What it doesn't do:
- **It's a gateway, not a bot.** There's no DK24 knowledge, mentor directory, RBAC per bot, prompt firewall, SELF assistant or persona routing. You would build all of that on top of it.
- **The same ban risk.** It uses the same unofficial clients, and its own docs warn: *"There is always a non-zero risk of account restriction or ban."*
- **Heavy by default.** Its default engine (whatsapp-web.js) runs a browser, about 300–500 MB of RAM per session. Baileys, which MAHORAGA uses, is about 30–80 MB, and that difference matters on a phone.

### open-wa/wa-automate-nodejs

This is the older project with a similar name, [open-wa/wa-automate-nodejs](https://github.com/open-wa/wa-automate-nodejs), about 3.7k stars. It turns WhatsApp Web into an API using browser automation (Puppeteer or Playwright).

- **Better:** it's mature and full of features: multi-session, MCP, webhooks, a Chatwoot bridge.
- **Worse:** some features need a paid license key, v5 is still alpha, and a browser per session is heavy.

### WhatsApp Business Platform (Cloud API)

This is Meta's official API.

- **Better:** no ban risk from running unofficially, it's stable and supported, and it's the only reasonable choice for regulated or commercial use.
- **Worse:**
  - It needs a business account and verification, and a number that isn't your personal WhatsApp.
  - Messages are paid, and outside the 24-hour customer-service window you can only send pre-approved templates.
  - Group support is limited.
  - Many of MAHORAGA's personal tricks, such as SELF in any chat, `!reveal` and reading chat history, are simply not possible on it.

### Other gateways

**WAHA** and **Evolution API** are in the same category as OpenWA: self-hosted HTTP gateways over unofficial clients. They make similar trade-offs, and they have strong communities.

### Summary

| | MAHORAGA | OpenWA | wa-automate | Cloud API |
|---|---|---|---|---|
| Official | no | no | no | **yes** |
| Ban risk | yes | yes | yes | no |
| Built-in bot logic | **yes** | no | no | no |
| Inbound webhooks | no | **yes** | **yes** | **yes** |
| Multi-number | no | **yes** | **yes** | **yes** |
| RAM per session | low (Baileys) | low–high | high | n/a (hosted) |
| Cost | free tiers | free | free + paid key | per message |

The realistic path forward may be a mix of both. MAHORAGA's value is the bot logic (DK24 knowledge, roles, SELF, the firewall), not the WhatsApp plumbing. That logic could run on top of a gateway like OpenWA, and the gateway would handle sessions, webhooks and media.

## 8. Lessons and loose ends

- **Revert early.** The 408 war ended the moment the code went back to a working state and was rebuilt one step at a time. Stacking one more "fix" on top had been making it worse.
- **Help text is part of the product.** It drifted from the real commands until a whole PR was needed to fix it. A test that checks help text against the command registry would stop that from happening again.
- **Protocol details dominate.** LIDs, view-once identities, Opus voice notes and 408 reconnects cost more commits than any AI feature did.
- **Free infrastructure shapes the design.** Neon cold starts, Render's port requirement and Groq's limits each changed the architecture at least once.
- **Small PRs and a written roadmap helped.** Once PRs started on 4 July, the history became readable. `PATCHES.md` and the July roadmap made it clear what was done and what was deliberately left for later.

If you want to try it, [`docs/termux.md`](./termux.md) covers running it on a phone, and the map at the top covers every command.
