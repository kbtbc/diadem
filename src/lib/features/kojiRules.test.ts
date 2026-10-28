import { describe, expect, it } from "vitest";
import { displayAreaName, isAreaHidden, type CoverageRules } from "./kojiRules";

const rules: CoverageRules = {
	hide: ["HI-Kalaheo", "MO-STL"],
	hidePatterns: ["(^|[-_ ])(fort|forts|test|staging)($|[-_ ])", "^quest-check$"],
	rename: { "User-ActivateInstantKill": "IN-Westfield" },
	renamePatterns: [["^User-.*?-([A-Z]{2}-.+)$", "$1"]]
};

describe("isAreaHidden", () => {
	it("hides exact names regardless of case", () => {
		expect(isAreaHidden("hi-kalaheo", rules)).toBe(true);
		expect(isAreaHidden("MO-STL", rules)).toBe(true);
	});

	it("hides fort, test, staging and quest-check areas by pattern", () => {
		for (const name of ["GA-ATL-FORTS", "TX-Austin-Fort", "A2-Test", "A-Staging", "Quest-Check"]) {
			expect(isAreaHidden(name, rules)).toBe(true);
		}
	});

	it("keeps ordinary areas, including names that merely contain those letters", () => {
		for (const name of ["GA-Cartersville", "MO-STL-Core", "GA-Western/Industrial", "NY-Rochester", "TX-Forth"]) {
			expect(isAreaHidden(name, rules)).toBe(false);
		}
	});

	it("hides nothing without rules", () => {
		expect(isAreaHidden("Quest-Check", undefined)).toBe(false);
	});

	it("ignores an invalid pattern instead of failing", () => {
		expect(isAreaHidden("GA-Rome", { hidePatterns: ["("] })).toBe(false);
	});
});

describe("displayAreaName", () => {
	it("uses an exact rename first", () => {
		expect(displayAreaName("User-ActivateInstantKill", rules)).toBe("IN-Westfield");
	});

	it("strips the username from user areas that end in State-Area", () => {
		expect(displayAreaName("User-Beefus(King)-WA-Bellingham", rules)).toBe("WA-Bellingham");
		expect(displayAreaName("User-MEstep8-GA-Jasper", rules)).toBe("GA-Jasper");
		expect(displayAreaName("User-OGBubbaDaVinci-IA-Creston", rules)).toBe("IA-Creston");
		expect(displayAreaName("User-Viator12-PA-Philadelphia", rules)).toBe("PA-Philadelphia");
	});

	it("leaves other names alone", () => {
		expect(displayAreaName("GA-Cartersville", rules)).toBe("GA-Cartersville");
		expect(displayAreaName("User-Barbelle", rules)).toBe("User-Barbelle");
		expect(displayAreaName("GA-Rome", undefined)).toBe("GA-Rome");
	});
});
