import { rangeDistanceMeters } from "@/lib/utils/rangeGeometry";

/**
 * The decisions behind moving a user's Poracle alerts with them, kept apart
 * from followMeAlerts.ts so they can be tested without a Poracle to talk to.
 */

/**
 * The profile follow-me borrows while a session is running.
 *
 * It is created with no active hours, which is what keeps Poracle's own
 * profile scheduler from ever selecting it. The scheduler can still switch
 * someone off it at an hour boundary; that is handled by only ever switching
 * back from a profile that is still this one.
 */
export const FOLLOW_PROFILE_NAME = "follow";

/**
 * What a user's default profile gets called when we have to write it down.
 *
 * Not cosmetic. 990 of the 1,103 registered users have no profiles row at all
 * - their profile 1 is implicit - and Poracle's AddProfile hands out the
 * lowest free number, which for them is 1. Creating "follow" first would
 * therefore rename their default profile and leave them nothing to switch
 * back to. Writing home down first takes number 1 honestly, with their own
 * area and location copied from the humans row, so follow lands on 2.
 */
export const HOME_PROFILE_NAME = "home";

/**
 * How far a user has to travel before their alerts are worth moving.
 *
 * The whole point of the location in Poracle is the distance printed in each
 * alert. Under a kilometre that figure is still close enough to act on, and
 * every update costs a full state reload, so this is where the two meet.
 */
export const DEFAULT_ALERT_MIN_METERS = 1000;

/**
 * And never more often than this, however fast they are going. At the 90 km/h
 * speed gate a kilometre takes forty seconds, so without a floor a motorway
 * drive would push an update every forty seconds for two hours.
 */
export const DEFAULT_ALERT_MIN_SECONDS = 60;

export type AlertLimits = {
	minMeters: number;
	minSeconds: number;
};

export const DEFAULT_ALERT_LIMITS: AlertLimits = {
	minMeters: DEFAULT_ALERT_MIN_METERS,
	minSeconds: DEFAULT_ALERT_MIN_SECONDS
};

function positive(value: number | undefined): number | undefined {
	return Number.isFinite(value) && (value as number) > 0 ? (value as number) : undefined;
}

export function resolveAlertLimits(minMeters?: number, minSeconds?: number): AlertLimits {
	return {
		minMeters: positive(minMeters) ?? DEFAULT_ALERT_MIN_METERS,
		minSeconds: positive(minSeconds) ?? DEFAULT_ALERT_MIN_SECONDS
	};
}

export type PushedLocation = {
	lat: number;
	lon: number;
	at: number;
};

/**
 * Whether the user has moved far enough, and waited long enough, for their
 * alerts to be pointed somewhere new.
 *
 * Time alone never triggers an update. Standing still does not make the
 * distance in an alert wrong, and pushing the same coordinates again would buy
 * a state reload for nothing - so the clock is a floor on how often we may
 * move them, not a reason to.
 */
export function shouldMoveAlerts(
	last: PushedLocation | undefined,
	lat: number,
	lon: number,
	now: number,
	limits: AlertLimits = DEFAULT_ALERT_LIMITS
): boolean {
	if (!last) return true;
	if (now - last.at < limits.minSeconds * 1000) return false;
	return rangeDistanceMeters([last.lon, last.lat], [lon, lat]) >= limits.minMeters;
}

export type PoracleProfile = {
	profile_no: number;
	name: string;
};

/** Case and padding are the user's business; matching is ours. */
export function findProfileByName(
	profiles: PoracleProfile[],
	name: string
): PoracleProfile | undefined {
	return profiles.find((profile) => profile.name.trim().toLowerCase() === name);
}

/**
 * What has to be created before this user can be switched onto a follow
 * profile, in the order it has to happen.
 *
 * Both steps are skipped for anyone who has been through here before, so the
 * usual cost of starting a session is one switch.
 */
export function planProfileSetup(profiles: PoracleProfile[]): {
	createHome: boolean;
	createFollow: boolean;
	followProfileNo?: number;
} {
	const follow = findProfileByName(profiles, FOLLOW_PROFILE_NAME);
	if (follow) return { createHome: false, createFollow: false, followProfileNo: follow.profile_no };

	// No rows at all means the implicit default would be handed out as number
	// 1 to whatever we create next - see HOME_PROFILE_NAME.
	return { createHome: profiles.length === 0, createFollow: true };
}

/**
 * Where to put a user back when their session ends.
 *
 * Their own profile if it is still there, and profile 1 otherwise: a profile
 * they deleted mid-session is not somewhere we can return them to, and the
 * default is the only number guaranteed to mean something.
 */
export function resolveReturnProfile(profiles: PoracleProfile[], preferred: number): number {
	return profiles.some((profile) => profile.profile_no === preferred) ? preferred : 1;
}
