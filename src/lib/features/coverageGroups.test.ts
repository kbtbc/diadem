import { describe, expect, it } from "vitest";
import { compareAreaNames, groupByState } from "./coverageGroups";

const area = (name: string) => ({ properties: { name } });

describe("groupByState", () => {
	it("groups by state code, states alphabetical by state name", () => {
		const groups = groupByState([
			area("TX-Killeen"),
			area("GA-Rome"),
			area("NY-Buffalo"),
			area("GA-Cumming"),
			area("FL-Tampa")
		]);
		expect(groups.map((g) => g.name)).toEqual(["Florida", "Georgia", "New York", "Texas"]);
	});

	it("sorts areas alphabetically inside a state, ignoring case", () => {
		const georgia = groupByState([area("GA-Rome"), area("GA-canton"), area("GA-Cumming"), area("GA-AlphaRoswell")])[0];
		expect(georgia.areas.map((a) => a.properties.name)).toEqual(["GA-AlphaRoswell", "GA-canton", "GA-Cumming", "GA-Rome"]);
	});

	it("puts names without a known state code last, under Other", () => {
		const groups = groupByState([area("Somewhere"), area("ZZ-Unknown"), area("AL-Mobile")]);
		expect(groups.map((g) => g.name)).toEqual(["Alabama", "Other"]);
		expect(groups[1].areas).toHaveLength(2);
	});

	it("recognises Puerto Rico and lower-case codes", () => {
		expect(groupByState([area("pr-Mayaguez")])[0].name).toBe("Puerto Rico");
	});

	it("returns nothing for no areas", () => {
		expect(groupByState([])).toEqual([]);
	});
});

describe("compareAreaNames", () => {
	it("orders numbers naturally", () => {
		expect(compareAreaNames(area("GA-Zone2"), area("GA-Zone10"))).toBeLessThan(0);
	});
});
