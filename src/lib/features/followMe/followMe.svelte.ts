import {
	ensureLocationWatch,
	getCurrentLocation,
	onLocationUpdate
} from "@/lib/map/geolocate.svelte";
import { getMap } from "@/lib/map/map.svelte";
import { getConfig } from "@/lib/services/config/config";
import * as m from "@/lib/paraglide/messages";
import { openToast } from "@/lib/ui/toasts.svelte.js";
import { Coords } from "@/lib/utils/coordinates";
import { encodeRequestBody, getHeaders, parseResponse } from "@/lib/utils/requests";
import {
	FOLLOW_ME_MAX_INTERVAL_MS,
	medianSpeedKmh,
	resolveSpeedLimits,
	shouldScan as decideScan,
	speedGateBlocks as decideSpeedGate,
	type SpeedSample
} from "./followMePolicy";

export {
	FOLLOW_ME_MAX_INTERVAL_MS,
	FOLLOW_ME_MAX_SPEED_KMH,
	FOLLOW_ME_MIN_INTERVAL_MS,
	FOLLOW_ME_REFRESH_METERS,
	FOLLOW_ME_RESUME_SPEED_KMH
} from "./followMePolicy";

export const FOLLOW_ME_IDLE_TIMEOUT_MS = 30 * 60_000;
export const FOLLOW_ME_SESSION_TIMEOUT_MS = 60 * 60_000;
export const FOLLOW_ME_HIDDEN_TIMEOUT_MS = 5 * 60_000;

/** Poll rate while the user is on the move. */
const TICK_MOVING_MS = 5_000;

/** How long to wait after a transient refusal before asking again. */
const FOLLOW_ME_BACKOFF_MS = 60_000;

/** Below this the user counts as standing still. */
const STATIONARY_SPEED_KMH = 1;

const SPEED_SAMPLES = 5;

/** A fix older than this says nothing about how fast the user is going now. */
const FIX_STALENESS_MS = 15_000;

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
let speedSamples: SpeedSample[] = [];
let speedPaused = false;
let inFlight = false;
let timer: ReturnType<typeof setTimeout> | undefined = undefined;
let nextWakeAt = 0;
let backoffUntil = 0;
let unsubscribeLocation: (() => void) | undefined = undefined;

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

function statusMessage(): string {
	switch (status) {
		case "locating":
			return m.followme_status_locating();
		case "scanning":
			return m.followme_status_scanning();
		case "idle":
			return m.followme_status_idle();
		case "too-fast":
			return m.followme_status_too_fast();
		case "covered":
			return m.followme_status_covered();
		case "quota":
			return m.followme_status_quota();
		case "busy":
			return m.followme_status_busy();
		case "error":
			return m.followme_status_error();
		default:
			return m.followme_status_off();
	}
}

/**
 * One line for the Tools row: the off-state pitch when idle, otherwise what it
 * is doing, how fast the user is going and how many scans they have had.
 */
export function getFollowMeSummary(): string {
	if (!active) return m.tool_follow_me_description();

	// Kept short: the Tools row is one line and clips the overflow.
	if (status === "too-fast") {
		const speed = getFollowMeSpeedKmh();
		return speed === undefined
			? statusMessage()
			: m.followme_status_too_fast_at({ speed: Math.round(speed) });
	}

	if (scanCount > 0 && (status === "idle" || status === "scanning")) {
		return statusMessage() + " \u00b7 " + scanCountLabel();
	}

	return statusMessage();
}

/** Paraglide has no plural form here, so pick the wording in code. */
function scanCountLabel(): string {
	return scanCount === 1 ? m.followme_scan_one() : m.followme_scans({ count: scanCount });
}

/**
 * One word for the map chip.
 *
 * The chip sits over the map and competes with it for attention, so it says
 * only what state the feature is in; the Tools row carries the speed and the
 * scan count for anyone who wants them.
 */
export function getFollowMeChipLabel(): string {
	switch (status) {
		case "locating":
			return m.followme_chip_locating();
		case "scanning":
			return m.followme_chip_scanning();
		case "too-fast":
			return m.followme_chip_paused();
		case "busy":
			return m.followme_chip_waiting();
		case "error":
			return m.followme_chip_error();
		default:
			return m.followme_chip_following();
	}
}

/**
 * Smoothed ground speed in km/h, or undefined until the device has given us a
 * speed at all. The median of the last few fixes rather than the mean, because
 * a single bad fix shows up as one large spike.
 */
export function getFollowMeSpeedKmh(): number | undefined {
	return medianSpeedKmh(speedSamples, Date.now());
}

function recordSpeed() {
	const location = getCurrentLocation();
	if (!location || location.speed === undefined) return;
	if (location.timestamp === lastFixTimestamp) return;

	// Leftovers from the last drive must not decide the gate on the next
	// switch-on, which is what made the toggle flip while standing still.
	if (Date.now() - location.timestamp > FIX_STALENESS_MS) return;

	lastFixTimestamp = location.timestamp;
	speedSamples.push({ metersPerSecond: location.speed, at: Date.now() });
	if (speedSamples.length > SPEED_SAMPLES) speedSamples.shift();
}

/**
 * The speed gate, latched so it has hysteresis: it trips above
 * FOLLOW_ME_MAX_SPEED_KMH and only clears below FOLLOW_ME_RESUME_SPEED_KMH.
 */
function speedGateBlocks(): boolean {
	const limits = getConfig()?.followMe;
	speedPaused = decideSpeedGate(
		getFollowMeSpeedKmh(),
		speedPaused,
		resolveSpeedLimits(limits?.maxSpeedKmh, limits?.resumeSpeedKmh)
	);
	return speedPaused;
}

function shouldScan(now: number, center: Coords): boolean {
	return decideScan({
		now,
		center: center.internal(),
		lastScanCenter: lastScanCenter?.internal(),
		lastScanAt,
		backoffUntil
	});
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
		backoffUntil = Date.now() + FOLLOW_ME_BACKOFF_MS;
		return;
	}

	if (data.result.status === "scanned") {
		lastScanCenter = center;
		lastScanAt = Date.now();
		scanCount += 1;
		status = "idle";

		openToast(m.followme_toast_scanned({ count: data.result.locations ?? 0 }));
		return;
	}

	// Every refusal has to change something, or shouldScan() stays true and the
	// next tick asks again five seconds later - which is what left the menu
	// flipping between "scanning" and the refusal during beta.
	if (data.result.status === "covered") {
		// Nothing here will change until they leave the area, and the whole
		// point is that this ground is already scanned. Stop rather than idle.
		stopFollowMe();
		openToast(m.followme_stopped_covered());
		return;
	}

	if (data.result.status === "quota") {
		stopFollowMe();
		openToast(m.followme_stopped_quota());
		return;
	}

	// Busy is transient, so hold off rather than stopping.
	status = "busy";
	backoffUntil = Date.now() + FOLLOW_ME_BACKOFF_MS;
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

/**
 * How long to sleep before the next check.
 *
 * On the move, every TICK_MOVING_MS so displacement is noticed promptly. Once
 * the user stops, the only thing that can still trigger a scan is the
 * five-minute ceiling, so sleep right up to it rather than waking every few
 * seconds - onMoved() pulls the wake-up forward again the moment they set off.
 */
function nextTickDelay(): number {
	const speed = getFollowMeSpeedKmh();
	const moving = speed === undefined || speed > STATIONARY_SPEED_KMH;
	if (moving) return TICK_MOVING_MS;

	const dueIn = Math.max(
		lastScanAt + FOLLOW_ME_MAX_INTERVAL_MS - Date.now(),
		backoffUntil - Date.now()
	);
	return Math.max(dueIn, TICK_MOVING_MS);
}

function scheduleTick(delay: number) {
	if (timer) clearTimeout(timer);
	nextWakeAt = Date.now() + delay;
	timer = setTimeout(() => void runTick(), delay);
}

async function runTick() {
	await tick();
	if (active) scheduleTick(nextTickDelay());
}

/**
 * Every fix feeds the speed estimate - sampling once per tick was far too
 * coarse, and left a stationary user's speed stuck at whatever it was when
 * they stopped. Only a fix that moved them pulls the next check forward, so a
 * standing-still user still sleeps to the five-minute ceiling.
 */
function onFix(moved: boolean) {
	if (!active) return;

	recordSpeed();
	if (!moved) return;

	if (Date.now() + TICK_MOVING_MS < nextWakeAt - 1_000) scheduleTick(TICK_MOVING_MS);
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
	backoffUntil = 0;
	scanCount = 0;

	ensureLocationWatch(getMap());
	document.addEventListener("visibilitychange", onVisibilityChange);
	unsubscribeLocation = onLocationUpdate(onFix);
	void runTick();
}

export function stopFollowMe() {
	if (!active) return;

	active = false;
	status = "off";

	if (timer) clearTimeout(timer);
	timer = undefined;
	nextWakeAt = 0;
	unsubscribeLocation?.();
	unsubscribeLocation = undefined;
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
