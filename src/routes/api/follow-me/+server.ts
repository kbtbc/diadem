import { getHex7Coords } from "@/lib/features/followMe/hexGeometry";
import { addScoutEntries } from "@/lib/server/api/dragoniteApi";
import { readRequestBody } from "@/lib/server/api/requestBody";
import { respond } from "@/lib/server/api/respond";
import { result } from "@/lib/server/api/results";
import { hasFeatureAnywhereServer } from "@/lib/server/auth/checkIfAuthed";
import { overlapsCoveredArea } from "@/lib/server/features/followMeAreas";
import {
	consumeFollowMeQuota,
	getFollowerCount,
	refundFollowMeQuota,
	releaseFollowerSlot,
	reserveFollowerSlot,
	scoutQueueIsBusy
} from "@/lib/server/features/followMeQuota";
import { Features } from "@/lib/utils/features";
import { Coords } from "@/lib/utils/coordinates";
import { getLogger } from "@/lib/utils/logger";
import { error } from "@sveltejs/kit";

const log = getLogger("followme");

type FollowMeRequest = {
	lat?: number;
	lon?: number;
	/** Set when the client is switching the feature off. */
	stop?: boolean;
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
		return respond(request, result({ status: "stopped" }));
	}

	const lat = Number(body.lat);
	const lon = Number(body.lon);
	if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
		return respond(request, result(undefined, "Invalid Coords"));
	}

	if (!reserveFollowerSlot(userKey)) {
		return respond(request, result({ status: "busy" }));
	}

	// Generated here, never accepted from the client, so a crafted request
	// cannot aim 49 scouts at coordinates of its choosing.
	const points = getHex7Coords(new Coords(lat, lon));

	const overlaps = await overlapsCoveredArea(points);
	if (overlaps === undefined) return respond(request, result({ status: "busy" }));
	if (overlaps) return respond(request, result({ status: "covered" }));

	if (await scoutQueueIsBusy()) return respond(request, result({ status: "busy" }));

	// Charged last, so a scan skipped for coverage or a busy queue costs the
	// user nothing.
	const quota = await consumeFollowMeQuota(userKey);
	if (!quota.ok) return respond(request, result({ status: "quota" }));

	const username = "Diadem FM: " + (locals.user?.name || "<unknown user>");
	const success = await addScoutEntries(
		username,
		points.map((point) => [point.lat, point.lon])
	);

	if (!success) {
		await refundFollowMeQuota(userKey);
		return respond(request, result(undefined, "Internal Error"));
	}

	log.info(
		"Follow-me scan queued / user: %s / locations: %d / quota left: %d / followers: %d",
		userKey,
		points.length,
		quota.remaining,
		getFollowerCount()
	);

	return respond(request, result({ status: "scanned", locations: points.length }));
}
