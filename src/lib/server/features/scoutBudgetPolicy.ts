/**
 * Pure decisions behind the scout allowance, kept clear of the database and
 * the config loader so they can be tested without either.
 */

/**
 * Scout locations one user may queue per day, across every endpoint.
 *
 * 8000 is about 163 follow-me scans at 49 points each. A flat-out two-hour
 * session spends roughly 4000 against the hourly ceiling, so this is two of
 * them with room over; the heaviest real day of the beta was 1568.
 */
export const DEFAULT_LOCATIONS_PER_DAY = 8000;

/**
 * Most locations one request may ask for. The scout tool sends at most 7
 * (getCoords size 0/1/2 gives 1, 7, 7) and follow-me sends 49, so this only
 * ever catches something that did not come from our own client.
 */
export const DEFAULT_MAX_LOCATIONS_PER_REQUEST = 64;

function positiveOr(value: number | undefined, fallback: number): number {
	return Number.isFinite(value) && (value as number) > 0 ? Math.floor(value as number) : fallback;
}

export function resolveLocationsPerDay(configured: number | undefined): number {
	return positiveOr(configured, DEFAULT_LOCATIONS_PER_DAY);
}

export function resolveMaxLocationsPerRequest(configured: number | undefined): number {
	return positiveOr(configured, DEFAULT_MAX_LOCATIONS_PER_REQUEST);
}

/**
 * The day a spend belongs to, as YYYY-MM-DD in the server's own timezone.
 *
 * Deliberately local rather than UTC: the box runs America/New_York and so do
 * the users, and a UTC day would roll the allowance over at eight in the
 * evening, which reads as a bug to anyone it happens to.
 */
export function scoutDay(now: Date = new Date()): string {
	const year = now.getFullYear();
	const month = String(now.getMonth() + 1).padStart(2, "0");
	const day = String(now.getDate()).padStart(2, "0");
	return year + "-" + month + "-" + day;
}
