import { describe, expect, it } from "vitest";
import {
	DEFAULT_ALERT_MIN_METERS,
	DEFAULT_ALERT_MIN_SECONDS,
	findProfileByName,
	planProfileSetup,
	resolveAlertLimits,
	resolveReturnProfile,
	shouldMoveAlerts,
	type PoracleProfile,
	type PushedLocation
} from "@/lib/server/features/followMeAlertsPolicy";

const limits = { minMeters: 1000, minSeconds: 60 };

/** Roughly a kilometre north at this latitude, which is close enough. */
function north(lat: number, meters: number) {
	return lat + meters / 111_320;
}

function pushed(lat: number, lon: number, at: number): PushedLocation {
	return { lat, lon, at };
}

describe("shouldMoveAlerts", () => {
	it("moves the first time, with nothing to compare against", () => {
		expect(shouldMoveAlerts(undefined, 39.1, -76.8, 1_000_000, limits)).toBe(true);
	});

	it("holds inside the time floor however far they have gone", () => {
		const last = pushed(39.1, -76.8, 1_000_000);
		const far = north(39.1, 10_000);
		expect(shouldMoveAlerts(last, far, -76.8, 1_000_000 + 59_000, limits)).toBe(false);
	});

	it("holds when they have waited but not moved", () => {
		// The point of the location is the distance in the alert, and standing
		// still does not make that figure wrong.
		const last = pushed(39.1, -76.8, 1_000_000);
		expect(shouldMoveAlerts(last, 39.1, -76.8, 1_000_000 + 3_600_000, limits)).toBe(false);
	});

	it("holds just under the distance", () => {
		const last = pushed(39.1, -76.8, 1_000_000);
		const nearly = north(39.1, 900);
		expect(shouldMoveAlerts(last, nearly, -76.8, 1_000_000 + 120_000, limits)).toBe(false);
	});

	it("moves once both are satisfied", () => {
		const last = pushed(39.1, -76.8, 1_000_000);
		const far = north(39.1, 1_200);
		expect(shouldMoveAlerts(last, far, -76.8, 1_000_000 + 120_000, limits)).toBe(true);
	});
});

describe("resolveAlertLimits", () => {
	it("falls back for absent, zero and nonsense values", () => {
		expect(resolveAlertLimits(undefined, undefined)).toEqual({
			minMeters: DEFAULT_ALERT_MIN_METERS,
			minSeconds: DEFAULT_ALERT_MIN_SECONDS
		});
		expect(resolveAlertLimits(0, -5)).toEqual({
			minMeters: DEFAULT_ALERT_MIN_METERS,
			minSeconds: DEFAULT_ALERT_MIN_SECONDS
		});
		expect(resolveAlertLimits(Number.NaN, Number.POSITIVE_INFINITY)).toEqual({
			minMeters: DEFAULT_ALERT_MIN_METERS,
			minSeconds: DEFAULT_ALERT_MIN_SECONDS
		});
	});

	it("takes configured values", () => {
		expect(resolveAlertLimits(250, 30)).toEqual({ minMeters: 250, minSeconds: 30 });
	});
});

describe("planProfileSetup", () => {
	const home: PoracleProfile = { profile_no: 1, name: "home" };
	const follow: PoracleProfile = { profile_no: 2, name: "Follow" };

	it("writes the default down first when the user has no profile rows", () => {
		// 990 of 1,103 users are in this state, and Poracle hands out the lowest
		// free number - so creating follow first would take number 1 and rename
		// their default profile out from under them.
		expect(planProfileSetup([])).toEqual({ createHome: true, createFollow: true });
	});

	it("only creates follow when they already have profiles", () => {
		expect(planProfileSetup([home])).toEqual({ createHome: false, createFollow: true });
	});

	it("creates nothing once the follow profile exists", () => {
		expect(planProfileSetup([home, follow])).toEqual({
			createHome: false,
			createFollow: false,
			followProfileNo: 2
		});
	});
});

describe("findProfileByName", () => {
	it("ignores case and padding, which are the user's business", () => {
		const profiles: PoracleProfile[] = [
			{ profile_no: 1, name: "Home" },
			{ profile_no: 4, name: "  FOLLOW " }
		];
		expect(findProfileByName(profiles, "follow")?.profile_no).toBe(4);
		expect(findProfileByName(profiles, "work")).toBeUndefined();
	});
});

describe("resolveReturnProfile", () => {
	const profiles: PoracleProfile[] = [
		{ profile_no: 1, name: "home" },
		{ profile_no: 3, name: "work" }
	];

	it("returns them to their own profile", () => {
		expect(resolveReturnProfile(profiles, 3)).toBe(3);
	});

	it("falls back to the default when they deleted it mid-session", () => {
		expect(resolveReturnProfile(profiles, 7)).toBe(1);
	});
});
