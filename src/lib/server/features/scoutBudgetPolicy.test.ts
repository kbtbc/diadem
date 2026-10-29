import { describe, expect, it } from "vitest";
import {
	DEFAULT_LOCATIONS_PER_DAY,
	DEFAULT_MAX_LOCATIONS_PER_REQUEST,
	resolveLocationsPerDay,
	resolveMaxLocationsPerRequest,
	scoutDay
} from "./scoutBudgetPolicy";

describe("scout allowance config", () => {
	it("takes a configured figure", () => {
		expect(resolveLocationsPerDay(500)).toBe(500);
		expect(resolveMaxLocationsPerRequest(7)).toBe(7);
	});

	it("falls back on anything that is not a usable number", () => {
		for (const bad of [undefined, 0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
			expect(resolveLocationsPerDay(bad as number | undefined)).toBe(DEFAULT_LOCATIONS_PER_DAY);
		}
		expect(resolveMaxLocationsPerRequest(0)).toBe(DEFAULT_MAX_LOCATIONS_PER_REQUEST);
	});

	it("will not hand back a fractional allowance", () => {
		expect(resolveLocationsPerDay(100.9)).toBe(100);
	});
});

describe("the day a spend belongs to", () => {
	it("formats the local date, zero padded", () => {
		expect(scoutDay(new Date(2026, 0, 5, 23, 59))).toBe("2026-01-05");
		expect(scoutDay(new Date(2026, 10, 30, 0, 1))).toBe("2026-11-30");
	});

	it("rolls over at local midnight, not at UTC midnight", () => {
		// The box is America/New_York, where a UTC day would turn over at 8pm.
		const beforeMidnight = new Date(2026, 5, 10, 21, 0);
		const afterMidnight = new Date(2026, 5, 11, 1, 0);
		expect(scoutDay(beforeMidnight)).toBe("2026-06-10");
		expect(scoutDay(afterMidnight)).toBe("2026-06-11");
	});
});
