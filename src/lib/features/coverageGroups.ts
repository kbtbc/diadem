/** US state (and territory) codes, as used in area names like "GA-Cumming". */
const STATE_NAMES: Record<string, string> = {
	AK: "Alaska",
	AL: "Alabama",
	AR: "Arkansas",
	AZ: "Arizona",
	CA: "California",
	CO: "Colorado",
	CT: "Connecticut",
	DC: "District of Columbia",
	DE: "Delaware",
	FL: "Florida",
	GA: "Georgia",
	HI: "Hawaii",
	IA: "Iowa",
	ID: "Idaho",
	IL: "Illinois",
	IN: "Indiana",
	KS: "Kansas",
	KY: "Kentucky",
	LA: "Louisiana",
	MA: "Massachusetts",
	MD: "Maryland",
	ME: "Maine",
	MI: "Michigan",
	MN: "Minnesota",
	MO: "Missouri",
	MS: "Mississippi",
	MT: "Montana",
	NC: "North Carolina",
	ND: "North Dakota",
	NE: "Nebraska",
	NH: "New Hampshire",
	NJ: "New Jersey",
	NM: "New Mexico",
	NV: "Nevada",
	NY: "New York",
	OH: "Ohio",
	OK: "Oklahoma",
	OR: "Oregon",
	PA: "Pennsylvania",
	PR: "Puerto Rico",
	RI: "Rhode Island",
	SC: "South Carolina",
	SD: "South Dakota",
	TN: "Tennessee",
	TX: "Texas",
	UT: "Utah",
	VA: "Virginia",
	VT: "Vermont",
	WA: "Washington",
	WI: "Wisconsin",
	WV: "West Virginia",
	WY: "Wyoming"
};

const OTHER = "Other";

export type StateGroup<T> = { code: string; name: string; areas: T[] };

type Named = { properties: { name: string } };

export function compareAreaNames(a: Named, b: Named): number {
	return a.properties.name.localeCompare(b.properties.name, undefined, { sensitivity: "base", numeric: true });
}

/** Areas grouped by the state code in their name, states alphabetical by state name, areas alphabetical inside. */
export function groupByState<T extends Named>(areas: T[]): StateGroup<T>[] {
	const groups = new Map<string, StateGroup<T>>();

	for (const area of areas) {
		const code = /^([A-Za-z]{2})-/.exec(area.properties.name)?.[1].toUpperCase();
		const known = code !== undefined && code in STATE_NAMES;
		const key = known ? code : OTHER;

		let group = groups.get(key);
		if (!group) {
			group = { code: key, name: known ? STATE_NAMES[key] : OTHER, areas: [] };
			groups.set(key, group);
		}
		group.areas.push(area);
	}

	return [...groups.values()]
		.map((group) => ({ ...group, areas: [...group.areas].sort(compareAreaNames) }))
		.sort((a, b) => {
			if (a.code === OTHER) return 1;
			if (b.code === OTHER) return -1;
			return a.name.localeCompare(b.name);
		});
}
