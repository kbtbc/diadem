import { rangeDistanceMeters } from "@/lib/utils/rangeGeometry";
import type { LatLon } from "@/lib/utils/coordinates";

/**
 * Pure decisions behind follow-me, kept out of followMe.svelte.ts so they can
 * be tested without booting Svelte runes. Both of these got a bug past review
 * during the first beta, so they are covered in followMePolicy.test.ts.
 */

/**
 * Above this the feature pauses. Not a staleness limit - a user moving faster
 * than this will not still be in range by the time they have checked the map,
 * switched to the game and thrown a ball, so the scan would be wasted.
 *
 * Started at 10 km/h, which is a jog: cyclists and traffic tripped it
 * constantly. Then 45, which was ordinary town driving - a tester spent a
 * whole drive home latched. Then 60, which still caught him on residential
 * streets where he wanted to see what was around him. 90 is highway speed.
 *
 * The gate is no longer what protects the scout pool: the 90-second floor, the
 * hourly quota and the daily location allowance do that. It only stops scans
 * nobody could act on, so it belongs at the top of the range rather than in
 * the middle of it.
 */
export const FOLLOW_ME_MAX_SPEED_KMH = 90;

/**
 * Resume below this, so a red light or a platform does not end the session.
 *
 * 35 was 22 mph, which sits inside the band a car spends most of its time in
 * around town, so the gate stayed latched for a whole trip. 60 reopens as soon
 * as you are off the highway, and keeps the same 30 km/h gap below the trip
 * threshold that stopped it flapping.
 */
export const FOLLOW_ME_RESUME_SPEED_KMH = 60;

export type SpeedLimits = {
	maxKmh: number;
	resumeKmh: number;
};

export const DEFAULT_SPEED_LIMITS: SpeedLimits = {
	maxKmh: FOLLOW_ME_MAX_SPEED_KMH,
	resumeKmh: FOLLOW_ME_RESUME_SPEED_KMH
};

/**
 * Where resume sits relative to the trip threshold when only the latter is
 * configured. Derived from the shipped pair rather than written out, so moving
 * one constant cannot leave the fallback behind - this was a literal 0.78,
 * which stopped meaning FOLLOW_ME_RESUME_SPEED_KMH the moment the trip
 * threshold moved.
 */
const RESUME_RATIO = FOLLOW_ME_RESUME_SPEED_KMH / FOLLOW_ME_MAX_SPEED_KMH;

/**
 * Config can only widen the gap, never invert it: a resume threshold at or
 * above the trip threshold would flap on every fix.
 */
export function resolveSpeedLimits(
	maxKmh: number | undefined,
	resumeKmh: number | undefined
): SpeedLimits {
	const max =
		Number.isFinite(maxKmh) && (maxKmh as number) > 0
			? (maxKmh as number)
			: FOLLOW_ME_MAX_SPEED_KMH;
	const wanted =
		Number.isFinite(resumeKmh) && (resumeKmh as number) >= 0
			? (resumeKmh as number)
			: Math.round(max * RESUME_RATIO);
	return { maxKmh: max, resumeKmh: Math.min(wanted, max) };
}

/**
 * Rescan once the user has left roughly half the guaranteed-covered footprint
 * behind (see HEX7_COVERED_RADIUS_METERS, ~371 m).
 */
export const FOLLOW_ME_REFRESH_METERS = 180;

/**
 * Floor between scans, so a jittery fix cannot burn 49 scouts in a row.
 * Overridable with [client.followMe] minScanIntervalSeconds.
 */
export const FOLLOW_ME_MIN_INTERVAL_MS = 90_000;

/** Never let config drop the floor below this, whatever it says. */
const FLOOR_FLOOR_MS = 15_000;

export function resolveMinInterval(seconds: number | undefined): number {
	if (!Number.isFinite(seconds) || (seconds as number) <= 0) return FOLLOW_ME_MIN_INTERVAL_MS;
	return Math.max((seconds as number) * 1000, FLOOR_FLOOR_MS);
}

/**
 * Ceiling between scans. 82% of spawns live 10-30 minutes, so refreshing a
 * stationary user faster than this mostly re-returns the same pokemon.
 */
export const FOLLOW_ME_MAX_INTERVAL_MS = 300_000;

export type SessionLimits = {
	sessionMs: number;
	idleMs: number;
};

export type SavedSession = {
	startedAt: number;
	lastScanAt: number;
};

/**
 * Whether a session found in storage is still worth picking up.
 *
 * Its own timeouts decide: a session that would have been auto-disabled while
 * the page was gone must not come back from the dead on the next load.
 */
export function shouldResumeSession(
	saved: SavedSession,
	now: number,
	limits: SessionLimits
): boolean {
	if (!Number.isFinite(saved.startedAt) || saved.startedAt <= 0) return false;
	if (now < saved.startedAt) return false;
	if (now - saved.startedAt >= limits.sessionMs) return false;
	return now - (saved.lastScanAt || saved.startedAt) < limits.idleMs;
}

export type ScanState = {
	now: number;
	center: LatLon;
	/** Where the last dispatched scan was centred, if any. */
	lastScanCenter: LatLon | undefined;
	lastScanAt: number;
	/** Set after a transient refusal; nothing is asked for until it passes. */
	backoffUntil: number;
	/** Floor between scans; see resolveMinInterval. */
	minIntervalMs: number;
};

/**
 * Whether to ask the server for a scan.
 *
 * Every refusal must move one of these inputs. A refusal that left them all
 * untouched is what made the menu flip between "scanning" and the refusal
 * five seconds apart, forever, during the first beta.
 */
export function shouldScan(state: ScanState): boolean {
	if (state.now < state.backoffUntil) return false;
	if (!state.lastScanCenter) return true;

	const elapsed = state.now - state.lastScanAt;
	if (elapsed >= FOLLOW_ME_MAX_INTERVAL_MS) return true;
	if (elapsed < state.minIntervalMs) return false;

	const moved = rangeDistanceMeters(
		[state.lastScanCenter.lon, state.lastScanCenter.lat],
		[state.center.lon, state.center.lat]
	);
	return moved > FOLLOW_ME_REFRESH_METERS;
}

/**
 * The speed gate, latched so it has hysteresis: it trips above
 * FOLLOW_ME_MAX_SPEED_KMH and only clears below FOLLOW_ME_RESUME_SPEED_KMH.
 *
 * Which reading to hand it is gateSpeedKmh's decision, not this one's.
 *
 * An unknown speed releases the latch rather than holding it. Keeping someone
 * paused on evidence that has expired is how a tester ended up stuck: he
 * stopped the car and sat, no usable fixes arrived, so the estimate never came
 * down and the gate never reopened. No evidence means no reason to block.
 */
export function speedGateBlocks(
	speedKmh: number | undefined,
	paused: boolean,
	limits: SpeedLimits = DEFAULT_SPEED_LIMITS
): boolean {
	if (speedKmh === undefined) return false;
	if (paused) return speedKmh > limits.resumeKmh;
	return speedKmh > limits.maxKmh;
}

/**
 * Fewer samples than this is not a speed, it is a guess.
 *
 * One sample used to be enough, and a single stale fix left over from driving
 * re-tripped the gate the instant the feature was switched back on - standing
 * still, the toggle just flipped between "too fast" and off.
 */
export const MIN_SPEED_SAMPLES = 3;

/**
 * Samples older than this are no evidence of how fast anyone is going now.
 *
 * Without an expiry the last few fixes before the phone stopped reporting -
 * backgrounded, indoors, accuracy gone - stayed the whole estimate forever.
 * A minute was still far too long, because a phone that stops issuing fixes
 * the moment it is set down leaves the gate waiting out the whole minute
 * before it will reopen - the "sat at a stop and it never came off paused"
 * report.
 */
export const SPEED_SAMPLE_TTL_MS = 20_000;

/**
 * A sample this fresh may reopen the gate on its own, without a median behind
 * it. Releasing on thin evidence is the safe direction: the cost is one scan
 * taken slightly too fast, which the quota caps anyway, where the cost of
 * holding the latch shut is the feature not working at all.
 */
export const RELEASE_SAMPLE_MAX_AGE_MS = 15_000;

export type SpeedSample = {
	metersPerSecond: number;
	/** Epoch milliseconds the sample was taken. */
	at: number;
};

function toKmh(metersPerSecond: number): number {
	return (metersPerSecond * 3600) / 1000;
}

/** Median rejects a spike better than a mean, which one bad fix can carry. */
export function medianSpeedKmh(samples: SpeedSample[], now: number): number | undefined {
	const fresh = samples.filter((sample) => now - sample.at <= SPEED_SAMPLE_TTL_MS);
	if (fresh.length < MIN_SPEED_SAMPLES) return undefined;

	const sorted = fresh.map((sample) => sample.metersPerSecond).sort((a, b) => a - b);
	return toKmh(sorted[Math.floor(sorted.length / 2)]);
}

/** The newest sample, if it is recent enough to stand on its own. */
export function latestSpeedKmh(samples: SpeedSample[], now: number): number | undefined {
	let newest: SpeedSample | undefined = undefined;
	for (const sample of samples) {
		if (now - sample.at > RELEASE_SAMPLE_MAX_AGE_MS) continue;
		if (!newest || sample.at > newest.at) newest = sample;
	}
	return newest ? toKmh(newest.metersPerSecond) : undefined;
}

/**
 * Which reading the gate should judge, which is not the same reading in both
 * directions.
 *
 * Tripping goes on the median, so one wild fix cannot pause the feature.
 * Releasing goes on the newest fresh sample, because the median is a window of
 * history and waiting for it to turn over is what kept a tester latched
 * through stop-and-go traffic and for a minute after he had parked. One good
 * fix below the line is enough to let go.
 */
export function gateSpeedKmh(
	samples: SpeedSample[],
	now: number,
	paused: boolean
): number | undefined {
	if (!paused) return medianSpeedKmh(samples, now);
	return latestSpeedKmh(samples, now) ?? medianSpeedKmh(samples, now);
}
