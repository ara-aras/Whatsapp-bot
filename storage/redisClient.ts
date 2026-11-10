import Redis from "ioredis";

const REDIS_URL = process.env.REDIS_URL;

if (!REDIS_URL) {
  console.error("FATAL: REDIS_URL environment variable is missing.");
  console.error("Please provide a valid REDIS_URL (e.g. redis://127.0.0.1:6379 for local or your Render redis url).");
  process.exit(1);
}

// Commands must be able to FAIL. With `maxRetriesPerRequest: null` ioredis
// queues every command forever while Redis is unreachable, so callers never
// reach their catch blocks: message handlers hang and the queue grows without
// bound. A finite value makes a command reject after that many reconnect
// attempts, which is what every "fall back if Redis is down" path relies on.
// The client itself keeps reconnecting in the background regardless.
const MAX_RETRIES = Number(process.env.REDIS_MAX_RETRIES_PER_REQUEST) || 3;

export const redis = new Redis(REDIS_URL, {
  maxRetriesPerRequest: MAX_RETRIES,
  connectTimeout: 10000,
  retryStrategy(times) {
    const delay = Math.min(times * 50, 2000);
    return delay;
  },
});

redis.on("connect", () => {
  console.log("Connected to Redis successfully!");
});

redis.on("error", (err) => {
  console.error("Redis Connection Error:", err);
});
