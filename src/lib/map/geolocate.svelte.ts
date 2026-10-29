import { getMap } from "@/lib/map/map.svelte";
import { isNative } from "@/lib/native/runtime";
import * as m from "@/lib/paraglide/messages";
import { openToast } from "@/lib/ui/toasts.svelte.js";
import { round } from "@/lib/utils/numberFormat";
import { isUsableFix, speedFromFixes, type SpeedFix } from "@/lib/utils/fixSpeed";
import { distance } from "@turf/turf";
import type * as maplibre from "maplibre-gl";

type Location = {
	lat: number;
	lng: number;
	heading: number | undefined;
	/** Ground speed in metres per second, or undefined before a second fix. */
	speed: number | undefined;
	/** Fix time in epoch milliseconds. */
	timestamp: number;
};

let geolocationEnabled: boolean = $state(false);
let isFetchingLocation: boolean = $state(false);
let isLocateFollowing: boolean = $state(false);
let currentLocation: Location | undefined = $state(undefined);
let watchId: number | undefined = undefined;
let animationFrame: number | undefined = undefined;
let shouldUpdateLocation = false;
let shouldUpdateCamera = false;
let previousFix: SpeedFix | undefined = undefined;
let watchPinned = false;
let dragFrom: maplibre.LngLat | undefined = undefined;

/**
 * How far a drag has to carry the map before it counts as "I want to look over
 * there" rather than a thumb brushing the screen. A phone in a car mount picks
 * up small drags all the time, and detaching on any of them left the camera
 * silently unhooked until the chip was tapped.
 */
const detachDragPixels = 60;

const minZoom = 14.5;
const maxZoom = 17.5;
const locationAnimationDuration = 1000;
const minLocationUpdateDistanceMeters = 2;

const locationListeners = new Set<(moved: boolean) => void>();

/**
 * Notified on every accepted fix, with whether it actually moved the user.
 *
 * Consumers need both: a mover lets a sleeping poller wake early, and a fix
 * that did not move still carries a fresh speed, which is the only way a
 * standing-still user's speed estimate ever comes back down.
 * Returns an unsubscribe function.
 */
export function onLocationUpdate(listener: (moved: boolean) => void) {
	locationListeners.add(listener);
	return () => locationListeners.delete(listener);
}

function notifyLocationListeners(moved: boolean) {
	for (const listener of locationListeners) listener(moved);
}

export function getIsGeolocationEnabled() {
	return geolocationEnabled;
}

export function getIsFetchingLocation() {
	return isFetchingLocation;
}

export function getCurrentLocation() {
	return currentLocation;
}

export function getIsLocateFollowing() {
	return isLocateFollowing;
}

export function setIsLocateFollowing(state: boolean) {
	isLocateFollowing = state;
}

/**
 * Whether the camera is actually chasing the user.
 *
 * Both flags, because panning needs both. Reporting only isLocateFollowing is
 * what let the chip say "Following" through a whole drive while the camera sat
 * still: shouldUpdateCamera was false, so the panTo never ran.
 */
export function getIsCameraFollowing() {
	return isLocateFollowing && shouldUpdateCamera;
}

/**
 * Keep the position watch alive through resetLocate().
 *
 * The locate button's second tap is resetLocate(), which tears down the watch
 * along with the camera. Follow-me needs the fix stream whatever the camera is
 * doing, so while it is running the teardown stops at the camera.
 */
export function pinLocationWatch(pinned: boolean) {
	watchPinned = pinned;
}

/**
 * Have the camera follow the user, and let go the moment they take hold of the
 * map themselves.
 *
 * Fighting someone who is trying to look two streets over is worse than not
 * following at all, so a drag always wins; the chip re-engages. Zoom is left
 * alone - pinching to see more of the area around you is not a request to stop
 * following. The dragstart hook is what the commented-out line in
 * animateLocation was reaching for.
 */
export function startCameraFollow(map: maplibre.Map | undefined) {
	isLocateFollowing = true;

	// Set here rather than waiting for flyToLocation to report back. The old
	// moveend handshake could never complete - see flyToLocation - and until it
	// did, every fix skipped the panTo.
	shouldUpdateCamera = true;

	// With no fix yet there is nothing to fly to: the first one takes itself
	// there, because the camera is following by then.
	if (map && currentLocation) flyToLocation(map, currentLocation);
}

/**
 * The map's own drag events, routed through here so that one rule decides
 * whether a drag meant "stop following me".
 *
 * It used to be decided in two places at once. events.ts cleared the follow
 * flag on every dragstart with no threshold and no questions asked, which is
 * fine for someone panning at a desk and useless in a moving car: a thumb
 * brushing the screen, or inertia on a bump, silently unhooked the camera and
 * only a chip tap brought it back.
 */
export function noteMapDragStart() {
	dragFrom = getMap()?.getCenter();
}

export function noteMapDragEnd() {
	const map = getMap();
	const from = dragFrom;
	dragFrom = undefined;
	if (!map || !from) return;

	const start = map.project(from);
	const end = map.project(map.getCenter());
	if (Math.hypot(start.x - end.x, start.y - end.y) >= detachDragPixels) {
		stopCameraFollow();
	}
}

export function stopCameraFollow() {
	isLocateFollowing = false;
	shouldUpdateCamera = false;
	dragFrom = undefined;
}

export function resetLocate() {
	getMap()?.stop();
	stopCameraFollow();

	// Follow-me is still running and still needs the fixes, so the teardown
	// stops at the camera. Without this, a second tap of the locate button left
	// the feature on with no location to scan around.
	if (watchPinned) return;

	shouldUpdateLocation = false;

	if (watchId !== undefined) {
		navigator.geolocation.clearWatch(watchId);
	}

	if (animationFrame !== undefined) {
		window.cancelAnimationFrame(animationFrame);
		animationFrame = undefined;
	}

	isFetchingLocation = false;
	currentLocation = undefined;
	previousFix = undefined;
	watchId = undefined;
}

function animateLocation(location: Location, map: maplibre.Map | undefined) {
	if (animationFrame !== undefined) {
		window.cancelAnimationFrame(animationFrame);
	}

	if (!currentLocation) currentLocation = location;

	const startLocation = currentLocation;
	const startTime = performance.now();
	if (isLocateFollowing && map && shouldUpdateCamera) {
		map.panTo([location.lng, location.lat], {
			duration: locationAnimationDuration
		});
	}

	function animateFrame(now: number) {
		const progress = Math.min((now - startTime) / locationAnimationDuration, 1);
		const easedProgress = 1 - Math.pow(1 - progress, 3);

		currentLocation = {
			lng: startLocation.lng + (location.lng - startLocation.lng) * easedProgress,
			lat: startLocation.lat + (location.lat - startLocation.lat) * easedProgress,
			heading: location.heading,
			speed: location.speed,
			timestamp: location.timestamp
		};

		if (progress < 1) {
			animationFrame = window.requestAnimationFrame(animateFrame);
		} else {
			animationFrame = undefined;
		}
	}

	animationFrame = window.requestAnimationFrame(animateFrame);
}

function getContinuousHeading(heading: number) {
	if (currentLocation?.heading === undefined) return heading;

	const normalizedHeading = heading % 360;
	const currentNormalizedHeading = currentLocation.heading % 360;
	const delta = ((normalizedHeading - currentNormalizedHeading + 540) % 360) - 180;

	return currentLocation.heading + delta;
}

function flyToLocation(map: maplibre.Map, location: Location) {
	let zoom = map.getZoom();
	if (zoom < minZoom - 1) {
		zoom = minZoom;
	} else if (zoom > maxZoom) {
		zoom = maxZoom;
	}

	// This used to wait for a moveend tagged "locate" before letting fixes pan
	// the camera. A once() handler is spent by whichever moveend arrives first,
	// so any unrelated camera movement finishing ahead of the flyTo consumed it
	// and nothing ever set the flag again; a flyTo to where the map already sits
	// may not fire moveend at all. Either way the camera never followed. The
	// handshake only ever bought not being nudged mid-flight by an incoming fix,
	// which is invisible when both are heading to the same place.
	shouldUpdateCamera = true;
	map.flyTo(
		{
			center: [location.lng, location.lat],
			zoom,
			speed: 1.6,
			curve: 1
		},
		{ data: "locate" }
	);
}

function handleGeolocationError(e: GeolocationPositionError) {
	if (e.code === 1) {
		openToast(m.locate_error_perms());
	} else if (e.code === 2 || e.code === 3) {
		openToast(m.locate_error_timeout());
	} else {
		openToast(m.locate_error_unknown());
	}

	geolocationEnabled = false;
	currentLocation = undefined;
	previousFix = undefined;
}

export async function updateGeolocationEnabled(showResult: boolean = false) {
	let errorReason = "";
	let geolocationOk: boolean = false;

	if (!window.navigator.permissions) {
		geolocationOk = !!window.navigator.geolocation;
		if (!geolocationOk) errorReason = m.locate_error_support();
	} else {
		try {
			const permsState = (await window.navigator.permissions.query({ name: "geolocation" })).state;
			geolocationOk = permsState !== "denied";
			if (!geolocationOk) errorReason = m.locate_error_perms();
		} catch {
			// Fix for iOS16 which rejects query but still supports geolocation
			geolocationOk = !!window.navigator.geolocation;
			if (!geolocationOk) errorReason = m.locate_error_support();
		}
	}

	geolocationEnabled = geolocationOk;
	if (!geolocationOk && showResult && errorReason) {
		openToast(errorReason);
	}
	return geolocationOk;
}

/**
 * Ground speed in metres per second. Devices that report coords.speed are
 * trusted; the rest get it from the displacement since the previous fix, which
 * is all the follow-me speed gate needs. Smoothing and the threshold itself
 * live in followMe.svelte.ts - this only reports what the fix says.
 */
function readSpeed(
	position: GeolocationPosition,
	coords: { lat: number; lng: number }
): number | undefined {
	const accuracy = position.coords.accuracy;

	// A vague fix is not evidence of movement, and keeping it as the baseline
	// would make the next displacement look like a sprint. Drop it entirely and
	// measure from the last fix worth trusting.
	if (!isUsableFix(accuracy)) return undefined;

	const previous = previousFix;
	const current: SpeedFix = { ...coords, timestamp: position.timestamp, accuracy };
	previousFix = current;

	const reported = position.coords.speed;
	if (reported !== null && Number.isFinite(reported) && reported >= 0) return reported;
	if (!previous) return undefined;

	return speedFromFixes(previous, current);
}

function handleGeolocationPosition(s: GeolocationPosition, map: maplibre.Map | undefined) {
	if (!shouldUpdateLocation) return;

	const hadLocation = !!currentLocation;
	let heading = currentLocation?.heading;
	let shouldMove = true;
	const locationCoords = {
		lng: round(s.coords.longitude, 6),
		lat: round(s.coords.latitude, 6)
	};

	if (currentLocation) {
		const distanceMeters = distance(
			[currentLocation.lng, currentLocation.lat],
			[locationCoords.lng, locationCoords.lat],
			{ units: "meters" }
		);
		shouldMove = distanceMeters > minLocationUpdateDistanceMeters;
	}

	if (s.coords.heading !== null && Number.isFinite(s.coords.heading)) {
		heading = getContinuousHeading(s.coords.heading);
	} else if (shouldMove && currentLocation) {
		const fromLat = (currentLocation.lat * Math.PI) / 180;
		const toLat = (locationCoords.lat * Math.PI) / 180;
		const lngDelta = ((locationCoords.lng - currentLocation.lng) * Math.PI) / 180;
		const y = Math.sin(lngDelta) * Math.cos(toLat);
		const x =
			Math.cos(fromLat) * Math.sin(toLat) -
			Math.sin(fromLat) * Math.cos(toLat) * Math.cos(lngDelta);

		heading = getContinuousHeading((Math.atan2(y, x) * 180) / Math.PI + 360);
	}

	const location: Location = {
		...locationCoords,
		heading,
		speed: readSpeed(s, locationCoords),
		timestamp: s.timestamp
	};

	isFetchingLocation = false;
	geolocationEnabled = true;

	if (!hadLocation) {
		currentLocation = location;
		if (isLocateFollowing && map) {
			flyToLocation(map, location);
		}
		notifyLocationListeners(true);
		return;
	}

	if (shouldMove) {
		animateLocation(location, map);
		notifyLocationListeners(true);
	} else {
		if (currentLocation && currentLocation.heading !== heading) {
			currentLocation.heading = heading;
		}
		// Standing still still produces fixes, and their speed is the only way
		// an estimate left high by the last drive ever comes back down.
		if (currentLocation) {
			currentLocation.speed = location.speed;
			currentLocation.timestamp = location.timestamp;
		}
		notifyLocationListeners(false);
	}
}

/**
 * Make sure a position watch is running, without touching camera follow.
 *
 * updateLocation() is the locate button: called again while watching it toggles
 * the watch off. Follow-me needs a live fix stream and must not cancel the
 * user's watch, so it comes in here instead. Whether the camera then follows is
 * the caller's business, not this function's - startCameraFollow() is its own
 * step, and follow-me takes it.
 */
export function ensureLocationWatch(map: maplibre.Map | undefined) {
	if (watchId !== undefined || isFetchingLocation) return;

	const wasFollowing = isLocateFollowing;
	beginLocate(map, true);
	isLocateFollowing = wasFollowing;
}

export function updateLocation(map: maplibre.Map | undefined, allowFollow: boolean) {
	if (allowFollow && watchId !== undefined) {
		// A lock: tap to have the map follow you, tap again to stop. Asking
		// getIsCameraFollowing rather than the raw flag means a tap after a pan
		// re-engages the camera instead of tearing the whole watch down.
		if (getIsCameraFollowing()) {
			resetLocate();
			return;
		}

		startCameraFollow(map);
		return;
	}

	if (isNative()) {
		void nativeLocationHandler(map, allowFollow);
		return;
	}

	beginLocate(map, allowFollow);
}

async function nativeLocationHandler(map: maplibre.Map | undefined, allowFollow: boolean) {
	// no-gms builds should use the web api
	if (import.meta.env.VITE_NO_GMS) {
		beginLocate(map, allowFollow);
		return;
	}
	try {
		const { Geolocation } = await import("@capacitor/geolocation");
		let status = await Geolocation.checkPermissions();
		if (status.location !== "granted" && status.coarseLocation !== "granted") {
			status = await Geolocation.requestPermissions();
		}
		const granted = status.location === "granted" || status.coarseLocation === "granted";
		if (granted) {
			beginLocate(map, allowFollow);
		} else {
			geolocationEnabled = false;
			openToast(m.locate_error_perms());
		}
	} catch (e) {
		console.error("Failed to request native location permission", e);
		geolocationEnabled = false;
		openToast(m.locate_error_support());
	}
}

function beginLocate(map: maplibre.Map | undefined, allowFollow: boolean) {
	if (!navigator.geolocation) {
		geolocationEnabled = false;
		openToast(m.locate_error_support());
		return;
	}

	isFetchingLocation = true;
	shouldUpdateLocation = true;

	if (allowFollow) {
		isLocateFollowing = true;
		watchId = navigator.geolocation.watchPosition(
			(s) => handleGeolocationPosition(s, map),
			(e) => {
				handleGeolocationError(e);
				resetLocate();
			},
			{
				enableHighAccuracy: true,
				maximumAge: 1000,
				timeout: 10000
			}
		);
	} else {
		navigator.geolocation.getCurrentPosition(
			(s) => {
				handleGeolocationPosition(s, map);
				if (map && currentLocation) flyToLocation(map, currentLocation);
				shouldUpdateLocation = watchId !== undefined;
			},
			(e) => {
				handleGeolocationError(e);
				isFetchingLocation = false;
				shouldUpdateLocation = watchId !== undefined;
			},
			{
				enableHighAccuracy: true,
				maximumAge: 1000,
				timeout: 10000
			}
		);
	}
}
