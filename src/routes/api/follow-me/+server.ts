import { getHex7Coords } from "@/lib/features/followMe/hexGeometry";
import { addScoutEntries, getScoutQueue } from "@/lib/server/api/dragoniteApi";
import { readRequestBody } from "@/lib/server/api/requestBody";
import { respond } from "@/lib/server/api/respond";
import { result } from "@/lib/server/api/results";
import { hasFeatureAnywhereServer } from "@/lib/server/auth/checkIfAuthed";
import {
	isAlertFollowEnabled,
	moveAlerts,
	startAlertFollow,
	stopAlertFollow
} from "@/lib/server/features/followMeAlerts";
import { overlapsCoveredArea } from "@/lib/server/features/followMeAreas";
import { chargeDailyLocations, refundDailyLocations } from "@/lib/server/features/scoutBudget";
import {
	consumeFollowMeQuota,
	getFollowerCount,
	getScansPerHour,
	refundFollowMeQuota,
	releaseFollowerSlot,
	reserveFollowerSlot,
	scoutQueueIsBusy
} from "@/lib/server/features/followMeQuota";
import { getServerConfig } from "@/lib/services/config/config.server";
import { Features } from "@/lib/utils/features";
import { Coords } from "@/lib/utils/coordinates";
import { getLogger } from "@/lib/utils/logger";
import { error } from "@sveltejs/kit";

const log = getLogger("followme");

/**
 * One shape for every way a scan can be turned away, so refusals can be
 * counted as a family. Only the success path used to be visible, which left no
 * way to tell how often the coverage check was turning people away - the
 * number that says whether it is too aggressive.
 */
function logRefusal(userKey: string, reason: string, detail?: string) {
	log.info(
		"Follow-me scan refused / user: %s / reason: %s / followers: %d%s",
		userKey,
		reason,
		getFollowerCount(),
		detail ? " / " + detail : ""
	);
}

/**
 * Scout queue depth, so the client can tell when a scan it queued has
 * actually been worked through. Queueing is instant; the scan is not.
 */
export async function GET({ locals, request }) {
	if (!hasFeatureAnywhereServer(locals.perms, Features.FOLLOW_ME, locals.user)) error(401);

	const queue = await getScoutQueue();
	if (queue === undefined) return respond(request, result(undefined, "Internal Error"));

	return respond(request, result({ queue }));
}

/**
 * Whether this user may scan inside an area we already cover.
 *
 * Configured by hand and expected to hold one or two ids: coverage is the only
 * refusal that ends the session instead of retrying, so without this nobody
 * can exercise a full follow-me session without first driving out of town.
 */
function skipsCoverageCheck(discordId: string | undefined): boolean {
	if (!discordId) return false;
	return (getServerConfig().followMe?.coverageExemptDiscordIds ?? []).includes(discordId);
}

type FollowMeRequest = {
	lat?: number;
	lon?: number;
	/** Set when the client is switching the feature off. */
	stop?: boolean;
	/**
	 * Move the user's alerts and nothing else, for when the speed gate is
	 * holding scans back. Costs no quota and no scout time.
	 */
	alertsOnly?: boolean;
};

export async function POST({ request, locals }) {
	if (!hasFeatureAnywhereServer(locals.perms, Features.FOLLOW_ME, locals.user)) error(401);

	// Follow-me is per-user by construction: the quota, the follower cap and the
	// scout username all key off the account, so an anonymous session has
	// nothing to charge.
	const userKey = locals.user?.id;
	if (!userKey) error(401);

	const body = await readRequestBody<FollowMeRequest>(request);

	if (body.stop) {
		releaseFollowerSlot(userKey);
		void stopAlertFollow(userKey);
		log.info("Follow-me stopped / user: %s / followers: %d", userKey, getFollowerCount());
		return respond(request, result({ status: "stopped" }));
	}

	const lat = Number(body.lat);
	const lon = Number(body.lon);
	if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
		// A warning rather than a refusal: the client should never send these.
		log.warning("Follow-me scan refused / user: %s / reason: invalid coords", userKey);
		return respond(request, result(undefined, "Invalid Coords"));
	}

	// Deliberately not awaited, and deliberately ahead of every refusal below:
	// a user driving through an area we already scan gets no scan, but still
	// wants the distance in their alerts measured from where they are. Poracle
	// being slow or down must never cost anybody a scan, so nothing here is on
	// the path to the response.
	//
	// No opt-in: anybody whose alerts Poracle already sends gets them measured
	// from where they are. The switch that used to gate this sat in the Tools
	// menu asking a question most people had no way to answer - and the answer
	// nearly everyone wants is yes, since the alternative is distances measured
	// from a house they are not at. startAlertFollow is a no-op for anyone
	// Poracle has never heard of, which is most users, so nobody who does not
	// use Poracle gains a profile they did not ask for.
	const discordId = locals.user?.discordId;
	if (isAlertFollowEnabled() && discordId) {
		void startAlertFollow(userKey, discordId).then(() => moveAlerts(userKey, lat, lon));
	}

	if (body.alertsOnly) {
		// No follower slot, no coverage check, no quota: this asks for nothing
		// from the scout pool. It also never starts a session - a session begins
		// with a scan, and somebody who has been above the gate since they
		// switched the feature on has not had one yet.
		// moveAlerts does nothing without a live session, so this cannot start
		// one on its own.
		if (isAlertFollowEnabled()) void moveAlerts(userKey, lat, lon);
		return respond(request, result({ status: "paused" }));
	}

	if (!reserveFollowerSlot(userKey)) {
		logRefusal(userKey, "follower cap");
		return respond(request, result({ status: "busy" }));
	}

	// Generated here, never accepted from the client, so a crafted request
	// cannot aim 49 scouts at coordinates of its choosing.
	const points = getHex7Coords(new Coords(lat, lon));

	const exempt = skipsCoverageCheck(locals.user?.discordId);
	const coverage = exempt ? { covered: false as const } : await overlapsCoveredArea(points);
	if (coverage === undefined) {
		// The area store did not answer, so we are blind rather than busy.
		log.warning(
			"Follow-me scan refused / user: %s / reason: coverage unavailable / followers: %d",
			userKey,
			getFollowerCount()
		);
		return respond(request, result({ status: "busy" }));
	}
	if (coverage.covered) {
		logRefusal(userKey, "covered area", "area: " + coverage.area);
		return respond(request, result({ status: "covered" }));
	}

	const scoutQueue = await scoutQueueIsBusy();
	if (scoutQueue.busy) {
		logRefusal(userKey, "scout queue busy", "queue: " + (scoutQueue.queue ?? "unreadable"));
		return respond(request, result({ status: "busy" }));
	}

	// Charged last, so a scan skipped for coverage or a busy queue costs the
	// user nothing.
	const quota = await consumeFollowMeQuota(userKey);
	if (!quota.ok) {
		logRefusal(userKey, "quota spent");
		return respond(request, result({ status: "quota" }));
	}

	// The day's allowance is shared with the manual scout tool, and is in the
	// database rather than in memory so a deploy cannot wipe it.
	const daily = await chargeDailyLocations(userKey, points.length);
	if (!daily.ok) {
		await refundFollowMeQuota(userKey);
		logRefusal(userKey, daily.reason, "spent: " + daily.spent + " of " + daily.limit);

		// A database that would not answer is a transient fault, not a spent
		// allowance: back off instead of ending the session.
		if (daily.reason === "unavailable") return respond(request, result({ status: "busy" }));
		return respond(request, result({ status: "quota", daily: true }));
	}

	const username = "Diadem FM: " + (locals.user?.name || "<unknown user>");
	const success = await addScoutEntries(
		username,
		points.map((point) => [point.lat, point.lon])
	);

	if (!success) {
		await refundFollowMeQuota(userKey);
		await refundDailyLocations(userKey, points.length);
		log.error(
			"Follow-me scan failed to queue / user: %s / locations: %d / quota and allowance refunded",
			userKey,
			points.length
		);
		return respond(request, result(undefined, "Internal Error"));
	}

	log.info(
		"Follow-me scan queued / user: %s / locations: %d / quota left: %d / followers: %d / spent today: %d of %d%s",
		userKey,
		points.length,
		quota.remaining,
		getFollowerCount(),
		daily.spent,
		daily.limit,
		exempt ? " / coverage check skipped" : ""
	);

	return respond(
		request,
		result({
			status: "scanned",
			locations: points.length,
			scansLeft: quota.remaining,
			scansPerHour: getScansPerHour()
		})
	);
}
