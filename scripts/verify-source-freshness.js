#!/usr/bin/env node

const fs = require("fs/promises");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const SOURCES_DIR = path.join(ROOT, "data", "sources");
const MAX_AGE_HOURS = Number(process.env.SOURCE_MAX_AGE_HOURS || "30");

const SOURCES = [
  { fileName: "nasdaqlisted.txt", required: true },
  { fileName: "otherlisted.txt", required: true },
  { fileName: "tsx-listed.csv", required: false }
];

function getAgeHours(mtimeMs) {
  return (Date.now() - mtimeMs) / (1000 * 60 * 60);
}

async function statSafe(filePath) {
  try {
    return await fs.stat(filePath);
  } catch {
    return null;
  }
}

async function main() {
  if (!Number.isFinite(MAX_AGE_HOURS) || MAX_AGE_HOURS <= 0) {
    throw new Error("SOURCE_MAX_AGE_HOURS must be a positive number.");
  }

  const failures = [];

  for (const source of SOURCES) {
    const filePath = path.join(SOURCES_DIR, source.fileName);
    const stats = await statSafe(filePath);

    if (!stats) {
      if (source.required) {
        failures.push(`${source.fileName}: missing`);
      } else {
        console.log(`[skip] ${source.fileName}: missing but optional`);
      }
      continue;
    }

    const ageHours = getAgeHours(stats.mtimeMs);
    if (source.required && ageHours > MAX_AGE_HOURS) {
      failures.push(`${source.fileName}: stale (${ageHours.toFixed(1)}h old)`);
      continue;
    }

    const level = source.required ? "ok" : "info";
    console.log(`[${level}] ${source.fileName}: ${ageHours.toFixed(1)}h old`);
  }

  if (failures.length) {
    throw new Error(`Freshness check failed (max ${MAX_AGE_HOURS}h): ${failures.join("; ")}`);
  }

  console.log(`Freshness check passed (max ${MAX_AGE_HOURS}h for required files).`);
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
