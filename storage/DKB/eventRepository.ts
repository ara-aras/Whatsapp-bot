import { getPool, withTransaction } from "../db";
import {
  getCacheHash,
  isCacheValid,
  markCacheUpdated,
} from "../core/cacheRepository";
import { contentHash, fetchDk24Json } from "./dk24Api";

export interface Event {
  id: string;
  title: string;
  host?: string;
  date?: string;
  location?: string;
  description?: string;
  registration_deadline?: string;
  prize_pool?: string;
  tracks?: string[];
  registration_link?: string;
  join_link?: string;
  youtube_link?: string;
  poster_url?: string;
  tags?: string[];
  stage?: string;
  month_year: string;
  start_at?: Date | string | null;
  end_at?: Date | string | null;
}

// Shape of one event in GET /api/v1/calendar (the website's IEvent).
interface ApiEvent {
  id?: string;
  title?: string;
  startDateTime?: string;
  endDateTime?: string;
  location?: string;
  description?: string;
  registrationLink?: string;
  joinLink?: string;
  youtubeLink?: string;
  posterUrl?: string;
  organizationName?: string;
  tags?: string[];
}

interface CalendarPayload {
  month?: string;
  events?: ApiEvent[];
}

// The whole calendar is small (~35 events), so it is fetched in one request
// and bucketed by month locally. `?date=` is not used: Netlify's edge cache
// ignores the query string, and the site caps each month at 3 events.
const EVENTS_CACHE_KEY = "calendar:all";
const EVENTS_COOLDOWN_MS = 30 * 60 * 1000;
const DK24_TIMEZONE = "Asia/Kolkata";
// Bump when mapApiEvent changes so stored rows are rebuilt even if the
// upstream payload is identical.
const EVENTS_MAPPING_VERSION = 1;

const EVENT_COLUMNS =
  "id, title, host, date, location, description, registration_deadline, prize_pool, tracks, registration_link, join_link, youtube_link, poster_url, tags, stage, month_year, start_at, end_at";

const MONTHS = [
  "jan",
  "feb",
  "mar",
  "apr",
  "may",
  "jun",
  "jul",
  "aug",
  "sep",
  "oct",
  "nov",
  "dec",
];

function currentMonthYear(): string {
  return monthYearOf(new Date()) ?? "jan-1970";
}

// Date normalization helper (e.g. may26, may-2026, May 26 -> may-2026)
export function normalizeMonthYear(input: string): string {
  const trimmed = input.trim().toLowerCase();

  if (trimmed === "events" || trimmed === "event" || !trimmed) {
    return currentMonthYear();
  }

  const match = trimmed.match(/^([a-z]{3,9})[\s-]*(\d{2,4})$/);
  if (match) {
    const month = match[1].slice(0, 3);
    let year = match[2];
    if (year.length === 2) {
      year = `20${year}`;
    }
    return `${month}-${year}`;
  }

  // Return input if it matches format already, else fallback
  if (/^[a-z]{3}-\d{4}$/.test(trimmed)) {
    return trimmed;
  }

  return currentMonthYear();
}

// Month bucket ("sep-2026") of an instant, as seen in India. Using server
// local time would shift events near midnight on the 1st into the wrong month.
export function monthYearOf(date: Date): string | null {
  if (isNaN(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: DK24_TIMEZONE,
    year: "numeric",
    month: "numeric",
  }).formatToParts(date);
  const month = Number(parts.find((p) => p.type === "month")?.value);
  const year = parts.find((p) => p.type === "year")?.value;
  if (!month || !year) return null;
  return `${MONTHS[month - 1]}-${year}`;
}

// Stage is derived from the clock, so it is computed on read rather than
// stored: an unchanged payload must not leave "Upcoming" on a past event.
export function computeStage(
  start: Date | null,
  end: Date | null,
  now: Date = new Date(),
): string {
  if (!start || !end || isNaN(start.getTime()) || isNaN(end.getTime())) {
    return "Upcoming";
  }
  if (now > end) return "Completed / Concluded";
  if (now >= start) return "Active / Ongoing";
  return "Upcoming";
}

// e.g. "Start: Jun 15, 2026 16:00 | End: Jun 16, 2026 17:00" (IST)
export function formatEventDate(start: Date, end: Date): string {
  const fmt = (date: Date) => {
    if (isNaN(date.getTime())) return "";
    const day = date.toLocaleDateString("en-US", {
      timeZone: DK24_TIMEZONE,
      month: "short",
      day: "numeric",
      year: "numeric",
    });
    const time = date.toLocaleTimeString("en-US", {
      timeZone: DK24_TIMEZONE,
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
    return `${day} ${time}`;
  };
  return `Start: ${fmt(start)} | End: ${fmt(end)}`;
}

// Validates a /api/v1/calendar body. A `month` field means the edge cache
// served a single-month response instead of the full list, so it is rejected.
export function parseCalendarPayload(data: CalendarPayload): ApiEvent[] {
  if (!data || !Array.isArray(data.events)) {
    throw new Error("dk24 calendar payload has no events array");
  }
  if (data.month) {
    throw new Error(
      `dk24 calendar returned a single-month response (${data.month}) instead of the full list`,
    );
  }
  return data.events;
}

export function mapApiEvent(e: ApiEvent, now: Date = new Date()): Event | null {
  const id = String(e.id ?? "").trim();
  const start = new Date(e.startDateTime ?? "");
  const monthYear = monthYearOf(start);
  if (!id || !e.title || !monthYear) return null;

  const end = new Date(e.endDateTime ?? "");
  const validEnd = isNaN(end.getTime()) ? null : end;

  return {
    id,
    title: e.title,
    host: e.organizationName || "",
    date: formatEventDate(start, end),
    location: e.location || undefined,
    description: e.description || undefined,
    registration_deadline: undefined,
    prize_pool: undefined,
    tracks: undefined,
    registration_link: e.registrationLink || undefined,
    join_link: e.joinLink || undefined,
    youtube_link: e.youtubeLink || undefined,
    poster_url: e.posterUrl || undefined,
    tags: Array.isArray(e.tags) ? e.tags : undefined,
    stage: computeStage(start, validEnd, now),
    month_year: monthYear,
    start_at: start,
    end_at: validEnd,
  };
}

function toDate(value: Date | string | null | undefined): Date | null {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  return isNaN(d.getTime()) ? null : d;
}

function withLiveStage(events: Event[], now: Date = new Date()): Event[] {
  return events.map((e) => {
    const start = toDate(e.start_at);
    const end = toDate(e.end_at);
    return start && end ? { ...e, stage: computeStage(start, end, now) } : e;
  });
}

function byStart(a: Event, b: Event): number {
  const ta = toDate(a.start_at)?.getTime() ?? Infinity;
  const tb = toDate(b.start_at)?.getTime() ?? Infinity;
  return ta - tb || a.id.localeCompare(b.id);
}

interface CalendarSnapshot {
  events: Event[];
  hash: string;
}

async function fetchAllEventsLive(): Promise<CalendarSnapshot> {
  const data = await fetchDk24Json<CalendarPayload>("/api/v1/calendar");
  const raw = parseCalendarPayload(data);
  const events = raw
    .map((e) => mapApiEvent(e))
    .filter((e): e is Event => e !== null);
  console.log(
    `Fetched ${raw.length} calendar events from dk24 API (${events.length} usable).`,
  );
  return { events, hash: `v${EVENTS_MAPPING_VERSION}:${contentHash(raw)}` };
}

// Collapses parallel fetches into one request.
let inFlightCalendarFetch: Promise<CalendarSnapshot> | null = null;

function getAllEventsLiveLocked(): Promise<CalendarSnapshot> {
  if (inFlightCalendarFetch) {
    console.log("Calendar fetch already in flight. Reusing existing promise...");
    return inFlightCalendarFetch;
  }
  inFlightCalendarFetch = fetchAllEventsLive().finally(() => {
    inFlightCalendarFetch = null;
  });
  return inFlightCalendarFetch;
}

// Last good snapshot, used when no database is configured.
let memorySnapshot: (CalendarSnapshot & { checkedAt: number }) | null = null;

type RefreshOutcome = "changed" | "unchanged" | "rejected";

// Fetches the full calendar and stores it only if its content hash changed.
// An empty list never replaces a non-empty cache (backend outage guard).
async function refreshEvents(): Promise<RefreshOutcome> {
  const live = await getAllEventsLiveLocked();
  const pool = getPool();

  if (!pool) {
    if (live.events.length === 0 && (memorySnapshot?.events.length ?? 0) > 0) {
      console.warn("dk24 calendar returned 0 events; keeping in-memory snapshot.");
      memorySnapshot!.checkedAt = Date.now();
      return "rejected";
    }
    const changed = memorySnapshot?.hash !== live.hash;
    memorySnapshot = { ...live, checkedAt: Date.now() };
    return changed ? "changed" : "unchanged";
  }

  const previousHash = await getCacheHash(EVENTS_CACHE_KEY);
  if (previousHash === live.hash) {
    await markCacheUpdated(EVENTS_CACHE_KEY);
    return "unchanged";
  }

  if (live.events.length === 0) {
    const { rows } = await pool.query(
      "SELECT EXISTS (SELECT 1 FROM dk24_events) AS has_events",
    );
    if (rows[0]?.has_events) {
      console.warn("dk24 calendar returned 0 events; keeping cached events.");
      // Start the cooldown anyway so every command doesn't retry immediately.
      await markCacheUpdated(EVENTS_CACHE_KEY);
      return "rejected";
    }
  }

  await replaceEventsInDb(live.events);
  await markCacheUpdated(EVENTS_CACHE_KEY, live.hash);
  console.log(`Calendar cache updated with ${live.events.length} events.`);
  return "changed";
}

async function replaceEventsInDb(events: Event[]): Promise<void> {
  const pool = getPool();
  if (!pool) return;

  await withTransaction(pool, async (client) => {
    await client.query("DELETE FROM dk24_events");
    // Per-month keys from the old ?date= sync are obsolete.
    await client.query(
      "DELETE FROM dk24_cache_log WHERE key LIKE 'calendar:%' AND key <> $1",
      [EVENTS_CACHE_KEY],
    );

    for (const e of events) {
      await client.query(
        `
        INSERT INTO dk24_events (${EVENT_COLUMNS}, last_updated)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, NOW())
        ON CONFLICT (id) DO UPDATE SET
          title = EXCLUDED.title, host = EXCLUDED.host, date = EXCLUDED.date,
          location = EXCLUDED.location, description = EXCLUDED.description,
          registration_link = EXCLUDED.registration_link, join_link = EXCLUDED.join_link,
          youtube_link = EXCLUDED.youtube_link, poster_url = EXCLUDED.poster_url,
          tags = EXCLUDED.tags, stage = EXCLUDED.stage, month_year = EXCLUDED.month_year,
          start_at = EXCLUDED.start_at, end_at = EXCLUDED.end_at, last_updated = NOW()
      `,
        [
          e.id,
          e.title,
          e.host || null,
          e.date || null,
          e.location || null,
          e.description || null,
          e.registration_deadline || null,
          e.prize_pool || null,
          e.tracks || null,
          e.registration_link || null,
          e.join_link || null,
          e.youtube_link || null,
          e.poster_url || null,
          e.tags || null,
          e.stage || null,
          e.month_year,
          e.start_at || null,
          e.end_at || null,
        ],
      );
    }
  });
}

function triggerBackgroundRefresh(): void {
  refreshEvents()
    .then((outcome) => {
      console.log(`Background calendar refresh finished: ${outcome}.`);
    })
    .catch((err) => {
      console.warn("Background calendar refresh failed:", err.message);
    });
}

function monthFromMemory(monthYear: string): Event[] {
  return withLiveStage(
    (memorySnapshot?.events ?? []).filter((e) => e.month_year === monthYear),
  ).sort(byStart);
}

async function getEventsForMonthWithoutDb(
  monthYear: string,
  allowScrape: boolean,
): Promise<Event[]> {
  const fresh =
    memorySnapshot !== null &&
    Date.now() - memorySnapshot.checkedAt < EVENTS_COOLDOWN_MS;
  if (fresh) return monthFromMemory(monthYear);

  if (memorySnapshot || !allowScrape) {
    // Serve what we have now; refresh quietly.
    if (allowScrape || !memorySnapshot) triggerBackgroundRefresh();
    return monthFromMemory(monthYear);
  }

  console.warn(`⚠️ No database configured. Fetching calendar live for ${monthYear}...`);
  try {
    await refreshEvents();
  } catch (err: any) {
    console.error("Live calendar fetch failed:", err.message);
  }
  return monthFromMemory(monthYear);
}

async function queryMonth(monthYear: string): Promise<Event[]> {
  const pool = getPool();
  if (!pool) return monthFromMemory(monthYear);
  const res = await pool.query(
    `SELECT ${EVENT_COLUMNS} FROM dk24_events WHERE month_year = $1 ORDER BY start_at ASC NULLS LAST, id ASC`,
    [monthYear],
  );
  return withLiveStage(res.rows as Event[]);
}

export async function getEventsForMonth(
  monthYear: string,
  allowScrape: boolean = true,
): Promise<Event[]> {
  const normalized = normalizeMonthYear(monthYear);
  const pool = getPool();
  if (!pool) return getEventsForMonthWithoutDb(normalized, allowScrape);

  try {
    const monthEvents = await queryMonth(normalized);

    // One cooldown for the whole calendar, since it is fetched as a whole.
    if (await isCacheValid(EVENTS_CACHE_KEY, EVENTS_COOLDOWN_MS)) {
      return monthEvents;
    }

    const { rows } = await pool.query(
      "SELECT EXISTS (SELECT 1 FROM dk24_events) AS has_events",
    );
    if (rows[0]?.has_events) {
      // Stale but populated: answer instantly, refresh in the background.
      if (allowScrape) triggerBackgroundRefresh();
      return monthEvents;
    }

    if (!allowScrape) {
      triggerBackgroundRefresh();
      return [];
    }

    // Nothing cached yet: block on the first fetch.
    console.log("Calendar cache is empty. Running foreground fetch...");
    await refreshEvents();
    return await queryMonth(normalized);
  } catch (error) {
    console.error(`getEventsForMonth error for ${normalized}:`, error);
    if (!allowScrape) return [];
    try {
      const live = await getAllEventsLiveLocked();
      return withLiveStage(
        live.events.filter((e) => e.month_year === normalized),
      ).sort(byStart);
    } catch {
      return [];
    }
  }
}

export async function searchEventsGlobally(query: string): Promise<Event[]> {
  const pool = getPool();
  const trimmed = query.trim().toLowerCase();
  if (!pool) {
    return withLiveStage(
      (memorySnapshot?.events ?? []).filter(
        (e) =>
          e.title.toLowerCase().includes(trimmed) ||
          (e.host ?? "").toLowerCase().includes(trimmed),
      ),
    );
  }
  try {
    const res = await pool.query(
      `SELECT ${EVENT_COLUMNS}
       FROM dk24_events
       WHERE LOWER(title) LIKE $1 OR LOWER(host) LIKE $1
       ORDER BY start_at DESC NULLS LAST`,
      [`%${trimmed}%`],
    );
    return withLiveStage(res.rows as Event[]);
  } catch (error) {
    console.error("⚠️ Error searching events globally:", error);
    return [];
  }
}

/** Test-only: reset module state. */
export function _resetEventsState(): void {
  memorySnapshot = null;
  inFlightCalendarFetch = null;
}
