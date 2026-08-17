import type { Season, WeatherInfo } from "@/lib/types";

const WEATHER_CODES: Record<number, string> = {
  0: "Clear",
  1: "Mostly clear",
  2: "Partly cloudy",
  3: "Overcast",
  45: "Foggy",
  48: "Foggy",
  51: "Light drizzle",
  53: "Drizzle",
  55: "Heavy drizzle",
  61: "Light rain",
  63: "Rain",
  65: "Heavy rain",
  71: "Light snow",
  73: "Snow",
  75: "Heavy snow",
  80: "Rain showers",
  81: "Rain showers",
  82: "Violent showers",
  95: "Thunderstorm",
  96: "Thunderstorm",
  99: "Thunderstorm",
};

export async function geocodeZip(zip: string, country = "US") {
  const res = await fetch(`https://api.zippopotam.us/${country.toLowerCase()}/${zip}`, {
    next: { revalidate: 86400 },
  });
  if (!res.ok) throw new Error(`zip lookup failed for ${zip}`);
  const json = await res.json();
  const place = json.places?.[0];
  if (!place) throw new Error(`no place for zip ${zip}`);
  return {
    lat: parseFloat(place.latitude),
    lon: parseFloat(place.longitude),
    place_name: `${place["place name"]}, ${place["state abbreviation"] ?? place.state}`,
  };
}

function currentSeason(lat: number): Season {
  const m = new Date().getMonth(); // 0-11
  const north = lat >= 0;
  const seasons: Season[] = north
    ? ["winter", "winter", "spring", "spring", "spring", "summer", "summer", "summer", "fall", "fall", "fall", "winter"]
    : ["summer", "summer", "fall", "fall", "fall", "winter", "winter", "winter", "spring", "spring", "spring", "summer"];
  return seasons[m];
}

function clothingHint(tempF: number, code: number, precip: number): string {
  const wet = precip > 40 || [51, 53, 55, 61, 63, 65, 80, 81, 82, 95, 96, 99].includes(code);
  if (tempF >= 85) return `Hot out — breathable fabrics, light colors, shorts territory.${wet ? " Pack for rain." : ""}`;
  if (tempF >= 70) return `Warm and easy — tees, light layers optional.${wet ? " Bring a light rain layer." : ""}`;
  if (tempF >= 55) return `Mild — perfect layering weather: light jacket or overshirt.${wet ? " Water-resistant outer layer recommended." : ""}`;
  if (tempF >= 40) return `Chilly — proper jacket, knitwear, closed shoes.${wet ? " Waterproof layer and boots." : ""}`;
  return `Cold — heavy coat, layers, warm footwear.${wet ? " Waterproof everything." : ""}`;
}

export async function getWeather(opts: {
  lat: number;
  lon: number;
  place: string;
}): Promise<WeatherInfo> {
  const { lat, lon, place } = opts;
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,weather_code,wind_speed_10m&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max&temperature_unit=fahrenheit&wind_speed_unit=mph&timezone=auto&forecast_days=1`;
  const res = await fetch(url, { next: { revalidate: 1800 } });
  if (!res.ok) throw new Error("weather fetch failed");
  const json = await res.json();
  const code = json.current.weather_code as number;
  const temp = Math.round(json.current.temperature_2m);
  const precip = json.daily.precipitation_probability_max?.[0] ?? 0;
  return {
    place,
    temp_f: temp,
    high_f: Math.round(json.daily.temperature_2m_max[0]),
    low_f: Math.round(json.daily.temperature_2m_min[0]),
    condition: WEATHER_CODES[code] ?? "—",
    code,
    wind_mph: Math.round(json.current.wind_speed_10m),
    precip_chance: precip,
    season: currentSeason(lat),
    clothing_hint: clothingHint(temp, code, precip),
  };
}
