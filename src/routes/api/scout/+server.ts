import type { ScoutRequest } from "@/lib/features/scout.svelte.js";
import { addScoutEntries, getScoutQueue } from "@/lib/server/api/dragoniteApi";
import { readRequestBody } from "@/lib/server/api/requestBody";
import { respond } from "@/lib/server/api/respond";
import { error } from "@sveltejs/kit";

import { result } from "@/lib/server/api/results";
import { hasFeatureAnywhereServer } from "@/lib/server/auth/checkIfAuthed";
import {
	chargeDailyLocations,
	getMaxLocationsPerRequest,
	refundDailyLocations
} from "@/lib/server/features/scoutBudget";
import { Features } from "@/lib/utils/features";
import { getLogger } from "@/lib/utils/logger";

const log = getLogger("scout");

export async function POST({ request, locals }) {
	if (!hasFeatureAnywhereServer(locals.perms, Features.SCOUT, locals.user)) error(401);

	// hasFeatureAnywhereServer already refuses without a session, so this only
	// narrows the type - but the allowance has to be charged to somebody.
	const userKey = locals.user?.id;
	if (!userKey) error(401);

	const scoutData = await readRequestBody<ScoutRequest>(request);

	if (!scoutData.coords) return respond(request, result(undefined, "No Coords"));

	// The coordinate list comes straight from the client, and nothing used to
	// bound it: one request could queue as many scouts as it liked. The tool
	// sends at most 7.
	const cap = getMaxLocationsPerRequest();
	if (scoutData.coords.length > cap) {
		log.warning(
			"Scout refused / user: %s / reason: too many locations / asked: %d / cap: %d",
			userKey,
			scoutData.coords.length,
			cap
		);
		return respond(request, result(undefined, "Too Many Coords"));
	}

	const locations = scoutData.coords.map((c) => [c.lat, c.lon]);

	// Same allowance follow-me draws on, so scouting by hand really does leave
	// less for being followed.
	const daily = await chargeDailyLocations(userKey, locations.length);
	if (!daily.ok) {
		log.info(
			"Scout refused / user: %s / reason: %s / spent: %d of %d",
			userKey,
			daily.reason,
			daily.spent,
			daily.limit
		);
		return respond(request, result(undefined, "Daily Limit"));
	}

	const username = "Diadem: " + (locals.user?.name || "<unknown user>");
	const success = await addScoutEntries(username, locations);

	if (!success) await refundDailyLocations(userKey, locations.length);

	log.info(
		"Queued scout entries / success: %s / user: %s / locations: %d / spent today: %d of %d",
		"" + success,
		userKey,
		locations.length,
		daily.spent,
		daily.limit
	);

	if (success) {
		return respond(request, result());
	} else {
		return respond(request, result(undefined, "Internal Error"));
	}
}

export async function GET({ locals, request }) {
	if (!hasFeatureAnywhereServer(locals.perms, Features.SCOUT, locals.user)) error(401);

	const response = await getScoutQueue();

	log.info("Fetched scout queue size");

	if (response === undefined) {
		return respond(request, result(undefined, "Internal Error"));
	} else {
		return respond(request, result(response));
	}
}
