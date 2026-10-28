import { getScoutQueue } from "@/lib/server/api/dragoniteApi";
import { getServerConfig } from "@/lib/services/config/config.server";
import { getLogger } from "@/lib/utils/logger";
import { RateLimiterMemory, type RateLimiterRes } from "rate-limiter-flexible";

const log = getLogger("followme");

/**
 * One scan per 2.5 minutes sustained, which leaves headroom above the 5-minute
 * refresh ceiling for a user who keeps moving.
 */
const DEFAULT_SCANS_PER_HOUR = 24;

/**
 * Concurrent followers. 100 AlphaScout workers at a 8.74 s p50 handle ~687
 * locations/min, or ~14 scans/min at 49 points each - about 70 followers on a
 * 5-minute cadence.
 */
const DEFAULT_MAX_FOLLOWERS = 70;

/** Back off above this scout queue depth so manual scouts are never starved. */
const DEFAULT_QUEUE_LIMIT = 50;

/** A follower who has not asked for a scan in this long has gone away. */
const FOLLOWER_TTL_MS = 10 * 60_000;

const limitsConfig = getServerConfig().followMe;
const scansPerHour = limitsConfig?.scansPerHour ?? DEFAULT_SCANS_PER_HOUR;
const maxFollowers = limitsConfig?.maxFollowers ?? DEFAULT_MAX_FOLLOWERS;
const queueLimit = limitsConfig?.queueLimit ?? DEFAULT_QUEUE_LIMIT;

/**
 * Both limits below are per-process. cluster.mjs forks DIADEM_WORKERS
 * processes, so with more than one the real ceilings are multiplied by the
 * worker count and have to move to the shared database first.
 */
const configuredWorkers = process.env.DIADEM_WORKERS ?? "auto";
if (configuredWorkers !== "1") {
	log.warning(
		"DIADEM_WORKERS=%s: follow-me quota and follower cap are per-process and will be multiplied by the worker count. Keep DIADEM_WORKERS=1 or move these limits to the shared database.",
		configuredWorkers
	);
}

/**
 * Deliberately not the limiter in api/rateLimit.ts: that one is keyed by
 * MapObjectType and switches off entirely with limits.enableRateLimiting,
 * which must not be able to disable a limit that is spending scouts.
 */
const quotaLimiter = new RateLimiterMemory({
	points: scansPerHour,
	duration: 60 * 60,
	keyPrefix: "follow_me_"
});

const followers = new Map<string, number>();

function pruneFollowers(now: number) {
	for (const [key, lastSeen] of followers) {
		if (now - lastSeen > FOLLOWER_TTL_MS) followers.delete(key);
	}
}

/**
 * Claim one of the concurrent follower slots. An existing follower always keeps
 * theirs, so a full map never drops a session already running.
 */
export function reserveFollowerSlot(userKey: string): boolean {
	const now = Date.now();
	pruneFollowers(now);

	if (!followers.has(userKey) && followers.size >= maxFollowers) {
		log.info("Follow-me at capacity: %d followers", followers.size);
		return false;
	}

	followers.set(userKey, now);
	return true;
}

export function releaseFollowerSlot(userKey: string) {
	followers.delete(userKey);
}

export function getFollowerCount(): number {
	pruneFollowers(Date.now());
	return followers.size;
}

/** True when the scout queue is too deep, or unreadable, to add 49 more points. */
export async function scoutQueueIsBusy(): Promise<boolean> {
	const queue = await getScoutQueue();
	if (queue === undefined) {
		log.error("Follow-me backing off: scout queue depth unreadable");
		return true;
	}
	if (queue > queueLimit) {
		log.info("Follow-me backing off: scout queue at %d", queue);
		return true;
	}
	return false;
}

export async function consumeFollowMeQuota(
	userKey: string
): Promise<{ ok: boolean; remaining: number }> {
	try {
		const data = await quotaLimiter.consume(userKey, 1);
		return { ok: true, remaining: data.remainingPoints };
	} catch (e) {
		const data = e as RateLimiterRes;
		return { ok: false, remaining: data?.remainingPoints ?? 0 };
	}
}

/** Give the point back when the scan could not be queued after all. */
export async function refundFollowMeQuota(userKey: string) {
	await quotaLimiter.reward(userKey, 1);
}
