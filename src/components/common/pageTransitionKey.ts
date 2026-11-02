/**
 * Layer identity for a location. Entries created outside the router (typing a URL,
 * `location.hash = …`, bookmarks) have no history state, so React Router gives them
 * all the key `"default"`; fold the pathname in so two such pages never collide.
 */
export const layerKeyFor = (location: { key: string; pathname: string }): string =>
  location.key === 'default' ? `default:${location.pathname}` : location.key;
