
(() => {
  const form = document.getElementById("compareForm");
  const placeInput = document.getElementById("placeInput");
  const fuelSelect = document.getElementById("fuelSelect");
  const status = document.getElementById("compareStatus");
  const results = document.getElementById("compareResults");
  const geoButton = document.getElementById("geoButton");

  let userPosition = null;

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

  function getCoords(row) {
    const lat = coordToDecimal(row.latitude);
    const lon = coordToDecimal(row.longitude);
    return lat !== null && lon !== null ? { lat, lon } : null;
  }

  function detectName(row) {
    const text = normalize([row.nom, row.nom_station, row.enseigne, row.marque, row.adresse, row.ville].filter(Boolean).join(" "));
    if (text.includes("leclerc")) return "E.Leclerc";
    if (text.includes("intermarche")) return "Intermarché";
    if (text.includes("carrefour")) return "Carrefour";
    if (text.includes("auchan")) return "Auchan";
    if (text.includes("total")) return "TotalEnergies";
    if (text.includes("avia")) return "Avia";
    if (text.includes("esso")) return "Esso";
    if (text.includes("shell")) return "Shell";
    return clean(row.nom_station || row.nom || row.enseigne || row.marque || (row.adresse ? "Station-service – " + row.adresse : "Station-service"));
  }

  function logoInitial(name) {
    const n = clean(name || "Station");
    return `<div class="station-logo">${n.charAt(0).toUpperCase()}</div>`;
  }

  function render(items, fuel, meta = {}) {
    results.innerHTML = "";
    const label = fuelLabels[fuel] || fuel.toUpperCase();

    if (!items.length) {
      status.textContent = meta.message || "Aucune station trouvée.";
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
      const sourceBadge = item.nameSource ? `<span class="name-source">${clean(item.nameSource)}</span>` : "";
      const info = `${label}${distance ? " · à " + distance : ""}${maj ? " · Mis à jour : " + maj : ""}`;

      const card = document.createElement("div");
      card.className = "result-card";
      card.innerHTML = `
        <div class="result-main">
          ${logoInitial(name)}
          <div>
            <strong>${index + 1}. ${name} ${sourceBadge}</strong>
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

  function parisWhere(q) {
    if (normalize(q) !== "paris") return null;
    return Array.from({ length: 20 }, (_, i) => `cp="750${String(i + 1).padStart(2, "0")}"`).join(" or ");
  }

  function buildDirectApiUrl(q, fuel) {
    const fields = fuelFields[fuel] || fuelFields.e10;
    let where;
    const query = clean(q);

    if (/^\d{5}$/.test(query)) {
      where = `cp="${query}"`;
    } else if (normalize(query) === "paris") {
      where = parisWhere(query);
    } else if (normalize(query).includes("tergnier") || query === "02700") {
      where = `cp="02700" or lower(ville)=lower("Condren") or lower(ville)=lower("Viry-Noureuil") or lower(ville)=lower("Beautor") or lower(ville)=lower("Chauny")`;
    } else {
      where = `lower(ville)=lower("${query.replace(/"/g, '\\"')}")`;
    }

    const params = new URLSearchParams({
      lang: "fr",
      timezone: "Europe/Paris",
      limit: "50",
      where
    });

    return `https://data.economie.gouv.fr/api/explore/v2.1/catalog/datasets/prix-des-carburants-en-france-flux-instantane-v2/records?${params.toString()}`;
  }

  async function directApiFallback(q, fuel) {
    const fields = fuelFields[fuel] || fuelFields.e10;
    const url = buildDirectApiUrl(q, fuel);
    const response = await fetch(url, { headers: { "Accept": "application/json" } });
    if (!response.ok) throw new Error("API publique bloquée : " + response.status);
    const data = await response.json();
    const rows = data.results || [];

    const stations = rows.map(row => {
      const coords = getCoords(row);
      const distanceKm = userPosition ? haversineKm(userPosition, coords) : null;
      return {
        id: clean(row.id),
        name: detectName(row),
        nameSource: "Nom déduit",
        address: clean(row.adresse),
        cp: clean(row.cp),
        city: clean(row.ville),
        price: row[fields.price],
        updateDateText: formatDate(row[fields.update]),
        distanceKm,
        distanceText: formatDistance(distanceKm)
      };
    }).filter(x => Number(String(x.price ?? "").replace(",", ".")) > 0);

    stations.sort((a, b) => {
      if (userPosition && a.distanceKm !== null && b.distanceKm !== null) return a.distanceKm - b.distanceKm;
      return Number(a.price) - Number(b.price);
    });

    return {
      meta: {
        message: `${stations.length} station(s) trouvée(s) via API publique directe.`
      },
      results: stations.slice(0, 12)
    };
  }

  async function searchStations() {
    const q = clean(placeInput.value);
    const fuel = String(fuelSelect.value || "e10").replace("prix_", "");

    if (!q && !userPosition) {
      status.textContent = "Entre une ville, un code postal ou utilise ta position.";
      return;
    }

    const params = new URLSearchParams({ fuel });
    if (q) params.set("q", q);
    if (userPosition) {
      params.set("lat", String(userPosition.lat));
      params.set("lon", String(userPosition.lon));
    }

    results.innerHTML = "";
    status.textContent = "Recherche des prix carburants…";

    try {
      const response = await fetch(`/api/carburants?${params.toString()}`, { headers: { "Accept": "application/json" } });
      const text = await response.text();
      let data;
      try {
        data = JSON.parse(text);
      } catch (_) {
        throw new Error("La route /api/carburants ne renvoie pas du JSON : " + text.slice(0, 120));
      }
      if (!response.ok || data.error) throw new Error(data.error || "Erreur API serveur");
      render(data.results || [], fuel, data.meta || {});
    } catch (serverError) {
      console.warn("API serveur indisponible, fallback direct", serverError);
      try {
        if (!q) throw serverError;
        const data = await directApiFallback(q, fuel);
        render(data.results || [], fuel, data.meta || {});
      } catch (directError) {
        console.error(directError);
        status.innerHTML = `Erreur de chargement des prix. Teste cette URL : <a class="map-link" href="/api/carburants?q=02700&fuel=e10" target="_blank">/api/carburants?q=02700&fuel=e10</a><div class="api-debug">${clean(directError.message || serverError.message)}</div>`;
      }
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
      navigator.geolocation.getCurrentPosition(async (position) => {
        userPosition = { lat: position.coords.latitude, lon: position.coords.longitude };
        status.textContent = "Position trouvée. Entre une ville/code postal ou clique sur comparer.";
        await searchStations();
      }, () => {
        status.textContent = "Localisation refusée. Tu peux entrer ton code postal à la place.";
      }, { enableHighAccuracy: true, timeout: 10000, maximumAge: 120000 });
    });
  }
})();
