/**
 * Display rules for the Koji areas the browser shows (coverage map, area search). They only change what
 * the client lists: permissions and everything else on the server still see every area under its real name.
 * Configured under `[client.coverage]`.
 */
export type CoverageRules = {
	/** Exact area names to leave out (case-insensitive), e.g. areas that are switched off. */
	hide?: string[];
	/** Regular expressions (case-insensitive) matched against the area name; a match leaves the area out. */
	hidePatterns?: string[];
	/** Exact area name -> the name to show instead. */
	rename?: Record<string, string>;
	/** [regular expression, replacement] pairs applied to names `rename` did not change. */
	renamePatterns?: [string, string][];
};

function compile(pattern: string): RegExp | undefined {
	try {
		return new RegExp(pattern, "i");
	} catch {
		return undefined;
	}
}

export function isAreaHidden(name: string, rules: CoverageRules | undefined): boolean {
	if (!rules) return false;
	const lower = name.toLowerCase();
	if (rules.hide?.some((n) => n.toLowerCase() === lower)) return true;
	return (rules.hidePatterns ?? []).some((p) => compile(p)?.test(name));
}

export function displayAreaName(name: string, rules: CoverageRules | undefined): string {
	if (!rules) return name;

	const exact = Object.entries(rules.rename ?? {}).find(([from]) => from.toLowerCase() === name.toLowerCase());
	if (exact) return exact[1];

	for (const [pattern, replacement] of rules.renamePatterns ?? []) {
		const regex = compile(pattern);
		if (regex?.test(name)) return name.replace(regex, replacement);
	}

	return name;
}
