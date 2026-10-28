import { readFileSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import * as constants from "@/lib/constants";
import { RADIUS_POKEMON } from "@/lib/constants";
import { Coords } from "@/lib/utils/coordinates";
import {
	rangeDestination,
	rangeDistanceMeters,
	type RangePosition
} from "@/lib/utils/rangeGeometry";
import {
	getHex7Coords,
	HEX7_CLUSTER_BEARING,
	HEX7_CLUSTER_METERS,
	HEX7_COVERED_RADIUS_METERS,
	HEX7_POINT_COUNT,
	HEX_RING_METERS
} from "./hexGeometry";

const sourceRoot = path.resolve(import.meta.dirname, "../../..");

/**
 * Same extraction harness as rangeCallers.test.ts: run the real declaration
 * without booting Svelte runes, so the drift guard below compares against the
 * live getCoords() rather than a copy of it.
 */
function producer(file: string, name: string, dependencies: Record<string, unknown>) {
	const contents = readFileSync(path.join(sourceRoot, file), "utf8");
	const ast = ts.createSourceFile(file + ".ts", contents, ts.ScriptTarget.Latest, true);
	let expression: string | undefined;
	for (const statement of ast.statements) {
		if (ts.isFunctionDeclaration(statement) && statement.name?.text === name) {
			expression = statement.getText(ast).replace(/^export\s+/, "");
		}
	}
	if (!expression) throw new Error("Missing producer " + file + ":" + name);
	const compiled = ts.transpileModule("return (" + expression + ");", {
		compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None }
	}).outputText;
	return new Function(...Object.keys(dependencies), compiled)(...Object.values(dependencies));
}

/** Louisiana, mid-latitude, and far north - the tiling must not shear. */
const latitudes = [30.45, 40, 61.2];
const longitude = -91.15;

function positions(lat: number): RangePosition[] {
	return getHex7Coords(new Coords(lat, longitude)).map((c) => c.geojson());
}

function isCovered(point: RangePosition, points: RangePosition[]) {
	return points.some((p) => rangeDistanceMeters(point, p) <= RADIUS_POKEMON);
}

describe("follow-me 7 x M hexagon geometry", () => {
	it("derives the cluster offset as sqrt(7) ring steps on a 19.1066 degree bearing", () => {
		expect(HEX_RING_METERS).toBeCloseTo(121.24, 2);
		expect(HEX7_CLUSTER_METERS).toBeCloseTo(HEX_RING_METERS * Math.sqrt(7), 9);
		expect(HEX7_CLUSTER_METERS).toBeCloseTo(320.77, 2);
		// RADIUS_POKEMON * sqrt(21), give or take the 1.732 truncation of sqrt(3)
		expect(HEX7_CLUSTER_METERS).toBeCloseTo(RADIUS_POKEMON * Math.sqrt(21), 1);
		expect(HEX7_CLUSTER_BEARING).toBeCloseTo(19.1066, 4);
	});

	it.each(latitudes)("places 49 distinct scout points at latitude %s", (lat) => {
		const points = positions(lat);
		expect(points).toHaveLength(HEX7_POINT_COUNT);

		let minSpacing = Infinity;
		for (let i = 0; i < points.length; i++) {
			for (let j = i + 1; j < points.length; j++) {
				minSpacing = Math.min(minSpacing, rangeDistanceMeters(points[i], points[j]));
			}
		}
		// No two points closer than a ring step means no duplicate, and so no
		// scout spent twice on the same circle.
		expect(minSpacing).toBeGreaterThan(HEX_RING_METERS - 0.1);
		expect(minSpacing).toBeLessThan(HEX_RING_METERS + 0.1);
	});

	it.each(latitudes)("keeps every M ring at one ring step from its centre, latitude %s", (lat) => {
		const points = positions(lat);
		for (let m = 0; m < 7; m++) {
			const cluster = points.slice(m * 7, m * 7 + 7);
			const centre = cluster[0];
			for (const point of cluster.slice(1)) {
				expect(rangeDistanceMeters(centre, point)).toBeCloseTo(HEX_RING_METERS, 2);
			}
			// Neighbouring ring points are 60 degrees apart, so their chord is
			// also one ring step - that is what makes the cover gapless.
			for (let i = 1; i <= 6; i++) {
				const next = cluster[(i % 6) + 1];
				expect(rangeDistanceMeters(cluster[i], next)).toBeCloseTo(HEX_RING_METERS, 1);
			}
		}
	});

	it.each(latitudes)("arranges the six outer M centres as a hexagon, latitude %s", (lat) => {
		const points = positions(lat);
		const origin = points[0];
		const clusterCentres = [1, 2, 3, 4, 5, 6].map((m) => points[m * 7]);

		for (const centre of clusterCentres) {
			expect(rangeDistanceMeters(origin, centre)).toBeCloseTo(HEX7_CLUSTER_METERS, 2);
		}
		for (let i = 0; i < 6; i++) {
			const next = clusterCentres[(i + 1) % 6];
			expect(rangeDistanceMeters(clusterCentres[i], next)).toBeCloseTo(HEX7_CLUSTER_METERS, 1);
		}
		for (let i = 0; i < 3; i++) {
			expect(rangeDistanceMeters(clusterCentres[i], clusterCentres[i + 3])).toBeCloseTo(
				HEX7_CLUSTER_METERS * 2,
				1
			);
		}
	});

	it.each(latitudes)("covers the inner disc with no gap, latitude %s", (lat) => {
		const centre: RangePosition = [longitude, lat];
		const points = positions(lat);
		const step = 5;
		const uncovered: number[] = [];

		for (let dx = -HEX7_COVERED_RADIUS_METERS; dx <= HEX7_COVERED_RADIUS_METERS; dx += step) {
			for (let dy = -HEX7_COVERED_RADIUS_METERS; dy <= HEX7_COVERED_RADIUS_METERS; dy += step) {
				const radius = Math.hypot(dx, dy);
				if (radius > HEX7_COVERED_RADIUS_METERS) continue;
				const bearing = (Math.atan2(dx, dy) * 180) / Math.PI;
				if (!isCovered(rangeDestination(centre, radius, bearing), points)) {
					uncovered.push(radius);
				}
			}
		}

		expect(uncovered).toEqual([]);
	});

	it("pins the covered radius from above - the first gap is just outside it", () => {
		const lat = 40;
		const centre: RangePosition = [longitude, lat];
		const points = positions(lat);
		let firstGap = Infinity;

		for (let radius = HEX7_COVERED_RADIUS_METERS; radius <= 420; radius += 1) {
			for (let bearing = 0; bearing < 360; bearing += 0.5) {
				if (!isCovered(rangeDestination(centre, radius, bearing), points)) {
					firstGap = Math.min(firstGap, radius);
				}
			}
			if (Number.isFinite(firstGap)) break;
		}

		// If this drifts far above HEX7_COVERED_RADIUS_METERS the constant has
		// gone stale and the refresh trigger is leaving coverage unused.
		expect(firstGap).toBeLessThan(HEX7_COVERED_RADIUS_METERS + 10);
	});

	it("reaches about 507 m at its widest", () => {
		const centre: RangePosition = [longitude, 40];
		const extent = Math.max(
			...positions(40).map((p) => rangeDistanceMeters(centre, p) + RADIUS_POKEMON)
		);
		expect(extent).toBeCloseTo(507.1, 0);
	});

	it("builds its M rings exactly as the scout menu does", () => {
		const getCoords = producer("lib/features/scout.svelte.ts", "getCoords", {
			rangeDestination,
			Coords,
			...constants
		}) as (center: Coords, size: 0 | 1 | 2) => Coords[];

		const centre = new Coords(40, longitude);
		const scoutM = getCoords(centre, 1);
		const hex7 = getHex7Coords(centre).slice(0, 7);

		expect(hex7.map((c) => c.internal())).toEqual(scoutM.map((c) => c.internal()));
	});
});
