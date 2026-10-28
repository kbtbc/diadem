import { rangeDistanceMeters } from "@/lib/utils/rangeGeometry";

/** Fixes vaguer than this say nothing useful about speed. */
export const SPEED_ACCURACY_LIMIT_METERS = 50;

export type SpeedFix = {
	lat: number;
	lng: number;
	/** Epoch milliseconds. */
	timestamp: number;
	/** Reported horizontal accuracy in metres. */
	accuracy: number;
};

export function isUsableFix(accuracy: number): boolean {
	return Number.isFinite(accuracy) && accuracy <= SPEED_ACCURACY_LIMIT_METERS;
}

/**
 * Ground speed in metres per second between two fixes, or undefined when they
 * cannot support a figure.
 *
 * Standing still under a jittery fix looks like walking, and during beta a
 * forty-foot walk past buildings read as fast enough to trip the 10 km/h gate.
 * Anything inside the combined error of the two fixes is noise, so it is
 * subtracted rather than reported as speed - which biases the result low, the
 * safe direction for a gate that pauses the feature.
 */
export function speedFromFixes(previous: SpeedFix, current: SpeedFix): number | undefined {
	if (!isUsableFix(previous.accuracy) || !isUsableFix(current.accuracy)) return undefined;

	const elapsedSeconds = (current.timestamp - previous.timestamp) / 1000;
	if (!(elapsedSeconds > 0)) return undefined;

	const moved = rangeDistanceMeters([previous.lng, previous.lat], [current.lng, current.lat]);

	const noiseFloor = (previous.accuracy + current.accuracy) / 2;
	if (moved <= noiseFloor) return 0;

	return (moved - noiseFloor) / elapsedSeconds;
}
