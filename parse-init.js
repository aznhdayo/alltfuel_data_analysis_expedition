// MAPBOX — only configure when mapbox-gl is present on the page.
// Pages like us-data-analysis.html don't load mapbox-gl, so referencing
// `mapboxgl` unconditionally here would throw a ReferenceError and abort the
// script before Parse.initialize() runs (breaking every Back4App query).
if (typeof mapboxgl !== 'undefined') {
  mapboxgl.accessToken = 'pk.eyJ1IjoiYXpuaGRheW8iLCJhIjoiY21lMGV4eGQ4MDQ0NjJ4b2Z5c3k1bXA1cyJ9.3BOBrlkxGtNocfCYuWXUug';
}

// PARSE
Parse.initialize(
  "gbW0BkveFDrQJxbgGLqka2HeITel0qsXob9iFwI8",
  "o52J3Sy1bpGo7LH5LLYF0HiSRLl77ZvgDCrSBiu3"
);
Parse.serverURL = "https://parseapi.back4app.com/";
