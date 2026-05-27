// Shipping corridor status data.
// Hardcoded for now — structured so it's easy to wire to a live API later.
// Each corridor has SVG map coordinates for an 800×400 equirectangular projection:
//   x = (lon + 180) * 800 / 360
//   y = (90  - lat) * 400 / 180

export const corridorData = [
  {
    id:     'malacca',
    name:   'Strait of Malacca',
    status: 'OPEN',
    region: 'Southeast Asia',
    note:   'Normal traffic. Key chokepoint between Indian Ocean and South China Sea. ~100 000 vessels annually; no active disruptions.',
    // lon ≈ 103.5°E, lat ≈ 1°N
    coords: { x: 629, y: 196 },
  },
  {
    id:     'suez',
    name:   'Suez Canal',
    status: 'DISRUPTED',
    region: 'Northeast Africa / Red Sea',
    note:   'Ongoing Houthi attacks in the Red Sea forcing diversions via Cape of Good Hope. ~30 % of global container traffic rerouted. Transit risk elevated.',
    // lon ≈ 32.5°E, lat ≈ 30°N
    coords: { x: 472, y: 133 },
  },
  {
    id:     'panama',
    name:   'Panama Canal',
    status: 'OPEN',
    region: 'Central America',
    note:   'Operations normal after drought-era restrictions lifted. Water levels stable; transit times back to standard 8–10 h.',
    // lon ≈ -79.5°W, lat ≈ 9°N
    coords: { x: 223, y: 180 },
  },
  {
    id:     'scs',
    name:   'South China Sea (SLOC)',
    status: 'MONITORED',
    region: 'Southeast Asia',
    note:   'Elevated PLA-N activity and ongoing territorial disputes. Commercial shipping unaffected but closely watched. US and allied naval presence maintained.',
    // lon ≈ 115°E, lat ≈ 12°N
    coords: { x: 655, y: 173 },
  },
  {
    id:     'taiwan',
    name:   'Taiwan Strait',
    status: 'MONITORED',
    region: 'East Asia',
    note:   'Regular PLA exercises near the median line. Strait open to commercial traffic. Heightened US Seventh Fleet presence. Situation fluid.',
    // lon ≈ 120°E, lat ≈ 24°N
    coords: { x: 667, y: 147 },
  },
];

export const STATUS_META = {
  OPEN:      { label: 'Open',      dot: 'bg-emerald-400', text: 'text-emerald-400', ring: 'ring-emerald-500/30', border: 'border-emerald-700/50', badge: 'bg-emerald-500/15 text-emerald-300 border-emerald-600/40' },
  DISRUPTED: { label: 'Disrupted', dot: 'bg-amber-400',   text: 'text-amber-400',   ring: 'ring-amber-500/30',   border: 'border-amber-700/50',   badge: 'bg-amber-500/15   text-amber-300   border-amber-600/40'   },
  MONITORED: { label: 'Monitored', dot: 'bg-amber-400',   text: 'text-amber-400',   ring: 'ring-amber-500/30',   border: 'border-amber-700/50',   badge: 'bg-amber-500/15   text-amber-300   border-amber-600/40'   },
};
