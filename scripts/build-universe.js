#!/usr/bin/env node

const fs = require("fs/promises");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const DATA_DIR = path.join(ROOT, "data");
const SOURCES_DIR = path.join(DATA_DIR, "sources");
const UNIVERSE_PATH = path.join(DATA_DIR, "universe.json");
const META_PATH = path.join(DATA_DIR, "universe-meta.json");
const OVERRIDES_PATH = path.join(DATA_DIR, "symbol-overrides.json");

const SOURCE_FILES = {
  nasdaqListed: path.join(SOURCES_DIR, "nasdaqlisted.txt"),
  otherListed: path.join(SOURCES_DIR, "otherlisted.txt"),
  tsxListed: path.join(SOURCES_DIR, "tsx-listed.csv")
};

const FALLBACK_UNIVERSE = require(path.join(DATA_DIR, "universe.json"));

function normalizeTicker(value) {
  return String(value || "").trim().toUpperCase();
}

function isCommonStockName(name) {
  const text = String(name || "").toLowerCase();
  const blocked = ["etf", "trust", "warrant", "rights", "preferred", "pref", "unit"];
  return !blocked.some((token) => text.includes(token));
}

async function readJson(filePath, fallback = {}) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

async function readText(filePath) {
  return fs.readFile(filePath, "utf8");
}

function parsePipeFile(content) {
  const lines = content.split(/\r?\n/).filter(Boolean);
  const headers = lines[0].split("|").map((value) => value.trim());

  return lines.slice(1)
    .filter((line) => !line.startsWith("File Creation Time"))
    .map((line) => {
      const values = line.split("|");
      const row = {};
      headers.forEach((header, index) => {
        row[header] = values[index] ? values[index].trim() : "";
      });
      return row;
    });
}

function parseCsv(content) {
  const lines = content.split(/\r?\n/).filter(Boolean);
  const headers = lines[0].split(",").map((value) => value.trim().replace(/^"|"$/g, ""));

  return lines.slice(1).map((line) => {
    const values = line.split(",").map((value) => value.trim().replace(/^"|"$/g, ""));
    const row = {};
    headers.forEach((header, index) => {
      row[header] = values[index] || "";
    });
    return row;
  });
}

function buildNasdaqUniverse(rows, overrides) {
  return rows
    .filter((row) => row.Symbol && row["Test Issue"] !== "Y" && row.ETF !== "Y")
    .filter((row) => isCommonStockName(row["Security Name"]))
    .map((row) => {
      const symbol = normalizeTicker(row.Symbol);
      return {
        symbol,
        fmpSymbol: overrides[symbol] || symbol,
        name: row["Security Name"],
        exchange: "NASDAQ",
        country: "US",
        assetType: "Common Stock",
        active: true,
        source: "nasdaqlisted.txt",
        updatedAt: new Date().toISOString()
      };
    });
}

function buildNyseUniverse(rows, overrides) {
  return rows
    .filter((row) => row["ACT Symbol"] && row.Exchange === "N" && row["Test Issue"] !== "Y" && row.ETF !== "Y")
    .filter((row) => isCommonStockName(row["Security Name"]))
    .map((row) => {
      const symbol = normalizeTicker(row["ACT Symbol"]);
      return {
        symbol,
        fmpSymbol: overrides[symbol] || symbol,
        name: row["Security Name"],
        exchange: "NYSE",
        country: "US",
        assetType: "Common Stock",
        active: true,
        source: "otherlisted.txt",
        updatedAt: new Date().toISOString()
      };
    });
}

function buildTsxUniverse(rows, overrides) {
  return rows
    .filter((row) => normalizeTicker(row.exchange || row.Exchange) === "TSX")
    .filter((row) => isCommonStockName(row.name || row.Name))
    .map((row) => {
      const symbol = normalizeTicker(row.symbol || row.Symbol);
      const name = row.name || row.Name;
      return {
        symbol,
        fmpSymbol: overrides[symbol] || symbol,
        name,
        exchange: "TSX",
        country: "CA",
        assetType: "Common Stock",
        active: true,
        source: "tsx-listed.csv",
        updatedAt: new Date().toISOString()
      };
    })
    .filter((row) => row.symbol);
}

function dedupeUniverse(rows) {
  const seen = new Set();
  return rows.filter((row) => {
    if (!row.fmpSymbol || seen.has(row.fmpSymbol)) {
      return false;
    }
    seen.add(row.fmpSymbol);
    return true;
  });
}

async function main() {
  const overrides = await readJson(OVERRIDES_PATH, {});
  const universe = [];
  const sources = [];

  try {
    const nasdaqRows = parsePipeFile(await readText(SOURCE_FILES.nasdaqListed));
    universe.push(...buildNasdaqUniverse(nasdaqRows, overrides));
    sources.push("nasdaqlisted.txt");
  } catch {}

  try {
    const nyseRows = parsePipeFile(await readText(SOURCE_FILES.otherListed));
    universe.push(...buildNyseUniverse(nyseRows, overrides));
    sources.push("otherlisted.txt");
  } catch {}

  try {
    const tsxRows = parseCsv(await readText(SOURCE_FILES.tsxListed));
    universe.push(...buildTsxUniverse(tsxRows, overrides));
    sources.push("tsx-listed.csv");
  } catch {}

  const finalUniverse = dedupeUniverse(universe);

  if (!finalUniverse.length) {
    const fallbackMeta = {
      lastUpdatedAt: new Date().toISOString(),
      mode: "seed-fallback",
      notes: "Source files were unavailable; preserved existing seed universe.",
      sources: ["seed-universe"],
      counts: {
        NASDAQ: FALLBACK_UNIVERSE.filter((row) => row.exchange === "NASDAQ").length,
        NYSE: FALLBACK_UNIVERSE.filter((row) => row.exchange === "NYSE").length,
        TSX: FALLBACK_UNIVERSE.filter((row) => row.exchange === "TSX").length,
        total: FALLBACK_UNIVERSE.length
      }
    };

    await fs.writeFile(META_PATH, JSON.stringify(fallbackMeta, null, 2) + "\n");
    console.log("No raw source files found. Kept existing seed universe.");
    return;
  }

  const meta = {
    lastUpdatedAt: new Date().toISOString(),
    mode: "full-source-build",
    notes: "Universe generated from local source files under data/sources/.",
    sources,
    counts: {
      NASDAQ: finalUniverse.filter((row) => row.exchange === "NASDAQ").length,
      NYSE: finalUniverse.filter((row) => row.exchange === "NYSE").length,
      TSX: finalUniverse.filter((row) => row.exchange === "TSX").length,
      total: finalUniverse.length
    }
  };

  await fs.writeFile(UNIVERSE_PATH, JSON.stringify(finalUniverse, null, 2) + "\n");
  await fs.writeFile(META_PATH, JSON.stringify(meta, null, 2) + "\n");
  console.log(`Universe built with ${finalUniverse.length} symbols.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
