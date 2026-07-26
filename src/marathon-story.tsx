"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";

import logoUrl from "./airtrack-logo.svg";

const ASSET_BASE = import.meta.env.BASE_URL;

type Pollutant = "pm25" | "no2" | "o3" | "pm10";
type Confidence = "high" | "moderate" | "indicative";

type RoutePoint = {
  km: number;
  lat: number;
  lon: number;
  no2: number;
  pm25: number;
  o3: number;
  pm10: number;
};

type PollutantSummary = { mean: number; min: number; max: number };

type WeekDay = {
  date: string;
  offset: number;
  race: boolean;
  no2: number;
  pm25: number;
  o3: number;
  pm10: number;
};

type City = {
  slug: string;
  name: string;
  city: string;
  date: string;
  local_start: string;
  tz: string;
  distance_km: number;
  provenance: string;
  provenance_note: string;
  model_family: string;
  confidence: Confidence;
  monitors: { count: number; network: string };
  route: RoutePoint[];
  hours: Array<{ local: string; no2: number; pm25: number; o3: number; pm10: number }>;
  summary: Record<Pollutant, PollutantSummary>;
  week: {
    days: WeekDay[];
    pm25_rank: number;
    pm25_of: number;
    pm25_min: number;
    pm25_max: number;
    no2_min: number;
    no2_max: number;
  };
};

type Payload = {
  generated_utc: string;
  who: Record<Pollutant, number>;
  cities: City[];
};

type Field = {
  city: string;
  nx: number;
  ny: number;
  lat0: number;
  lon0: number;
  cell: number;
  fields: Record<Pollutant, { lo: number; hi: number; data: string; coverage: number }>;
};

type MapContext = {
  city: string;
  roads: Array<{ c: number[]; k: string }>;
  water: number[][];
};

const ORDER = ["paris", "london", "bangkok", "accra", "dakar"];

const POLLUTANTS: Record<
  Pollutant,
  { label: string; long: string; reference: number; period: string; short: string }
> = {
  pm25: { label: "PM₂.₅", long: "fine particles", reference: 15, period: "24-hour", short: "Particles" },
  no2: { label: "NO₂", long: "nitrogen dioxide", reference: 25, period: "24-hour", short: "Traffic gas" },
  o3: { label: "O₃", long: "ozone", reference: 100, period: "8-hour daily max", short: "Ozone" },
  pm10: { label: "PM₁₀", long: "coarse particles", reference: 45, period: "24-hour", short: "Coarse particles" },
};

const STORIES: Record<string, string> = {
  paris:
    "AirTrack estimates lower NO₂ through the Bois de Vincennes and Bois de Boulogne, with higher values near the Périphérique. PM₂.₅ on race day was the second-lowest value in the 15-day comparison.",
  london:
    "The route estimate is fairly even. NO₂ increases on the final approach through central London.",
  bangkok:
    "PM₂.₅ remains high across the whole 02:00 race window. This run tests the 2024 course against conditions on 30 November 2025.",
  accra:
    "The AirTrack estimate is relatively low, but there are no reference monitors in the local panel. Treat the result as indicative.",
  dakar:
    "This 8.8 km corridor follows Dakar’s open Atlantic waterfront. The relatively low NO₂ estimate may partly reflect coastal inflow and the waterfront setting; PM₁₀ is not low. There are no reference monitors in the local panel to test that explanation.",
};

const EVIDENCE: Record<Confidence, { label: string; className: string }> = {
  high: { label: "Stronger validation base", className: "" },
  moderate: { label: "Some local validation", className: "" },
  indicative: { label: "Indicative only", className: "estimate" },
};

const CITY_LABELS: Record<string, string> = {
  paris: "Paris",
  london: "London",
  bangkok: "Bangkok",
  accra: "Accra",
  dakar: "Dakar",
};

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(`${value}T12:00:00Z`));
}

function pollutantTabs(selected: Pollutant, onSelect: (pollutant: Pollutant) => void) {
  return (
    <div className="pollutant-tabs" aria-label="Choose a pollutant">
      {(Object.keys(POLLUTANTS) as Pollutant[]).map((key) => (
        <button
          className="pollutant-tab"
          type="button"
          key={key}
          aria-pressed={selected === key}
          onClick={() => onSelect(key)}
          title={POLLUTANTS[key].long}
        >
          {POLLUTANTS[key].label}
        </button>
      ))}
    </div>
  );
}

function mixColor(a: number[], b: number[], t: number) {
  return a.map((value, index) => Math.round(value + (b[index] - value) * t));
}

function rampColor(t: number, muted = false) {
  const stops = muted
    ? [
        [222, 236, 249],
        [169, 200, 247],
        [74, 87, 217],
        [26, 14, 154],
      ]
    : [
        [68, 198, 120],
        [244, 229, 82],
        [249, 65, 57],
      ];
  const clamped = Math.max(0, Math.min(1, t));
  const scaled = clamped * (stops.length - 1);
  const index = Math.min(stops.length - 2, Math.floor(scaled));
  const rgb = mixColor(stops[index], stops[index + 1], scaled - index);
  return `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`;
}

function decodeHex(hex: string) {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i += 1) out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

function AirMap({
  city,
  field,
  context,
  pollutant,
  progress,
}: {
  city: City;
  field: Field;
  context: MapContext;
  pollutant: Pollutant;
  progress: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fieldLayer = field.fields[pollutant];
  const buffer = useMemo(() => decodeHex(fieldLayer.data), [fieldLayer.data]);
  const geoAspect = (field.nx * Math.cos((field.lat0 + field.ny * field.cell * 0.5) * Math.PI / 180)) / field.ny;

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const bounds = canvas.getBoundingClientRect();
    if (!bounds.width || !bounds.height) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(bounds.width * dpr);
    canvas.height = Math.round(bounds.height * dpr);
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const width = bounds.width;
    const height = bounds.height;
    const cosLat = Math.cos((field.lat0 + field.ny * field.cell * 0.5) * Math.PI / 180);
    const x = (lon: number) => ((lon - field.lon0) / (field.nx * field.cell)) * width;
    const y = (lat: number) => height - ((lat - field.lat0) / (field.ny * field.cell)) * height;

    ctx.fillStyle = "#deecf9";
    ctx.fillRect(0, 0, width, height);

    const offscreen = document.createElement("canvas");
    offscreen.width = field.nx;
    offscreen.height = field.ny;
    const offCtx = offscreen.getContext("2d");
    if (!offCtx) return;
    const image = offCtx.createImageData(field.nx, field.ny);
    for (let index = 0; index < field.nx * field.ny; index += 1) {
      const value = buffer[index];
      if (value === 0) {
        image.data[index * 4 + 3] = 0;
        continue;
      }
      const normalized = (value - 1) / 254;
      const color = rampColor(normalized, true).match(/\d+/g)?.map(Number) ?? [100, 160, 210];
      image.data[index * 4] = color[0];
      image.data[index * 4 + 1] = color[1];
      image.data[index * 4 + 2] = color[2];
      image.data[index * 4 + 3] = 235;
    }
    offCtx.putImageData(image, 0, 0);
    ctx.save();
    ctx.translate(0, height);
    ctx.scale(1, -1);
    ctx.globalAlpha = 0.86;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(offscreen, 0, 0, width, height);
    ctx.restore();
    ctx.globalAlpha = 1;

    ctx.fillStyle = "rgba(206, 237, 248, .66)";
    for (const polygon of context.water ?? []) {
      ctx.beginPath();
      for (let index = 0; index < polygon.length; index += 2) {
        const px = x(polygon[index]);
        const py = y(polygon[index + 1]);
        if (index === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.fill();
    }

    for (const road of context.roads ?? []) {
      const river = road.k === "river";
      ctx.beginPath();
      for (let index = 0; index < road.c.length; index += 2) {
        const px = x(road.c[index]);
        const py = y(road.c[index + 1]);
        if (index === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.strokeStyle = river ? "rgba(213, 243, 255, .82)" : "rgba(255, 255, 255, .50)";
      ctx.lineWidth = river ? 2 : road.k === "motorway" ? 1.3 : 0.8;
      ctx.lineCap = "round";
      ctx.stroke();
    }

    const routeMin = city.summary[pollutant].min;
    const routeMax = city.summary[pollutant].max;
    const routeT = (value: number) => (value - routeMin) / Math.max(0.01, routeMax - routeMin);
    const progressKm = city.distance_km * progress;
    const firstPointAfterProgress = city.route.findIndex((point) => point.km >= progressKm);
    const currentIndex = firstPointAfterProgress === -1 ? city.route.length - 1 : firstPointAfterProgress;
    const currentPoint = city.route[currentIndex];

    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.beginPath();
    city.route.forEach((point, index) => {
      if (index === 0) ctx.moveTo(x(point.lon), y(point.lat));
      else ctx.lineTo(x(point.lon), y(point.lat));
    });
    ctx.strokeStyle = "rgba(255,255,255,.96)";
    ctx.lineWidth = 9;
    ctx.stroke();

    ctx.beginPath();
    city.route.forEach((point, index) => {
      if (index === 0) ctx.moveTo(x(point.lon), y(point.lat));
      else ctx.lineTo(x(point.lon), y(point.lat));
    });
    ctx.strokeStyle = "rgba(26, 14, 154, .28)";
    ctx.lineWidth = 4;
    ctx.stroke();

    for (let index = 1; index <= currentIndex; index += 1) {
      const before = city.route[index - 1];
      const point = city.route[index];
      ctx.beginPath();
      ctx.moveTo(x(before.lon), y(before.lat));
      ctx.lineTo(x(point.lon), y(point.lat));
      ctx.strokeStyle = rampColor(routeT((before[pollutant] + point[pollutant]) / 2));
      ctx.lineWidth = 5;
      ctx.stroke();
    }

    const highest = city.route.reduce((best, point) => (point[pollutant] > best[pollutant] ? point : best));

    const courseMarks = city.distance_km > 30
      ? [
          { km: 10, label: "10 KM" },
          { km: city.distance_km / 2, label: "HALFWAY" },
          { km: 30, label: "30 KM" },
        ]
      : [{ km: city.distance_km / 2, label: "HALFWAY" }];

    for (const mark of courseMarks) {
      const point = city.route.reduce((nearest, candidate) => (
        Math.abs(candidate.km - mark.km) < Math.abs(nearest.km - mark.km) ? candidate : nearest
      ));
      const px = x(point.lon);
      const py = y(point.lat);
      ctx.beginPath();
      ctx.arc(px, py, 3, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(7, 26, 47, .72)";
      ctx.fill();
      ctx.font = "700 9px Arial, sans-serif";
      const textWidth = ctx.measureText(mark.label).width;
      const boxX = Math.min(width - textWidth - 12, Math.max(4, px + 7));
      const boxY = Math.min(height - 19, Math.max(4, py - 19));
      ctx.fillStyle = "rgba(255,255,255,.84)";
      ctx.beginPath();
      ctx.roundRect(boxX, boxY, textWidth + 8, 16, 4);
      ctx.fill();
      ctx.fillStyle = "rgba(7, 26, 47, .76)";
      ctx.fillText(mark.label, boxX + 4, boxY + 11);
    }

    const marker = (point: RoutePoint, fill: string, label: string, alignRight = false) => {
      const px = x(point.lon);
      const py = y(point.lat);
      ctx.beginPath();
      ctx.arc(px, py, 6, 0, Math.PI * 2);
      ctx.fillStyle = fill;
      ctx.fill();
      ctx.lineWidth = 2.5;
      ctx.strokeStyle = "#fff";
      ctx.stroke();
      ctx.font = "700 10px Arial, sans-serif";
      const textWidth = ctx.measureText(label).width;
      const boxX = alignRight ? px - textWidth - 20 : px + 10;
      const boxY = py - 22;
      ctx.fillStyle = "rgba(255,255,255,.94)";
      ctx.beginPath();
      ctx.roundRect(boxX, boxY, textWidth + 12, 20, 5);
      ctx.fill();
      ctx.fillStyle = "#000";
      ctx.fillText(label, boxX + 6, boxY + 14);
    };

    const start = city.route[0];
    const finish = city.route[city.route.length - 1];
    marker(start, "#44c678", "START", x(start.lon) > width * 0.72);
    marker(finish, "#ff610a", "FINISH", x(finish.lon) > width * 0.72);
    if (progress >= 0.999 && Math.hypot(x(highest.lon) - x(start.lon), y(highest.lat) - y(start.lat)) > 35) {
      ctx.beginPath();
      ctx.arc(x(highest.lon), y(highest.lat), 8, 0, Math.PI * 2);
      ctx.strokeStyle = "#000";
      ctx.lineWidth = 2;
      ctx.stroke();
    }

    if (progress < 0.999) {
      const px = x(currentPoint.lon);
      const py = y(currentPoint.lat);
      ctx.beginPath();
      ctx.arc(px, py, 11, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(7, 95, 255, .18)";
      ctx.fill();
      ctx.beginPath();
      ctx.arc(px, py, 6, 0, Math.PI * 2);
      ctx.fillStyle = "#4a57d9";
      ctx.fill();
      ctx.lineWidth = 2.5;
      ctx.strokeStyle = "#fff";
      ctx.stroke();
    }

    ctx.font = "700 10px Arial, sans-serif";
    ctx.fillStyle = "rgba(255,255,255,.82)";
    ctx.fillText(`${Math.round(field.cell * 111)} km grid`, width - 72, 18);
    void cosLat;
  }, [buffer, city, context, field, pollutant, progress]);

  useEffect(() => {
    draw();
    const observer = new ResizeObserver(draw);
    if (canvasRef.current) observer.observe(canvasRef.current);
    return () => observer.disconnect();
  }, [draw]);

  return (
    <div className="map-frame" style={{ aspectRatio: `${Math.max(1.12, geoAspect)} / 1` }}>
      <canvas
        ref={canvasRef}
        role="img"
        aria-label={`${city.city} route map coloured by ${POLLUTANTS[pollutant].long}, shown to ${Math.round(progress * city.distance_km)} kilometres`}
      />
      <div className="map-legend" aria-hidden="true">
        <span>Lower</span><i className="route-ramp"/><span>Higher on this route</span>
      </div>
      <span className="map-source">500 m air field · OSM road context</span>
    </div>
  );
}

function ProfileChart({ city, pollutant, progress }: { city: City; pollutant: Pollutant; progress: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const config = POLLUTANTS[pollutant];

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const bounds = canvas.getBoundingClientRect();
    if (!bounds.width || !bounds.height) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(bounds.width * dpr);
    canvas.height = Math.round(bounds.height * dpr);
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const width = bounds.width;
    const height = bounds.height;
    const margin = { top: 16, right: 14, bottom: 28, left: 42 };
    const plotW = width - margin.left - margin.right;
    const plotH = height - margin.top - margin.bottom;
    const values = city.route.map((point) => point[pollutant]);
    const low = Math.max(0, Math.min(...values, config.reference) * 0.82);
    const high = Math.max(...values, config.reference) * 1.14;
    const x = (km: number) => margin.left + (km / city.distance_km) * plotW;
    const y = (value: number) => margin.top + (1 - (value - low) / Math.max(0.1, high - low)) * plotH;

    ctx.clearRect(0, 0, width, height);
    ctx.strokeStyle = "#dbe5ec";
    ctx.lineWidth = 1;
    for (let i = 0; i < 3; i += 1) {
      const py = margin.top + (i / 2) * plotH;
      ctx.beginPath();
      ctx.moveTo(margin.left, py);
      ctx.lineTo(width - margin.right, py);
      ctx.stroke();
    }

    const referenceY = y(config.reference);
    ctx.save();
    ctx.setLineDash([4, 4]);
    ctx.strokeStyle = "rgba(249, 65, 57, .9)";
    ctx.beginPath();
    ctx.moveTo(margin.left, referenceY);
    ctx.lineTo(width - margin.right, referenceY);
    ctx.stroke();
    ctx.restore();

    const gradient = ctx.createLinearGradient(0, margin.top, 0, height - margin.bottom);
    gradient.addColorStop(0, "rgba(7,95,255,.26)");
    gradient.addColorStop(1, "rgba(7,95,255,.02)");
    ctx.beginPath();
    city.route.forEach((point, index) => {
      const px = x(point.km);
      const py = y(point[pollutant]);
      if (index === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    });
    ctx.lineTo(x(city.route[city.route.length - 1].km), height - margin.bottom);
    ctx.lineTo(x(city.route[0].km), height - margin.bottom);
    ctx.closePath();
    ctx.fillStyle = gradient;
    ctx.fill();

    ctx.beginPath();
    city.route.forEach((point, index) => {
      const px = x(point.km);
      const py = y(point[pollutant]);
      if (index === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    });
    ctx.strokeStyle = "#4a57d9";
    ctx.lineWidth = 2.3;
    ctx.lineJoin = "round";
    ctx.stroke();

    const maxPoint = city.route.reduce((best, point) => (point[pollutant] > best[pollutant] ? point : best));
    ctx.beginPath();
    ctx.arc(x(maxPoint.km), y(maxPoint[pollutant]), 4, 0, Math.PI * 2);
    ctx.fillStyle = "#ff610a";
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = "#fff";
    ctx.stroke();

    if (progress < 0.999) {
      const currentKm = city.distance_km * progress;
      const currentPoint = city.route.reduce((nearest, point) => (
        Math.abs(point.km - currentKm) < Math.abs(nearest.km - currentKm) ? point : nearest
      ));
      const cursorX = x(currentPoint.km);
      ctx.save();
      ctx.setLineDash([3, 4]);
      ctx.strokeStyle = "rgba(7, 26, 47, .48)";
      ctx.beginPath();
      ctx.moveTo(cursorX, margin.top);
      ctx.lineTo(cursorX, height - margin.bottom);
      ctx.stroke();
      ctx.restore();
      ctx.beginPath();
      ctx.arc(cursorX, y(currentPoint[pollutant]), 5, 0, Math.PI * 2);
      ctx.fillStyle = "#4a57d9";
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = "#fff";
      ctx.stroke();
    }

    ctx.fillStyle = "#64788b";
    ctx.font = "10px Arial, sans-serif";
    ctx.textAlign = "left";
    ctx.fillText("0 km", margin.left, height - 7);
    ctx.textAlign = "center";
    ctx.fillText(`${(city.distance_km / 2).toFixed(1)} km`, margin.left + plotW / 2, height - 7);
    ctx.textAlign = "right";
    ctx.fillText(`${city.distance_km.toFixed(1)} km`, width - margin.right, height - 7);
    ctx.fillText(`${high.toFixed(0)}`, margin.left - 8, margin.top + 3);
    ctx.fillText(`${low.toFixed(0)}`, margin.left - 8, height - margin.bottom);
    ctx.fillStyle = "#a33e19";
    ctx.textAlign = "right";
    ctx.fillText(`WHO ${config.period} reference`, width - margin.right, Math.max(11, referenceY - 6));
  }, [city, config, pollutant, progress]);

  useEffect(() => {
    draw();
    const observer = new ResizeObserver(draw);
    if (canvasRef.current) observer.observe(canvasRef.current);
    return () => observer.disconnect();
  }, [draw]);

  return <canvas ref={canvasRef} className="profile-canvas" role="img" aria-label={`${config.label} along the ${city.city} route by distance`}/>;
}

function WeekBars({ city, pollutant }: { city: City; pollutant: Pollutant }) {
  const values = city.week.days.map((day) => day[pollutant]);
  const low = Math.min(...values);
  const high = Math.max(...values);
  const race = city.week.days.find((day) => day.race);
  const rank = race ? [...values].sort((a, b) => a - b).indexOf(race[pollutant]) + 1 : 0;
  return (
    <>
      <div className="week-bars" aria-label={`${POLLUTANTS[pollutant].label} across the week before and after the route date`}>
        {city.week.days.map((day) => {
          const height = 18 + ((day[pollutant] - low) / Math.max(0.1, high - low)) * 82;
          return (
            <div className={`week-day${day.race ? " race" : ""}`} key={day.date} title={`${day.date}: ${day[pollutant]} µg/m³`}>
              <span className="week-bar" style={{ height: `${height}%` }} />
            </div>
          );
        })}
      </div>
      <div className="week-axis"><span>7 days before</span><span>Race / route day</span><span>7 days after</span></div>
      <p className="chart-subtitle" style={{ marginTop: 12 }}>
        Route day ranked <strong>{rank} of {values.length}</strong> from lower to higher {POLLUTANTS[pollutant].short.toLowerCase()} in its fortnight.
      </p>
    </>
  );
}

export function MarathonStory() {
  const [payload, setPayload] = useState<Payload | null>(null);
  const [selectedCity, setSelectedCity] = useState("bangkok");
  const [pollutant, setPollutant] = useState<Pollutant>("pm25");
  const [field, setField] = useState<Field | null>(null);
  const [context, setContext] = useState<MapContext | null>(null);
  const [error, setError] = useState("");
  const [shareLabel, setShareLabel] = useState("Share");
  const [routeProgress, setRouteProgress] = useState(1);
  const [routePlaying, setRoutePlaying] = useState(false);
  const routeProgressRef = useRef(1);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const city = params.get("city");
    const pol = params.get("pollutant") as Pollutant | null;
    if (city && ORDER.includes(city)) setSelectedCity(city);
    if (pol && pol in POLLUTANTS) setPollutant(pol);
    fetch(`${ASSET_BASE}data/marathons.json`)
      .then((response) => {
        if (!response.ok) throw new Error("The route data could not be loaded.");
        return response.json();
      })
      .then((data: Payload) => setPayload(data))
      .catch((reason: Error) => setError(reason.message));
  }, []);

  useEffect(() => {
    setField(null);
    setContext(null);
    Promise.all([
      fetch(`${ASSET_BASE}data/fields/${selectedCity}.json`).then((response) => response.json() as Promise<Field>),
      fetch(`${ASSET_BASE}data/context/${selectedCity}.json`).then((response) => response.json() as Promise<MapContext>),
    ])
      .then(([nextField, nextContext]) => {
        setField(nextField);
        setContext(nextContext);
      })
      .catch(() => setError("The map could not be loaded."));
  }, [selectedCity]);

  useEffect(() => {
    if (!payload) return;
    const url = new URL(window.location.href);
    url.searchParams.set("city", selectedCity);
    url.searchParams.set("pollutant", pollutant);
    window.history.replaceState({}, "", url);
  }, [payload, pollutant, selectedCity]);

  useEffect(() => {
    routeProgressRef.current = routeProgress;
  }, [routeProgress]);

  useEffect(() => {
    routeProgressRef.current = 1;
    setRouteProgress(1);
    setRoutePlaying(false);
  }, [pollutant, selectedCity]);

  useEffect(() => {
    if (!routePlaying) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      const next = routeProgressRef.current >= 0.999 ? 0 : 1;
      routeProgressRef.current = next;
      setRouteProgress(next);
      setRoutePlaying(false);
      return;
    }
    const from = routeProgressRef.current >= 0.999 ? 0 : routeProgressRef.current;
    const startedAt = performance.now();
    let frame = 0;
    routeProgressRef.current = from;
    setRouteProgress(from);

    const tick = (now: number) => {
      const next = Math.min(1, from + (now - startedAt) / 8000);
      routeProgressRef.current = next;
      setRouteProgress(next);
      if (next < 1) frame = window.requestAnimationFrame(tick);
      else setRoutePlaying(false);
    };

    frame = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(frame);
  }, [routePlaying]);

  const city = payload?.cities.find((item) => item.slug === selectedCity) ?? null;
  const ranked = useMemo(() => {
    if (!payload) return [];
    return [...payload.cities].sort((a, b) => b.summary[pollutant].mean - a.summary[pollutant].mean);
  }, [payload, pollutant]);

  const selectCity = (slug: string, scroll = false) => {
    setSelectedCity(slug);
    if (scroll) document.getElementById("routes")?.scrollIntoView({ behavior: "smooth" });
  };

  const share = async () => {
    try {
      if (navigator.share) {
        await navigator.share({
          title: "AirTrack marathon route analysis",
          text: "AirTrack background air-quality estimates across five city running routes.",
          url: window.location.href,
        });
      } else {
        await navigator.clipboard.writeText(window.location.href);
        setShareLabel("Link copied");
        window.setTimeout(() => setShareLabel("Share"), 1800);
      }
    } catch {
      // Closing the native share sheet is not an error the reader needs to see.
    }
  };

  const openMethod = () => {
    const disclosure = document.querySelector<HTMLDetailsElement>(".method-disclosure");
    if (disclosure) disclosure.open = true;
  };

  if (error) {
    return <main className="error-screen"><div><h1>We couldn’t open the briefing.</h1><p>{error}</p></div></main>;
  }

  if (!payload || !city) {
    return <main className="loading-screen"><div><p className="eyebrow">AirTrack by Air Aware Labs</p><h1>Loading route data…</h1></div></main>;
  }

  const summary = city.summary[pollutant];
  const config = POLLUTANTS[pollutant];
  const lowPoint = city.route.reduce((best, point) => (point[pollutant] < best[pollutant] ? point : best));
  const highPoint = city.route.reduce((best, point) => (point[pollutant] > best[pollutant] ? point : best));
  const maxRank = Math.max(...ranked.map((item) => item.summary[pollutant].mean));
  const heroBangkok = payload.cities.find((item) => item.slug === "bangkok")!;
  const replayDistance = city.distance_km * routeProgress;
  const replayPoint = city.route.reduce((nearest, point) => (
    Math.abs(point.km - replayDistance) < Math.abs(nearest.km - replayDistance) ? point : nearest
  ));
  const routeSoFar = city.route.filter((point) => point.km <= replayDistance + 0.001);
  const replayAverage = (routeSoFar.length ? routeSoFar : [city.route[0]])
    .reduce((total, point) => total + point[pollutant], 0) / Math.max(1, routeSoFar.length);

  return (
    <>
      <a className="skip-link" href="#main">Skip to the story</a>
      <header className="topbar">
        <div className="shell topbar-inner">
          <a className="brand" href="#top" aria-label="AirTrack by Air Aware Labs, back to top">
            <img className="airtrack-logo" src={logoUrl} alt="AirTrack" />
            <span className="brand-by">by Air Aware Labs</span>
          </a>
          <nav className="topnav" aria-label="Briefing sections">
            <a href="#overview">Compare</a>
            <a href="#routes">Routes</a>
            <a href="#notes" onClick={openMethod}>Method</a>
          </nav>
          <div className="share-actions">
            <button type="button" className="compact-button" onClick={() => window.print()}>Save as PDF</button>
            <button type="button" className="compact-button" onClick={share}>{shareLabel}</button>
          </div>
        </div>
      </header>

      <main id="main">
        <section className="hero" id="top">
          <div className="shell hero-grid">
            <div>
              <p className="eyebrow">Marathon route analysis</p>
              <h1>Air quality across five city routes</h1>
              <p className="hero-copy">
                AirTrack estimates background PM₂.₅, NO₂, ozone and PM₁₀ along four marathon courses and one Dakar running corridor, using the hours each event was on the road.
              </p>
              <div className="hero-actions">
                <a className="primary-button" href="#routes">View route results <span aria-hidden="true">↓</span></a>
                <a className="secondary-button" href="#notes" onClick={openMethod}>Read the model notes</a>
              </div>
            </div>
            <aside className="hero-card" aria-label="Key Bangkok finding">
              <p className="mini-label">Highest route average · PM₂.₅</p>
              <div className="hero-number">{heroBangkok.summary.pm25.mean}</div>
              <p className="hero-unit">µg/m³ averaged along the course</p>
              <h2>Bangkok · 30 November 2025</h2>
              <p>
                The AirTrack estimate is averaged across the 02:00 race window. Open the route to see how the value changes around the course.
              </p>
            </aside>
          </div>
        </section>

        <div className="signal-band">
          <div className="shell signals">
            <div className="signal"><strong>AirTrack output</strong><span>All route and city concentration estimates come from the AirTrack modelling engine.</span></div>
            <div className="signal"><strong>Reference data</strong><span>Monitors support model training and validation; they are not route measurements.</span></div>
            <div className="signal"><strong>Model scope</strong><span>Road closures and immediate roadside exposure are not explicitly modelled.</span></div>
          </div>
        </div>

        <section className="section" id="overview">
          <div className="shell">
            <div className="section-head">
              <p className="section-kicker">Route averages</p>
              <h2>A consistent AirTrack comparison</h2>
              <p>The same pollutants and units are used for every city, with the relevant event window in each location. Dakar is a planning corridor, not a marathon.</p>
            </div>
            <div className="comparison-card">
              <div className="comparison-intro">
                <p className="mini-label">Route-window average</p>
                <h3>{config.label} · {config.long}</h3>
                <p>Mean AirTrack concentration along the route and across its race or planning window.</p>
                {pollutantTabs(pollutant, setPollutant)}
              </div>
              <div>
                <div className="ranking">
                  {ranked.map((item, index) => (
                    <button
                      type="button"
                      className={`rank-row${index === 0 ? " is-outlier" : ""}`}
                      key={item.slug}
                      onClick={() => selectCity(item.slug, true)}
                      aria-label={`Open ${item.city}, ${item.summary[pollutant].mean} micrograms per cubic metre`}
                    >
                      <span className="rank-city">{item.city}</span>
                      <span className="rank-track"><span className="rank-bar" style={{ width: `${(item.summary[pollutant].mean / maxRank) * 100}%` }}/></span>
                      <span className="rank-value">{item.summary[pollutant].mean}<small>µg/m³</small></span>
                    </button>
                  ))}
                </div>
                <p className="context-note">
                  WHO reference: {config.reference} µg/m³ ({config.period}). Our route figures cover only the event hours, so this is context—not a like-for-like compliance test.
                </p>
              </div>
            </div>
          </div>
        </section>

        <section className="section section-blue" id="routes">
          <div className="shell">
            <div className="section-head">
              <p className="section-kicker">Course detail</p>
              <h2>How concentration changes along the route</h2>
              <p>The map is AirTrack’s 500 m background estimate. Course colours are scaled within the selected city so local changes remain visible.</p>
            </div>
            <div className="route-shell">
              <div className="city-tabs" role="group" aria-label="Choose a city">
                {ORDER.map((slug) => (
                  <button className="city-tab" type="button" key={slug} aria-pressed={selectedCity === slug} onClick={() => selectCity(slug)}>
                    {CITY_LABELS[slug]}
                  </button>
                ))}
              </div>
              <div className="route-top">
                <div className="route-visual">
                  <div className="route-title-row">
                    <div className="route-title">
                      <p className="mini-label">{city.slug === "dakar" ? "Planning corridor" : "Marathon course"}</p>
                      <h3>{city.city}</h3>
                      <p className="route-meta">{formatDate(city.date)} · {city.local_start} local start · {city.distance_km.toFixed(1)} km</p>
                    </div>
                    <span className={`evidence-badge ${EVIDENCE[city.confidence].className}`}>{EVIDENCE[city.confidence].label}</span>
                  </div>
                  {field && context ? (
                    <AirMap city={city} field={field} context={context} pollutant={pollutant} progress={routeProgress}/>
                  ) : (
                    <div className="map-frame map-loading">Drawing {city.city}…</div>
                  )}
                  <div className="replay-panel">
                    <button
                      type="button"
                      className="replay-button"
                      onClick={() => setRoutePlaying((playing) => !playing)}
                    >
                      <span className="replay-icon" aria-hidden="true">{routePlaying ? "Ⅱ" : "▶"}</span>
                      {routePlaying ? "Pause" : routeProgress < 0.999 ? "Continue" : "Replay route"}
                    </button>
                    <div className="replay-scrubber">
                      <input
                        type="range"
                        min="0"
                        max="1000"
                        value={Math.round(routeProgress * 1000)}
                        onChange={(event) => {
                          setRoutePlaying(false);
                          setRouteProgress(Number(event.target.value) / 1000);
                        }}
                        style={{ "--route-progress": `${routeProgress * 100}%` } as CSSProperties}
                        aria-label={`Move along the ${city.city} route`}
                        aria-valuetext={`${replayDistance.toFixed(1)} kilometres`}
                      />
                      <div className="replay-ends" aria-hidden="true"><span>Start</span><span>Finish</span></div>
                    </div>
                    <div className="replay-reading" aria-live="polite">
                      <strong>{replayDistance.toFixed(1)} km</strong>
                      <span>{replayPoint[pollutant].toFixed(1)} µg/m³ here</span>
                      <span>{replayAverage.toFixed(1)} µg/m³ average so far</span>
                    </div>
                  </div>
                  <p className="model-scope-note">
                    <strong>Model scope:</strong> historic background conditions at 500 m. Event road closures and the immediate roadside increment are not included.
                  </p>
                </div>
                <aside className="route-side">
                  {pollutantTabs(pollutant, setPollutant)}
                  <p className="route-story">{STORIES[city.slug]}</p>
                  {city.slug === "dakar" && (
                    <div className="dakar-context">
                      <strong>Dakar model context</strong>
                      <p>AirTrack’s route run includes emissions, population, built-up land, terrain and distance-to-coast features.</p>
                      <p>AAL has also prepared a separate 250 m Dakar city foundation with terrain, population, building height and mapped schools and health facilities. It is ready to support a Youth Olympics study, but it is not yet fused into the concentration estimates shown here.</p>
                    </div>
                  )}
                  <div className="metrics-grid">
                    <div className="metric">
                      <div className="metric-label">On the route</div>
                      <div className="metric-value">{summary.mean}<span> µg/m³</span></div>
                      <div className="metric-note">Mean during the route window</div>
                    </div>
                    <div className="metric">
                      <div className="metric-label">Along the course</div>
                      <div className="metric-value">{summary.min}–{summary.max}</div>
                      <div className="metric-note">Lowest to highest section</div>
                    </div>
                    <div className="metric">
                      <div className="metric-label">Reference monitors</div>
                      <div className="metric-value">{city.monitors.count}</div>
                      <div className="metric-note">In the comparable local panel</div>
                    </div>
                    <div className="metric">
                      <div className="metric-label">WHO context</div>
                      <div className="metric-value">{config.reference}<span> µg/m³</span></div>
                      <div className="metric-note">{config.period}; averaging period differs</div>
                    </div>
                  </div>
                  <div className="route-points">
                    <div className="route-point"><strong>Start</strong>0.0 km</div>
                    <div className="route-point"><strong>Lowest</strong>{lowPoint.km.toFixed(1)} km · {lowPoint[pollutant].toFixed(1)}</div>
                    <div className="route-point"><strong>Highest</strong>{highPoint.km.toFixed(1)} km · {highPoint[pollutant].toFixed(1)}</div>
                  </div>
                </aside>
              </div>
              <div className="route-charts">
                <div className="chart-panel">
                  <p className="mini-label">The course, kilometre by kilometre</p>
                  <h4>{config.label} along the route</h4>
                  <p className="chart-subtitle">The orange point marks the highest AirTrack value on this route.</p>
                  <div className="profile-wrap"><ProfileChart city={city} pollutant={pollutant} progress={routeProgress}/></div>
                </div>
                <div className="chart-panel">
                  <p className="mini-label">Timing matters</p>
                  <h4>The same route over 15 days</h4>
                  <p className="chart-subtitle">Seven days either side, using the same hours.</p>
                  <WeekBars city={city} pollutant={pollutant}/>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="section">
          <div className="shell">
            <div className="section-head">
              <p className="section-kicker">What this run suggests</p>
              <h2>Three points to investigate</h2>
              <p>These are early findings from the model run, not operational recommendations.</p>
            </div>
            <div className="insight-grid">
              <article className="insight" data-number="1">
                <p className="mini-label">Bangkok · start time</p>
                <h3>Check the start window, not only the route</h3>
                <p>The 02:00 race window had the highest PM₂.₅ estimate in this comparison. A separate study would be needed to test other start times and account for heat.</p>
              </article>
              <article className="insight" data-number="2">
                <p className="mini-label">Paris · race day</p>
                <h3>Day-to-day conditions changed more than the route</h3>
                <p>Paris race-day PM₂.₅ ranked second-lowest in the 15-day window. That makes timing an important part of any future planning test.</p>
              </article>
              <article className="insight" data-number="3">
                <p className="mini-label">Accra + Dakar · evidence</p>
                <h3>Do not over-read the low values</h3>
                <p>Neither city has a reference monitor in the local panel behind this analysis. Local measurement is needed before using these estimates for event decisions.</p>
              </article>
            </div>
          </div>
        </section>

        <section className="section method-section" id="notes">
          <div className="shell">
            <details className="method-disclosure">
              <summary>
                <span className="method-summary-copy">
                  <span className="section-kicker">Method and limitations</span>
                  <strong>How AirTrack produced these results</strong>
                  <span>Routes, model inputs, validation and the limits of the comparison.</span>
                </span>
                <span className="method-toggle" aria-hidden="true"><span>Open</span><span>Close</span></span>
              </summary>
              <div className="method-body">
              <div className="notes-list">
                <div className="note-item"><strong>AirTrack engine</strong><p>Every route and city estimate on this page is AirTrack output. Paris and London use AirTrack Europe; Bangkok, Accra and Dakar use AirTrack Global/RoW.</p></div>
                <div className="note-item"><strong>Routes</strong><p>Official course files for Paris, London and Bangkok; the measured Accra course from KML; and an 8.8 km Corniche corridor for Dakar. Accra’s 2026 measurement line is paired with the 2025 race-day window.</p></div>
                <div className="note-item"><strong>Time</strong><p>Concentrations are averaged across the hours participants were expected to be on the road. They describe the event window, not a full day.</p></div>
                <div className="note-item"><strong>Model inputs</strong><p>AirTrack combines a Copernicus CAMS or NASA GEOS-CF atmospheric prior with emissions, population, land and terrain features to estimate background concentration at 500 m.</p></div>
                <div className="note-item"><strong>Validation</strong><p>Reference-monitor observations support model training and evaluation where available. They are not direct measurements taken along these routes on race day.</p></div>
                <div className="note-item"><strong>Road closures</strong><p>Closure schedules were not added to this run. The model uses normal background and static emissions patterns, so it does not claim an event-specific traffic reduction.</p></div>
              </div>
              <div className="limitations method-limitations">
                <h3>Important limitations</h3>
                <div className="limitations-body">
                  <ul>
                    <li>These are 500 m background estimates. They do not include the immediate roadside increment that AirTrack can calculate separately.</li>
                    <li>Marathon road closures are not explicitly modelled. Future operational work should add closure data or compare the model with measurements collected on the route.</li>
                    <li>They are not personal dose estimates: breathing rate, pace and individual physiology are outside this comparison.</li>
                    <li>Accra and Dakar are indicative only because there is no local reference monitor in the panel used here.</li>
                    <li>Bangkok and Accra use exploratory 500 m grids outside the current sealed AirTrack Global/RoW serving registry; Dakar uses the sealed v1.3 grid.</li>
                    <li>The WHO markers use 24-hour values for PM and NO₂, and an 8-hour daily maximum for ozone. A race-window average is not a like-for-like test.</li>
                    <li>This is a historic briefing, not a live race forecast or medical advice.</li>
                  </ul>
                </div>
              </div>
              <div className="source-links" aria-label="Sources and further reading">
                <a href="https://www.who.int/publications/i/item/9789240034228" target="_blank" rel="noreferrer">WHO air quality guidelines ↗</a>
                <a href="https://atmosphere.copernicus.eu/" target="_blank" rel="noreferrer">Copernicus CAMS ↗</a>
                <a href="https://gmao.gsfc.nasa.gov/weather_prediction/GEOS-CF/" target="_blank" rel="noreferrer">NASA GEOS-CF ↗</a>
                <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">© OpenStreetMap contributors ↗</a>
              </div>
              </div>
            </details>
          </div>
        </section>
      </main>

      <footer className="footer">
        <div className="shell footer-inner">
          <a className="brand" href="https://www.airawarelabs.com/airtrack" target="_blank" rel="noreferrer">
            <img className="airtrack-logo" src={logoUrl} alt="AirTrack" />
            <span className="brand-by">by Air Aware Labs</span>
          </a>
          <p>Marathon route analysis · <a href="https://www.airawarelabs.com/airtrack" target="_blank" rel="noreferrer">About AirTrack</a></p>
        </div>
      </footer>
    </>
  );
}
