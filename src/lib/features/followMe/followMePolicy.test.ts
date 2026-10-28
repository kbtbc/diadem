import { describe, expect, it } from "vitest";
import { speedFromFixes, type SpeedFix } from "@/lib/utils/fixSpeed";
import {
	FOLLOW_ME_MAX_INTERVAL_MS,
	FOLLOW_ME_MIN_INTERVAL_MS,
	medianSpeedKmh,
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

	it("rescans a stationary user at the ceiling", () => {
		expect(shouldScan(state({ lastScanAt: NOW - FOLLOW_ME_MAX_INTERVAL_MS + 1 }))).toBe(false);
		expect(shouldScan(state({ lastScanAt: NOW - FOLLOW_ME_MAX_INTERVAL_MS }))).toBe(true);
	});
});

/** Samples all taken now, oldest first. */
function samples(metersPerSecond: number[]): SpeedSample[] {
	return metersPerSecond.map((speed) => ({ metersPerSecond: speed, at: NOW }));
}

describe("follow-me speed gate", () => {
	it("trips above 10 km/h and only clears below 8", () => {
		expect(speedGateBlocks(9, false)).toBe(false);
		expect(speedGateBlocks(11, false)).toBe(true);
		// latched: 9 km/h is not enough to resume
		expect(speedGateBlocks(9, true)).toBe(true);
		expect(speedGateBlocks(7, true)).toBe(false);
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

	it("comes off pause once stale driving samples age out", () => {
		const driving = samples([25, 25, 25]);
		let paused = speedGateBlocks(medianSpeedKmh(driving, NOW), false);
		expect(paused).toBe(true);

		// Sat still, nothing new arrived, the old samples expired.
		const later = NOW + SPEED_SAMPLE_TTL_MS + 1;
		paused = speedGateBlocks(medianSpeedKmh(driving, later), paused);
		expect(paused).toBe(false);
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
