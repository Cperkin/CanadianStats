#!/usr/bin/env node

const fs = require("fs/promises");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const SOURCES_DIR = path.join(ROOT, "data", "sources");

const SOURCE_DEFINITIONS = [
  {
    key: "NASDAQ_SOURCE_URL",
    fileName: "nasdaqlisted.txt",
    required: true,
    defaultUrl: "https://www.nasdaqtrader.com/dynamic/SymDir/nasdaqlisted.txt"
  },
  {
    key: "NYSE_SOURCE_URL",
    fileName: "otherlisted.txt",
    required: true,
    defaultUrl: "https://www.nasdaqtrader.com/dynamic/SymDir/otherlisted.txt"
  },
  {
    key: "TSX_SOURCE_URL",
    fileName: "tsx-listed.csv",
    required: false,
    defaultUrl: ""
  }
];

function getUrl(definition) {
  const fromEnv = process.env[definition.key];
  if (typeof fromEnv === "string" && fromEnv.trim()) {
    return fromEnv.trim();
  }
  return definition.defaultUrl;
}

async function ensureDirectory(dirPath) {
  await fs.mkdir(dirPath, { recursive: true });
}

async function fetchText(url) {
  const response = await fetch(url, {
    redirect: "follow",
    headers: {
      "User-Agent": "CanadianStatsBot/1.0"
    }
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  const text = await response.text();
  if (!text.trim()) {
    throw new Error("Empty response body");
  }

  return text;
}

async function writeIfChanged(filePath, content) {
  try {
    const current = await fs.readFile(filePath, "utf8");
    if (current === content) {
      return false;
    }
  } catch {}

  await fs.writeFile(filePath, content, "utf8");
  return true;
}

async function updateSource(definition) {
  const url = getUrl(definition);
  const targetPath = path.join(SOURCES_DIR, definition.fileName);

  if (!url) {
    if (definition.required) {
      throw new Error(`${definition.key} is required but not set.`);
    }

    return {
      fileName: definition.fileName,
      status: "skipped",
      message: `${definition.key} is not configured.`
    };
  }

  const text = await fetchText(url);
  const changed = await writeIfChanged(targetPath, text);

  return {
    fileName: definition.fileName,
    status: changed ? "updated" : "unchanged",
    message: `Fetched from ${url}`
  };
}

async function main() {
  await ensureDirectory(SOURCES_DIR);

  const results = [];
  let failures = 0;

  for (const definition of SOURCE_DEFINITIONS) {
    try {
      const result = await updateSource(definition);
      results.push(result);
      console.log(`[${result.status}] ${result.fileName}: ${result.message}`);
    } catch (error) {
      failures += 1;
      results.push({
        fileName: definition.fileName,
        status: "failed",
        message: String(error.message || error)
      });
      console.error(`[failed] ${definition.fileName}: ${error.message}`);
      if (definition.required) {
        throw new Error(`Required source update failed for ${definition.fileName}`);
      }
    }
  }

  const updatedCount = results.filter((item) => item.status === "updated").length;
  const unchangedCount = results.filter((item) => item.status === "unchanged").length;
  const skippedCount = results.filter((item) => item.status === "skipped").length;

  console.log(`Fetch summary: updated=${updatedCount}, unchanged=${unchangedCount}, skipped=${skippedCount}, failures=${failures}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
