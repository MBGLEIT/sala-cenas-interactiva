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
  expectedTableCount?: number;
  expectedChairTotal?: number;
  expectedRowCount?: number;
  expectedColumnCount?: number;
};

const ROOT_DIR = path.resolve(process.cwd(), ".plan-import-feedback");
const STAGED_DIR = path.join(ROOT_DIR, "staged");
const VALIDATED_DIR = path.join(ROOT_DIR, "validated");
const VALIDATED_INDEX_PATH = path.join(ROOT_DIR, "validated-index.json");

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
  const payload = JSON.parse(raw) as StagedPlanImportPayload & {
    imagePath?: string;
    stagedAt?: string;
  };
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

  const rowCount = new Set(validatedPayload.importedTables.map((table) => table.posY)).size;
  const columnCount = new Set(validatedPayload.importedTables.map((table) => table.posX)).size;
  const chairTotal = validatedPayload.importedTables.reduce(
    (sum, table) => sum + table.chairCount,
    0,
  );

  let currentIndex: Array<Record<string, unknown>> = [];
  try {
    const rawIndex = await fs.readFile(VALIDATED_INDEX_PATH, "utf8");
    const parsedIndex = JSON.parse(rawIndex);
    if (Array.isArray(parsedIndex)) {
      currentIndex = parsedIndex;
    }
  } catch {}

  currentIndex.push({
    traceId: validatedPayload.traceId,
    eventoId: validatedPayload.eventoId,
    eventName: validatedPayload.eventName ?? null,
    fileName: validatedPayload.fileName,
    validatedAt: validatedPayload.validatedAt,
    imagePath: targetImagePath,
    samplePath: targetJsonPath,
    imageSha256: (validatedPayload as { imageSha256?: string }).imageSha256 ?? null,
    expectedTableCount: validatedPayload.hints?.expectedTableCount ?? validatedPayload.importedTables.length,
    expectedChairTotal: validatedPayload.hints?.expectedChairTotal ?? chairTotal,
    expectedRowCount: validatedPayload.hints?.expectedRowCount ?? rowCount,
    expectedColumnCount: validatedPayload.hints?.expectedColumnCount ?? columnCount,
  });

  await fs.mkdir(ROOT_DIR, { recursive: true });
  await fs.writeFile(VALIDATED_INDEX_PATH, JSON.stringify(currentIndex, null, 2), "utf8");

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
  let indexRows: ValidatedIndexRow[] = [];

  try {
    const rawIndex = await fs.readFile(VALIDATED_INDEX_PATH, "utf8");
    const parsedIndex = JSON.parse(rawIndex);
    if (Array.isArray(parsedIndex)) {
      indexRows = parsedIndex as ValidatedIndexRow[];
    }
  } catch {
    return "";
  }

  const scoredRows = indexRows
    .filter((row) => row.samplePath)
    .map((row) => {
      const score =
        Math.abs((row.expectedTableCount ?? 0) - (hints.expectedTableCount ?? 0)) * 8 +
        Math.abs((row.expectedChairTotal ?? 0) - (hints.expectedChairTotal ?? 0)) +
        Math.abs((row.expectedRowCount ?? 0) - (hints.expectedRowCount ?? 0)) * 5 +
        Math.abs((row.expectedColumnCount ?? 0) - (hints.expectedColumnCount ?? 0)) * 5;

      return { row, score };
    })
    .sort((a, b) => a.score - b.score)
    .slice(0, 2);

  const contexts: string[] = [];

  for (const { row } of scoredRows) {
    try {
      const rawSample = await fs.readFile(String(row.samplePath), "utf8");
      const sample = JSON.parse(rawSample) as StagedPlanImportPayload;
      const orderedTables = [...sample.importedTables].sort(
        (a, b) => a.posY === b.posY ? a.posX - b.posX : a.posY - b.posY,
      );
      const tableSummary = orderedTables
        .map((table, index) => `${index + 1}. M:${table.numero} S:${table.chairCount}`)
        .join("; ");

      contexts.push(
        `Plano validado ${row.fileName ?? sample.fileName}: ${tableSummary}`,
      );
    } catch {}
  }

  return contexts.join("\n");
}
