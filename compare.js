
(() => {
  const form = document.getElementById("compareForm");
  const placeInput = document.getElementById("placeInput");
  const fuelSelect = document.getElementById("fuelSelect");
  const status = document.getElementById("compareStatus");
  const results = document.getElementById("compareResults");
  const geoButton = document.getElementById("geoButton");

  let userPosition = null;

  const DATA_API = "https://data.economie.gouv.fr/api/explore/v2.1/catalog/datasets/prix-des-carburants-en-france-flux-instantane-v2/records";
  const GEO_COMMUNES_API = "https://geo.api.gouv.fr/communes";

  const fuelLabels = {
    gazole: "Gazole",
    sp95: "SP95",
    sp98: "SP98",
    e10: "E10",
    e85: "E85",
    gplc: "GPLc"
  };

  const fuelFields = {
    gazole: { price: "prix_gazole", update: "maj_gazole" },
    sp95: { price: "prix_sp95", update: "maj_sp95" },
    sp98: { price: "prix_sp98", update: "maj_sp98" },
    e10: { price: "prix_e10", update: "maj_e10" },
    e85: { price: "prix_e85", update: "maj_e85" },
    gplc: { price: "prix_gplc", update: "maj_gplc" }
  };

  const clean = (v) => String(v ?? "").replace(/[<>"']/g, "").trim();

  function normalize(value) {
    return clean(value).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  }

  function formatPrice(value) {
    const n = Number(String(value ?? "").replace(",", "."));
    if (!Number.isFinite(n) || n <= 0) return "Non dispo";
    return n.toFixed(3).replace(".", ",") + " €/L";
  }

  function formatDate(value) {
    if (!value) return "";
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return clean(value);
    return d.toLocaleDateString("fr-FR") + " " + d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
  }

  function coordToDecimal(value) {
    if (value === undefined || value === null || value === "") return null;
    const n = Number(String(value).replace(",", ".").trim());
    if (!Number.isFinite(n)) return null;
    return Math.abs(n) > 1000 ? n / 100000 : n;
  }

  function getCoords(row) {
    const lat = coordToDecimal(row.latitude);
    const lon = coordToDecimal(row.longitude);
    return lat !== null && lon !== null ? { lat, lon } : null;
  }

  function haversineKm(a, b) {
    if (!a || !b) return null;
    const R = 6371;
    const dLat = (b.lat - a.lat) * Math.PI / 180;
    const dLon = (b.lon - a.lon) * Math.PI / 180;
    const lat1 = a.lat * Math.PI / 180;
    const lat2 = b.lat * Math.PI / 180;
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
  }

  function formatDistance(km) {
    if (km === null || !Number.isFinite(km)) return "";
    return km < 1 ? Math.round(km * 1000) + " m" : km.toFixed(1).replace(".", ",") + " km";
  }

  function detectName(row) {
    const direct = clean(row.nom_station || row.nom || row.enseigne || row.marque);
    if (direct) return direct;

    const text = normalize([row.adresse, row.ville, row.services_service, row.horaires_jour].filter(Boolean).join(" "));
    if (text.includes("leclerc")) return "E.Leclerc";
    if (text.includes("intermarche")) return "Intermarché";
    if (text.includes("carrefour")) return "Carrefour";
    if (text.includes("auchan")) return "Auchan";
    if (text.includes("total")) return "TotalEnergies";
    if (text.includes("avia")) return "Avia";
    if (text.includes("esso")) return "Esso";
    if (text.includes("shell")) return "Shell";
    return row.adresse ? "Station-service – " + clean(row.adresse) : "Station-service";
  }

  function logoInitial(name) {
    const n = clean(name || "Station");
    return `<div class="station-logo">${n.charAt(0).toUpperCase()}</div>`;
  }

  function render(items, fuel, meta = {}) {
    results.innerHTML = "";
    const label = fuelLabels[fuel] || fuel.toUpperCase();

    if (!items.length) {
      status.textContent = meta.message || "Aucune station trouvée avec ce carburant. Essaie un autre carburant ou un code postal proche.";
      return;
    }

    status.textContent = meta.message || `${items.length} station(s) trouvée(s).`;

    items.forEach((item, index) => {
      const name = clean(item.name || "Station-service");
      const address = clean(item.address);
      const cp = clean(item.cp);
      const city = clean(item.city);
      const distance = clean(item.distanceText);
      const maj = clean(item.updateDateText);
      const mapQuery = encodeURIComponent([address, cp, city].filter(Boolean).join(" "));
      const info = `${label}${distance ? " · à " + distance : ""}${maj ? " · Mis à jour : " + maj : ""}`;

      const card = document.createElement("div");
      card.className = "result-card";
      card.innerHTML = `
        <div class="result-main">
          ${logoInitial(name)}
          <div>
            <strong>${index + 1}. ${name} <span class="name-source">Prix officiel</span></strong>
            <div class="address">${address}${address && (cp || city) ? " · " : ""}${cp} ${city}</div>
            <div class="small">${info}</div>
            ${mapQuery ? `<a class="map-link" target="_blank" rel="noopener" href="https://www.google.com/maps/search/?api=1&query=${mapQuery}">Itinéraire</a>` : ""}
          </div>
        </div>
        <div class="price-badge">${formatPrice(item.price)}<span class="date">${label}</span></div>
      `;
      results.appendChild(card);
    });
  }

  async function getPostcodes(query) {
    const q = clean(query);
    const n = normalize(q);

    if (/^\d{5}$/.test(q)) return [q];

    if (n === "paris") {
      return Array.from({ length: 20 }, (_, i) => `750${String(i + 1).padStart(2, "0")}`);
    }

    if (n.includes("tergnier")) {
      return ["02700", "02300", "02800"];
    }

    const params = new URLSearchParams({
      nom: q,
      fields: "nom,codesPostaux,centre",
      boost: "population",
      limit: "5"
    });

    const response = await fetch(`${GEO_COMMUNES_API}?${params.toString()}`, { headers: { "Accept": "application/json" } });
    if (!response.ok) throw new Error("Impossible de trouver le code postal de la ville");
    const communes = await response.json();

    const codes = [];
    for (const commune of communes) {
      for (const cp of commune.codesPostaux || []) {
        if (!codes.includes(cp)) codes.push(cp);
      }
    }

    return codes.slice(0, 20);
  }

  function buildWhereFromPostcodes(codes) {
    return codes.map(cp => `cp="${cp}"`).join(" or ");
  }

  async function fetchFuelRows(query, fuel) {
    const postcodes = await getPostcodes(query);
    if (!postcodes.length) return [];

    const params = new URLSearchParams({
      lang: "fr",
      timezone: "Europe/Paris",
      limit: "100",
      where: buildWhereFromPostcodes(postcodes)
    });

    const url = `${DATA_API}?${params.toString()}`;
    const response = await fetch(url, { headers: { "Accept": "application/json" } });

    if (!response.ok) {
      const text = await response.text();
      throw new Error("API carburants erreur " + response.status + " : " + text.slice(0, 120));
    }

    const data = await response.json();
    return data.results || [];
  }

  async function searchStations() {
    const q = clean(placeInput.value);
    const fuel = String(fuelSelect.value || "e10").replace("prix_", "");
    const fields = fuelFields[fuel] || fuelFields.e10;

    if (!q) {
      status.textContent = "Entre une ville ou un code postal.";
      return;
    }

    results.innerHTML = "";
    status.textContent = "Recherche des prix carburants officiels…";

    try {
      const rows = await fetchFuelRows(q, fuel);
      const seen = new Set();

      const stations = rows.filter(row => {
        const id = clean(row.id || `${row.adresse}-${row.cp}-${row.ville}`);
        if (seen.has(id)) return false;
        seen.add(id);
        return true;
      }).map(row => {
        const coords = getCoords(row);
        const distanceKm = userPosition ? haversineKm(userPosition, coords) : null;
        return {
          id: clean(row.id),
          name: detectName(row),
          address: clean(row.adresse),
          cp: clean(row.cp),
          city: clean(row.ville),
          price: row[fields.price],
          updateDateText: formatDate(row[fields.update]),
          distanceKm,
          distanceText: formatDistance(distanceKm)
        };
      }).filter(item => {
        const n = Number(String(item.price ?? "").replace(",", "."));
        return Number.isFinite(n) && n > 0;
      }).sort((a, b) => {
        if (userPosition && a.distanceKm !== null && b.distanceKm !== null) return a.distanceKm - b.distanceKm;
        return Number(a.price) - Number(b.price);
      }).slice(0, 12);

      render(stations, fuel, {
        message: `${stations.length} station(s) trouvée(s) avec les prix officiels.`
      });
    } catch (error) {
      console.error(error);
      status.innerHTML = `Erreur API carburants : ${clean(error.message)}<br><span class="api-debug">Essaie avec un code postal simple comme 02700 ou 75015.</span>`;
    }
  }

  if (form) {
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      await searchStations();
    });
  }

  if (geoButton) {
    geoButton.addEventListener("click", () => {
      if (!navigator.geolocation) {
        status.textContent = "Ton navigateur ne permet pas la géolocalisation.";
        return;
      }

      status.textContent = "Autorise la localisation pour calculer la distance…";
      navigator.geolocation.getCurrentPosition((position) => {
        userPosition = {
          lat: position.coords.latitude,
          lon: position.coords.longitude
        };
        status.textContent = "Position trouvée. Entre une ville ou un code postal puis clique sur comparer.";
      }, () => {
        status.textContent = "Localisation refusée. Tu peux entrer ton code postal à la place.";
      }, {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 120000
      });
    });
  }
})();
