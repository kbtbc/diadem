import { describe, expect, it } from "vitest";
import { speedFromFixes, type SpeedFix } from "@/lib/utils/fixSpeed";
import {
	FOLLOW_ME_MAX_INTERVAL_MS,
	FOLLOW_ME_MIN_INTERVAL_MS,
	resolveMinInterval,
	FOLLOW_ME_MAX_SPEED_KMH,
	FOLLOW_ME_RESUME_SPEED_KMH,
	gateSpeedKmh,
	latestSpeedKmh,
	medianSpeedKmh,
	RELEASE_SAMPLE_MAX_AGE_MS,
	resolveSpeedLimits,
	shouldResumeSession,
	shouldScan,
	speedGateBlocks,
	SPEED_SAMPLE_TTL_MS,
	type ScanState,
	type SpeedSample
} from "./followMePolicy";

const HERE = { lat: 39.2, lon: -76.7 };
const NOW = 1_800_000_000_000;

function state(overrides: Partial<ScanState> = {}): ScanState {
	return {
		now: NOW,
		center: HERE,
		lastScanCenter: HERE,
		lastScanAt: NOW - FOLLOW_ME_MIN_INTERVAL_MS - 1,
		backoffUntil: 0,
		minIntervalMs: FOLLOW_ME_MIN_INTERVAL_MS,
		...overrides
	};
}

/** Metres east of HERE, close enough at this latitude for a displacement test. */
function east(meters: number) {
	return {
		lat: HERE.lat,
		lon: HERE.lon + meters / (111_320 * Math.cos((HERE.lat * Math.PI) / 180))
	};
}

describe("follow-me scan decision", () => {
	it("scans immediately when nothing has been scanned yet", () => {
		expect(shouldScan(state({ lastScanCenter: undefined }))).toBe(true);
	});

	it("holds off while a transient refusal is backing off", () => {
		// The first beta had no backoff, so a refusal left every input
		// unchanged and the client re-asked every five seconds forever.
		expect(shouldScan(state({ lastScanCenter: undefined, backoffUntil: NOW + 1 }))).toBe(false);
		expect(shouldScan(state({ lastScanCenter: undefined, backoffUntil: NOW }))).toBe(true);
	});

	it("refuses to rescan inside the floor however far the user moved", () => {
		expect(shouldScan(state({ lastScanAt: NOW - 1_000, center: east(5_000) }))).toBe(false);
	});

	it("rescans once the user leaves half the footprint behind", () => {
		expect(shouldScan(state({ center: east(100) }))).toBe(false);
		expect(shouldScan(state({ center: east(250) }))).toBe(true);
	});

	it("honours a configured floor", () => {
		const twoMinutes = resolveMinInterval(120);
		expect(twoMinutes).toBe(120_000);
		// moved far, but inside the configured floor
		expect(
			shouldScan(
				state({ lastScanAt: NOW - 90_000, center: east(5_000), minIntervalMs: twoMinutes })
			)
		).toBe(false);
		expect(
			shouldScan(
				state({ lastScanAt: NOW - 130_000, center: east(5_000), minIntervalMs: twoMinutes })
			)
		).toBe(true);
	});

	it("will not let config drop the floor to nothing", () => {
		expect(resolveMinInterval(undefined)).toBe(FOLLOW_ME_MIN_INTERVAL_MS);
		expect(resolveMinInterval(0)).toBe(FOLLOW_ME_MIN_INTERVAL_MS);
		expect(resolveMinInterval(-5)).toBe(FOLLOW_ME_MIN_INTERVAL_MS);
		expect(resolveMinInterval(1)).toBe(15_000);
	});

	it("rescans a stationary user at the ceiling", () => {
		expect(shouldScan(state({ lastScanAt: NOW - FOLLOW_ME_MAX_INTERVAL_MS + 1 }))).toBe(false);
		expect(shouldScan(state({ lastScanAt: NOW - FOLLOW_ME_MAX_INTERVAL_MS }))).toBe(true);
	});
});

/** Samples all taken now, oldest first. */
function samples(metersPerSecond: number[]): SpeedSample[] {
	return metersPerSecond.map((speed) => ({ metersPerSecond: speed, at: NOW }));
}

/** Samples with ages, as [metres per second, milliseconds old]. */
function aged(entries: [number, number][]): SpeedSample[] {
	return entries.map(([speed, age]) => ({ metersPerSecond: speed, at: NOW - age }));
}

describe("follow-me speed gate", () => {
	it("trips above the limit and only clears below the resume threshold", () => {
		expect(speedGateBlocks(FOLLOW_ME_MAX_SPEED_KMH - 5, false)).toBe(false);
		expect(speedGateBlocks(FOLLOW_ME_MAX_SPEED_KMH + 5, false)).toBe(true);
		// latched: still above the resume threshold
		expect(speedGateBlocks(FOLLOW_ME_RESUME_SPEED_KMH + 5, true)).toBe(true);
		expect(speedGateBlocks(FOLLOW_ME_RESUME_SPEED_KMH - 5, true)).toBe(false);
	});

	it("leaves walking and traffic alone at the shipped threshold", () => {
		// 10 km/h was a jog, and cyclists and crawling traffic tripped it.
		// 45 and 60 were the earlier tries, and both caught town driving.
		for (const kmh of [5, 15, 25, 35, 45, 55, 65, 85]) {
			expect(speedGateBlocks(kmh, false)).toBe(false);
		}
		expect(speedGateBlocks(100, false)).toBe(true);
	});

	it("honours configured limits", () => {
		const limits = resolveSpeedLimits(20, 15);
		expect(speedGateBlocks(18, false, limits)).toBe(false);
		expect(speedGateBlocks(25, false, limits)).toBe(true);
		expect(speedGateBlocks(18, true, limits)).toBe(true);
		expect(speedGateBlocks(10, true, limits)).toBe(false);
	});

	it("falls back, and never lets resume reach the trip threshold", () => {
		expect(resolveSpeedLimits(undefined, undefined)).toEqual({
			maxKmh: FOLLOW_ME_MAX_SPEED_KMH,
			resumeKmh: FOLLOW_ME_RESUME_SPEED_KMH
		});
		// a resume at or above the trip threshold would flap on every fix
		expect(resolveSpeedLimits(30, 99).resumeKmh).toBe(30);
		expect(resolveSpeedLimits(0, undefined).maxKmh).toBe(FOLLOW_ME_MAX_SPEED_KMH);
	});

	it("never trips on an unknown speed", () => {
		expect(speedGateBlocks(undefined, false)).toBe(false);
	});

	it("takes the median, so one wild fix cannot trip it", () => {
		expect(medianSpeedKmh(samples([1, 1.1, 30, 1.2, 1]), NOW)!).toBeLessThan(10);
	});

	it("will not call a speed on too few samples", () => {
		// A single stale fix left over from driving used to re-trip the gate
		// the instant the feature was switched back on, standing still.
		expect(medianSpeedKmh(samples([25]), NOW)).toBeUndefined();
		expect(medianSpeedKmh(samples([25, 25]), NOW)).toBeUndefined();
		expect(medianSpeedKmh(samples([25, 25, 25]), NOW)).toBeGreaterThan(10);
	});

	it("forgets samples once they expire", () => {
		// The stuck pause: he stopped the car and sat, no usable fixes came in,
		// and the estimate stayed at motorway speed indefinitely.
		const driving = samples([25, 25, 25]);
		expect(medianSpeedKmh(driving, NOW)).toBeGreaterThan(10);
		expect(medianSpeedKmh(driving, NOW + SPEED_SAMPLE_TTL_MS + 1)).toBeUndefined();
	});

	it("releases the latch when the speed is unknown", () => {
		// Holding someone paused on evidence that has expired is the bug; with
		// nothing to go on there is no reason to block.
		expect(speedGateBlocks(undefined, true)).toBe(false);
		expect(speedGateBlocks(undefined, false)).toBe(false);
	});

	it("reads the newest fresh sample, and ignores the ones behind it", () => {
		// 3 m/s now, 25 m/s a few seconds ago: the gate cares about the 3.
		expect(
			latestSpeedKmh(
				aged([
					[25, 8_000],
					[3, 1_000]
				]),
				NOW
			)
		).toBeCloseTo(10.8);
		expect(latestSpeedKmh(aged([[25, RELEASE_SAMPLE_MAX_AGE_MS + 1]]), NOW)).toBeUndefined();
		expect(latestSpeedKmh([], NOW)).toBeUndefined();
	});

	it("trips on the median but releases on the newest fix", () => {
		const spike = samples([1, 1, 30, 1, 1]);
		expect(gateSpeedKmh(spike, NOW, false)).toBe(medianSpeedKmh(spike, NOW));

		const slowingDown = aged([
			[20, 12_000],
			[18, 9_000],
			[16, 6_000],
			[4, 1_000]
		]);
		expect(gateSpeedKmh(slowingDown, NOW, true)).toBeCloseTo(14.4);
	});

	it("lets a driver out of town traffic off pause on one good fix", () => {
		// AntDigby's report: latched on the motorway, then held there for the
		// whole drive home because the median was still a minute of history.
		const justSlowed = aged([
			[25, 14_000],
			[25, 11_000],
			[25, 8_000],
			[8, 1_000]
		]);
		expect(medianSpeedKmh(justSlowed, NOW)!).toBeGreaterThan(FOLLOW_ME_RESUME_SPEED_KMH);
		expect(speedGateBlocks(gateSpeedKmh(justSlowed, NOW, true), true)).toBe(false);
	});

	it("will not let one wild fix pause a stationary user", () => {
		// The release path is deliberately thin evidence; the trip path is not.
		const standingStill = aged([
			[0, 9_000],
			[0, 6_000],
			[0, 4_000],
			[30, 1_000]
		]);
		expect(speedGateBlocks(gateSpeedKmh(standingStill, NOW, false), false)).toBe(false);
	});

	it("comes off pause once stale driving samples age out", () => {
		// 30 m/s is 108 km/h: over the trip threshold, as a motorway should be.
		const driving = samples([30, 30, 30]);
		let paused = speedGateBlocks(medianSpeedKmh(driving, NOW), false);
		expect(paused).toBe(true);

		// Sat still, nothing new arrived, the old samples expired.
		const later = NOW + SPEED_SAMPLE_TTL_MS + 1;
		paused = speedGateBlocks(medianSpeedKmh(driving, later), paused);
		expect(paused).toBe(false);
	});
});

describe("resuming a session after a page reload", () => {
	const limits = { sessionMs: 3 * 60 * 60_000, idleMs: 30 * 60_000 };

	it("picks up a session that is still live", () => {
		// Android Chrome discards backgrounded tabs, so a reload is not a
		// decision to stop - it just happens while you are in the game.
		expect(
			shouldResumeSession({ startedAt: NOW - 60_000, lastScanAt: NOW - 30_000 }, NOW, limits)
		).toBe(true);
	});

	it("lets a session that outlived its cap stay dead", () => {
		expect(
			shouldResumeSession(
				{ startedAt: NOW - limits.sessionMs, lastScanAt: NOW - 1_000 },
				NOW,
				limits
			)
		).toBe(false);
	});

	it("lets an idle session stay dead", () => {
		expect(
			shouldResumeSession(
				{ startedAt: NOW - 60 * 60_000, lastScanAt: NOW - limits.idleMs },
				NOW,
				limits
			)
		).toBe(false);
	});

	it("measures idleness from the start when nothing was ever scanned", () => {
		expect(shouldResumeSession({ startedAt: NOW - 60_000, lastScanAt: 0 }, NOW, limits)).toBe(true);
		expect(
			shouldResumeSession({ startedAt: NOW - limits.idleMs, lastScanAt: 0 }, NOW, limits)
		).toBe(false);
	});

	it("rejects nonsense from storage", () => {
		expect(shouldResumeSession({ startedAt: 0, lastScanAt: 0 }, NOW, limits)).toBe(false);
		expect(shouldResumeSession({ startedAt: NaN, lastScanAt: 0 }, NOW, limits)).toBe(false);
		// a clock that moved backwards, or a doctored entry
		expect(shouldResumeSession({ startedAt: NOW + 60_000, lastScanAt: 0 }, NOW, limits)).toBe(
			false
		);
	});
});

describe("speed from fixes", () => {
	function fix(metersEast: number, afterMs: number, accuracy: number): SpeedFix {
		const point = east(metersEast);
		return { lat: point.lat, lng: point.lon, timestamp: NOW + afterMs, accuracy };
	}

	it("reads jitter inside the fixes' own error as standing still", () => {
		// The beta report: a short walk past buildings read as too fast.
		expect(speedFromFixes(fix(0, 0, 10), fix(6, 1000, 10))).toBe(0);
	});

	it("still reports real movement, net of the noise floor", () => {
		// (40 - 4) / 2 s = 18 m/s, give or take the projection
		const speed = speedFromFixes(fix(0, 0, 4), fix(40, 2000, 4))!;
		expect(speed).toBeGreaterThan(15);
		expect(speed).toBeLessThan(20);
	});

	it("declines to guess from a vague fix", () => {
		expect(speedFromFixes(fix(0, 0, 5), fix(300, 1000, 500))).toBeUndefined();
	});

	it("declines when the clock did not advance", () => {
		expect(speedFromFixes(fix(0, 0, 5), fix(10, 0, 5))).toBeUndefined();
	});
});
