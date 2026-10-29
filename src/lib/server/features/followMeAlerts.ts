import { callPoracle } from "@/lib/server/api/poracleApi";
import {
	clearAlertSession,
	listAlertSessions,
	readAlertSession,
	writeAlertSession
} from "@/lib/server/db/internal/followAlertSessions";
import { getServerConfig } from "@/lib/services/config/config.server";
import { getLogger } from "@/lib/utils/logger";
import {
	FOLLOW_PROFILE_NAME,
	HOME_PROFILE_NAME,
	findProfileByName,
	planProfileSetup,
	resolveAlertLimits,
	resolveReturnProfile,
	shouldMoveAlerts,
	type PoracleProfile,
	type PushedLocation
} from "./followMeAlertsPolicy";

// Moves a user's Poracle alerts along with them while follow-me is running, so
// the distance each alert prints is measured from where they actually are.
//
// It does that by borrowing a profile rather than overwriting their location:
// their home coordinates live in the profiles row for their default profile
// and are never written, and SwitchProfile copies that row back into the
// humans table on the way out. A session we fail to end therefore leaves
// someone with alerts pointed at where they parked - annoying, and fixable by
// them with !profile home - rather than a home location that is silently
// wrong.
//
// Every call here is best effort. A Poracle that will not answer must never
// cost somebody a scan, so nothing in this file throws and nothing it returns
// changes what the follow-me endpoint does next.

const log = getLogger("followme-alerts");

/** Live sessions, so the common path costs no database read. */
type LiveSession = {
	poracleId: string;
	followProfileNo: number;
	lastPushed?: PushedLocation;
};

const live = new Map<string, LiveSession>();

function settings() {
	const poracle = getServerConfig().poracle;
	if (!poracle?.url || !poracle.followMeAlerts) return undefined;
	return poracle;
}

export function isAlertFollowEnabled() {
	return Boolean(settings());
}

/**
 * Whether we are currently moving this user's alerts. The cheap check, for
 * noticing that somebody switched the option off part-way through a session
 * without reading the database on every scan.
 */
export function isFollowingAlerts(userId: string) {
	return live.has(userId);
}

function limits() {
	const poracle = settings();
	return resolveAlertLimits(poracle?.alertMinMeters, poracle?.alertMinSeconds);
}

function humanPath(poracleId: string) {
	return `/api/v2/humans/${encodeURIComponent(poracleId)}`;
}

async function readJson<T>(response: Response | undefined): Promise<T | undefined> {
	if (!response?.ok) return undefined;
	return (await response.json().catch(() => undefined)) as T | undefined;
}

/** undefined for anyone Poracle has never heard of, which is most people. */
async function getCurrentProfileNo(poracleId: string): Promise<number | undefined> {
	const response = await callPoracle(humanPath(poracleId), "GET");
	if (response?.status === 404) return undefined;
	const body = await readJson<{ human?: { current_profile_no?: number } }>(response);
	return body?.human?.current_profile_no;
}

async function getProfiles(poracleId: string): Promise<PoracleProfile[] | undefined> {
	const response = await callPoracle(`${humanPath(poracleId)}/profiles`, "GET");
	const body = await readJson<{ profiles?: PoracleProfile[] }>(response);
	return body?.profiles;
}

/** Returns the number Poracle assigned, which the caller cannot predict. */
async function addProfile(poracleId: string, name: string): Promise<number | undefined> {
	const response = await callPoracle(`${humanPath(poracleId)}/profiles`, "POST", {
		name,
		// No schedule, which is what keeps Poracle's profile scheduler from
		// ever selecting this one.
		active_hours: []
	});
	const body = await readJson<{ profile_no?: number }>(response);
	return body?.profile_no;
}

async function copyProfile(poracleId: string, from: number, into: number): Promise<boolean> {
	const response = await callPoracle(
		`${humanPath(poracleId)}/profiles/${into}/copy`,
		"POST",
		{ from_profile: from }
	);
	return Boolean(response?.ok);
}

async function switchProfile(poracleId: string, profileNo: number): Promise<boolean> {
	const response = await callPoracle(`${humanPath(poracleId)}/profile`, "POST", {
		profile_no: profileNo
	});
	return Boolean(response?.ok);
}

/**
 * Put a user on their follow profile, creating it the first time they ever use
 * the feature rather than for everyone who might.
 *
 * Trackings are copied from whatever profile they were on each time a session
 * starts, so anything they have changed since comes with them. The reverse
 * copy is deliberately not done on the way out: a session's worth of edits
 * lost is a smaller problem than a stray copy over the profile that holds
 * everything.
 */
export async function startAlertFollow(userId: string, poracleId: string) {
	try {
		if (!settings() || live.has(userId)) return;

		// After a restart the map is empty but the row is not, and the sweep may
		// not have reached this user yet. Adopting the row beats switching
		// somebody who is already switched.
		const existing = await readAlertSession(userId);
		if (existing) {
			live.set(userId, {
				poracleId: existing.poracleId,
				followProfileNo: existing.followProfileNo
			});
			return;
		}

		const currentProfileNo = await getCurrentProfileNo(poracleId);
		if (currentProfileNo === undefined) {
			log.debug("User %s isn't registered in Poracle; alerts not moved", userId);
			return;
		}

		const profiles = await getProfiles(poracleId);
		if (!profiles) return;

		const plan = planProfileSetup(profiles);

		if (plan.createHome) {
			// Takes number 1 with their own area and location copied off the
			// humans row, so the follow profile cannot land on it.
			const homeNo = await addProfile(poracleId, HOME_PROFILE_NAME);
			if (homeNo === undefined) return;
			log.info("Wrote down %s's default Poracle profile as %s", userId, HOME_PROFILE_NAME);
		}

		let followProfileNo = plan.followProfileNo;
		if (plan.createFollow) {
			followProfileNo = await addProfile(poracleId, FOLLOW_PROFILE_NAME);
			if (followProfileNo === undefined) return;
		}
		if (followProfileNo === undefined) return;

		// Their rules as they stand now, not as they stood the first time they
		// ever turned this on.
		await copyProfile(poracleId, currentProfileNo, followProfileNo);

		if (!(await switchProfile(poracleId, followProfileNo))) {
			log.warning("Couldn't switch %s onto the %s profile", userId, FOLLOW_PROFILE_NAME);
			return;
		}

		await writeAlertSession({
			userId,
			poracleId,
			followProfileNo,
			returnProfileNo: currentProfileNo
		});
		live.set(userId, { poracleId, followProfileNo });

		log.info(
			"Moving %s's Discord alerts with them / profile: %d / back to: %d",
			userId,
			followProfileNo,
			currentProfileNo
		);
	} catch (err) {
		log.error("Starting alert following for %s failed: %s", userId, err);
	}
}

/**
 * Point the user's alerts at where they are now, if they have covered enough
 * ground to make the old figure wrong.
 *
 * Called with every position the follow-me endpoint sees, including the ones
 * whose scan was refused for coverage: a user driving through an area we
 * already scan still wants the distances in their alerts to be right.
 */
export async function moveAlerts(userId: string, lat: number, lon: number) {
	try {
		const session = live.get(userId);
		if (!session) return;

		const now = Date.now();
		if (!shouldMoveAlerts(session.lastPushed, lat, lon, now, limits())) return;

		// Written before the call rather than after, so a slow Poracle cannot
		// have a queue of updates pile up behind it.
		session.lastPushed = { lat, lon, at: now };

		const response = await callPoracle(
			`${humanPath(session.poracleId)}/location?profile=${session.followProfileNo}`,
			"POST",
			{ latitude: lat, longitude: lon }
		);
		if (response?.ok) return;

		log.warning(
			"Moving %s's alerts returned %s",
			userId,
			response ? response.status : "no answer"
		);
	} catch (err) {
		log.error("Moving alerts for %s failed: %s", userId, err);
	}
}

/**
 * Put a user back where they came from.
 *
 * Only if they are still on the follow profile: Poracle's own scheduler can
 * switch somebody at an hour boundary, and when it has, the profile they are
 * on now is the one they are meant to be on. Switching them off it would be us
 * fighting Poracle over a user, which we lose by definition.
 */
async function returnToOwnProfile(session: {
	userId: string;
	poracleId: string;
	followProfileNo: number;
	returnProfileNo: number;
}) {
	const currentProfileNo = await getCurrentProfileNo(session.poracleId);

	if (currentProfileNo !== session.followProfileNo) {
		log.info(
			"Leaving %s on profile %s; something else moved them off %s",
			session.userId,
			currentProfileNo === undefined ? "unknown" : String(currentProfileNo),
			FOLLOW_PROFILE_NAME
		);
		return currentProfileNo !== undefined;
	}

	const profiles = await getProfiles(session.poracleId);
	if (!profiles) return false;

	const target = resolveReturnProfile(profiles, session.returnProfileNo);
	if (!(await switchProfile(session.poracleId, target))) {
		log.warning("Couldn't switch %s back to profile %d", session.userId, target);
		return false;
	}

	log.info("%s's Discord alerts are back on profile %d", session.userId, target);
	return true;
}

export async function stopAlertFollow(userId: string) {
	try {
		if (!settings()) return;

		const row = await readAlertSession(userId);
		live.delete(userId);
		if (!row) return;

		// Cleared whether or not the switch worked. A row we cannot act on is a
		// row that will be retried on every restart for ever, and the user can
		// put themselves back with !profile home.
		if (!(await returnToOwnProfile(row))) {
			log.warning("Gave up putting %s back on their own profile", userId);
		}
		await clearAlertSession(userId);
	} catch (err) {
		log.error("Stopping alert following for %s failed: %s", userId, err);
	}
}

/**
 * Anyone a restart left parked on a follow profile.
 *
 * Runs once at startup, before requests arrive in any numbers, because the
 * alternative is a user whose alerts stay pointed at wherever they were when
 * we were deployed over.
 */
export async function restoreStrandedAlertFollows() {
	try {
		if (!settings()) return;

		const rows = await listAlertSessions();
		if (rows.length === 0) return;

		log.info("Putting %d stranded follow-me user(s) back on their own profile", rows.length);
		for (const row of rows) {
			await returnToOwnProfile(row);
			await clearAlertSession(row.userId);
		}
	} catch (err) {
		log.error("Sweeping stranded alert sessions failed: %s", err);
	}
}

/** For tests: forget who is being followed. */
export function resetAlertFollowState() {
	live.clear();
}
