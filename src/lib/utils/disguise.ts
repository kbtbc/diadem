/**
 * A Pokémon is disguised (a Ditto) when the species it is shown as differs from the
 * real one. Golbat also fills the display fields for a Minior whose core colour was
 * derived (display = Minior / Meteor), which is the same species, so it is not a disguise.
 */
export function isDisguised(data: {
	pokemon_id?: number | null | undefined;
	display_pokemon_id?: number | null | undefined;
}) {
	return Boolean(data.display_pokemon_id) && data.display_pokemon_id !== data.pokemon_id;
}
