import "server-only";

import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";

import type { ImportedPlanTable, PlanImportHints } from "@/lib/plan-import";

type StagedPlanImportPayload = {
  traceId: string;
  eventoId: string;
  eventName?: string;
  fileName: string;
  hints?: PlanImportHints;
  importedTables: ImportedPlanTable[];
};

type ValidatedIndexRow = {
  traceId?: string;
  fileName?: string;
  samplePath?: string;
  sampleSignature?: string | null;
  expectedTableCount?: number;
  expectedChairTotal?: number;
  expectedRowCount?: number;
  expectedColumnCount?: number;
  eventName?: string | null;
  validatedAt?: string;
};

export type ValidatedPositionPrior = {
  positionIndex: number;
  chairCounts: number[];
  mostCommonChairCount: number | null;
};

export type ValidatedPlanPriors = {
  matchingExampleCount: number;
  priorsByPosition: ValidatedPositionPrior[];
};

export type ValidatedMesaNumberPrior = {
  numero: number;
  chairCounts: number[];
  mostCommonChairCount: number | null;
};

export type ValidatedMesaNumberPriors = {
  matchingExampleCount: number;
  priorsByMesaNumber: ValidatedMesaNumberPrior[];
};

const ROOT_DIR = path.resolve(process.cwd(), ".plan-import-feedback");
const STAGED_DIR = path.join(ROOT_DIR, "staged");
const VALIDATED_DIR = path.join(ROOT_DIR, "validated");
const VALIDATED_INDEX_PATH = path.join(ROOT_DIR, "validated-index.json");
const VALIDATED_INDEX_LOCK_DIR = path.join(ROOT_DIR, "validated-index.lock");
const VALIDATED_INDEX_LOCK_INFO_PATH = path.join(VALIDATED_INDEX_LOCK_DIR, "owner.json");
const VALIDATED_INDEX_LOCK_TIMEOUT_MS = 5000;
const VALIDATED_INDEX_LOCK_RETRY_MS = 50;
const VALIDATED_INDEX_LOCK_STALE_MS = 60000;

type ValidatedPlanMatchHints = Pick<
  PlanImportHints,
  | "expectedTableCount"
  | "expectedChairTotal"
  | "expectedRowCount"
  | "expectedColumnCount"
  | "eventName"
>;

type ValidatedIndexEntry = ValidatedIndexRow & {
  eventoId?: string;
  imagePath?: string;
  imageSha256?: string | null;
};

type StoredValidatedPlanSample = StagedPlanImportPayload & {
  imagePath?: string;
  imageSha256?: string | null;
  stagedAt?: string;
  validatedAt?: string;
};

type HydratedValidatedIndexEntry = {
  row: ValidatedIndexEntry;
  sample: StoredValidatedPlanSample | null;
};

type ValidatedRowMatch = {
  row: ValidatedIndexEntry;
  similarity: number;
  activeFieldCount: number;
};

const VALIDATED_MATCH_WEIGHTS = {
  expectedTableCount: 3,
  expectedChairTotal: 2,
  expectedRowCount: 2,
  expectedColumnCount: 2,
  eventName: 1,
} satisfies Record<keyof ValidatedPlanMatchHints, number>;

function isInteger(value: unknown): value is number {
  return Number.isInteger(value);
}

function groupImportedTablesIntoRows(tables: ImportedPlanTable[]) {
  if (tables.length === 0) {
    return [] as ImportedPlanTable[][];
  }

  const minY = Math.min(...tables.map((table) => table.posY));
  const maxY = Math.max(...tables.map((table) => table.posY));
  const spanY = Math.max(1, maxY - minY);
  const rowThreshold = Math.max(
    44,
    spanY / Math.max(3, Math.round(Math.sqrt(tables.length) * 1.8)),
  );
  const sorted = [...tables].sort((a, b) =>
    Math.abs(a.posY - b.posY) < rowThreshold * 0.45 ? a.posX - b.posX : a.posY - b.posY,
  );
  const rows: ImportedPlanTable[][] = [];

  for (const table of sorted) {
    const currentRow = rows[rows.length - 1];
    if (!currentRow) {
      rows.push([table]);
      continue;
    }

    const averageY =
      currentRow.reduce((sum, rowTable) => sum + rowTable.posY, 0) / currentRow.length;
    if (Math.abs(table.posY - averageY) <= rowThreshold) {
      currentRow.push(table);
      continue;
    }

    rows.push([table]);
  }

  return rows.map((row) => row.sort((a, b) => a.posX - b.posX));
}

function sortImportedTablesByVisualOrder(tables: ImportedPlanTable[]) {
  return groupImportedTablesIntoRows(tables).flat();
}

function getImportedTableGridMetrics(tables: ImportedPlanTable[]) {
  return {
    tableCount: tables.length,
    rowCount: new Set(tables.map((table) => table.posY)).size,
    columnCount: new Set(tables.map((table) => table.posX)).size,
    chairTotal: tables.reduce((sum, table) => sum + table.chairCount, 0),
  };
}

function buildValidatedSampleSignature(sample: {
  eventName?: string | null;
  hints?: PlanImportHints;
  importedTables: ImportedPlanTable[];
}) {
  const orderedTables = sortImportedTablesByVisualOrder(sample.importedTables);
  const metrics = getImportedTableGridMetrics(orderedTables);
  const normalizedSignaturePayload = {
    eventName: normalizeEventName(sample.eventName ?? sample.hints?.eventName),
    expectedTableCount: sample.hints?.expectedTableCount ?? metrics.tableCount,
    expectedChairTotal: sample.hints?.expectedChairTotal ?? metrics.chairTotal,
    expectedRowCount: sample.hints?.expectedRowCount ?? metrics.rowCount,
    expectedColumnCount: sample.hints?.expectedColumnCount ?? metrics.columnCount,
    orderedTables: orderedTables.map((table) => ({
      numero: table.numero,
      chairCount: table.chairCount,
    })),
  };

  return createHash("sha256")
    .update(JSON.stringify(normalizedSignaturePayload))
    .digest("hex");
}

async function readValidatedSample(
  samplePath: string | undefined,
): Promise<StoredValidatedPlanSample | null> {
  if (!samplePath) {
    return null;
  }

  try {
    const rawSample = await fs.readFile(samplePath, "utf8");
    return JSON.parse(rawSample) as StoredValidatedPlanSample;
  } catch {
    return null;
  }
}

async function hydrateValidatedIndexEntry(
  row: ValidatedIndexEntry,
): Promise<HydratedValidatedIndexEntry> {
  const sample = await readValidatedSample(row.samplePath);

  if (!sample) {
    return {
      row,
      sample: null,
    };
  }

  return {
    row: {
      ...row,
      imageSha256: row.imageSha256 ?? sample.imageSha256 ?? null,
      sampleSignature: row.sampleSignature ?? buildValidatedSampleSignature(sample),
    },
    sample,
  };
}

function getValidatedIndexIdentityKeys(row: ValidatedIndexEntry) {
  const keys: string[] = [];

  if (row.sampleSignature) {
    keys.push(`signature:${row.sampleSignature}`);
  }

  if (row.imageSha256) {
    keys.push(`image:${row.imageSha256}`);
  }

  if (keys.length === 0) {
    keys.push(`fallback:${row.samplePath ?? row.traceId ?? row.fileName ?? "unknown"}`);
  }

  return keys;
}

function hasSharedValidatedIndexIdentity(
  left: ValidatedIndexEntry,
  right: ValidatedIndexEntry,
) {
  const rightKeys = new Set(getValidatedIndexIdentityKeys(right));
  return getValidatedIndexIdentityKeys(left).some((key) => rightKeys.has(key));
}

function scoreValidatedIndexRow(row: ValidatedIndexRow, hints: ValidatedPlanMatchHints) {
  let score = 0;

  if (
    isInteger(row.expectedTableCount) &&
    isInteger(hints.expectedTableCount)
  ) {
    score += Math.abs(row.expectedTableCount - hints.expectedTableCount) * 8;
  }

  if (
    isInteger(row.expectedChairTotal) &&
    isInteger(hints.expectedChairTotal)
  ) {
    score += Math.abs(row.expectedChairTotal - hints.expectedChairTotal);
  }

  if (isInteger(row.expectedRowCount) && isInteger(hints.expectedRowCount)) {
    score += Math.abs(row.expectedRowCount - hints.expectedRowCount) * 5;
  }

  if (
    isInteger(row.expectedColumnCount) &&
    isInteger(hints.expectedColumnCount)
  ) {
    score += Math.abs(row.expectedColumnCount - hints.expectedColumnCount) * 5;
  }

  const eventNameSimilarity = scoreEventNameSimilarity(row.eventName, hints.eventName);
  if (typeof eventNameSimilarity === "number") {
    score += Math.round((1 - eventNameSimilarity) * 10);
  }

  return score;
}

function normalizeEventName(value?: string | null) {
  return value
    ?.normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim() ?? "";
}

function scoreEventNameSimilarity(
  rowEventName?: string | null,
  hintEventName?: string | null,
) {
  const normalizedHint = normalizeEventName(hintEventName);
  if (!normalizedHint) {
    return null;
  }

  const normalizedRow = normalizeEventName(rowEventName);
  if (!normalizedRow) {
    return null;
  }

  if (normalizedRow === normalizedHint) {
    return 1;
  }

  if (
    normalizedRow.length >= 6 &&
    normalizedHint.length >= 6 &&
    (normalizedRow.includes(normalizedHint) || normalizedHint.includes(normalizedRow))
  ) {
    return 0.92;
  }

  const rowTokens = new Set(normalizedRow.split(" ").filter((token) => token.length >= 2));
  const hintTokens = new Set(normalizedHint.split(" ").filter((token) => token.length >= 2));
  if (rowTokens.size === 0 || hintTokens.size === 0) {
    return 0;
  }

  let sharedTokenCount = 0;
  for (const token of hintTokens) {
    if (rowTokens.has(token)) {
      sharedTokenCount += 1;
    }
  }

  return sharedTokenCount / Math.max(rowTokens.size, hintTokens.size);
}

function scoreNumericSimilarity(
  actualValue: number | undefined,
  expectedValue: number | undefined,
  minimumTolerance: number,
  relativeTolerance = 0,
) {
  if (!isInteger(actualValue) || !isInteger(expectedValue)) {
    return null;
  }

  const tolerance = Math.max(
    minimumTolerance,
    Math.round(Math.max(Math.abs(actualValue), Math.abs(expectedValue)) * relativeTolerance),
  );
  const difference = Math.abs(actualValue - expectedValue);

  if (difference > tolerance) {
    return 0;
  }

  return 1 - difference / (tolerance + 1);
}

function getActiveValidatedHintFieldCount(hints: ValidatedPlanMatchHints) {
  return ([
    hints.expectedTableCount,
    hints.expectedChairTotal,
    hints.expectedRowCount,
    hints.expectedColumnCount,
    hints.eventName?.trim(),
  ]).filter((value) =>
    typeof value === "string" ? value.length > 0 : isInteger(value),
  ).length;
}

function getValidatedMatchThreshold(activeFieldCount: number) {
  if (activeFieldCount <= 1) {
    return 0.92;
  }

  if (activeFieldCount === 2) {
    return 0.72;
  }

  if (activeFieldCount === 3) {
    return 0.6;
  }

  return 0.52;
}

function getValidatedRowMatch(
  row: ValidatedIndexEntry,
  hints: ValidatedPlanMatchHints,
): ValidatedRowMatch | null {
  const activeFieldCount = getActiveValidatedHintFieldCount(hints);
  if (activeFieldCount === 0) {
    return null;
  }

  let weightedScore = 0;
  let totalWeight = 0;

  const fieldScores = {
    expectedTableCount: scoreNumericSimilarity(
      row.expectedTableCount,
      hints.expectedTableCount,
      1,
      0.08,
    ),
    expectedChairTotal: scoreNumericSimilarity(
      row.expectedChairTotal,
      hints.expectedChairTotal,
      6,
      0.15,
    ),
    expectedRowCount: scoreNumericSimilarity(
      row.expectedRowCount,
      hints.expectedRowCount,
      1,
    ),
    expectedColumnCount: scoreNumericSimilarity(
      row.expectedColumnCount,
      hints.expectedColumnCount,
      1,
    ),
    eventName: scoreEventNameSimilarity(row.eventName, hints.eventName),
  } satisfies Record<keyof ValidatedPlanMatchHints, number | null>;

  for (const [field, weight] of Object.entries(VALIDATED_MATCH_WEIGHTS) as Array<
    [keyof ValidatedPlanMatchHints, number]
  >) {
    const hintValue = hints[field];
    const isActiveHint =
      typeof hintValue === "string" ? hintValue.trim().length > 0 : isInteger(hintValue);
    if (!isActiveHint) {
      continue;
    }

    totalWeight += weight;
    weightedScore += (fieldScores[field] ?? 0) * weight;
  }

  if (totalWeight === 0) {
    return null;
  }

  const similarity = weightedScore / totalWeight;
  if (similarity < getValidatedMatchThreshold(activeFieldCount)) {
    return null;
  }

  return {
    row,
    similarity,
    activeFieldCount,
  };
}

async function readValidatedIndexRows() {
  try {
    const rawIndex = await fs.readFile(VALIDATED_INDEX_PATH, "utf8");
    const parsedIndex = JSON.parse(rawIndex);
    return Array.isArray(parsedIndex) ? (parsedIndex as ValidatedIndexEntry[]) : [];
  } catch {
    return [] as ValidatedIndexEntry[];
  }
}

async function sleep(milliseconds: number) {
  await new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function getValidatedIndexLockAgeMs() {
  try {
    const rawLockInfo = await fs.readFile(VALIDATED_INDEX_LOCK_INFO_PATH, "utf8");
    const parsedLockInfo = JSON.parse(rawLockInfo) as { acquiredAt?: string };
    const acquiredAtMs = Date.parse(parsedLockInfo.acquiredAt ?? "");
    if (!Number.isNaN(acquiredAtMs)) {
      return Date.now() - acquiredAtMs;
    }
  } catch {}

  try {
    const lockStats = await fs.stat(VALIDATED_INDEX_LOCK_DIR);
    return Date.now() - lockStats.mtimeMs;
  } catch {
    return null;
  }
}

async function recoverStaleValidatedIndexLock() {
  const lockAgeMs = await getValidatedIndexLockAgeMs();
  if (lockAgeMs === null || lockAgeMs < VALIDATED_INDEX_LOCK_STALE_MS) {
    return false;
  }

  const recoveredLockDir = path.join(
    ROOT_DIR,
    `validated-index.lock.recovered.${Date.now()}-${Math.random().toString(16).slice(2)}`,
  );

  try {
    await fs.rename(VALIDATED_INDEX_LOCK_DIR, recoveredLockDir);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || code === "EPERM" || code === "EBUSY") {
      return false;
    }

    throw error;
  }

  await fs.rm(recoveredLockDir, { recursive: true, force: true });
  return true;
}

async function withValidatedIndexLock<T>(callback: () => Promise<T>) {
  await fs.mkdir(ROOT_DIR, { recursive: true });
  const deadline = Date.now() + VALIDATED_INDEX_LOCK_TIMEOUT_MS;

  while (true) {
    try {
      await fs.mkdir(VALIDATED_INDEX_LOCK_DIR);
      try {
        await fs.writeFile(
          VALIDATED_INDEX_LOCK_INFO_PATH,
          JSON.stringify(
            {
              acquiredAt: new Date().toISOString(),
            },
            null,
            2,
          ),
          "utf8",
        );
      } catch (error) {
        await fs.rm(VALIDATED_INDEX_LOCK_DIR, { recursive: true, force: true });
        throw error;
      }
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
        throw error;
      }

      if (await recoverStaleValidatedIndexLock()) {
        continue;
      }

      if (Date.now() >= deadline) {
        throw new Error("Timed out waiting for validated plan index lock.");
      }

      await sleep(VALIDATED_INDEX_LOCK_RETRY_MS);
    }
  }

  try {
    return await callback();
  } finally {
    await fs.rm(VALIDATED_INDEX_LOCK_DIR, { recursive: true, force: true });
  }
}

async function writeValidatedIndexRows(indexRows: ValidatedIndexEntry[]) {
  const tempPath = path.join(
    ROOT_DIR,
    `validated-index.${Date.now()}-${Math.random().toString(16).slice(2)}.tmp`,
  );
  const tempFile = await fs.open(tempPath, "w");

  try {
    await tempFile.writeFile(JSON.stringify(indexRows, null, 2), "utf8");
    await tempFile.sync();
  } finally {
    await tempFile.close();
  }

  await fs.rename(tempPath, VALIDATED_INDEX_PATH);
}

async function getMatchedValidatedIndexRows(
  hints: ValidatedPlanMatchHints,
  limit: number,
) {
  if (limit <= 0 || getActiveValidatedHintFieldCount(hints) === 0) {
    return [] as ValidatedIndexEntry[];
  }

  const indexRows = await readValidatedIndexRows();
  const hydratedRows = await Promise.all(
    indexRows
      .filter((row) => row.samplePath)
      .map((row) => hydrateValidatedIndexEntry(row)),
  );
  const rankedRows = hydratedRows
    .map(({ row }) => {
      const match = getValidatedRowMatch(row, hints);
      return match
        ? {
            row,
            similarity: match.similarity,
            score: scoreValidatedIndexRow(row, hints),
          }
        : null;
    })
    .filter((entry): entry is { row: ValidatedIndexEntry; similarity: number; score: number } =>
      Boolean(entry),
    )
    .sort((a, b) =>
      b.similarity === a.similarity
        ? a.score === b.score
          ? String(b.row.validatedAt ?? "").localeCompare(String(a.row.validatedAt ?? ""))
          : a.score - b.score
        : b.similarity - a.similarity,
    );
  const seenIdentityKeys = new Set<string>();
  const dedupedRows: ValidatedIndexEntry[] = [];

  for (const entry of rankedRows) {
    const identityKeys = getValidatedIndexIdentityKeys(entry.row);
    if (identityKeys.some((key) => seenIdentityKeys.has(key))) {
      continue;
    }

    identityKeys.forEach((key) => seenIdentityKeys.add(key));
    dedupedRows.push(entry.row);

    if (dedupedRows.length >= limit) {
      break;
    }
  }

  return dedupedRows;
}

function getMostCommonChairCount(chairCounts: number[]) {
  if (chairCounts.length === 0) {
    return null;
  }

  const frequencyByChairCount = new Map<number, number>();
  for (const chairCount of chairCounts) {
    frequencyByChairCount.set(
      chairCount,
      (frequencyByChairCount.get(chairCount) ?? 0) + 1,
    );
  }

  return [...frequencyByChairCount.entries()].sort((a, b) =>
    b[1] === a[1] ? a[0] - b[0] : b[1] - a[1],
  )[0]?.[0] ?? null;
}

function formatObservedRange(values: number[]) {
  if (values.length === 0) {
    return null;
  }

  const sortedValues = [...new Set(values)].sort((a, b) => a - b);
  return sortedValues.length === 1
    ? `${sortedValues[0]}`
    : `${sortedValues[0]}-${sortedValues[sortedValues.length - 1]}`;
}

function getMostFrequentChairCounts(chairCounts: number[], limit = 3) {
  const frequencyByChairCount = new Map<number, number>();

  for (const chairCount of chairCounts) {
    frequencyByChairCount.set(
      chairCount,
      (frequencyByChairCount.get(chairCount) ?? 0) + 1,
    );
  }

  return [...frequencyByChairCount.entries()]
    .sort((a, b) => (b[1] === a[1] ? a[0] - b[0] : b[1] - a[1]))
    .slice(0, limit)
    .map(([chairCount]) => chairCount);
}

function getStagedJsonPath(traceId: string) {
  return path.join(STAGED_DIR, `${traceId}.json`);
}

function getStagedImagePath(traceId: string, fileName: string) {
  return path.join(STAGED_DIR, `${traceId}${path.extname(fileName) || ".png"}`);
}

export async function stageImportedPlanSample(
  payload: StagedPlanImportPayload,
  imageBuffer: Buffer,
) {
  await fs.mkdir(STAGED_DIR, { recursive: true });
  const jsonPath = getStagedJsonPath(payload.traceId);
  const imagePath = getStagedImagePath(payload.traceId, payload.fileName);

  await fs.writeFile(
    jsonPath,
    JSON.stringify(
      {
        ...payload,
        hints: payload.hints
          ? {
              expectedTableCount: payload.hints.expectedTableCount,
              expectedRowCount: payload.hints.expectedRowCount,
              expectedColumnCount: payload.hints.expectedColumnCount,
              expectedChairTotal: payload.hints.expectedChairTotal,
              eventName: payload.hints.eventName,
            }
          : undefined,
        stagedAt: new Date().toISOString(),
        imagePath,
        imageSha256: createHash("sha256").update(imageBuffer).digest("hex"),
      },
      null,
      2,
    ),
    "utf8",
  );
  await fs.writeFile(imagePath, imageBuffer);
}

export async function confirmImportedPlanSample(traceId: string) {
  const jsonPath = getStagedJsonPath(traceId);
  const raw = await fs.readFile(jsonPath, "utf8");
  const payload = JSON.parse(raw) as StoredValidatedPlanSample;
  const targetDir = path.join(
    VALIDATED_DIR,
    `${new Date().toISOString().slice(0, 10)}-${traceId}`,
  );

  await fs.mkdir(targetDir, { recursive: true });
  const targetJsonPath = path.join(targetDir, "sample.json");
  const targetImagePath = path.join(
    targetDir,
    payload.fileName || `sample${path.extname(payload.imagePath ?? "") || ".png"}`,
  );

  if (payload.imagePath) {
    await fs.copyFile(payload.imagePath, targetImagePath);
  }
  const validatedPayload = {
    ...payload,
    validatedAt: new Date().toISOString(),
    imagePath: targetImagePath,
  };
  await fs.writeFile(
    targetJsonPath,
    JSON.stringify(validatedPayload, null, 2),
    "utf8",
  );

  const { rowCount, columnCount, chairTotal, tableCount } = getImportedTableGridMetrics(
    validatedPayload.importedTables,
  );
  const sampleSignature = buildValidatedSampleSignature(validatedPayload);

  const nextIndexEntry: ValidatedIndexEntry = {
    traceId: validatedPayload.traceId,
    eventoId: validatedPayload.eventoId,
    eventName: validatedPayload.eventName ?? null,
    fileName: validatedPayload.fileName,
    validatedAt: validatedPayload.validatedAt,
    imagePath: targetImagePath,
    samplePath: targetJsonPath,
    sampleSignature,
    imageSha256: (validatedPayload as { imageSha256?: string }).imageSha256 ?? null,
    expectedTableCount:
      validatedPayload.hints?.expectedTableCount ?? tableCount,
    expectedChairTotal: validatedPayload.hints?.expectedChairTotal ?? chairTotal,
    expectedRowCount: validatedPayload.hints?.expectedRowCount ?? rowCount,
    expectedColumnCount: validatedPayload.hints?.expectedColumnCount ?? columnCount,
  };

  const displacedSamplePaths: string[] = [];

  await withValidatedIndexLock(async () => {
    const currentIndex = await readValidatedIndexRows();
    const hydratedCurrentIndex = await Promise.all(
      currentIndex.map((row) => hydrateValidatedIndexEntry(row)),
    );
    const nextIndex = hydratedCurrentIndex
      .filter(({ row }) => {
        const sharedIdentity = hasSharedValidatedIndexIdentity(row, nextIndexEntry);
        if (sharedIdentity && row.samplePath && row.samplePath !== targetJsonPath) {
          displacedSamplePaths.push(row.samplePath);
        }
        return !sharedIdentity;
      })
      .map(({ row }) => row);
    nextIndex.push(nextIndexEntry);
    await writeValidatedIndexRows(nextIndex);
  });

  await Promise.allSettled(
    displacedSamplePaths.map(async (samplePath) => {
      const sampleDir = path.dirname(samplePath);
      if (sampleDir === VALIDATED_DIR || !sampleDir.startsWith(VALIDATED_DIR)) {
        return;
      }
      await fs.rm(sampleDir, { recursive: true, force: true });
    }),
  );

  await cleanupImportedPlanSample(traceId);
}

export async function cleanupImportedPlanSample(traceId: string) {
  const jsonPath = getStagedJsonPath(traceId);

  try {
    const raw = await fs.readFile(jsonPath, "utf8");
    const payload = JSON.parse(raw) as { imagePath?: string };
    await Promise.allSettled([
      fs.unlink(jsonPath),
      payload.imagePath ? fs.unlink(payload.imagePath) : Promise.resolve(),
    ]);
  } catch {
    await Promise.allSettled([fs.unlink(jsonPath)]);
  }
}

export async function getValidatedPlanLearningContext(hints: PlanImportHints) {
  const matchedRows = await getMatchedValidatedIndexRows(hints, 2);
  const tableCounts: number[] = [];
  const chairTotals: number[] = [];
  const rowCounts: number[] = [];
  const columnCounts: number[] = [];
  const chairCounts: number[] = [];
  let matchedSampleCount = 0;

  for (const row of matchedRows) {
    const sample = await readValidatedSample(row.samplePath);
    if (!sample) {
      continue;
    }

    const orderedTables = sortImportedTablesByVisualOrder(sample.importedTables);
    const metrics = getImportedTableGridMetrics(orderedTables);

    tableCounts.push(metrics.tableCount);
    chairTotals.push(metrics.chairTotal);
    rowCounts.push(metrics.rowCount);
    columnCounts.push(metrics.columnCount);
    chairCounts.push(...orderedTables.map((table) => table.chairCount));
    matchedSampleCount += 1;
  }

  if (matchedSampleCount === 0) {
    return "";
  }

  const frequentChairCounts = getMostFrequentChairCounts(chairCounts);
  const layoutSummary =
    rowCounts.length > 0 && columnCounts.length > 0
      ? `${formatObservedRange(rowCounts)} filas por ${formatObservedRange(columnCounts)} columnas aprox.`
      : null;
  const globalRangeSummary = [
    formatObservedRange(tableCounts)
      ? `${formatObservedRange(tableCounts)} mesas`
      : null,
    formatObservedRange(chairTotals)
      ? `${formatObservedRange(chairTotals)} sillas totales`
      : null,
    layoutSummary,
  ]
    .filter(Boolean)
    .join(", ");

  return [
    `${matchedSampleCount} referencias validadas similares.`,
    "Usalas solo como comprobacion secundaria de coherencia global; nunca copies una secuencia historica ni asignes valores por analogia.",
    globalRangeSummary ? `Patrones globales observados: ${globalRangeSummary}.` : "",
    frequentChairCounts.length > 0
      ? `ChairCount frecuentes en ejemplos: ${frequentChairCounts.join(", ")}.`
      : "",
  ]
    .filter(Boolean)
    .join(" ");
}

export async function getValidatedPlanPriors(
  hints: ValidatedPlanMatchHints,
): Promise<ValidatedPlanPriors | null> {
  const matchedRows = await getMatchedValidatedIndexRows(hints, 2);
  if (matchedRows.length === 0) {
    return null;
  }

  const chairCountsByPosition = new Map<number, number[]>();
  let matchingExampleCount = 0;

  for (const row of matchedRows) {
    try {
      const rawSample = await fs.readFile(String(row.samplePath), "utf8");
      const sample = JSON.parse(rawSample) as StagedPlanImportPayload;
      const orderedTables = sortImportedTablesByVisualOrder(sample.importedTables);

      orderedTables.forEach((table, positionIndex) => {
        const chairCounts = chairCountsByPosition.get(positionIndex) ?? [];
        chairCounts.push(table.chairCount);
        chairCountsByPosition.set(positionIndex, chairCounts);
      });
      matchingExampleCount += 1;
    } catch {}
  }

  if (matchingExampleCount === 0) {
    return null;
  }

  return {
    matchingExampleCount,
    priorsByPosition: [...chairCountsByPosition.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([positionIndex, chairCounts]) => ({
        positionIndex,
        chairCounts,
        mostCommonChairCount: getMostCommonChairCount(chairCounts),
      })),
  };
}

export async function getValidatedMesaNumberPriors(
  hints: ValidatedPlanMatchHints,
): Promise<ValidatedMesaNumberPriors | null> {
  const matchedRows = await getMatchedValidatedIndexRows(hints, 3);
  if (matchedRows.length === 0) {
    return null;
  }

  const chairCountsByMesaNumber = new Map<number, number[]>();
  let matchingExampleCount = 0;

  for (const row of matchedRows) {
    try {
      const rawSample = await fs.readFile(String(row.samplePath), "utf8");
      const sample = JSON.parse(rawSample) as StagedPlanImportPayload;

      for (const table of sample.importedTables) {
        if (!Number.isInteger(table.numero) || !Number.isInteger(table.chairCount)) {
          continue;
        }
        const chairCounts = chairCountsByMesaNumber.get(table.numero) ?? [];
        chairCounts.push(table.chairCount);
        chairCountsByMesaNumber.set(table.numero, chairCounts);
      }

      matchingExampleCount += 1;
    } catch {}
  }

  if (matchingExampleCount === 0) {
    return null;
  }

  return {
    matchingExampleCount,
    priorsByMesaNumber: [...chairCountsByMesaNumber.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([numero, chairCounts]) => ({
        numero,
        chairCounts,
        mostCommonChairCount: getMostCommonChairCount(chairCounts),
      })),
  };
}
