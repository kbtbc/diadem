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
 * constantly. 45 means you are in a vehicle on a road, where the scan really
 * is wasted, and leaves walking and crawling traffic alone.
 */
export const FOLLOW_ME_MAX_SPEED_KMH = 45;

/** Resume below this, so a red light or a platform does not end the session. */
export const FOLLOW_ME_RESUME_SPEED_KMH = 35;

export type SpeedLimits = {
	maxKmh: number;
	resumeKmh: number;
};

export const DEFAULT_SPEED_LIMITS: SpeedLimits = {
	maxKmh: FOLLOW_ME_MAX_SPEED_KMH,
	resumeKmh: FOLLOW_ME_RESUME_SPEED_KMH
};

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
			: Math.round(max * 0.78);
	return { maxKmh: max, resumeKmh: Math.min(wanted, max) };
}

/**
 * Rescan once the user has left roughly half the guaranteed-covered footprint
 * behind (see HEX7_COVERED_RADIUS_METERS, ~371 m).
 */
export const FOLLOW_ME_REFRESH_METERS = 180;

/** Floor between scans, so a jittery fix cannot burn 49 scouts in a row. */
export const FOLLOW_ME_MIN_INTERVAL_MS = 90_000;

/**
 * Ceiling between scans. 82% of spawns live 10-30 minutes, so refreshing a
 * stationary user faster than this mostly re-returns the same pokemon.
 */
export const FOLLOW_ME_MAX_INTERVAL_MS = 300_000;

export type ScanState = {
	now: number;
	center: LatLon;
	/** Where the last dispatched scan was centred, if any. */
	lastScanCenter: LatLon | undefined;
	lastScanAt: number;
	/** Set after a transient refusal; nothing is asked for until it passes. */
	backoffUntil: number;
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
	if (elapsed < FOLLOW_ME_MIN_INTERVAL_MS) return false;

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
 */
export const SPEED_SAMPLE_TTL_MS = 60_000;

export type SpeedSample = {
	metersPerSecond: number;
	/** Epoch milliseconds the sample was taken. */
	at: number;
};

/** Median rejects a spike better than a mean, which one bad fix can carry. */
export function medianSpeedKmh(samples: SpeedSample[], now: number): number | undefined {
	const fresh = samples.filter((sample) => now - sample.at <= SPEED_SAMPLE_TTL_MS);
	if (fresh.length < MIN_SPEED_SAMPLES) return undefined;

	const sorted = fresh.map((sample) => sample.metersPerSecond).sort((a, b) => a - b);
	return (sorted[Math.floor(sorted.length / 2)] * 3600) / 1000;
}
