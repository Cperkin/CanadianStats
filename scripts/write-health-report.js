#!/usr/bin/env node

const fs = require("fs/promises");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const DATA_DIR = path.join(ROOT, "data");
const REPORT_PATH = path.join(DATA_DIR, "automation-health.json");

const PATHS = {
  universeMeta: path.join(DATA_DIR, "universe-meta.json"),
  top20Cache: path.join(DATA_DIR, "top20-cache.json"),
  budget: path.join(DATA_DIR, "api-budget.json")
};

async function readJson(filePath, fallback) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

function parseDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function ageHours(isoString) {
  const date = parseDate(isoString);
  if (!date) return null;
  return (Date.now() - date.getTime()) / (1000 * 60 * 60);
}

function toRounded(value, decimals = 1) {
  if (!Number.isFinite(value)) return null;
  return Number(value.toFixed(decimals));
}

function statusFromAges(universeAge, cacheAge) {
  if (!Number.isFinite(universeAge) || !Number.isFinite(cacheAge)) {
    return "degraded";
  }
  if (universeAge > 30 || cacheAge > 30) {
    return "stale";
  }
  return "healthy";
}

async function main() {
  const [universeMeta, top20Cache, budget] = await Promise.all([
    readJson(PATHS.universeMeta, {}),
    readJson(PATHS.top20Cache, { meta: {}, stocks: [] }),
    readJson(PATHS.budget, {})
  ]);

  const universeUpdatedAt = universeMeta.lastUpdatedAt || null;
  const top20UpdatedAt = top20Cache.meta?.lastUpdatedAt || null;
  const universeAge = ageHours(universeUpdatedAt);
  const top20Age = ageHours(top20UpdatedAt);

  const report = {
    generatedAt: new Date().toISOString(),
    status: statusFromAges(universeAge, top20Age),
    freshness: {
      universeUpdatedAt,
      universeAgeHours: toRounded(universeAge),
      top20UpdatedAt,
      top20AgeHours: toRounded(top20Age)
    },
    counts: {
      universeCount: universeMeta.counts?.total ?? null,
      scoredCount: top20Cache.meta?.scoredCount ?? null,
      displayedTopCount: Array.isArray(top20Cache.stocks) ? top20Cache.stocks.length : null
    },
    budget: {
      date: budget.date || null,
      top20Used: budget.top20Used ?? null,
      top20Limit: budget.top20Limit ?? null,
      trackedUsed: budget.trackedUsed ?? null,
      trackedLimit: budget.trackedLimit ?? null
    },
    notes: {
      universeMode: universeMeta.mode || null,
      top20Status: top20Cache.meta?.status || null
    }
  };

  await fs.writeFile(REPORT_PATH, JSON.stringify(report, null, 2) + "\n", "utf8");
  console.log(`Wrote health report to ${REPORT_PATH}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
