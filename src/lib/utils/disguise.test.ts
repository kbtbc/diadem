import { describe, expect, test } from "vitest";
import { isDisguised } from "./disguise";

describe("isDisguised", () => {
	test("a Ditto shown as another species is disguised", () => {
		expect(isDisguised({ pokemon_id: 132, display_pokemon_id: 25 })).toBe(true);
	});

	test("a Minior with a derived core colour (display is Minior) is not", () => {
		expect(isDisguised({ pokemon_id: 774, display_pokemon_id: 774 })).toBe(false);
	});

	test("no display species is not disguised", () => {
		expect(isDisguised({ pokemon_id: 132 })).toBe(false);
		expect(isDisguised({ pokemon_id: 132, display_pokemon_id: null })).toBe(false);
		expect(isDisguised({ pokemon_id: 132, display_pokemon_id: 0 })).toBe(false);
	});
});
