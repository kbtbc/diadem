import {
	ensureLocationWatch,
	getCurrentLocation,
	onLocationUpdate,
	pinLocationWatch,
	startCameraFollow
} from "@/lib/map/geolocate.svelte";
import { getMap } from "@/lib/map/map.svelte";
import { getConfig } from "@/lib/services/config/config";
import * as m from "@/lib/paraglide/messages";
import { openToast } from "@/lib/ui/toasts.svelte.js";
import { Coords, type LatLon } from "@/lib/utils/coordinates";
import { encodeRequestBody, getHeaders, parseResponse } from "@/lib/utils/requests";
import {
	FOLLOW_ME_MAX_INTERVAL_MS,
	gateSpeedKmh,
	medianSpeedKmh,
	resolveMinInterval,
	resolveSpeedLimits,
	shouldResumeSession,
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

/** Unchanged: a session that cannot get a scan away for this long is stuck. */
export const FOLLOW_ME_IDLE_TIMEOUT_MS = 30 * 60_000;

/** A playing session, not an hour - users were hitting the old cap mid-outing. */
export const FOLLOW_ME_SESSION_TIMEOUT_MS = 3 * 60 * 60_000;

/**
 * Switching to the game is the entire point of the feature, and walking to a
 * spawn and catching it routinely takes more than the five minutes this used
 * to allow - so the map going to the background was turning follow-me off
 * exactly when it was working.
 */
export const FOLLOW_ME_HIDDEN_TIMEOUT_MS = 30 * 60_000;

/** How long the covered-area notice stays up in the Tools menu. */
export const FOLLOW_ME_NOTICE_MS = 10_000;

/** Long enough to read, for the toasts that explain why it stopped. */
const TOAST_EXPLAIN_MS = 6_000;

/** How often to ask whether the scout queue has worked through our scan. */
const COMPLETION_POLL_MS = 2_000;

/**
 * Stop waiting after this. A scan of 49 points clears in about ten seconds on
 * a quiet pool, so anything past this is the pool being busy, not our scan.
 */
const COMPLETION_GIVE_UP_MS = 40_000;

/** Poll rate while the user is on the move. */
/**
 * Android Chrome discards backgrounded tabs, so switching to the game and back
 * can silently reload the page. Without this the session died on every reload
 * and the only sign was the chip vanishing.
 */
const STORAGE_KEY = "followMe:session";

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
let restoreAttempted = false;
let noticeKind: "covered" | undefined = $state(undefined);
let noticeTimer: ReturnType<typeof setTimeout> | undefined = undefined;
let completionTimer: ReturnType<typeof setTimeout> | undefined = undefined;

/**
 * A reason worth leaving on screen after the feature switched itself off.
 *
 * Stopping used to leave the Tools row showing nothing but its usual pitch,
 * so a user who had just been refused saw no explanation at all.
 */
export function getFollowMeNotice() {
	return noticeKind;
}

function showCoveredNotice() {
	noticeKind = "covered";
	if (noticeTimer) clearTimeout(noticeTimer);
	noticeTimer = setTimeout(() => {
		noticeKind = undefined;
		noticeTimer = undefined;
	}, FOLLOW_ME_NOTICE_MS);
}

function clearNotice() {
	if (noticeTimer) clearTimeout(noticeTimer);
	noticeTimer = undefined;
	noticeKind = undefined;
}

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
	// Not getFollowMeSpeedKmh(): that is the median, which is the right number
	// to display and the wrong one to come off a pause with.
	speedPaused = decideSpeedGate(
		gateSpeedKmh(speedSamples, Date.now(), speedPaused),
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
		backoffUntil,
		minIntervalMs: resolveMinInterval(getConfig()?.followMe?.minScanIntervalSeconds)
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

function stopCompletionWatch() {
	if (completionTimer) clearTimeout(completionTimer);
	completionTimer = undefined;
}

/**
 * Wait for the scout queue to drain, then say so.
 *
 * The queue is shared, so a busy pool can hold it above zero past our own
 * scan - which only ever makes this report late, never early. If it has not
 * drained by COMPLETION_GIVE_UP_MS we say it is still running rather than
 * claim a finish we cannot see.
 */
function watchScanCompletion(points: number) {
	stopCompletionWatch();
	const startedAt = Date.now();

	const poll = async () => {
		if (!active) return;

		let queue: number | undefined;
		try {
			const response = await fetch("/api/follow-me", { headers: getHeaders() });
			const data = await parseResponse<{ result?: { queue: number } }>(response);
			queue = data.result?.queue;
		} catch {
			// leave it undefined and let the give-up clock decide
		}

		if (!active) return;

		if (queue === 0) {
			if (status === "scanning") status = "idle";
			openToast(m.followme_toast_done({ count: points }));
			completionTimer = undefined;
			return;
		}

		if (Date.now() - startedAt >= COMPLETION_GIVE_UP_MS) {
			if (status === "scanning") status = "idle";
			openToast(m.followme_toast_slow(), TOAST_EXPLAIN_MS);
			completionTimer = undefined;
			return;
		}

		completionTimer = setTimeout(() => void poll(), COMPLETION_POLL_MS);
	};

	completionTimer = setTimeout(() => void poll(), COMPLETION_POLL_MS);
}

async function requestScan(center: Coords): Promise<void> {
	const encoded = encodeRequestBody(center.internal());
	const response = await fetch("/api/follow-me", {
		method: "POST",
		body: encoded.body,
		headers: getHeaders(encoded.contentType)
	});
	if (response.status === 401) {
		// Signed out, or the entitlement went away: retrying every minute would
		// achieve nothing.
		stopFollowMe();
		return;
	}

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
		persistSession();

		// Status stays "scanning" until the queue has actually worked through
		// it - queueing is instant, the scan is not, and a tester could not tell
		// whether a scan with no visible spawns had finished or failed.
		const points = data.result.locations ?? 0;
		openToast(m.followme_toast_scanned({ count: points }));
		watchScanCompletion(points);
		return;
	}

	// Every refusal has to change something, or shouldScan() stays true and the
	// next tick asks again five seconds later - which is what left the menu
	// flipping between "scanning" and the refusal during beta.
	if (data.result.status === "covered") {
		// Nothing here will change until they leave the area, and the whole
		// point is that this ground is already scanned. Stop rather than idle.
		stopFollowMe();
		// Both: the toast catches them if the menu is shut, the notice is still
		// there when they open it to find out what happened.
		showCoveredNotice();
		openToast(m.followme_covered_title(), TOAST_EXPLAIN_MS);
		return;
	}

	if (data.result.status === "quota") {
		stopFollowMe();
		openToast(m.followme_stopped_quota(), TOAST_EXPLAIN_MS);
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
		openToast(stopReason, TOAST_EXPLAIN_MS);
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
		// "scanning" belongs to the completion watcher until it resolves.
		if (status === "locating") status = "idle";
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

function persistSession() {
	if (!active) return;
	try {
		localStorage.setItem(
			STORAGE_KEY,
			JSON.stringify({
				startedAt,
				lastScanAt,
				lastScanCenter: lastScanCenter?.internal(),
				scanCount
			})
		);
	} catch {
		// private mode or a full quota: the session just will not survive a reload
	}
}

function clearPersistedSession() {
	try {
		localStorage.removeItem(STORAGE_KEY);
	} catch {
		// nothing to do
	}
}

/**
 * Pick a session back up after a page load, if its own timeouts say it should
 * still be running. Called once from the map chip, which is always mounted.
 */
export function restoreFollowMe() {
	if (restoreAttempted || active) return;
	restoreAttempted = true;

	let saved:
		| { startedAt: number; lastScanAt: number; lastScanCenter?: LatLon; scanCount: number }
		| undefined;
	try {
		const raw = localStorage.getItem(STORAGE_KEY);
		saved = raw ? JSON.parse(raw) : undefined;
	} catch {
		return;
	}
	if (!saved) return;

	const resumable = shouldResumeSession(saved, Date.now(), {
		sessionMs: FOLLOW_ME_SESSION_TIMEOUT_MS,
		idleMs: FOLLOW_ME_IDLE_TIMEOUT_MS
	});
	if (!resumable) {
		clearPersistedSession();
		return;
	}

	startFollowMe();

	// Carry the original session's clock and history over, so a reload does not
	// hand the user a fresh hour or reset the count they were watching.
	startedAt = saved.startedAt;
	lastScanAt = saved.lastScanAt;
	lastScanCenter = saved.lastScanCenter
		? new Coords(saved.lastScanCenter.lat, saved.lastScanCenter.lon)
		: undefined;
	scanCount = saved.scanCount ?? 0;
	persistSession();
}

/**
 * Put the camera back on the user after a pan dropped it. Wired to the chip,
 * which is the only control on screen while every menu is closed.
 */
export function recenterFollowMe() {
	if (!active) return;
	startCameraFollow(getMap());
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
	clearNotice();

	ensureLocationWatch(getMap());

	// Switching the feature on is a request to be followed: the whole point is
	// that you are moving, and a map centred where you set off is no use. A pan
	// drops it again, and the chip puts it back.
	pinLocationWatch(true);
	startCameraFollow(getMap());

	document.addEventListener("visibilitychange", onVisibilityChange);
	unsubscribeLocation = onLocationUpdate(onFix);
	persistSession();
	void runTick();
}

export function stopFollowMe() {
	if (!active) return;

	active = false;
	status = "off";
	clearPersistedSession();

	if (timer) clearTimeout(timer);
	timer = undefined;
	nextWakeAt = 0;
	stopCompletionWatch();

	// The camera is left as it is on purpose. Switching the scanner off is not a
	// request to have the map yanked away from wherever you were looking; the
	// locate button owns it from here.
	pinLocationWatch(false);
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
