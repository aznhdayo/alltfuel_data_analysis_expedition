/* -------------------------------------------------------
   PARKS + WAYPOINTS DATA
------------------------------------------------------- */
async function getParksData() {
  const ParksData = Parse.Object.extend("ParksData");
  const query = new Parse.Query(ParksData);
  query.limit(1000);

  const results = await query.find();

  return results.map(park => ({
    parkID:      park.id,
    name:        park.get("name"),
    description: park.get("description"),
    address:     park.get("address"),
    image:       park.get("image"),
    location:    park.get("location"),
    boundary:    park.get("boundary")
  }));
}

function parksToGeoJSON(parks) {
  return {
    type: "FeatureCollection",
    features: parks.map(park => {
      let geometry;
      let boundary = park.boundary;

      // Parse boundary if stored as string
      if (typeof boundary === "string") {
        try { boundary = JSON.parse(boundary); } catch (e) {}
      }

      // Polygon
      if (Array.isArray(boundary) && boundary.length > 0) {
        const coords = boundary.map(p => [Number(p[0]), Number(p[1])]);

        // Close polygon if needed
        const first = coords[0];
        const last = coords[coords.length - 1];
        if (first[0] !== last[0] || first[1] !== last[1]) {
          coords.push([first[0], first[1]]);
        }

        geometry = { type: "Polygon", coordinates: [coords] };
      }

      // Point fallback
      else if (
        park.location &&
        typeof park.location.longitude === "number" &&
        typeof park.location.latitude === "number"
      ) {
        geometry = {
          type: "Point",
          coordinates: [park.location.longitude, park.location.latitude]
        };
      }

      if (!geometry) return null;

      return {
        type: "Feature",
        geometry,
        properties: {
          parkID: park.parkID,
          name: park.name,
          description: park.description,
          address: park.address,
          image: park.image
        }
      };
    }).filter(f => f)
  };
}

// PakDropdown list
function populateParkDropdown(parks) {
  const dropdown = document.getElementById("parkDropdown");
  dropdown.innerHTML = `<option value="">Select a park...</option>`;

  parks.forEach(p => {
    const opt = document.createElement("option");
    opt.value = p.parkID;
    opt.textContent = p.name;
    dropdown.appendChild(opt);
  });
}

function popupHTML(props) {
  const title = props.name || 'Park';
  const desc = props.description ? `<p class="popup-text">${props.description}</p>` : '';
  const addr = props.address ? `<p class="popup-address">${props.address}</p>` : '';
  const img = props.image ? `<img src="${props.image}" class="popup-img">` : '';

  return `<h3 class="popup-title">${title}</h3>${desc}${addr}${img}`;
}



/* -------------------------------------------------------
   MAP INITIALIZATION
------------------------------------------------------- */
let map = null;
let parksGeoJSON = null;

async function initializeMapAndData() {
  if (map) return;

  map = new mapboxgl.Map({
    container: "map",
    style: "mapbox://styles/mapbox/streets-v11",
    center: [-121.1575, 38.6770],
    zoom: 12
  });

  /* MAP CONTROLS */
  zoomInBtn.onclick     = () => map.zoomIn();
  zoomOutBtn.onclick    = () => map.zoomOut();
  satelliteBtn.onclick  = () => map.setStyle("mapbox://styles/mapbox/satellite-streets-v12");
  lightBtn.onclick      = () => map.setStyle("mapbox://styles/mapbox/streets-v11");

  /* LOAD PARK DATA */
  const parks = await getParksData();
  parksGeoJSON = parksToGeoJSON(parks);
  populateParkDropdown(parks);


/* -------------------------------------------------------
   PARK DROPDOWN LISTENER
------------------------------------------------------- */
document.getElementById("parkDropdown").addEventListener("change", (e) => {
  console.log("Selected parkID:", e.target.value);
  const id = e.target.value;
  if (!id) return;

  const feature = parksGeoJSON.features.find(f => f.properties.parkID === id);
  if (!feature) return;

  if (feature.geometry.type === "Point") {
    map.flyTo({ center: feature.geometry.coordinates, zoom: 15 });
  } else {
    const bounds = new mapboxgl.LngLatBounds();
    feature.geometry.coordinates[0].forEach(c => bounds.extend(c));
    map.fitBounds(bounds, { padding: 40 });
  }

  new mapboxgl.Popup()
    .setLngLat(
      feature.geometry.type === "Point"
        ? feature.geometry.coordinates
        : feature.geometry.coordinates[0][0]
    )
    .setHTML(popupHTML(feature.properties))
    .addTo(map);
});


  map.on("load", () => {
    map.addSource("parks", { type: "geojson", data: parksGeoJSON });

    /* POLYGON FILL */
    map.addLayer({
      id: "parks-fill",
      type: "fill",
      source: "parks",
      filter: ["==", "$type", "Polygon"],
      paint: {
        "fill-color": "#088",
        "fill-opacity": 0.35
      }
    });

    /* POLYGON OUTLINE */
    map.addLayer({
      id: "parks-outline",
      type: "line",
      source: "parks",
      filter: ["==", "$type", "Polygon"],
      paint: {
        "line-color": "#000",
        "line-width": 2
      }
    });

    /* POINTS */
    map.addLayer({
      id: "parks-points",
      type: "circle",
      source: "parks",
      filter: ["==", "$type", "Point"],
      paint: {
        "circle-radius": 6,
        "circle-color": "#007cbf"
      }
    });

    /* POLYGON CLICK */
    map.on("click", "parks-fill", async (e) => {
      const feature = e.features[0];
      const props = feature.properties;

      const bounds = new mapboxgl.LngLatBounds();
      feature.geometry.coordinates[0].forEach(c => bounds.extend(c));

      map.fitBounds(bounds, { padding: 40, duration: 800 });

      new mapboxgl.Popup()
        .setLngLat(e.lngLat)
        .setHTML(popupHTML(props))
        .addTo(map);

      await loadWaypointsForPark(props.parkID);
    });

    /* POINT CLICK */
    map.on("click", "parks-points", async (e) => {
      const feature = e.features[0];
      const props = feature.properties;

      map.flyTo({ center: feature.geometry.coordinates, zoom: 15 });

      new mapboxgl.Popup()
        .setLngLat(feature.geometry.coordinates)
        .setHTML(popupHTML(props))
        .addTo(map);

      await loadWaypointsForPark(props.parkID);
    });

    /* FIT MAP TO ALL PARKS */
    const initialBounds = new mapboxgl.LngLatBounds();

    parksGeoJSON.features.forEach(f => {
      if (f.geometry.type === "Point") {
        initialBounds.extend(f.geometry.coordinates);
      } else {
        f.geometry.coordinates[0].forEach(c => initialBounds.extend(c));
      }
    });

    if (!initialBounds.isEmpty()) {
      map.fitBounds(initialBounds, { padding: 40, duration: 800 });
    }
  });
  

}
