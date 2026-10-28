import { ensureLocationWatch, getCurrentLocation } from "@/lib/map/geolocate.svelte";
import { getMap } from "@/lib/map/map.svelte";
import * as m from "@/lib/paraglide/messages";
import { openToast } from "@/lib/ui/toasts.svelte.js";
import { Coords } from "@/lib/utils/coordinates";
import { rangeDistanceMeters } from "@/lib/utils/rangeGeometry";
import { encodeRequestBody, getHeaders, parseResponse } from "@/lib/utils/requests";

/**
 * Above this the feature pauses. Not a staleness limit - a user moving faster
 * than this will not still be in range by the time they have checked the map,
 * switched to the game and thrown a ball, so the scan would be wasted.
 */
export const FOLLOW_ME_MAX_SPEED_KMH = 10;

/** Resume below this, so a red light or a platform does not end the session. */
export const FOLLOW_ME_RESUME_SPEED_KMH = 8;

/**
 * Rescan once the user has left roughly half the guaranteed-covered footprint
 * behind (see HEX7_COVERED_RADIUS_METERS, ~371 m).
 */
export const FOLLOW_ME_REFRESH_METERS = 180;

/** Floor between scans, so a jittery fix cannot burn 49 scouts in a row. */
export const FOLLOW_ME_MIN_INTERVAL_MS = 90_000;

/**
 * Ceiling between scans. 82% of spawns live 10-30 minutes, so refreshing a
 * stationary user faster than this mostly re-returns the same pokemon.
 */
export const FOLLOW_ME_MAX_INTERVAL_MS = 300_000;

export const FOLLOW_ME_IDLE_TIMEOUT_MS = 30 * 60_000;
export const FOLLOW_ME_SESSION_TIMEOUT_MS = 60 * 60_000;
export const FOLLOW_ME_HIDDEN_TIMEOUT_MS = 5 * 60_000;

const TICK_MS = 5_000;
const SPEED_SAMPLES = 3;

export type FollowMeStatus =
	"off" | "locating" | "scanning" | "idle" | "too-fast" | "covered" | "quota" | "busy" | "error";

export type FollowMeResult = {
	status: "scanned" | "covered" | "quota" | "busy";
	locations?: number;
};

let active: boolean = $state(false);
let status: FollowMeStatus = $state("off");
let scanCount: number = $state(0);
let lastScanAt: number = $state(0);

let startedAt = 0;
let lastScanCenter: Coords | undefined = undefined;
let hiddenSince: number | undefined = undefined;
let lastFixTimestamp: number | undefined = undefined;
let speedSamples: number[] = [];
let speedPaused = false;
let inFlight = false;
let timer: ReturnType<typeof setInterval> | undefined = undefined;

export function getFollowMeActive() {
	return active;
}

export function getFollowMeStatus() {
	return status;
}

export function getFollowMeScanCount() {
	return scanCount;
}

export function getFollowMeLastScanAt() {
	return lastScanAt;
}

/**
 * Smoothed ground speed in km/h, or undefined until the device has given us a
 * speed at all. The median of the last few fixes rather than the mean, because
 * a single bad fix shows up as one large spike.
 */
export function getFollowMeSpeedKmh(): number | undefined {
	if (speedSamples.length === 0) return undefined;
	const sorted = [...speedSamples].sort((a, b) => a - b);
	return (sorted[Math.floor(sorted.length / 2)] * 3600) / 1000;
}

function recordSpeed() {
	const location = getCurrentLocation();
	if (!location || location.speed === undefined) return;
	if (location.timestamp === lastFixTimestamp) return;

	lastFixTimestamp = location.timestamp;
	speedSamples.push(location.speed);
	if (speedSamples.length > SPEED_SAMPLES) speedSamples.shift();
}

/**
 * The speed gate, latched so it has hysteresis: it trips above
 * FOLLOW_ME_MAX_SPEED_KMH and only clears below FOLLOW_ME_RESUME_SPEED_KMH.
 */
function speedGateBlocks(): boolean {
	const speed = getFollowMeSpeedKmh();
	if (speed === undefined) return false;

	if (speedPaused) {
		if (speed <= FOLLOW_ME_RESUME_SPEED_KMH) speedPaused = false;
	} else if (speed > FOLLOW_ME_MAX_SPEED_KMH) {
		speedPaused = true;
	}

	return speedPaused;
}

function shouldScan(now: number, center: Coords): boolean {
	if (!lastScanCenter) return true;

	const elapsed = now - lastScanAt;
	if (elapsed >= FOLLOW_ME_MAX_INTERVAL_MS) return true;
	if (elapsed < FOLLOW_ME_MIN_INTERVAL_MS) return false;

	const moved = rangeDistanceMeters(lastScanCenter.geojson(), center.geojson());
	return moved > FOLLOW_ME_REFRESH_METERS;
}

function autoStopReason(now: number): string | undefined {
	if (now - startedAt >= FOLLOW_ME_SESSION_TIMEOUT_MS) return m.followme_stopped_session();
	if (now - (lastScanAt || startedAt) >= FOLLOW_ME_IDLE_TIMEOUT_MS)
		return m.followme_stopped_idle();
	if (hiddenSince !== undefined && now - hiddenSince >= FOLLOW_ME_HIDDEN_TIMEOUT_MS)
		return m.followme_stopped_hidden();
	return undefined;
}

async function requestScan(center: Coords): Promise<void> {
	const encoded = encodeRequestBody(center.internal());
	const response = await fetch("/api/follow-me", {
		method: "POST",
		body: encoded.body,
		headers: getHeaders(encoded.contentType)
	});
	const data = await parseResponse<{ result?: FollowMeResult; error?: string }>(response);

	if (data.error || !data.result) {
		status = "error";
		return;
	}

	if (data.result.status === "scanned") {
		// Only a dispatched scan moves the centre, so a user who was skipped
		// for coverage or quota is retried on the next tick rather than being
		// pinned to where they were refused.
		lastScanCenter = center;
		lastScanAt = Date.now();
		scanCount += 1;
		status = "idle";
		return;
	}

	status = data.result.status;
}

async function tick() {
	if (!active) return;

	recordSpeed();
	const now = Date.now();

	const stopReason = autoStopReason(now);
	if (stopReason) {
		stopFollowMe();
		openToast(stopReason);
		return;
	}

	if (speedGateBlocks()) {
		status = "too-fast";
		return;
	}

	const location = getCurrentLocation();
	if (!location) {
		status = "locating";
		return;
	}

	const center = new Coords(location.lat, location.lng);
	if (!shouldScan(now, center)) {
		if (status === "scanning" || status === "locating") status = "idle";
		return;
	}

	if (inFlight) return;
	inFlight = true;
	status = "scanning";

	try {
		await requestScan(center);
	} catch {
		status = "error";
	} finally {
		inFlight = false;
	}
}

function onVisibilityChange() {
	if (document.visibilityState === "hidden") {
		hiddenSince = Date.now();
	} else {
		hiddenSince = undefined;
	}
}

export function startFollowMe() {
	if (active) return;

	active = true;
	status = "locating";
	startedAt = Date.now();
	lastScanAt = 0;
	lastScanCenter = undefined;
	hiddenSince = undefined;
	lastFixTimestamp = undefined;
	speedSamples = [];
	speedPaused = false;
	scanCount = 0;

	ensureLocationWatch(getMap());
	document.addEventListener("visibilitychange", onVisibilityChange);
	timer = setInterval(() => void tick(), TICK_MS);
	void tick();
}

export function stopFollowMe() {
	if (!active) return;

	active = false;
	status = "off";

	if (timer) clearInterval(timer);
	timer = undefined;
	document.removeEventListener("visibilitychange", onVisibilityChange);

	// Hand the follower slot back so the concurrency cap reflects reality
	// without waiting out the server's idle TTL. Best effort: the slot expires
	// on its own if this never lands.
	void releaseSlot();
}

async function releaseSlot() {
	try {
		const encoded = encodeRequestBody({ stop: true });
		await fetch("/api/follow-me", {
			method: "POST",
			body: encoded.body,
			headers: getHeaders(encoded.contentType)
		});
	} catch {
		// nothing to do: the server prunes idle followers anyway
	}
}

export function toggleFollowMe() {
	if (active) {
		stopFollowMe();
	} else {
		startFollowMe();
	}
}
