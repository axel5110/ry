
const FUEL_API = "https://data.economie.gouv.fr/api/explore/v2.1/catalog/datasets/prix-des-carburants-en-france-flux-instantane-v2/records";
const STATION_PAGE = "https://www.prix-carburants.gouv.fr/station/";
const NOMINATIM_REVERSE = "https://nominatim.openstreetmap.org/reverse";

const FUEL_FIELDS = {
  gazole: { price: "prix_gazole", update: "maj_gazole" },
  sp95: { price: "prix_sp95", update: "maj_sp95" },
  sp98: { price: "prix_sp98", update: "maj_sp98" },
  e10: { price: "prix_e10", update: "maj_e10" },
  e85: { price: "prix_e85", update: "maj_e85" },
  gplc: { price: "prix_gplc", update: "maj_gplc" }
};

const PARIS_CP = Array.from({ length: 20 }, (_, i) => `750${String(i + 1).padStart(2, "0")}`);
const TERGNIER_QUERIES = ["02700", "Condren", "Viry-Noureuil", "Beautor", "Chauny"];

const clean = (v) => String(v ?? "").replace(/[<>"']/g, "").trim();
const normalize = (v) => clean(v).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
const escapeWhere = (v) => clean(v).replace(/\\/g, "\\\\").replace(/"/g, '\\"');

function coordToDecimal(v) {
  if (v === undefined || v === null || v === "") return null;
  const n = Number(String(v).replace(",", ".").trim());
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
  return km < 1 ? `${Math.round(km * 1000)} m` : `${km.toFixed(1).replace(".", ",")} km`;
}

function formatDate(v) {
  if (!v) return "";
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return clean(v);
  return `${d.toLocaleDateString("fr-FR")} ${d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}`;
}

function detectBrand(text) {
  const t = normalize(text);
  if (t.includes("leclerc")) return "E.Leclerc";
  if (t.includes("intermarche")) return "Intermarché";
  if (t.includes("carrefour")) return "Carrefour";
  if (t.includes("auchan")) return "Auchan";
  if (t.includes("total")) return "TotalEnergies";
  if (t.includes("avia")) return "Avia";
  if (t.includes("esso")) return "Esso";
  if (t.includes("shell")) return "Shell";
  if (t.includes("bp")) return "BP";
  return "";
}

function stripHtml(v) {
  return String(v || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractStationName(html) {
  const patterns = [
    /<h1[^>]*>([\s\S]*?)<\/h1>/i,
    /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i,
    /<title[^>]*>([\s\S]*?)<\/title>/i
  ];

  for (const p of patterns) {
    const m = html.match(p);
    if (m?.[1]) {
      const name = stripHtml(m[1])
        .replace(/Prix des carburants/gi, "")
        .replace(/prix-carburants\.gouv\.fr/gi, "")
        .replace(/Station-service/gi, "")
        .replace(/^[-|–]+|[-|–]+$/g, "")
        .trim();
      if (name.length >= 3) return name;
    }
  }

  const brand = detectBrand(stripHtml(html));
  return brand || "";
}

async function getOfficialName(id) {
  if (!id) return "";
  try {
    const r = await fetch(`${STATION_PAGE}${encodeURIComponent(id)}`, {
      headers: {
        "Accept": "text/html",
        "User-Agent": "Carburio/1.0 (+https://carburio.com)"
      }
    });
    if (!r.ok) return "";
    return extractStationName(await r.text());
  } catch {
    return "";
  }
}

function fallbackName(row) {
  const direct = clean(row.nom_station || row.nom || row.enseigne || row.marque);
  if (direct) return direct;
  const brand = detectBrand([row.adresse, row.ville, row.services_service, row.horaires_jour].flat().join(" "));
  if (brand) return brand;
  if (row.adresse) return `Station-service – ${clean(row.adresse)}`;
  if (row.ville) return `Station-service – ${clean(row.ville)}`;
  return "Station-service";
}

function isParis(q) {
  const v = clean(q);
  return normalize(v) === "paris" || /^750(0[1-9]|1[0-9]|20)$/.test(v);
}

function isTergnier(q) {
  const v = clean(q);
  return normalize(v).includes("tergnier") || v === "02700";
}

function buildWhere(q) {
  const v = clean(q);
  if (normalize(v) === "paris") return PARIS_CP.map(cp => `cp="${cp}"`).join(" or ");
  if (/^\d{5}$/.test(v)) return `cp="${v}"`;
  return `lower(ville)=lower("${escapeWhere(v)}")`;
}

async function reversePostcode(lat, lon) {
  try {
    const params = new URLSearchParams({ format: "jsonv2", lat: String(lat), lon: String(lon), zoom: "18", addressdetails: "1" });
    const r = await fetch(`${NOMINATIM_REVERSE}?${params.toString()}`, {
      headers: { "Accept": "application/json", "User-Agent": "Carburio/1.0 (+https://carburio.com)" }
    });
    if (!r.ok) return "";
    const data = await r.json();
    return clean(data.address?.postcode || "");
  } catch {
    return "";
  }
}

async function fetchRows(q) {
  const params = new URLSearchParams({
    lang: "fr",
    timezone: "Europe/Paris",
    limit: "100",
    where: buildWhere(q)
  });

  const r = await fetch(`${FUEL_API}?${params.toString()}`, { headers: { "Accept": "application/json" } });
  if (!r.ok) throw new Error(`API carburant ${r.status}`);
  const data = await r.json();
  return data.results || [];
}

async function apiCarburants(request) {
  const url = new URL(request.url);
  let q = clean(url.searchParams.get("q"));
  const fuel = normalize(url.searchParams.get("fuel") || "e10").replace("prix_", "");
  const lat = Number(url.searchParams.get("lat"));
  const lon = Number(url.searchParams.get("lon"));

  const headers = {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "public, max-age=120"
  };

  if (!FUEL_FIELDS[fuel]) {
    return new Response(JSON.stringify({ error: "Carburant non reconnu", results: [] }), { status: 400, headers });
  }

  let origin = null;
  if (Number.isFinite(lat) && Number.isFinite(lon)) {
    origin = { lat, lon };
    if (!q) q = await reversePostcode(lat, lon);
  }

  if (!q) {
    return new Response(JSON.stringify({ error: "Ville, code postal ou position manquante", results: [] }), { status: 400, headers });
  }

  const queries = isTergnier(q) ? TERGNIER_QUERIES : [q];
  const rows = [];
  for (const query of queries) {
    try {
      rows.push(...await fetchRows(query));
    } catch (e) {
      console.warn("Erreur query", query, e);
    }
  }

  const seen = new Set();
  const fields = FUEL_FIELDS[fuel];

  let results = await Promise.all(rows.filter(row => {
    const id = clean(row.id || `${row.adresse}-${row.cp}-${row.ville}`);
    if (seen.has(id)) return false;
    seen.add(id);
    if (isParis(q) && !PARIS_CP.includes(clean(row.cp))) return false;
    return true;
  }).map(async row => {
    const price = Number(String(row[fields.price] ?? "").replace(",", "."));
    if (!Number.isFinite(price) || price <= 0) return null;
    const coords = getCoords(row);
    const distanceKm = origin ? haversineKm(origin, coords) : null;
    const official = row.id ? await getOfficialName(row.id) : "";
    return {
      id: clean(row.id),
      name: official || fallbackName(row),
      nameSource: official ? "Nom officiel" : "Nom déduit",
      address: clean(row.adresse),
      cp: clean(row.cp),
      city: clean(row.ville),
      price,
      updateDateText: formatDate(row[fields.update]),
      distanceKm,
      distanceText: formatDistance(distanceKm)
    };
  }));

  results = results.filter(Boolean).sort((a, b) => {
    if (origin && a.distanceKm !== null && b.distanceKm !== null) return a.distanceKm - b.distanceKm;
    return a.price - b.price;
  }).slice(0, 12);

  return new Response(JSON.stringify({
    meta: {
      q,
      fuel,
      message: `${results.length} station(s) trouvée(s).`
    },
    results
  }), { status: 200, headers });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === "/api/carburants") {
      return apiCarburants(request);
    }
    return env.ASSETS.fetch(request);
  }
};
