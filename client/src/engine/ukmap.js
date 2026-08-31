// The map behind the city picker: a coarse Great Britain coastline and the
// projection that turns geographic coordinates into SVG units.
//
// Kept as plain JS (not inside the JSX component) so the geometry is unit
// testable — a projection that is subtly wrong doesn't crash, it just quietly
// drops Edinburgh in the North Sea.

// A coarse Great Britain coastline as [lon, lat]. Stored in geographic
// coordinates, not SVG units, so the outline and the city pins go through the
// same projection and therefore always line up.
export const COASTLINE = [
  // West coast, south to north: Land's End up around Cornwall and the Bristol
  // Channel, along Wales, the north-west, and up through Scotland.
  [-5.72, 50.07], [-5.5, 50.35], [-5.0, 50.55], [-4.55, 50.8], [-4.2, 51.0],
  [-4.2, 51.2], [-3.6, 51.22], [-3.0, 51.32], [-2.5, 51.5], [-2.7, 51.58],
  [-3.2, 51.5], [-3.94, 51.62], [-4.3, 51.68], [-5.1, 51.7], [-5.3, 51.88],
  [-4.9, 52.05], [-4.4, 52.25], [-4.05, 52.42], [-4.1, 52.75], [-4.75, 52.8],
  [-4.35, 52.95], [-4.2, 53.1], [-4.0, 53.3], [-3.5, 53.35], [-3.05, 53.3],
  [-3.1, 53.45], [-3.05, 53.75], [-2.95, 54.0], [-3.15, 54.1], [-3.6, 54.2],
  [-3.5, 54.45], [-3.4, 54.75], [-3.55, 54.95], [-4.3, 54.87], [-4.9, 54.65],
  [-5.05, 54.9], [-4.75, 55.25], [-4.9, 55.45], [-5.0, 55.7], [-5.2, 55.95],
  [-5.35, 56.25], [-5.6, 56.45], [-5.5, 56.7], [-5.9, 56.85], [-5.55, 57.1],
  [-5.75, 57.35], [-5.45, 57.55], [-5.35, 57.85], [-5.15, 58.0], [-5.1, 58.25],
  [-4.95, 58.45], [-5.0, 58.62],
  // The north coast, west to east.
  [-4.4, 58.55], [-3.85, 58.57], [-3.35, 58.63], [-3.02, 58.64],
  // East coast, north to south: down Scotland, over the border, along the
  // Yorkshire and East Anglian coasts to the Thames.
  [-3.05, 58.45], [-3.35, 58.28], [-3.9, 57.95], [-4.05, 57.85], [-4.3, 57.68],
  [-3.9, 57.7], [-3.5, 57.7], [-2.95, 57.7], [-2.05, 57.7], [-1.78, 57.5],
  [-2.08, 57.15], [-2.35, 56.8], [-2.5, 56.6], [-2.85, 56.45], [-2.6, 56.28],
  [-3.15, 56.05], [-2.6, 56.0], [-2.15, 55.9], [-1.9, 55.75], [-1.6, 55.35],
  [-1.4, 55.0], [-1.35, 54.85], [-1.2, 54.7], [-1.05, 54.55], [-0.55, 54.45],
  [-0.35, 54.28], [-0.1, 54.1], [-0.05, 53.9], [-0.25, 53.72], [0.1, 53.63],
  [0.2, 53.45], [0.35, 53.0], [0.15, 52.9], [0.5, 52.93], [0.9, 52.97],
  [1.3, 52.93], [1.72, 52.68], [1.6, 52.35], [1.35, 52.05], [1.0, 51.85],
  [0.75, 51.55],
  // The south coast, east to west, back to Land's End.
  [1.05, 51.4], [1.42, 51.38], [1.38, 51.15], [0.95, 50.92], [0.55, 50.85],
  [0.0, 50.78], [-0.75, 50.78], [-1.1, 50.72], [-1.75, 50.72], [-2.05, 50.6],
  [-2.45, 50.57], [-3.0, 50.68], [-3.4, 50.62], [-3.55, 50.45], [-4.15, 50.35],
  [-4.75, 50.25], [-5.05, 50.15], [-5.55, 50.05],
];


// Equirectangular projection with a cos(lat) correction so the island isn't
// stretched sideways. Fixed bounds keep the map stable whatever the corpus is.
export const LON_MIN = -6.2;
export const LON_MAX = 2.0;
export const LAT_MIN = 49.9;
export const LAT_MAX = 58.8;
const K = Math.cos(((LAT_MIN + LAT_MAX) / 2) * (Math.PI / 180));
export const VIEW_W = 200;
export const VIEW_H = Math.round((VIEW_W * (LAT_MAX - LAT_MIN)) / ((LON_MAX - LON_MIN) * K));

export const project = (lon, lat) => [
  ((lon - LON_MIN) / (LON_MAX - LON_MIN)) * VIEW_W,
  ((LAT_MAX - lat) / (LAT_MAX - LAT_MIN)) * VIEW_H,
];

export const COAST_PATH = `${COASTLINE.map((c, i) => {
  const [x, y] = project(c[0], c[1]);
  return `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`;
}).join('')}Z`;
