#!/usr/bin/env node

const fs = require("fs/promises");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const DATA_DIR = path.join(ROOT, "data");
const UNIVERSE_PATH = path.join(DATA_DIR, "universe.json");
const CACHE_PATH = path.join(DATA_DIR, "top20-cache.json");
const BUDGET_PATH = path.join(DATA_DIR, "api-budget.json");

const API_KEY = process.env.FMP_API_KEY;
const API_BASE = "https://financialmodelingprep.com/stable";
const TOP20_API_DAILY_LIMIT = 200;
const TOP20_DISPLAY_COUNT = 20;
const REQUEST_DELAY_MS = Number(process.env.FMP_REQUEST_DELAY_MS || 500);
const MAX_RETRIES = Number(process.env.FMP_HTTP_MAX_RETRIES || 3);
const MAX_RETRY_DELAY_MS = 20_000;
const MAX_NON_429_ERRORS = Number(process.env.FMP_MAX_NON_429_ERRORS || 10);

if (!API_KEY) {
  console.error("FMP_API_KEY is required to run update-top20-cache.js");
  process.exit(1);
}

function getBudgetDateKey() {
  return new Date().toISOString().slice(0, 10);
}

function buildDefaultBudget() {
  return {
    date: getBudgetDateKey(),
    trackedUsed: 0,
    trackedLimit: 50,
    top20Used: 0,
    top20Limit: TOP20_API_DAILY_LIMIT,
    lastResetAt: new Date().toISOString()
  };
}

async function readJson(filePath, fallback) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

async function writeJson(filePath, value) {
  await fs.writeFile(filePath, JSON.stringify(value, null, 2) + "\n");
}

class HttpError extends Error {
  constructor(status, message, retryAfterMs = null) {
    super(message);
    this.name = "HttpError";
    this.status = status;
    this.retryAfterMs = retryAfterMs;
  }
}

function isFinitePositiveNumber(value) {
  return Number.isFinite(value) && value > 0;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseRetryAfterMs(value) {
  if (!value) return null;
  const trimmed = String(value).trim();
  const seconds = Number(trimmed);
  if (isFinitePositiveNumber(seconds)) {
    return Math.round(seconds * 1000);
  }

  const timestamp = Date.parse(trimmed);
  if (!Number.isNaN(timestamp)) {
    const deltaMs = timestamp - Date.now();
    return deltaMs > 0 ? deltaMs : null;
  }

  return null;
}

function backoffDelayMs(attemptIndex) {
  const base = Math.min(MAX_RETRY_DELAY_MS, 1000 * (2 ** attemptIndex));
  const jitter = Math.floor(Math.random() * 300);
  return base + jitter;
}

async function fetchJson(url) {
  let attempt = 0;

  while (attempt <= MAX_RETRIES) {
    const response = await fetch(url);
    if (response.ok) {
      return response.json();
    }

    const status = response.status;
    const retryAfterMs = parseRetryAfterMs(response.headers.get("retry-after"));
    const isRetryable = status === 429 || (status >= 500 && status <= 599);
    const hasRetry = attempt < MAX_RETRIES;

    if (isRetryable && hasRetry) {
      const waitMs = retryAfterMs || backoffDelayMs(attempt);
      console.warn(`Request retry ${attempt + 1}/${MAX_RETRIES} after HTTP ${status}. Waiting ${waitMs}ms.`);
      await sleep(waitMs);
      attempt += 1;
      continue;
    }

    throw new HttpError(status, `HTTP ${status}`, retryAfterMs);
  }

  throw new Error("Unreachable fetch retry loop exit");
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function toScore(value) {
  return Math.round(clamp(value, 0, 100));
}

function parseRange(rangeText) {
  if (typeof rangeText !== "string" || !rangeText.includes("-")) {
    return { low: null, high: null };
  }

  const [lowRaw, highRaw] = rangeText.split("-");
  const low = Number(lowRaw);
  const high = Number(highRaw);
  if (!Number.isFinite(low) || !Number.isFinite(high) || high <= 0) {
    return { low: null, high: null };
  }

  return { low, high };
}

function drawdownScore(drawdownPct) {
  if (!Number.isFinite(drawdownPct)) {
    return 40;
  }
  return toScore((drawdownPct / 45) * 100);
}

function getTier(finalScore) {
  if (finalScore >= 80) return "A";
  if (finalScore >= 65) return "B";
  return "C";
}

function assessSourceConfidence(profile) {
  const fields = ["price", "marketCap", "beta", "lastDividend", "volume", "averageVolume", "range", "sector", "country", "fullTimeEmployees"];
  const available = fields.filter((field) => profile[field] !== undefined && profile[field] !== null && `${profile[field]}` !== "").length;
  const confidenceScore = toScore((available / fields.length) * 100);
  if (confidenceScore >= 85) return { label: "High", className: "high", score: confidenceScore };
  if (confidenceScore >= 65) return { label: "Medium", className: "medium", score: confidenceScore };
  return { label: "Low", className: "low", score: confidenceScore };
}

function scoreProfile(profile) {
  const price = Number(profile.price);
  const changePercentage = Number(profile.changePercentage);
  const marketCap = Number(profile.marketCap);
  const beta = Number(profile.beta);
  const volume = Number(profile.volume);
  const averageVolume = Number(profile.averageVolume);
  const lastDividend = Number(profile.lastDividend);
  const employeeCount = Number(profile.fullTimeEmployees);
  const { high } = parseRange(profile.range);

  const drawdownPct = Number.isFinite(price) && Number.isFinite(high) && high > 0 ? ((high - price) / high) * 100 : null;
  const volumeRatio = Number.isFinite(volume) && Number.isFinite(averageVolume) && averageVolume > 0 ? volume / averageVolume : null;

  const qualityDividendScore = Number.isFinite(lastDividend) && lastDividend > 0 ? 75 : 35;
  const qualitySectorScore = profile.sector ? 70 : 45;
  const qualityEmployeeScore = Number.isFinite(employeeCount) ? clamp(25 + Math.log10(Math.max(employeeCount, 10)) * 18, 35, 85) : 45;
  const qualityScore = toScore((qualityDividendScore + qualitySectorScore + qualityEmployeeScore) / 3);

  const strengthCapScore = Number.isFinite(marketCap) ? clamp((Math.log10(Math.max(marketCap, 1)) - 8) * 20, 20, 95) : 40;
  const strengthLiquidityScore = Number.isFinite(volumeRatio) ? clamp(volumeRatio * 75, 20, 95) : 40;
  const strengthBetaScore = Number.isFinite(beta) ? clamp(100 - Math.abs(beta - 1) * 45, 30, 95) : 50;
  const strengthScore = toScore((strengthCapScore + strengthLiquidityScore + strengthBetaScore) / 3);

  const valuationDrawdownScore = drawdownScore(drawdownPct);
  const valuationChangeScore = Number.isFinite(changePercentage) ? clamp(75 - changePercentage * 2.2, 20, 95) : 45;
  const valuationScore = toScore((valuationDrawdownScore * 0.75) + (valuationChangeScore * 0.25));

  const expectationsChangeScore = Number.isFinite(changePercentage) ? clamp(70 - Math.abs(changePercentage) * 5, 20, 90) : 45;
  const expectationsLiquidityScore = Number.isFinite(volumeRatio) ? clamp(30 + volumeRatio * 35, 20, 90) : 40;
  const expectationsScore = toScore((expectationsChangeScore + expectationsLiquidityScore) / 2);

  const riskFlags = [];
  if (Number.isFinite(drawdownPct) && drawdownPct > 55) riskFlags.push("Deep drawdown");
  if (Number.isFinite(beta) && beta > 1.7) riskFlags.push("High beta");
  if (Number.isFinite(volumeRatio) && volumeRatio < 0.55) riskFlags.push("Weak liquidity");
  if ((Number.isFinite(lastDividend) && lastDividend <= 0) || !Number.isFinite(lastDividend)) riskFlags.push("No dividend");
  if (Number.isFinite(marketCap) && marketCap < 2_000_000_000) riskFlags.push("Small-cap risk");

  const governanceRiskScore = toScore(90 - riskFlags.length * 16);
  const penaltyPoints = riskFlags.length * 4;
  const finalScore = toScore((qualityScore * 0.30) + (strengthScore * 0.25) + (valuationScore * 0.30) + (expectationsScore * 0.10) + (governanceRiskScore * 0.05) - penaltyPoints);

  return {
    drawdownPct,
    qualityScore,
    strengthScore,
    valuationScore,
    expectationsScore,
    governanceRiskScore,
    riskFlags,
    finalScore,
    tier: getTier(finalScore)
  };
}

async function fetchProfile(symbol) {
  const url = `${API_BASE}/profile?symbol=${encodeURIComponent(symbol)}&apikey=${API_KEY}`;
  const data = await fetchJson(url);
  return Array.isArray(data) ? data[0] || null : null;
}

async function main() {
  const universe = await readJson(UNIVERSE_PATH, []);
  if (!Array.isArray(universe) || !universe.length) {
    throw new Error("Universe is empty. Build data/universe.json first.");
  }

  const existingCache = await readJson(CACHE_PATH, { meta: {}, stocks: [] });
  const budget = await readJson(BUDGET_PATH, buildDefaultBudget());
  const currentBudget = budget.date === getBudgetDateKey() ? budget : buildDefaultBudget();
  let callsRemaining = Math.max(0, currentBudget.top20Limit - currentBudget.top20Used);

  if (callsRemaining <= 0) {
    await writeJson(CACHE_PATH, {
      meta: {
        ...existingCache.meta,
        lastUpdatedAt: existingCache.meta?.lastUpdatedAt || null,
        budgetUsed: currentBudget.top20Used,
        budgetLimit: currentBudget.top20Limit,
        universeCount: universe.length,
        scoredCount: existingCache.stocks?.length || 0,
        status: "Daily Top 20 budget exhausted."
      },
      stocks: existingCache.stocks || []
    });
    await writeJson(BUDGET_PATH, currentBudget);
    console.log("Top 20 budget exhausted for today.");
    return;
  }

  const candidates = universe.slice(0, Math.min(universe.length, callsRemaining));
  const scoredStocks = [];
  let rateLimited = false;
  let non429Errors = 0;

  for (const entry of candidates) {
    currentBudget.top20Used += 1;
    callsRemaining -= 1;

    let profile = null;
    try {
      profile = await fetchProfile(entry.fmpSymbol || entry.symbol);
    } catch (error) {
      if (error instanceof HttpError && error.status === 429) {
        rateLimited = true;
        console.warn(`Rate limited on ${entry.fmpSymbol || entry.symbol}; stopping early and keeping partial results.`);
        break;
      }

      non429Errors += 1;
      console.warn(`Skipping ${entry.fmpSymbol || entry.symbol} due to error: ${error.message || error}`);
      if (non429Errors >= MAX_NON_429_ERRORS) {
        console.warn(`Too many non-429 errors (${non429Errors}); stopping early.`);
        break;
      }

      if (callsRemaining <= 0) break;
      if (REQUEST_DELAY_MS > 0) {
        await sleep(REQUEST_DELAY_MS);
      }
      continue;
    }

    if (!profile || !profile.companyName) {
      if (callsRemaining <= 0) break;
      if (REQUEST_DELAY_MS > 0) {
        await sleep(REQUEST_DELAY_MS);
      }
      continue;
    }

    const score = scoreProfile(profile);
    const confidence = assessSourceConfidence(profile);
    scoredStocks.push({
      symbol: entry.symbol,
      name: profile.companyName,
      exchange: entry.exchange,
      country: entry.country,
      image: profile.image || "",
      price: new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 }).format(Number(profile.price || 0)),
      drawdownPct: score.drawdownPct,
      finalScore: score.finalScore,
      tier: score.tier,
      riskCount: score.riskFlags.length,
      confidenceLabel: confidence.label,
      confidenceClass: confidence.className
    });

    if (callsRemaining <= 0) break;
    if (REQUEST_DELAY_MS > 0) {
      await sleep(REQUEST_DELAY_MS);
    }
  }

  scoredStocks.sort((a, b) => b.finalScore - a.finalScore);

  const existingStocks = Array.isArray(existingCache.stocks) ? existingCache.stocks : [];
  const outputStocks = scoredStocks.length ? scoredStocks.slice(0, TOP20_DISPLAY_COUNT) : existingStocks;
  let status = "Top 20 cache updated from custom universe.";

  if (rateLimited) {
    status = scoredStocks.length
      ? "Partial Top 20 update due to provider rate limit (HTTP 429)."
      : "Provider rate limited immediately (HTTP 429); kept previous Top 20 snapshot.";
  } else if (non429Errors > 0) {
    status = `Partial Top 20 update with ${non429Errors} non-rate-limit fetch errors.`;
  }

  await writeJson(CACHE_PATH, {
    meta: {
      lastUpdatedAt: new Date().toISOString(),
      source: "custom-universe-cache",
      universeCount: universe.length,
      scoredCount: scoredStocks.length,
      budgetUsed: currentBudget.top20Used,
      budgetLimit: currentBudget.top20Limit,
      status
    },
    stocks: outputStocks
  });

  currentBudget.lastResetAt = new Date().toISOString();
  await writeJson(BUDGET_PATH, currentBudget);
  console.log(`Updated Top 20 cache using ${currentBudget.top20Used}/${currentBudget.top20Limit} daily top20 calls.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
