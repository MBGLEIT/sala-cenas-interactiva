import "server-only";

import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";

import { Jimp } from "jimp";
import sharp from "sharp";

import {
  getValidatedMesaNumberPriors,
  getValidatedPlanPriors,
  type ValidatedMesaNumberPriors,
  type ValidatedPlanPriors,
} from "@/lib/plan-import-feedback";
import {
  ROOM_LAYOUT_HEIGHT,
  ROOM_LAYOUT_WIDTH,
  getEventTitleFootprint,
  getNextMesaPosition,
  getTableDimensions,
} from "@/lib/room-layout";
import {
  appendPlanImportTraceLog,
  assertPlanImportNotCancelled,
  getPlanImportAbortSignal,
  PlanImportCancelledError,
} from "@/lib/plan-import-runtime";

export type ImportedPlanTable = {
  numero: number;
  chairCount: number;
  posX: number;
  posY: number;
};

export type PlanImportHints = {
  expectedTableCount?: number;
  expectedRowCount?: number;
  expectedColumnCount?: number;
  expectedChairTotal?: number;
  eventName?: string;
  learningContext?: string;
};

type SpatialTextEntry = {
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
};

type MesaSillaPair = {
  numero: number;
  chairCount: number;
  x?: number;
  y?: number;
};

type TableChairCandidateSource =
  | "current_selected"
  | "paddle_full"
  | "paddle_bottom_band"
  | "paddle_tight"
  | "paddle_wide"
  | "gpt_ordered"
  | "ocr_fallback"
  | "validated_prior"
  | "validated_mesa_prior";

type TableChairCandidate = {
  chairCount: number;
  source: TableChairCandidateSource;
  confidence: number;
  evidence?: string;
};

type SuspicionFlag =
  | "source_disagreement"
  | "weak_ocr_evidence"
  | "bottom_band_conflict"
  | "global_total_pressure"
  | "validated_prior_mismatch"
  | "neighbor_swap_risk";

type TableResolutionCandidate = MesaSillaPair & {
  positionIndex: number;
  candidates: TableChairCandidate[];
  selectedChairCount: number;
  suspicionScore: number;
  suspicionFlags: SuspicionFlag[];
};

type ImportSourceBounds = {
  width: number;
  height: number;
  minX?: number;
  minY?: number;
  maxX?: number;
  maxY?: number;
  preferRegularized?: boolean;
};

type OcrToken = {
  kind: "mesa" | "silla";
  value: number;
  x: number;
  y: number;
  width: number;
  height: number;
  confidence: number;
};

type OcrWord = {
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
  confidence: number;
};

type OcrVariant = {
  label: string;
  buffer: Buffer;
  width: number;
  height: number;
  scale: number;
};

type OcrRunResult = {
  label: string;
  buffer: Buffer;
  width: number;
  height: number;
  scale: number;
  tokens: OcrToken[];
  pairs: MesaSillaPair[];
  textFallback: MesaSillaPair[];
  score: number;
};

type CropRegion = {
  x: number;
  y: number;
  width: number;
  height: number;
};

type SuspiciousChairCropRegion = CropRegion & {
  index: number;
  tableIndex: number;
  source: Extract<
    TableChairCandidateSource,
    "paddle_bottom_band" | "paddle_tight" | "paddle_wide"
  >;
  evidence: string;
};

type OcrWorkerLike = {
  recognize: (
    image: Buffer,
    options?: Record<string, unknown>,
    output?: Record<string, unknown>,
  ) => Promise<{
    data: {
      hocr?: string | null;
      text?: string | null;
    };
  }>;
};

type PaddleOcrVariantResult = {
  variant: string;
  texts: string[];
};

type PaddleOcrCropResult = {
  index?: number | null;
  numero?: number | null;
  chairCount?: number | null;
  numeroCandidates?: number[];
  chairCandidates?: number[];
  variants?: PaddleOcrVariantResult[];
};

type AdvancedVisionLayoutResult = {
  tables: Array<MesaSillaPair & { x: number; y: number }>;
  sourceBounds: { width: number; height: number } | null;
  meta?: Record<string, unknown>;
};

type AiImportedPlanTable = {
  numero: number;
  chairCount: number;
  x: number;
  y: number;
  confidence?: number;
};

type AiImportedPlanPayload = {
  width?: number;
  height?: number;
  tables: AiImportedPlanTable[];
};

type AiOrderedPlanTable = {
  numero: number;
  chairCount: number;
};

type AiOrderedPlanPayload = {
  tables: AiOrderedPlanTable[];
};

type PlanImportDebugContext = {
  traceId: string;
};

type DetectedImageLayout = {
  tables: MesaSillaPair[];
  sourceBounds: ImportSourceBounds;
  nearestDistance: number;
};

type TimeoutOptions = {
  signal?: AbortSignal;
};

type PythonCommandCandidate = {
  command: string;
  argsPrefix: string[];
};

type PythonCommandPreference = "default" | "paddle";

type ExecPythonOptions = Parameters<typeof execFile>[2] & {
  signal?: AbortSignal;
  preference?: PythonCommandPreference;
  retryMissingPaddleSupport?: boolean;
};

const OCR_VARIANT_LIMIT_VERCEL = 1;
const OPENAI_IMPORT_MODEL = process.env.OPENAI_IMPORT_MODEL?.trim() || "gpt-4.1";
const IMAGE_GEOMETRY_TIMEOUT_MS = 20000;
const IMAGE_GEOMETRY_OCR_TIMEOUT_MS = 45000;
const IMAGE_ADVANCED_VISION_TIMEOUT_MS = 240000;
const PADDLE_PLAN_OCR_TIMEOUT_MS = 240000;

function getUniquePythonCommandCandidates(candidates: PythonCommandCandidate[]) {
  const seen = new Set<string>();
  return candidates.filter((candidate) => {
    const key = `${candidate.command}\u0000${candidate.argsPrefix.join("\u0000")}`;
    if (seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
}

function getPythonCommandCandidates(preference: PythonCommandPreference = "default") {
  const paddleEnvCandidates = [process.env.PADDLE_PYTHON_PATH]
    .map((value) => value?.trim())
    .filter((value): value is string => Boolean(value));
  const envCandidates = [process.env.PYTHON]
    .map((value) => value?.trim())
    .filter((value): value is string => Boolean(value));
  const localVenvCandidates =
    process.platform === "win32"
      ? [
          path.resolve(process.cwd(), ".venv", "Scripts", "python.exe"),
          path.resolve(process.cwd(), "venv", "Scripts", "python.exe"),
        ]
      : [
          path.resolve(process.cwd(), ".venv", "bin", "python3"),
          path.resolve(process.cwd(), ".venv", "bin", "python"),
          path.resolve(process.cwd(), "venv", "bin", "python3"),
          path.resolve(process.cwd(), "venv", "bin", "python"),
        ];
  const defaultCommands =
    process.platform === "win32"
      ? ["python", "python3", "py"]
      : ["python3", "python"];
  const orderedCommands =
    preference === "paddle"
      ? [...paddleEnvCandidates, ...localVenvCandidates, ...envCandidates, ...defaultCommands]
      : [...paddleEnvCandidates, ...envCandidates, ...localVenvCandidates, ...defaultCommands];

  return getUniquePythonCommandCandidates(
    orderedCommands.map(
      (command) =>
        ({
          command,
          argsPrefix: [],
        }) satisfies PythonCommandCandidate,
    ),
  );
}

function logPlanImport(
  debugContext: PlanImportDebugContext | undefined,
  stage: string,
  details?: Record<string, unknown>,
) {
  if (!debugContext) {
    return;
  }

  if (details) {
    console.info(`[plan-import:${debugContext.traceId}] ${stage}`, details);
    appendPlanImportTraceLog(debugContext.traceId, "info", stage, details);
    return;
  }

  console.info(`[plan-import:${debugContext.traceId}] ${stage}`);
  appendPlanImportTraceLog(debugContext.traceId, "info", stage);
}

function assertImportNotCancelled(debugContext?: PlanImportDebugContext) {
  if (!debugContext) {
    return;
  }

  assertPlanImportNotCancelled(debugContext.traceId);
}

function getImportAbortSignal(debugContext?: PlanImportDebugContext) {
  if (!debugContext) {
    return undefined;
  }

  return getPlanImportAbortSignal(debugContext.traceId);
}

function createAbortError(message: string) {
  const error = new Error(message);
  error.name = "AbortError";
  return error;
}

function throwIfAborted(signal?: AbortSignal) {
  if (!signal?.aborted) {
    return;
  }

  if (signal.reason instanceof Error) {
    throw signal.reason;
  }

  throw createAbortError(
    typeof signal.reason === "string" && signal.reason.length > 0
      ? signal.reason
      : "The operation was aborted",
  );
}

function combineAbortSignals(signals: Array<AbortSignal | undefined>) {
  const activeSignals = signals.filter((signal): signal is AbortSignal => Boolean(signal));
  if (activeSignals.length === 0) {
    return {
      signal: undefined,
      cleanup: () => {},
    };
  }

  if (activeSignals.length === 1) {
    return {
      signal: activeSignals[0],
      cleanup: () => {},
    };
  }

  if (typeof AbortSignal.any === "function") {
    return {
      signal: AbortSignal.any(activeSignals),
      cleanup: () => {},
    };
  }

  const controller = new AbortController();
  const listeners = new Map<AbortSignal, () => void>();
  const cleanup = () => {
    for (const [signal, listener] of listeners.entries()) {
      signal.removeEventListener("abort", listener);
    }
    listeners.clear();
  };

  for (const signal of activeSignals) {
    if (signal.aborted) {
      controller.abort(signal.reason);
      return {
        signal: controller.signal,
        cleanup,
      };
    }

    const listener = () => {
      cleanup();
      controller.abort(signal.reason);
    };
    listeners.set(signal, listener);
    signal.addEventListener("abort", listener, { once: true });
  }

  return {
    signal: controller.signal,
    cleanup,
  };
}

function attachWorkerAbortHandler(
  signal: AbortSignal | undefined,
  worker: { terminate: () => Promise<unknown> },
) {
  if (!signal) {
    return () => {};
  }

  const onAbort = () => {
    void worker.terminate().catch(() => {});
  };

  if (signal.aborted) {
    onAbort();
    return () => {};
  }

  signal.addEventListener("abort", onAbort, { once: true });
  return () => {
    signal.removeEventListener("abort", onAbort);
  };
}

function isMissingExecutableError(error: unknown) {
  if (!(error instanceof Error)) {
    return false;
  }

  return "code" in error && (error as NodeJS.ErrnoException).code === "ENOENT";
}

async function execFileWithImportAbort(
  file: string,
  args: string[],
  options: Parameters<typeof execFile>[2] & { signal?: AbortSignal },
) {
  return await new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
    execFile(file, args, options, (error, stdout, stderr) => {
      if (error) {
        reject(error);
        return;
      }

      resolve({
        stdout: typeof stdout === "string" ? stdout : stdout.toString(),
        stderr: typeof stderr === "string" ? stderr : stderr.toString(),
      });
    });
  });
}

function getExecErrorText(error: unknown) {
  if (!(error instanceof Error)) {
    return "";
  }

  const execError = error as Error & {
    stdout?: string | Buffer;
    stderr?: string | Buffer;
  };
  const stderr =
    typeof execError.stderr === "string"
      ? execError.stderr
      : Buffer.isBuffer(execError.stderr)
        ? execError.stderr.toString("utf8")
        : "";
  const stdout =
    typeof execError.stdout === "string"
      ? execError.stdout
      : Buffer.isBuffer(execError.stdout)
        ? execError.stdout.toString("utf8")
        : "";

  return [error.message, stderr, stdout].filter((value) => value.length > 0).join("\n");
}

function isMissingPaddleSupportError(error: unknown) {
  const errorText = getExecErrorText(error);
  if (!errorText) {
    return false;
  }

  return [
    /ModuleNotFoundError: .*?\b(paddle|paddleocr|paddlex)\b/i,
    /No module named ['"]?(paddle|paddleocr|paddlex)['"]?/i,
    /ImportError: .*?\b(paddle|paddleocr|paddlex)\b/i,
    /cannot import name .* from ['"]?(paddle|paddleocr|paddlex)['"]?/i,
    /DLL load failed.*?\b(paddle|paddleocr|paddlex)\b/i,
  ].some((pattern) => pattern.test(errorText));
}

async function execPythonWithImportAbort(
  args: string[],
  options: ExecPythonOptions,
) {
  const {
    preference = "default",
    retryMissingPaddleSupport = false,
    ...execOptions
  } = options;
  let lastError: unknown;
  let lastRetryableError: unknown;

  for (const candidate of getPythonCommandCandidates(preference)) {
    try {
      return await execFileWithImportAbort(
        candidate.command,
        [...candidate.argsPrefix, ...args],
        execOptions,
      );
    } catch (error) {
      if (isAbortLikeError(error)) {
        throw error;
      }

      if (isMissingExecutableError(error)) {
        lastError = error;
        continue;
      }

      if (retryMissingPaddleSupport && isMissingPaddleSupportError(error)) {
        lastRetryableError = error;
        continue;
      }

      throw error;
    }
  }

  if (lastRetryableError instanceof Error) {
    throw lastRetryableError;
  }

  if (lastError instanceof Error) {
    throw lastError;
  }

  throw new Error("No se encontro un ejecutable de Python compatible para los scripts de importacion.");
}

function isAbortLikeError(error: unknown) {
  if (!(error instanceof Error)) {
    return false;
  }

  return (
    error.name === "AbortError" ||
    error.name === "PlanImportCancelledError" ||
    error.message.includes("aborted") ||
    error.message.includes("The operation was aborted")
  );
}

function serializeImportError(error: unknown) {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
    };
  }

  return {
    message: String(error),
  };
}

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  label: string,
): Promise<T>;
async function withTimeout<T>(
  operation: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number,
  label: string,
  options?: TimeoutOptions,
): Promise<T>;
async function withTimeout<T>(
  operationOrPromise: Promise<T> | ((signal: AbortSignal) => Promise<T>),
  timeoutMs: number,
  label: string,
  options?: TimeoutOptions,
) {
  const timeoutError = new Error(`${label} timed out after ${timeoutMs}ms`);
  timeoutError.name = "TimeoutError";
  const timeoutController = new AbortController();
  const { signal, cleanup } = combineAbortSignals([options?.signal, timeoutController.signal]);
  let timeoutHandle: ReturnType<typeof setTimeout> | null = null;

  try {
    const timeoutPromise = new Promise<T>((_, reject) => {
      timeoutHandle = setTimeout(() => {
        timeoutController.abort(timeoutError);
        reject(timeoutError);
      }, timeoutMs);
    });
    const operationPromise =
      typeof operationOrPromise === "function"
        ? operationOrPromise(signal ?? timeoutController.signal)
        : operationOrPromise;

    return await Promise.race([operationPromise, timeoutPromise]);
  } catch (error) {
    if (timeoutController.signal.aborted && isAbortLikeError(error)) {
      throw timeoutError;
    }

    throw error;
  } finally {
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
    }
    cleanup();
  }
}

function groupSpatialRows(entries: MesaSillaPair[], tolerance = 28) {
  const sorted = [...entries]
    .filter((entry) => typeof entry.x === "number" && typeof entry.y === "number")
    .sort((a, b) =>
      Math.abs((a.y ?? 0) - (b.y ?? 0)) < tolerance
        ? (a.x ?? 0) - (b.x ?? 0)
        : (a.y ?? 0) - (b.y ?? 0),
    );
  const rows: MesaSillaPair[][] = [];

  for (const entry of sorted) {
    const currentRow = rows[rows.length - 1];
    if (!currentRow) {
      rows.push([entry]);
      continue;
    }

    const averageY =
      currentRow.reduce((sum, rowEntry) => sum + (rowEntry.y ?? 0), 0) / currentRow.length;
    if (Math.abs((entry.y ?? 0) - averageY) <= tolerance) {
      currentRow.push(entry);
      continue;
    }

    rows.push([entry]);
  }

  return rows.map((row) => row.sort((a, b) => (a.x ?? 0) - (b.x ?? 0)));
}

function mergeNearbyRowEntries(row: MesaSillaPair[], minGap = 32) {
  const merged: MesaSillaPair[] = [];

  for (const entry of row) {
    const previous = merged[merged.length - 1];
    if (
      previous &&
      typeof previous.x === "number" &&
      typeof entry.x === "number" &&
      Math.abs(entry.x - previous.x) <= minGap
    ) {
      previous.x = (previous.x + entry.x) / 2;
      previous.y =
        typeof previous.y === "number" && typeof entry.y === "number"
          ? (previous.y + entry.y) / 2
          : previous.y ?? entry.y;
      continue;
    }

    merged.push({ ...entry });
  }

  return merged;
}

function inferGridColumnCount(rows: MesaSillaPair[][]) {
  const counts = new Map<number, number>();
  for (const row of rows) {
    counts.set(row.length, (counts.get(row.length) ?? 0) + 1);
  }

  const best = [...counts.entries()].sort((a, b) =>
    b[1] === a[1] ? b[0] - a[0] : b[1] - a[1],
  )[0];

  return clamp(best?.[0] ?? 0, 3, 16);
}

function inferGlobalColumnCenters(rows: MesaSillaPair[][], columnCount: number) {
  const samples = rows
    .filter((row) => row.length > 0)
    .flatMap((row) =>
      row.map((entry) => ({
        x: entry.x ?? 0,
        ratio:
          row.length === 1 ? 0 : row.indexOf(entry) / Math.max(1, row.length - 1),
      })),
    );

  if (samples.length === 0) {
    return [] as number[];
  }

  const minX = Math.min(...samples.map((sample) => sample.x));
  const maxX = Math.max(...samples.map((sample) => sample.x));
  const initialCenters = Array.from({ length: columnCount }, (_, index) =>
    lerp(minX, maxX, columnCount === 1 ? 0 : index / Math.max(1, columnCount - 1)),
  );

  let centers = initialCenters;
  for (let iteration = 0; iteration < 6; iteration += 1) {
    const buckets = centers.map(() => [] as number[]);

    for (const sample of samples) {
      let bestIndex = 0;
      let bestDistance = Number.POSITIVE_INFINITY;

      for (let index = 0; index < centers.length; index += 1) {
        const distance = Math.abs(sample.x - centers[index]);
        if (distance < bestDistance) {
          bestDistance = distance;
          bestIndex = index;
        }
      }

      buckets[bestIndex].push(sample.x);
    }

    centers = centers.map((center, index) =>
      buckets[index].length > 0
        ? buckets[index].reduce((sum, value) => sum + value, 0) / buckets[index].length
        : center,
    );
  }

  return centers.sort((a, b) => a - b);
}

function normalizeRowsToColumnGrid(rows: MesaSillaPair[][], columnCenters: number[]) {
  return rows.map((row) => {
    const averageY =
      row.reduce((sum, entry) => sum + (entry.y ?? 0), 0) / Math.max(1, row.length);
    const assigned = new Map<number, MesaSillaPair>();

    for (const entry of row) {
      const x = entry.x ?? 0;
      let bestIndex = 0;
      let bestDistance = Number.POSITIVE_INFINITY;

      for (let index = 0; index < columnCenters.length; index += 1) {
        const distance = Math.abs(x - columnCenters[index]);
        if (distance < bestDistance) {
          bestDistance = distance;
          bestIndex = index;
        }
      }

      const existing = assigned.get(bestIndex);
      if (!existing || bestDistance < Math.abs((existing.x ?? 0) - columnCenters[bestIndex])) {
        assigned.set(bestIndex, {
          ...entry,
          x: columnCenters[bestIndex],
          y: averageY,
        });
      }
    }

    return columnCenters.map((columnX, index) => {
      const assignedEntry = assigned.get(index);
      return assignedEntry
        ? assignedEntry
        : {
            numero: index + 1,
            chairCount: 8,
            x: columnX,
            y: averageY,
          };
    });
  });
}

function getGeometryBounds(entries: MesaSillaPair[], padding = 90) {
  const positioned = entries.filter(
    (entry): entry is MesaSillaPair & { x: number; y: number } =>
      typeof entry.x === "number" && typeof entry.y === "number",
  );

  if (positioned.length === 0) {
    return null;
  }

  return {
    minX: Math.max(0, Math.floor(Math.min(...positioned.map((entry) => entry.x)) - padding)),
    minY: Math.max(0, Math.floor(Math.min(...positioned.map((entry) => entry.y)) - padding)),
    maxX: Math.ceil(Math.max(...positioned.map((entry) => entry.x)) + padding),
    maxY: Math.ceil(Math.max(...positioned.map((entry) => entry.y)) + padding),
  };
}

function hasSufficientOrderedLabelCoverage(
  geometryEntryCount: number,
  orderedLabelCount: number,
) {
  if (geometryEntryCount <= 0 || orderedLabelCount <= 0) {
    return false;
  }

  return (
    orderedLabelCount >= geometryEntryCount ||
    orderedLabelCount >= Math.max(12, Math.floor(geometryEntryCount * 0.7))
  );
}

function mergeGeometryWithOrderedLabels(
  geometryEntries: MesaSillaPair[],
  orderedLabels: AiOrderedPlanTable[],
) {
  const orderedGeometry = sortEntriesBySpatialOrder(geometryEntries);
  return orderedGeometry.map((geometryEntry, index) => {
    const labelEntry = orderedLabels[index];

    if (!labelEntry) {
      return { ...geometryEntry };
    }

    return {
      numero: labelEntry.numero,
      chairCount: labelEntry.chairCount,
      x: geometryEntry.x,
      y: geometryEntry.y,
    };
  });
}

function getChairTotal(entries: Array<Pick<MesaSillaPair, "chairCount">>) {
  return entries.reduce((sum, entry) => sum + entry.chairCount, 0);
}

function buildInitialResolutionCandidates(
  entries: MesaSillaPair[],
  source: TableChairCandidateSource,
) {
  return entries.map((entry, index) => ({
    ...entry,
    positionIndex: index,
    candidates: [
      {
        chairCount: entry.chairCount,
        source,
        confidence: 0.7,
        evidence: "initial-first-pass",
      },
    ],
    selectedChairCount: entry.chairCount,
    suspicionScore: 0,
    suspicionFlags: [],
  })) satisfies TableResolutionCandidate[];
}

function findValidatedPriorForPosition(
  priors: ValidatedPlanPriors | null | undefined,
  positionIndex: number,
) {
  return priors?.priorsByPosition.find((prior) => prior.positionIndex === positionIndex) ?? null;
}

function addChairCountCandidate(
  candidate: TableResolutionCandidate | undefined,
  chairCount: number | null | undefined,
  source: TableChairCandidateSource,
  confidence: number,
  evidence?: string,
) {
  if (
    !candidate ||
    typeof chairCount !== "number" ||
    !Number.isInteger(chairCount) ||
    chairCount < 1 ||
    chairCount > 24 ||
    candidate.candidates.some(
      (existing) => existing.chairCount === chairCount && existing.source === source,
    )
  ) {
    return;
  }

  candidate.candidates.push({
    chairCount,
    source,
    confidence,
    evidence,
  });
}

function isDirectOcrChairCandidateSource(source: TableChairCandidateSource) {
  return (
    source === "paddle_full" ||
    source === "paddle_bottom_band" ||
    source === "paddle_tight" ||
    source === "paddle_wide" ||
    source === "ocr_fallback"
  );
}

function isMeaningfulChairCandidateSource(source: TableChairCandidateSource) {
  return (
    source !== "current_selected" &&
    source !== "validated_prior" &&
    source !== "validated_mesa_prior"
  );
}

function scoreResolutionCandidateSuspicion(
  candidate: TableResolutionCandidate,
  options: {
    expectedChairTotal?: number;
    currentChairTotal?: number;
    validatedPriorChairCount?: number | null;
    competingCounts?: number[];
  },
) {
  const flags: SuspicionFlag[] = [];
  let score = 0;
  const meaningfulCandidates = candidate.candidates.filter((entry) =>
    isMeaningfulChairCandidateSource(entry.source),
  );
  const confidenceByChairCount = new Map<number, number>();
  for (const chairCandidate of meaningfulCandidates) {
    const currentBest = confidenceByChairCount.get(chairCandidate.chairCount) ?? 0;
    confidenceByChairCount.set(
      chairCandidate.chairCount,
      Math.max(currentBest, chairCandidate.confidence),
    );
  }
  const competingCounts = [...new Set(options.competingCounts ?? [])].filter(
    (value) => Number.isInteger(value) && value >= 1 && value <= 24,
  );
  const selectedMeaningfulConfidence =
    confidenceByChairCount.get(candidate.selectedChairCount) ?? 0;
  const conflictingMeaningfulCounts = [...confidenceByChairCount.entries()]
    .filter(([chairCount]) => chairCount !== candidate.selectedChairCount)
    .filter(([, confidence]) => confidence >= Math.max(0.6, selectedMeaningfulConfidence - 0.12))
    .map(([chairCount]) => chairCount);

  if (
    conflictingMeaningfulCounts.length > 0 ||
    (selectedMeaningfulConfidence === 0 &&
      meaningfulCandidates.length > 0 &&
      competingCounts.some((value) => value !== candidate.selectedChairCount))
  ) {
    score += 2;
    flags.push("source_disagreement");
  }

  const directOcrCandidates = candidate.candidates.filter(
    (entry) => isDirectOcrChairCandidateSource(entry.source),
  );
  const bestDirectOcrConfidence = directOcrCandidates.reduce(
    (best, entry) => Math.max(best, entry.confidence),
    0,
  );
  if (directOcrCandidates.length === 0 || bestDirectOcrConfidence < 0.55) {
    score += 1;
    flags.push("weak_ocr_evidence");
  }

  if (
    typeof options.validatedPriorChairCount === "number" &&
    options.validatedPriorChairCount !== candidate.selectedChairCount
  ) {
    score += 1;
    flags.push("validated_prior_mismatch");
  }

  const bottomBandChairCounts = [...new Set(
    candidate.candidates
      .filter((entry) => entry.source === "paddle_bottom_band")
      .map((entry) => entry.chairCount),
  )];
  if (
    bottomBandChairCounts.length > 0 &&
    bottomBandChairCounts.some((chairCount) => chairCount !== candidate.selectedChairCount)
  ) {
    score += 1;
    flags.push("bottom_band_conflict");
  }

  if (
    typeof options.expectedChairTotal === "number" &&
    typeof options.currentChairTotal === "number" &&
    options.currentChairTotal !== options.expectedChairTotal &&
    (flags.includes("source_disagreement") || flags.includes("validated_prior_mismatch"))
  ) {
    score += 1;
    flags.push("global_total_pressure");
  }

  return {
    suspicionScore: score,
    suspicionFlags: [...new Set(flags)],
  };
}

function annotateSuspicionScores(
  candidates: TableResolutionCandidate[],
  validatedPriors: ValidatedPlanPriors | null | undefined,
  expectedChairTotal?: number,
) {
  const currentChairTotal = candidates.reduce((sum, candidate) => sum + candidate.selectedChairCount, 0);

  return candidates.map((candidate) => {
    const prior = findValidatedPriorForPosition(validatedPriors, candidate.positionIndex);
    const competingCounts = candidate.candidates.map((entry) => entry.chairCount);
    const scored = scoreResolutionCandidateSuspicion(candidate, {
      expectedChairTotal,
      currentChairTotal,
      validatedPriorChairCount: prior?.mostCommonChairCount ?? null,
      competingCounts,
    });

    return {
      ...candidate,
      ...scored,
    };
  });
}

function getChairCandidateSourceWeight(source: TableChairCandidateSource) {
  switch (source) {
    case "paddle_bottom_band":
      return 1.2;
    case "paddle_tight":
      return 1.08;
    case "paddle_full":
      return 1;
    case "paddle_wide":
      return 0.94;
    case "gpt_ordered":
      return 0.86;
    case "ocr_fallback":
      return 0.72;
    case "validated_prior":
      return 0.42;
    case "validated_mesa_prior":
      return 0.56;
    case "current_selected":
    default:
      return 0.32;
  }
}

function compareChairCandidatePriority(
  left: TableChairCandidate | null | undefined,
  right: TableChairCandidate | null | undefined,
) {
  if (!left && !right) {
    return 0;
  }
  if (!left) {
    return 1;
  }
  if (!right) {
    return -1;
  }

  const confidenceDelta = right.confidence - left.confidence;
  if (Math.abs(confidenceDelta) > 0.001) {
    return confidenceDelta;
  }

  const sourceDelta =
    getChairCandidateSourceWeight(right.source) - getChairCandidateSourceWeight(left.source);
  if (Math.abs(sourceDelta) > 0.001) {
    return sourceDelta;
  }

  const evidenceComparison = (left.evidence ?? "").localeCompare(right.evidence ?? "");
  if (evidenceComparison !== 0) {
    return evidenceComparison;
  }

  return left.chairCount - right.chairCount;
}

function buildChairCountResolutionScores(
  candidate: TableResolutionCandidate,
  validatedPriorChairCount?: number | null,
  options?: {
    includeSelectionBias?: boolean;
  },
) {
  const includeSelectionBias = options?.includeSelectionBias ?? true;
  const scoreByChairCount = new Map<
    number,
    {
      score: number;
      support: number;
      ocrSupport: number;
      bestCandidate: TableChairCandidate | null;
      bestCandidateScore: number;
    }
  >();

  for (const chairCandidate of candidate.candidates) {
    const current = scoreByChairCount.get(chairCandidate.chairCount) ?? {
      score: 0,
      support: 0,
      ocrSupport: 0,
      bestCandidate: null,
      bestCandidateScore: Number.NEGATIVE_INFINITY,
    };
    const weightedConfidence =
      chairCandidate.confidence * getChairCandidateSourceWeight(chairCandidate.source);
    const individualScore =
      weightedConfidence +
      (includeSelectionBias && chairCandidate.chairCount === candidate.selectedChairCount ? 0.08 : 0) +
      (typeof validatedPriorChairCount === "number" &&
      chairCandidate.chairCount === validatedPriorChairCount
        ? 0.18
        : 0) +
      (candidate.suspicionFlags.includes("weak_ocr_evidence") &&
      isDirectOcrChairCandidateSource(chairCandidate.source)
        ? 0.05
        : 0);

    current.score += weightedConfidence;
    current.support += 1;
    if (isDirectOcrChairCandidateSource(chairCandidate.source)) {
      current.ocrSupport += weightedConfidence;
    }
    if (
      individualScore > current.bestCandidateScore + 0.001 ||
      (Math.abs(individualScore - current.bestCandidateScore) <= 0.001 &&
        compareChairCandidatePriority(chairCandidate, current.bestCandidate) < 0)
    ) {
      current.bestCandidate = chairCandidate;
      current.bestCandidateScore = individualScore;
    }
    scoreByChairCount.set(chairCandidate.chairCount, current);
  }

  for (const [chairCount, summary] of scoreByChairCount.entries()) {
    if (includeSelectionBias && chairCount === candidate.selectedChairCount) {
      summary.score += 0.08;
    }
    if (typeof validatedPriorChairCount === "number" && chairCount === validatedPriorChairCount) {
      summary.score += 0.18;
    }
    if (
      candidate.suspicionFlags.includes("weak_ocr_evidence") &&
      summary.ocrSupport > 0
    ) {
      summary.score += 0.05;
    }
  }

  return [...scoreByChairCount.entries()]
    .map(([chairCount, summary]) => ({
      chairCount,
      ...summary,
    }))
    .sort((left, right) => {
      const scoreDelta = right.score - left.score;
      if (Math.abs(scoreDelta) > 0.001) {
        return scoreDelta;
      }

      const ocrDelta = right.ocrSupport - left.ocrSupport;
      if (Math.abs(ocrDelta) > 0.001) {
        return ocrDelta;
      }

      if (right.support !== left.support) {
        return right.support - left.support;
      }

      const candidateComparison = compareChairCandidatePriority(
        left.bestCandidate,
        right.bestCandidate,
      );
      if (candidateComparison !== 0) {
        return candidateComparison;
      }

      const baseline =
        typeof validatedPriorChairCount === "number"
          ? validatedPriorChairCount
          : candidate.selectedChairCount;
      const baselineDelta =
        Math.abs(left.chairCount - baseline) - Math.abs(right.chairCount - baseline);
      if (baselineDelta !== 0) {
        return baselineDelta;
      }

      return left.chairCount - right.chairCount;
    });
}

function selectBestChairCandidate(
  candidate: TableResolutionCandidate,
  validatedPriorChairCount?: number | null,
) {
  return (
    buildChairCountResolutionScores(candidate, validatedPriorChairCount, {
      includeSelectionBias: true,
    })[0]?.bestCandidate ?? null
  );
}

function getResolvedChairCountScore(
  candidate: TableResolutionCandidate,
  chairCount: number,
  validatedPriorChairCount?: number | null,
) {
  return (
    buildChairCountResolutionScores(candidate, validatedPriorChairCount, {
      includeSelectionBias: false,
    }).find((entry) => entry.chairCount === chairCount)?.score ?? Number.NEGATIVE_INFINITY
  );
}

function reselectResolutionCandidates(
  candidates: TableResolutionCandidate[],
  validatedPriors: ValidatedPlanPriors | null | undefined,
  validatedMesaNumberPriors?: ValidatedMesaNumberPriors | null,
) {
  return candidates.map((candidate) => {
    const prior = findValidatedPriorForPosition(validatedPriors, candidate.positionIndex);
    const mesaNumberPrior =
      validatedMesaNumberPriors?.priorsByMesaNumber.find((entry) => entry.numero === candidate.numero)
        ?.mostCommonChairCount ?? null;
    const preferredPrior =
      typeof mesaNumberPrior === "number" ? mesaNumberPrior : prior?.mostCommonChairCount ?? null;
    const selectedChairCandidate = selectBestChairCandidate(candidate, preferredPrior);
    const selectedChairCount = selectedChairCandidate?.chairCount ?? candidate.selectedChairCount;

    return {
      ...candidate,
      chairCount: selectedChairCount,
      selectedChairCount,
    };
  });
}

function getSuspiciousRereadPriority(candidate: TableResolutionCandidate) {
  let priority = candidate.suspicionScore * 100;

  if (candidate.suspicionFlags.includes("global_total_pressure")) {
    priority += 30;
  }
  if (candidate.suspicionFlags.includes("source_disagreement")) {
    priority += 20;
  }
  if (candidate.suspicionFlags.includes("validated_prior_mismatch")) {
    priority += 12;
  }
  if (candidate.suspicionFlags.includes("weak_ocr_evidence")) {
    priority += 8;
  }

  return priority;
}

function selectSuspiciousResolutionCandidatesForReread(
  entries: TableResolutionCandidate[],
) {
  const rereadLimit = Math.min(entries.length, clamp(Math.ceil(entries.length * 0.3), 2, 8));

  return [...entries]
    .filter((entry) => entry.suspicionScore >= 2)
    .sort((a, b) => {
      const priorityDelta =
        getSuspiciousRereadPriority(b) - getSuspiciousRereadPriority(a);
      if (priorityDelta !== 0) {
        return priorityDelta;
      }

      if (b.candidates.length !== a.candidates.length) {
        return b.candidates.length - a.candidates.length;
      }

      return a.positionIndex - b.positionIndex;
    })
    .slice(0, rereadLimit);
}

function getSuspiciousRereadCropIndex(
  tableIndex: number,
  source: SuspiciousChairCropRegion["source"],
) {
  switch (source) {
    case "paddle_tight":
      return tableIndex * 10 + 1;
    case "paddle_wide":
      return tableIndex * 10 + 2;
    case "paddle_bottom_band":
    default:
      return tableIndex * 10 + 3;
  }
}

function buildSuspiciousChairCropRegions(
  layout: DetectedImageLayout,
  entries: TableResolutionCandidate[],
  halfWidth: number,
  halfHeight: number,
) {
  const orderedGeometry = sortEntriesBySpatialOrder(layout.tables).filter(
    (entry): entry is MesaSillaPair & { x: number; y: number } =>
      typeof entry.x === "number" && typeof entry.y === "number",
  );
  const rereadEntries = selectSuspiciousResolutionCandidatesForReread(entries);
  const tightHalfWidth = clamp(Math.round(halfWidth * 0.78), 42, halfWidth);
  const tightHalfHeight = clamp(Math.round(halfHeight * 0.76), 34, halfHeight);
  const wideHalfWidth = clamp(Math.round(halfWidth * 1.26), halfWidth + 8, 136);
  const wideHalfHeight = clamp(Math.round(halfHeight * 1.18), halfHeight + 4, 112);
  const bottomBandHalfWidth = clamp(Math.round(halfWidth * 1.24), halfWidth, 144);
  const bottomBandHeight = clamp(Math.round(halfHeight * 0.82), 28, 64);

  return rereadEntries
    .flatMap((entry) => {
      const geometryEntry = orderedGeometry[entry.positionIndex];
      if (!geometryEntry) {
        return [];
      }

      const centerX = geometryEntry.x;
      const centerY = geometryEntry.y;

      return [
        {
          index: getSuspiciousRereadCropIndex(entry.positionIndex, "paddle_tight"),
          tableIndex: entry.positionIndex,
          source: "paddle_tight",
          evidence: `reread-tight-index-${entry.positionIndex}`,
          ...clampCropRegion(
            {
              x: centerX - tightHalfWidth,
              y: centerY - tightHalfHeight,
              width: tightHalfWidth * 2,
              height: tightHalfHeight * 2,
            },
            layout.sourceBounds.width,
            layout.sourceBounds.height,
          ),
        },
        {
          index: getSuspiciousRereadCropIndex(entry.positionIndex, "paddle_wide"),
          tableIndex: entry.positionIndex,
          source: "paddle_wide",
          evidence: `reread-wide-index-${entry.positionIndex}`,
          ...clampCropRegion(
            {
              x: centerX - wideHalfWidth,
              y: centerY - wideHalfHeight,
              width: wideHalfWidth * 2,
              height: wideHalfHeight * 2,
            },
            layout.sourceBounds.width,
            layout.sourceBounds.height,
          ),
        },
        {
          index: getSuspiciousRereadCropIndex(entry.positionIndex, "paddle_bottom_band"),
          tableIndex: entry.positionIndex,
          source: "paddle_bottom_band",
          evidence: `reread-bottom-band-index-${entry.positionIndex}`,
          ...clampCropRegion(
            {
              x: centerX - bottomBandHalfWidth,
              y: centerY + Math.round(halfHeight * 0.18),
              width: bottomBandHalfWidth * 2,
              height: bottomBandHeight,
            },
            layout.sourceBounds.width,
            layout.sourceBounds.height,
          ),
        },
      ] satisfies SuspiciousChairCropRegion[];
    });
}

function getSuspiciousRereadConfidence(source: SuspiciousChairCropRegion["source"]) {
  switch (source) {
    case "paddle_bottom_band":
      return 0.86;
    case "paddle_tight":
      return 0.8;
    case "paddle_wide":
    default:
      return 0.74;
  }
}

function resolutionCandidatesToEntries(candidates: TableResolutionCandidate[]) {
  return candidates.map((candidate) => ({
    numero: candidate.numero,
    chairCount: candidate.selectedChairCount,
    x: candidate.x,
    y: candidate.y,
  }));
}

function applyChairCountsToResolutionCandidates(
  candidates: TableResolutionCandidate[],
  entries: MesaSillaPair[],
) {
  return candidates.map((candidate, index) => {
    const selectedChairCount = entries[index]?.chairCount ?? candidate.selectedChairCount;
    return {
      ...candidate,
      chairCount: selectedChairCount,
      selectedChairCount,
    };
  });
}

function maybeSwapNeighborCounts(
  candidates: TableResolutionCandidate[],
  validatedPriors: ValidatedPlanPriors | null | undefined,
  validatedMesaNumberPriors?: ValidatedMesaNumberPriors | null,
  expectedChairTotal?: number,
) {
  const next = candidates.map((candidate) => ({
    ...candidate,
    candidates: [...candidate.candidates],
    suspicionFlags: [...candidate.suspicionFlags],
  }));
  const appliedSwaps: Array<{
    leftIndex: number;
    rightIndex: number;
    leftChairCount: number;
    rightChairCount: number;
  }> = [];
  const nearestDistance = estimateNearestNeighborDistance(next);
  const maxNeighborDistance = Math.max(84, nearestDistance > 0 ? nearestDistance * 1.45 : 132);

  for (let index = 0; index < next.length - 1; index += 1) {
    const current = next[index];
    const neighbor = next[index + 1];
    if (!current || !neighbor) {
      continue;
    }

    if (
      (current.suspicionScore === 0 && neighbor.suspicionScore === 0) ||
      current.selectedChairCount === neighbor.selectedChairCount
    ) {
      continue;
    }

    if (
      typeof current.x === "number" &&
      typeof current.y === "number" &&
      typeof neighbor.x === "number" &&
      typeof neighbor.y === "number"
    ) {
      const distance = Math.hypot(neighbor.x - current.x, neighbor.y - current.y);
      const verticalGap = Math.abs(neighbor.y - current.y);
      if (distance > maxNeighborDistance || verticalGap > maxNeighborDistance * 0.45) {
        continue;
      }
    }

    const currentPrior =
      validatedMesaNumberPriors?.priorsByMesaNumber.find((entry) => entry.numero === current.numero)
        ?.mostCommonChairCount ??
      findValidatedPriorForPosition(validatedPriors, current.positionIndex)?.mostCommonChairCount ??
      null;
    const neighborPrior =
      validatedMesaNumberPriors?.priorsByMesaNumber.find((entry) => entry.numero === neighbor.numero)
        ?.mostCommonChairCount ??
      findValidatedPriorForPosition(validatedPriors, neighbor.positionIndex)?.mostCommonChairCount ??
      null;
    const keepScore =
      getResolvedChairCountScore(current, current.selectedChairCount, currentPrior) +
      getResolvedChairCountScore(neighbor, neighbor.selectedChairCount, neighborPrior);
    const swapScore =
      getResolvedChairCountScore(current, neighbor.selectedChairCount, currentPrior) +
      getResolvedChairCountScore(neighbor, current.selectedChairCount, neighborPrior);

    if (!Number.isFinite(keepScore) || !Number.isFinite(swapScore)) {
      continue;
    }

    const keepPriorMatches =
      (typeof currentPrior === "number" && current.selectedChairCount === currentPrior ? 1 : 0) +
      (typeof neighborPrior === "number" && neighbor.selectedChairCount === neighborPrior ? 1 : 0);
    const swapPriorMatches =
      (typeof currentPrior === "number" && neighbor.selectedChairCount === currentPrior ? 1 : 0) +
      (typeof neighborPrior === "number" && current.selectedChairCount === neighborPrior ? 1 : 0);
    const totalPressureBonus =
      typeof expectedChairTotal === "number" && getChairTotal(next) !== expectedChairTotal ? 0.02 : 0;
    const shouldSwap =
      swapScore > keepScore + 0.16 + totalPressureBonus ||
      (swapScore > keepScore + totalPressureBonus && swapPriorMatches > keepPriorMatches);

    if (!shouldSwap) {
      continue;
    }

    const previousCurrentChairCount = current.selectedChairCount;
    current.chairCount = neighbor.selectedChairCount;
    current.selectedChairCount = neighbor.selectedChairCount;
    neighbor.chairCount = previousCurrentChairCount;
    neighbor.selectedChairCount = previousCurrentChairCount;
    appliedSwaps.push({
      leftIndex: current.positionIndex,
      rightIndex: neighbor.positionIndex,
      leftChairCount: previousCurrentChairCount,
      rightChairCount: current.selectedChairCount,
    });
    index += 1;
  }

  return {
    candidates: next,
    appliedSwaps,
  };
}

function buildNormalizationChairCandidates(
  entry: MesaSillaPair,
  resolutionCandidate: TableResolutionCandidate | undefined,
) {
  const candidateSourcesByChairCount = new Map<number, Set<TableChairCandidateSource>>();
  const addCandidate = (
    chairCount: number | null | undefined,
    source: TableChairCandidateSource,
  ) => {
    if (
      typeof chairCount !== "number" ||
      !Number.isInteger(chairCount) ||
      chairCount < 1 ||
      chairCount > 24
    ) {
      return;
    }

    const sources = candidateSourcesByChairCount.get(chairCount) ?? new Set<TableChairCandidateSource>();
    sources.add(source);
    candidateSourcesByChairCount.set(chairCount, sources);
  };

  for (const candidate of resolutionCandidate?.candidates ?? []) {
    addCandidate(candidate.chairCount, candidate.source);
  }

  const candidates = [...candidateSourcesByChairCount.entries()]
    .filter(
      ([chairCount, sources]) =>
        chairCount === entry.chairCount ||
        [...sources].some((source) => source !== "validated_prior"),
    )
    .map(([chairCount]) => chairCount);

  return candidates.length > 0 ? candidates : [entry.chairCount];
}

async function runPaddlePlanCropOcr(
  buffer: Buffer,
  cropRegions: Array<CropRegion & { index: number }>,
  debugContext?: PlanImportDebugContext,
) {
  assertImportNotCancelled(debugContext);
  const signal = getImportAbortSignal(debugContext);
  const scriptPath = path.resolve(process.cwd(), "scripts", "paddle-plan-ocr.py");
  const tempDir = path.resolve(process.cwd(), ".tmp-plan-import");
  const baseName = `paddle-${debugContext?.traceId ?? randomUUID()}`;
  const imagePath = path.join(tempDir, `${baseName}.png`);
  const regionsPath = path.join(tempDir, `${baseName}.regions.json`);

  await fs.mkdir(tempDir, { recursive: true });
  await fs.writeFile(imagePath, buffer);
  await fs.writeFile(regionsPath, JSON.stringify(cropRegions), "utf8");

    try {
      logPlanImport(debugContext, "image.paddle.started", {
        total: cropRegions.length,
      });
      const { stdout, stderr } = await execPythonWithImportAbort(
        [scriptPath, imagePath, regionsPath],
        {
          preference: "paddle",
          retryMissingPaddleSupport: true,
          timeout: PADDLE_PLAN_OCR_TIMEOUT_MS,
          maxBuffer: 8 * 1024 * 1024,
          signal,
          env: {
            ...process.env,
            PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK: "True",
          },
        },
      );
    assertImportNotCancelled(debugContext);

    if (stderr?.trim()) {
      logPlanImport(debugContext, "image.paddle.stderr", {
        message: stderr.trim().slice(-1200),
      });
    }

    const parsed = JSON.parse(stdout) as { results?: PaddleOcrCropResult[] };
      logPlanImport(debugContext, "image.paddle.completed", {
        total: Array.isArray(parsed.results) ? parsed.results.length : 0,
      });
      return Array.isArray(parsed.results) ? parsed.results : [];
    } catch (error) {
      if (isAbortLikeError(error)) {
        throw new PlanImportCancelledError();
      }

      throw error;
    } finally {
      await Promise.allSettled([
        fs.unlink(imagePath),
      fs.unlink(regionsPath),
    ]);
  }
}

async function runAdvancedPlanVision(
  buffer: Buffer,
  hints: PlanImportHints | undefined,
  debugContext?: PlanImportDebugContext,
  signal?: AbortSignal,
) {
  assertImportNotCancelled(debugContext);
  const operationSignal = signal ?? getImportAbortSignal(debugContext);
  const scriptPath = path.resolve(process.cwd(), "scripts", "detect-plan-layout-advanced.py");
  const tempDir = path.resolve(process.cwd(), ".tmp-plan-import");
  const baseName = `advanced-${debugContext?.traceId ?? randomUUID()}`;
  const imagePath = path.join(tempDir, `${baseName}.png`);
  const hintsPath = path.join(tempDir, `${baseName}.hints.json`);

  await fs.mkdir(tempDir, { recursive: true });
  await fs.writeFile(imagePath, buffer);
  await fs.writeFile(hintsPath, JSON.stringify(hints ?? {}), "utf8");

    try {
      logPlanImport(debugContext, "image.advanced.started");
      const { stdout, stderr } = await execPythonWithImportAbort(
        [scriptPath, imagePath, hintsPath],
        {
          preference: "paddle",
          retryMissingPaddleSupport: true,
          timeout: IMAGE_ADVANCED_VISION_TIMEOUT_MS,
          maxBuffer: 10 * 1024 * 1024,
          signal: operationSignal,
          env: {
            ...process.env,
            PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK: "True",
            ULTRALYTICS_CONFIG_DIR: path.resolve(process.cwd(), ".ultralytics"),
          },
      },
    );
    assertImportNotCancelled(debugContext);

    if (stderr?.trim()) {
      logPlanImport(debugContext, "image.advanced.stderr", {
        message: stderr.trim().slice(-1200),
      });
    }

    const parsed = JSON.parse(stdout) as {
      tables?: Array<{ numero?: number; chairCount?: number; x?: number; y?: number }>;
      meta?: Record<string, unknown>;
    };

    const tables = Array.isArray(parsed.tables)
      ? parsed.tables
          .filter(
            (table): table is { numero: number; chairCount: number; x: number; y: number } =>
              Number.isInteger(table?.numero) &&
              Number.isInteger(table?.chairCount) &&
              typeof table?.x === "number" &&
              typeof table?.y === "number",
          )
          .map((table) => ({
            numero: table.numero,
            chairCount: table.chairCount,
            x: table.x,
            y: table.y,
          }))
      : [];

    const width =
      typeof parsed.meta?.imageWidth === "number" ? Number(parsed.meta.imageWidth) : null;
    const height =
      typeof parsed.meta?.imageHeight === "number" ? Number(parsed.meta.imageHeight) : null;

    logPlanImport(debugContext, "image.advanced.completed", {
      tableCount: tables.length,
      ...(parsed.meta ?? {}),
    });

      return {
        tables,
        sourceBounds:
        width && height
          ? {
              width,
              height,
            }
          : null,
        meta: parsed.meta,
      } satisfies AdvancedVisionLayoutResult;
    } catch (error) {
      if (isAbortLikeError(error)) {
        throw new PlanImportCancelledError();
      }

      throw error;
    } finally {
      await Promise.allSettled([fs.unlink(imagePath), fs.unlink(hintsPath)]);
    }
}

function chooseChairCountsClosestToTarget(
  entries: MesaSillaPair[],
  chairCandidatesByIndex: number[][],
  expectedChairTotal?: number,
) {
  if (
    !Number.isInteger(expectedChairTotal) ||
    !Array.isArray(chairCandidatesByIndex) ||
    chairCandidatesByIndex.length !== entries.length
  ) {
    return entries;
  }
  const targetChairTotal = expectedChairTotal!;

  type CandidateState = {
    score: number;
    counts: number[];
  };

  let states = new Map<number, CandidateState>();
  states.set(0, { score: 0, counts: [] });

  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    const rawCandidates = chairCandidatesByIndex[index] ?? [];
    const candidates = [...new Set(rawCandidates)].filter(
      (value) => Number.isInteger(value) && value >= 1 && value <= 24,
    );

    if (candidates.length === 0) {
      candidates.push(entry.chairCount);
    }

    const nextStates = new Map<number, CandidateState>();

    for (const [partialTotal, state] of states.entries()) {
      for (const candidate of candidates) {
        const nextTotal = partialTotal + candidate;
        const penalty =
          Math.abs(candidate - entry.chairCount) * 4 +
          (candidate === entry.chairCount ? 0 : 1);
        const nextScore = state.score + penalty;
        const previous = nextStates.get(nextTotal);

        if (!previous || nextScore < previous.score) {
          nextStates.set(nextTotal, {
            score: nextScore,
            counts: [...state.counts, candidate],
          });
        }
      }
    }

    states = nextStates;
  }

  let bestState: CandidateState | null = null;
  let bestTotal: number | null = null;

  for (const [total, state] of states.entries()) {
    if (
      !bestState ||
      Math.abs(total - targetChairTotal) < Math.abs((bestTotal ?? 0) - targetChairTotal) ||
      (Math.abs(total - targetChairTotal) === Math.abs((bestTotal ?? 0) - targetChairTotal) &&
        state.score < bestState.score)
    ) {
      bestState = state;
      bestTotal = total;
    }
  }

  if (!bestState || bestState.counts.length !== entries.length) {
    return entries;
  }

  return entries.map((entry, index) => ({
    ...entry,
    chairCount: bestState!.counts[index],
  }));
}

function serializeOrderedLabels(entries: AiOrderedPlanTable[]) {
  return entries.map((entry, index) => `${index + 1}. M:${entry.numero} S:${entry.chairCount}`).join("\n");
}

function scoreOrderedLabelCandidate(
  entries: AiOrderedPlanTable[] | null | undefined,
  hints: PlanImportHints | undefined,
  geometryTableCount: number,
) {
  if (!entries || entries.length === 0) {
    return Number.POSITIVE_INFINITY;
  }

  const expectedTableCount = hints?.expectedTableCount ?? geometryTableCount;
  const expectedChairTotal = hints?.expectedChairTotal;
  const tablePenalty = Math.abs(entries.length - expectedTableCount) * 1000;
  const chairPenalty =
    typeof expectedChairTotal === "number"
      ? Math.abs(getChairTotal(entries) - expectedChairTotal) * 25
      : 0;

  return tablePenalty + chairPenalty;
}

function applyHintGridLayout(entries: MesaSillaPair[], hints?: PlanImportHints) {
  if (
    !hints?.expectedRowCount ||
    !hints?.expectedColumnCount ||
    hints.expectedRowCount <= 0 ||
    hints.expectedColumnCount <= 0
  ) {
    return entries;
  }

  const orderedEntries = sortEntriesBySpatialOrder(entries);
  const maxEntries = hints.expectedRowCount * hints.expectedColumnCount;
  if (orderedEntries.length > maxEntries) {
    return entries;
  }

  const density = clamp(Math.sqrt(orderedEntries.length / 18), 0.42, 1);
  const maxTableSpan = orderedEntries.reduce((maxSpan, entry) => {
    const dimensions = getTableDimensions(entry.chairCount);
    return Math.max(maxSpan, dimensions.height + dimensions.chairOffset * 2 + 34);
  }, 260);
  const widthCompactness =
    orderedEntries.length <= 8 ? 0.44 : orderedEntries.length <= 18 ? 0.58 : lerp(0.68, 0.8, density);
  const heightCompactness =
    orderedEntries.length <= 8 ? 0.26 : orderedEntries.length <= 18 ? 0.4 : lerp(0.48, 0.62, density);
  const usableWidth = ROOM_LAYOUT_WIDTH * widthCompactness;
  const usableHeight = ROOM_LAYOUT_HEIGHT * heightCompactness;
  const centerX = ROOM_LAYOUT_WIDTH / 2;
  const centerY = ROOM_LAYOUT_HEIGHT / 2;
  const titleFootprint = hints.eventName
    ? getEventTitleFootprint(hints.eventName, ROOM_LAYOUT_WIDTH, ROOM_LAYOUT_HEIGHT)
    : null;
  const columnStep =
    hints.expectedColumnCount > 1 ? usableWidth / (hints.expectedColumnCount - 1) : 0;
  const rowStepBase =
    hints.expectedRowCount > 1
      ? Math.min(330, Math.max(150, usableHeight / (hints.expectedRowCount - 1)))
      : 0;

  const columnPositions = Array.from(
    { length: hints.expectedColumnCount },
    (_, index) =>
      hints.expectedColumnCount === 1
        ? centerX
        : Math.round(centerX - usableWidth / 2 + columnStep * index),
  );

  let rowPositions: number[];
  if (hints.expectedRowCount === 1) {
    rowPositions = [centerY];
  } else if (hints.expectedRowCount === 2) {
    const pairHalfGap = Math.max(120, rowStepBase * 0.48);
    rowPositions = [
      Math.round(centerY - pairHalfGap),
      Math.round(centerY + pairHalfGap),
    ];
  } else {
    const topRows = Math.floor(hints.expectedRowCount / 2);
    const bottomRows = hints.expectedRowCount - topRows;
    const columnDensity =
      hints.expectedColumnCount >= 7
        ? 1
        : hints.expectedColumnCount >= 6
          ? 0.84
          : hints.expectedColumnCount >= 4
            ? 0.72
            : 0.62;
    const centerGapBias =
      (hints.expectedRowCount >= 6 ? 0.22 : hints.expectedRowCount >= 4 ? 0.32 : 0.46) *
      columnDensity;
    const reservedCenterHeight = titleFootprint
      ? titleFootprint.safeHeight + maxTableSpan * centerGapBias + 10
      : maxTableSpan + 96;
    const titleGap = clamp(
      reservedCenterHeight,
      rowStepBase * 0.46,
      Math.max(rowStepBase * 0.92, reservedCenterHeight),
    );
    const topStart = centerY - titleGap / 2 - rowStepBase * Math.max(0, topRows - 1);
    const bottomStart = centerY + titleGap / 2;
    rowPositions = [
      ...Array.from({ length: topRows }, (_, index) =>
        Math.round(topStart + rowStepBase * index),
      ),
      ...Array.from({ length: bottomRows }, (_, index) =>
        Math.round(bottomStart + rowStepBase * index),
      ),
    ];
  }

  return orderedEntries.map((entry, index) => {
    const rowIndex = Math.floor(index / hints.expectedColumnCount!);
    const columnIndex = index % hints.expectedColumnCount!;

    return {
      ...entry,
      x: columnPositions[columnIndex] ?? centerX,
      y: rowPositions[rowIndex] ?? centerY,
    };
  });
}

function normalizeText(text: string) {
  return text
    .replace(/\u0000/g, " ")
    .replace(/\r/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{2,}/g, "\n")
    .trim();
}

function getOpenAIApiKey() {
  return process.env.OPENAI_API_KEY?.trim() || "";
}

function canUseOpenAIImporter() {
  return getOpenAIApiKey().length > 0;
}

function parseNumericDimension(value: string | undefined) {
  if (!value) {
    return null;
  }

  const match = value.match(/-?\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : null;
}

function decodeHtmlText(text: string) {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"');
}

function normalizeDigitLikeString(text: string) {
  return text
    .toUpperCase()
    .replace(/[\s|]/g, "")
    .replace(/[OQD]/g, "0")
    .replace(/[IL]/g, "1")
    .replace(/Z/g, "2")
    .replace(/[A]/g, "4")
    .replace(/[S\$]/g, "5")
    .replace(/G/g, "6")
    .replace(/T/g, "7")
    .replace(/B/g, "8")
    .replace(/[^0-9]/g, "");
}

function parseMesaOrSillaToken(text: string): { kind: "mesa" | "silla"; value: number } | null {
  const compact = decodeHtmlText(text)
    .toUpperCase()
    .replace(/\s+/g, "")
    .replace(/[;,_]/g, ":");

  const tokenMatch = compact.match(/^([MMS5\$])[:=\-]?([0-9A-Z\$]{1,4})$/i);
  if (!tokenMatch) {
    return null;
  }

  const prefix = tokenMatch[1].toUpperCase();
  const kind: "mesa" | "silla" | null =
    prefix === "M"
      ? "mesa"
      : prefix === "S" || prefix === "5" || prefix === "$"
        ? "silla"
        : null;

  if (!kind) {
    return null;
  }

  const normalizedDigits = normalizeDigitLikeString(tokenMatch[2]);
  if (!normalizedDigits) {
    return null;
  }

  const value = Number(normalizedDigits);
  if (!Number.isInteger(value) || value <= 0) {
    return null;
  }

  return { kind, value };
}

function scalePosition(value: number, sourceSize: number, targetSize: number, margin: number) {
  if (sourceSize <= 0) {
    return targetSize / 2;
  }

  const usable = Math.max(1, targetSize - margin * 2);
  return Math.round(margin + (value / sourceSize) * usable);
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function clampCropRegion(region: CropRegion, maxWidth: number, maxHeight: number) {
  const x = clamp(region.x, 0, Math.max(0, maxWidth - 1));
  const y = clamp(region.y, 0, Math.max(0, maxHeight - 1));
  const width = clamp(region.width, 1, Math.max(1, maxWidth - x));
  const height = clamp(region.height, 1, Math.max(1, maxHeight - y));

  return { x, y, width, height } satisfies CropRegion;
}

function lerp(start: number, end: number, amount: number) {
  return start + (end - start) * amount;
}

function median(values: number[]) {
  if (values.length === 0) {
    return 0;
  }

  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);

  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

function parseJsonSafe<T>(value: string): T | null {
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

function getContentBounds(entries: MesaSillaPair[]) {
  const positionedEntries = entries.filter(
    (entry) => typeof entry.x === "number" && typeof entry.y === "number",
  ) as Array<MesaSillaPair & { x: number; y: number }>;

  if (positionedEntries.length === 0) {
    return null;
  }

  const minX = Math.min(...positionedEntries.map((entry) => entry.x));
  const minY = Math.min(...positionedEntries.map((entry) => entry.y));
  const maxX = Math.max(...positionedEntries.map((entry) => entry.x));
  const maxY = Math.max(...positionedEntries.map((entry) => entry.y));

  return {
    minX,
    minY,
    maxX,
    maxY,
  };
}

function getEntryFootprint(entry: MesaSillaPair) {
  const { width, height, chairOffset } = getTableDimensions(entry.chairCount);

  return {
    width: width + chairOffset * 2 + 40,
    height: height + chairOffset * 2 + 32,
  };
}

function groupEntriesIntoRows(entries: Array<MesaSillaPair & { x: number; y: number }>) {
  if (entries.length === 0) {
    return [] as Array<Array<MesaSillaPair & { x: number; y: number }>>;
  }

  const contentBounds = getContentBounds(entries);
  const spanY = Math.max(1, (contentBounds?.maxY ?? 0) - (contentBounds?.minY ?? 0));
  const rowThreshold = Math.max(44, spanY / Math.max(3, Math.round(Math.sqrt(entries.length) * 1.8)));
  const sorted = [...entries].sort((a, b) =>
    Math.abs(a.y - b.y) < rowThreshold * 0.45 ? a.x - b.x : a.y - b.y,
  );
  const rows: Array<Array<MesaSillaPair & { x: number; y: number }>> = [];

  for (const entry of sorted) {
    const currentRow = rows[rows.length - 1];

    if (!currentRow) {
      rows.push([entry]);
      continue;
    }

    const averageY =
      currentRow.reduce((sum, rowEntry) => sum + rowEntry.y, 0) / currentRow.length;

    if (Math.abs(entry.y - averageY) <= rowThreshold) {
      currentRow.push(entry);
      continue;
    }

    rows.push([entry]);
  }

  return rows.map((row) => row.sort((a, b) => a.x - b.x));
}

function regularizeSpatialEntries(entries: MesaSillaPair[]) {
  const positionedEntries = entries.filter(
    (entry) => typeof entry.x === "number" && typeof entry.y === "number",
  ) as Array<MesaSillaPair & { x: number; y: number }>;

  if (positionedEntries.length === 0) {
    return [] as Array<MesaSillaPair & { x: number; y: number }>;
  }

  const rows = groupEntriesIntoRows(positionedEntries);
  const density = clamp(Math.sqrt(positionedEntries.length / 16), 0.6, 1.8);
  const maxLayoutWidth = ROOM_LAYOUT_WIDTH - 460;
  const maxLayoutHeight = ROOM_LAYOUT_HEIGHT - 420;
  const baseHorizontalGap = lerp(200, 88, clamp((positionedEntries.length - 6) / 36, 0, 1));
  const baseVerticalGap = lerp(240, 140, clamp((rows.length - 2) / 5, 0, 1));
  const rowMeta = rows.map((row) => {
    const footprints = row.map(getEntryFootprint);
    const footprintWidth = footprints.reduce((sum, footprint) => sum + footprint.width, 0);
    const gap = row.length > 1
      ? Math.max(42, Math.min(baseHorizontalGap, (maxLayoutWidth - footprintWidth) / (row.length - 1)))
      : 0;
    const totalWidth = footprintWidth + gap * Math.max(0, row.length - 1);
    const maxHeight = Math.max(...footprints.map((footprint) => footprint.height));

    return {
      row,
      footprints,
      gap,
      totalWidth,
      maxHeight,
    };
  });
  const footprintHeight = rowMeta.reduce((sum, meta) => sum + meta.maxHeight, 0);
  const rowGap = rowMeta.length > 1
    ? Math.max(88, Math.min(baseVerticalGap, (maxLayoutHeight - footprintHeight) / (rowMeta.length - 1)))
    : 0;
  const totalHeight = footprintHeight + rowGap * Math.max(0, rowMeta.length - 1);
  const top = (ROOM_LAYOUT_HEIGHT - totalHeight) / 2;
  const normalizedEntries: Array<MesaSillaPair & { x: number; y: number }> = [];

  let currentY = top;

  for (const meta of rowMeta) {
    const left = (ROOM_LAYOUT_WIDTH - meta.totalWidth) / 2;
    let currentX = left;

    for (let index = 0; index < meta.row.length; index += 1) {
      const entry = meta.row[index];
      const footprint = meta.footprints[index];

      normalizedEntries.push({
        ...entry,
        x: Math.round(currentX + footprint.width / 2),
        y: Math.round(currentY + meta.maxHeight / 2),
      });

      currentX += footprint.width + meta.gap;
    }

    currentY += meta.maxHeight + rowGap;
  }

  return normalizedEntries;
}

function hasReliableSpatialLayout(entries: MesaSillaPair[]) {
  const positionedEntries = entries.filter(
    (entry) => typeof entry.x === "number" && typeof entry.y === "number",
  ) as Array<MesaSillaPair & { x: number; y: number }>;

  if (positionedEntries.length === 0) {
    return false;
  }

  const bounds = getContentBounds(positionedEntries);
  const spanX = Math.max(0, (bounds?.maxX ?? 0) - (bounds?.minX ?? 0));
  const spanY = Math.max(0, (bounds?.maxY ?? 0) - (bounds?.minY ?? 0));
  const rowCount = groupEntriesIntoRows(positionedEntries).length;

  if (positionedEntries.length >= 8 && spanY < 60) {
    return false;
  }

  if (positionedEntries.length >= 12 && rowCount < 2) {
    return false;
  }

  if (positionedEntries.length >= 24 && rowCount < 3) {
    return false;
  }

  return spanX > 0;
}

function mergeSpatialAndAiEntries(
  spatialEntries: MesaSillaPair[],
  aiEntries: MesaSillaPair[],
) {
  const spatialByMesa = new Map(spatialEntries.map((entry) => [entry.numero, entry]));
  const merged: MesaSillaPair[] = spatialEntries.map((entry) => {
    const aiEntry = aiEntries.find((candidate) => candidate.numero === entry.numero);

    return {
      ...entry,
      chairCount: aiEntry?.chairCount ?? entry.chairCount,
    };
  });

  for (const aiEntry of aiEntries) {
    if (!spatialByMesa.has(aiEntry.numero)) {
      merged.push(aiEntry);
    }
  }

  return merged;
}

function shouldUseAiCountsForImage(
  spatialEntries: MesaSillaPair[],
  aiEntries: MesaSillaPair[],
) {
  if (spatialEntries.length === 0 || aiEntries.length === 0) {
    return false;
  }

  const overlappingMesaNumbers = spatialEntries.filter((entry) =>
    aiEntries.some((candidate) => candidate.numero === entry.numero),
  );

  if (overlappingMesaNumbers.length < Math.max(4, Math.floor(spatialEntries.length * 0.35))) {
    return false;
  }

  const aiChairCounts = aiEntries
    .map((entry) => entry.chairCount)
    .filter((value) => Number.isInteger(value) && value > 0);
  const spatialChairCounts = spatialEntries
    .map((entry) => entry.chairCount)
    .filter((value) => Number.isInteger(value) && value > 0);
  const aiDistinctChairCounts = new Set(aiChairCounts);
  const spatialDistinctChairCounts = new Set(spatialChairCounts);

  if (aiDistinctChairCounts.size === 1 && spatialDistinctChairCounts.size > 1) {
    return false;
  }

  return true;
}

function shouldPreferAiLayoutForImage(
  spatialEntries: MesaSillaPair[],
  aiEntries: MesaSillaPair[],
) {
  if (aiEntries.length === 0) {
    return false;
  }

  if (spatialEntries.length === 0) {
    return true;
  }

  if (aiEntries.length >= Math.max(spatialEntries.length + 8, Math.ceil(spatialEntries.length * 1.8))) {
    return true;
  }

  if (!hasReliableSpatialLayout(spatialEntries) && aiEntries.length >= spatialEntries.length + 4) {
    return true;
  }

  return false;
}

function estimateNearestNeighborDistance(entries: MesaSillaPair[]) {
  const positionedEntries = entries.filter(
    (entry) => typeof entry.x === "number" && typeof entry.y === "number",
  ) as Array<MesaSillaPair & { x: number; y: number }>;

  if (positionedEntries.length < 2) {
    return 0;
  }

  const distances = positionedEntries.map((entry, index) => {
    let best = Number.POSITIVE_INFINITY;

    for (let candidateIndex = 0; candidateIndex < positionedEntries.length; candidateIndex += 1) {
      if (candidateIndex === index) {
        continue;
      }

      const candidate = positionedEntries[candidateIndex];
      const distance = Math.hypot(candidate.x - entry.x, candidate.y - entry.y);
      if (distance < best) {
        best = distance;
      }
    }

    return best;
  }).filter((value) => Number.isFinite(value) && value > 0);

  return median(distances);
}

function dedupeOcrTokens(tokens: OcrToken[]) {
  const sorted = [...tokens].sort((a, b) => b.confidence - a.confidence);
  const deduped: OcrToken[] = [];

  for (const token of sorted) {
    const duplicate = deduped.some((candidate) => {
      if (candidate.kind !== token.kind || candidate.value !== token.value) {
        return false;
      }

      return Math.abs(candidate.x - token.x) <= 28 && Math.abs(candidate.y - token.y) <= 24;
    });

    if (!duplicate) {
      deduped.push(token);
    }
  }

  return deduped.sort((a, b) => (Math.abs(a.y - b.y) < 18 ? a.x - b.x : a.y - b.y));
}

function sortEntriesBySpatialOrder(entries: MesaSillaPair[]) {
  const positionedEntries = entries.filter(
    (entry) => typeof entry.x === "number" && typeof entry.y === "number",
  ) as Array<MesaSillaPair & { x: number; y: number }>;

  if (positionedEntries.length === 0) {
    return [...entries];
  }

  return groupEntriesIntoRows(positionedEntries).flat();
}

function mergeAiLayoutWithOrderedLabels(
  aiEntries: MesaSillaPair[],
  orderedLabelEntries: MesaSillaPair[],
) {
  if (aiEntries.length === 0 || orderedLabelEntries.length === 0) {
    return aiEntries;
  }

  if (orderedLabelEntries.length < Math.max(12, Math.floor(aiEntries.length * 0.7))) {
    return aiEntries;
  }

  const aiSorted = sortEntriesBySpatialOrder(aiEntries);
  const labelSorted = sortEntriesBySpatialOrder(orderedLabelEntries);

  return aiSorted.map((entry, index) => {
    const labelEntry = labelSorted[index];

    if (!labelEntry) {
      return entry;
    }

    return {
      ...entry,
      numero: labelEntry.numero,
      chairCount: labelEntry.chairCount,
    };
  });
}

async function detectTableLayoutFromImageGeometry(
  buffer: Buffer,
  debugContext?: PlanImportDebugContext,
  signal?: AbortSignal,
) {
  assertImportNotCancelled(debugContext);
  throwIfAborted(signal);
  logPlanImport(debugContext, "image.geometry.started");
  const metadata = await sharp(buffer).metadata();
  throwIfAborted(signal);
  const originalWidth = metadata.width ?? 0;
  const originalHeight = metadata.height ?? 0;
  const resizedWidth = Math.min(1400, Math.max(1, originalWidth || 1400));
  const { data, info } = await sharp(buffer)
    .resize({ width: resizedWidth })
    .greyscale()
    .threshold(180)
    .negate()
    .raw()
    .toBuffer({ resolveWithObject: true });
  throwIfAborted(signal);

  const width = info.width;
  const height = info.height;
  const visited = new Uint8Array(width * height);
  const queue = new Int32Array(width * height);
  const candidates: Array<{ x: number; y: number; area: number; width: number; height: number }> = [];

  for (let y = 0; y < height; y += 1) {
    if (y % 24 === 0) {
      throwIfAborted(signal);
    }

    for (let x = 0; x < width; x += 1) {
      const startIndex = y * width + x;
      if (visited[startIndex] || data[startIndex] === 0) {
        continue;
      }

      visited[startIndex] = 1;
      let head = 0;
      let tail = 0;
      queue[tail] = startIndex;
      tail += 1;
      let minX = x;
      let maxX = x;
      let minY = y;
      let maxY = y;
      let area = 0;

      while (head < tail) {
        const currentIndex = queue[head];
        head += 1;
        const currentX = currentIndex % width;
        const currentY = Math.floor(currentIndex / width);
        area += 1;
        minX = Math.min(minX, currentX);
        maxX = Math.max(maxX, currentX);
        minY = Math.min(minY, currentY);
        maxY = Math.max(maxY, currentY);

        if (currentX + 1 < width) {
          const right = currentIndex + 1;
          if (!visited[right] && data[right] !== 0) {
            visited[right] = 1;
            queue[tail] = right;
            tail += 1;
          }
        }

        if (currentX - 1 >= 0) {
          const left = currentIndex - 1;
          if (!visited[left] && data[left] !== 0) {
            visited[left] = 1;
            queue[tail] = left;
            tail += 1;
          }
        }

        if (currentY + 1 < height) {
          const down = currentIndex + width;
          if (!visited[down] && data[down] !== 0) {
            visited[down] = 1;
            queue[tail] = down;
            tail += 1;
          }
        }

        if (currentY - 1 >= 0) {
          const up = currentIndex - width;
          if (!visited[up] && data[up] !== 0) {
            visited[up] = 1;
            queue[tail] = up;
            tail += 1;
          }
        }
      }

      const boxWidth = maxX - minX + 1;
      const boxHeight = maxY - minY + 1;
      const ratio = boxWidth / Math.max(1, boxHeight);

      if (
        area < 350 ||
        area > 1300 ||
        boxWidth < 45 ||
        boxHeight < 45 ||
        boxWidth > 95 ||
        boxHeight > 95 ||
        ratio < 0.8 ||
        ratio > 1.2
      ) {
        continue;
      }

      candidates.push({
        x: minX + boxWidth / 2,
        y: minY + boxHeight / 2,
        area,
        width: boxWidth,
        height: boxHeight,
      });
    }
  }

  const groupedRows = groupSpatialRows(
    candidates.map((candidate, index) => ({
      numero: index + 1,
      chairCount: 8,
      x: candidate.x,
      y: candidate.y,
    })),
    28,
  )
    .filter((row) => row.length >= 3)
    .map((row) => mergeNearbyRowEntries(row, 32));

  const columnCount = inferGridColumnCount(groupedRows);
  const columnCenters = inferGlobalColumnCenters(groupedRows, columnCount);
  const normalizedRows = normalizeRowsToColumnGrid(groupedRows, columnCenters);
  const flattened = normalizedRows.flat();
  const scaleX = originalWidth / Math.max(1, width);
  const scaleY = originalHeight / Math.max(1, height);
  const nearestDistance = estimateNearestNeighborDistance(
    flattened.map((entry) => ({
      ...entry,
      x: entry.x ? entry.x * scaleX : entry.x,
      y: entry.y ? entry.y * scaleY : entry.y,
    })),
  );

  logPlanImport(debugContext, "image.geometry.completed", {
    rawCandidates: candidates.length,
    rowLengths: normalizedRows.map((row) => row.length),
    inferredColumns: columnCount,
    finalTables: flattened.length,
  });

  return {
    tables: flattened.map((entry, index) => ({
      numero: index + 1,
      chairCount: 8,
      x: typeof entry.x === "number" ? Math.round(entry.x * scaleX) : undefined,
      y: typeof entry.y === "number" ? Math.round(entry.y * scaleY) : undefined,
    })),
    sourceBounds: {
      width: originalWidth,
      height: originalHeight,
      preferRegularized: true,
    },
    nearestDistance,
  } satisfies DetectedImageLayout;
}

async function readSingleMesaLabelFromCrop(
  worker: OcrWorkerLike,
  croppedBuffer: Buffer,
) {
  const variants = await createOcrVariants(croppedBuffer, { mode: "crop" });
  let bestPair: MesaSillaPair | null = null;
  let bestScore = Number.NEGATIVE_INFINITY;

  for (const variant of variants.slice(0, 2)) {
    const result = await runOcrVariantBuffer(worker, variant);
    const candidate = result.pairs[0] ?? result.textFallback[0] ?? null;
    if (!candidate) {
      continue;
    }

    if (
      !Number.isInteger(candidate.numero) ||
      candidate.numero <= 0 ||
      !Number.isInteger(candidate.chairCount) ||
      candidate.chairCount < 2 ||
      candidate.chairCount > 16
    ) {
      continue;
    }

    if (result.score > bestScore) {
      bestScore = result.score;
      bestPair = candidate;
    }
  }

  return bestPair;
}

async function readChairCountFromCrop(
  worker: OcrWorkerLike,
  croppedBuffer: Buffer,
) {
  const image = await Jimp.read(croppedBuffer);
  const lowerRegionY = Math.max(0, Math.floor(image.bitmap.height * 0.42));
  const lowerRegionHeight = Math.max(24, image.bitmap.height - lowerRegionY);
  const lowerRegion = image.clone().crop({
    x: 0,
    y: lowerRegionY,
    w: image.bitmap.width,
    h: lowerRegionHeight,
  });

  const variants = [
    lowerRegion.clone().greyscale().contrast(0.95).normalize().scale(4),
    lowerRegion.clone().greyscale().contrast(1).normalize().scale(5).threshold({ max: 178 }),
    lowerRegion.clone().greyscale().contrast(1).normalize().scale(6).threshold({ max: 165 }),
  ];

  let bestCount: number | null = null;
  let bestScore = Number.NEGATIVE_INFINITY;

  for (const variant of variants) {
    const variantBuffer = Buffer.from(await variant.getBuffer("image/png"));
    const result = await worker.recognize(
      variantBuffer,
      {},
      { hocr: true, text: true },
    );
    const rawText = normalizeText(String(result.data.text ?? ""))
      .toUpperCase()
      .replace(/\s+/g, "")
      .replace(/[;,_]/g, ":");
    const chairToken =
      rawText.match(/S[:=-]?(\d{1,2})/)?.[1] ??
      rawText.match(/(?:^|[^0-9])(\d{1,2})(?:[^0-9]|$)/)?.[1] ??
      "";
    const chairCount = Number(chairToken);

    if (!Number.isInteger(chairCount) || chairCount < 2 || chairCount > 16) {
      continue;
    }

    const score =
      ((rawText.includes("S:") || rawText.includes("S")) ? 100 : 0) +
      (chairCount >= 4 && chairCount <= 12 ? 30 : 0) +
      variant.bitmap.width * 0.001;

    if (score > bestScore) {
      bestScore = score;
      bestCount = chairCount;
    }
  }

  return bestCount;
}

async function readLabelsFromDetectedImageLayout(
  buffer: Buffer,
  layout: DetectedImageLayout,
  debugContext?: PlanImportDebugContext,
  signal?: AbortSignal,
) {
  assertImportNotCancelled(debugContext);
  throwIfAborted(signal);
  logPlanImport(debugContext, "image.geometry_ocr.bootstrap");
  const tesseractModule = await import("tesseract.js");
  const tesseract = tesseractModule.default ?? tesseractModule;
  const worker = await tesseract.createWorker("eng", 1, {
    workerPath: path.resolve(
      process.cwd(),
      "node_modules",
      "tesseract.js",
      "src",
      "worker-script",
      "node",
      "index.js",
    ),
    logger: () => {},
    cacheMethod: "none",
  });
  const detachAbortHandler = attachWorkerAbortHandler(signal, worker);

  try {
    throwIfAborted(signal);
    await worker.setParameters({
      tessedit_pageseg_mode: tesseract.PSM.SINGLE_BLOCK,
      preserve_interword_spaces: "1",
      user_defined_dpi: "300",
      tessedit_char_whitelist: "MS:0123456789",
    });

    const orderedTables = sortEntriesBySpatialOrder(layout.tables);
    const halfWidth = clamp(Math.round(layout.nearestDistance * 0.4), 65, 125);
    const halfHeight = clamp(Math.round(layout.nearestDistance * 0.34), 55, 110);
    const recognized: MesaSillaPair[] = [];
    const usedNumbers = new Set<number>();

    logPlanImport(debugContext, "image.geometry_ocr.started", {
      total: orderedTables.length,
      nearestDistance: layout.nearestDistance,
      halfWidth,
      halfHeight,
    });

    for (const [index, table] of orderedTables.entries()) {
      assertImportNotCancelled(debugContext);
      throwIfAborted(signal);
      if (typeof table.x !== "number" || typeof table.y !== "number") {
        continue;
      }

      const cropRegion = clampCropRegion(
        {
          x: table.x - halfWidth,
          y: table.y - halfHeight,
          width: halfWidth * 2,
          height: halfHeight * 2,
        },
        layout.sourceBounds.width,
        layout.sourceBounds.height,
      );

      const croppedBuffer = await cropBufferToRegion(buffer, cropRegion);
      const candidate = await readSingleMesaLabelFromCrop(worker, croppedBuffer);

      if (!candidate || usedNumbers.has(candidate.numero)) {
        continue;
      }

      recognized.push({
        numero: candidate.numero,
        chairCount: candidate.chairCount,
        x: table.x,
        y: table.y,
      });
      usedNumbers.add(candidate.numero);

      if ((index + 1) % 6 === 0 || index === orderedTables.length - 1) {
        logPlanImport(debugContext, "image.geometry_ocr.progress", {
          processed: index + 1,
          total: orderedTables.length,
          recognized: recognized.length,
        });
      }
    }

    logPlanImport(debugContext, "image.geometry_ocr.completed", {
      recognized: recognized.length,
      total: orderedTables.length,
      nearestDistance: layout.nearestDistance,
    });

    return recognized;
  } finally {
    detachAbortHandler();
    await worker.terminate().catch(() => {});
  }
}

async function recoverChairCountsFromGeometryLayout(
  buffer: Buffer,
  layout: DetectedImageLayout,
  orderedEntries: MesaSillaPair[],
  hints?: PlanImportHints,
  debugContext?: PlanImportDebugContext,
) {
  assertImportNotCancelled(debugContext);
  const orderedGeometry = sortEntriesBySpatialOrder(layout.tables).filter(
    (entry): entry is MesaSillaPair & { x: number; y: number } =>
      typeof entry.x === "number" && typeof entry.y === "number",
  );
  const limit = Math.min(orderedEntries.length, orderedGeometry.length);
  const nearestDistance = Math.max(90, layout.nearestDistance || 110);
  const halfWidth = clamp(Math.round(nearestDistance * 0.34), 58, 96);
  const halfHeight = clamp(Math.round(nearestDistance * 0.28), 50, 82);

  logPlanImport(debugContext, "image.chair_ocr.started", {
    total: limit,
    expectedChairTotal: hints?.expectedChairTotal ?? null,
    halfWidth,
    halfHeight,
    engine: "paddleocr",
  });

  const validatedPriors = await getValidatedPlanPriors({
    expectedTableCount: hints?.expectedTableCount,
    expectedChairTotal: hints?.expectedChairTotal,
    expectedRowCount: hints?.expectedRowCount,
    expectedColumnCount: hints?.expectedColumnCount,
    eventName: hints?.eventName,
  });
  const validatedMesaNumberPriors = await getValidatedMesaNumberPriors({
    expectedTableCount: hints?.expectedTableCount,
    expectedChairTotal: hints?.expectedChairTotal,
    expectedRowCount: hints?.expectedRowCount,
    expectedColumnCount: hints?.expectedColumnCount,
    eventName: hints?.eventName,
  });
  const resolutionCandidates = buildInitialResolutionCandidates(
    orderedEntries.slice(0, limit),
    "current_selected",
  );
  for (const candidate of resolutionCandidates) {
    const prior = findValidatedPriorForPosition(validatedPriors, candidate.positionIndex);
    if (typeof prior?.mostCommonChairCount === "number") {
      candidate.candidates.push({
        chairCount: prior.mostCommonChairCount,
        source: "validated_prior",
        confidence: 0.35,
        evidence: `validated-position-${candidate.positionIndex}`,
      });
    }

    const mesaNumberPrior =
      validatedMesaNumberPriors?.priorsByMesaNumber.find((entry) => entry.numero === candidate.numero)
        ?.mostCommonChairCount ?? null;
    if (typeof mesaNumberPrior === "number") {
      candidate.candidates.push({
        chairCount: mesaNumberPrior,
        source: "validated_mesa_prior",
        confidence: 0.48,
        evidence: `validated-mesa-${candidate.numero}`,
      });
    }
  }

  if (validatedPriors) {
    logPlanImport(debugContext, "image.chair_ocr.validated_priors", {
      matchingExampleCount: validatedPriors.matchingExampleCount,
      priorPositionCount: validatedPriors.priorsByPosition.length,
      mesaNumberPriorCount: validatedMesaNumberPriors?.priorsByMesaNumber.length ?? 0,
    });
  }

  const cropRegions = orderedGeometry.slice(0, limit).map((geometryEntry, index) => ({
    index,
    ...clampCropRegion(
      {
        x: geometryEntry.x - halfWidth,
        y: geometryEntry.y - halfHeight,
        width: halfWidth * 2,
        height: halfHeight * 2,
      },
      layout.sourceBounds.width,
      layout.sourceBounds.height,
    ),
  }));

  const paddleResults = await runPaddlePlanCropOcr(buffer, cropRegions, debugContext);
  const resultsByIndex = new Map<number, PaddleOcrCropResult>();
  for (const result of paddleResults) {
    if (typeof result.index === "number") {
      resultsByIndex.set(result.index, result);
    }
  }

  for (let index = 0; index < limit; index += 1) {
    assertImportNotCancelled(debugContext);
    const entry = orderedEntries[index];
    const resolutionCandidate = resolutionCandidates[index];
    const result = resultsByIndex.get(index);
    const numeroCandidates = Array.isArray(result?.numeroCandidates)
      ? result!.numeroCandidates.filter((value) => Number.isInteger(value) && value > 0)
      : [];
    const sameMesaLikely =
      !result?.numero ||
      result.numero === entry.numero ||
      numeroCandidates.includes(entry.numero);
    const firstPassChairCount =
      sameMesaLikely &&
      typeof result?.chairCount === "number" &&
      Number.isInteger(result.chairCount) &&
      result.chairCount >= 1 &&
      result.chairCount <= 24
        ? result.chairCount
        : entry.chairCount;

    if (sameMesaLikely) {
      addChairCountCandidate(
        resolutionCandidate,
        result?.chairCount,
        "paddle_full",
        0.82,
        `first-pass-index-${index}`,
      );
      for (const chairCandidate of result?.chairCandidates ?? []) {
        addChairCountCandidate(
          resolutionCandidate,
          chairCandidate,
          "ocr_fallback",
          0.5,
          `first-pass-fallback-index-${index}`,
        );
      }
    }
    if (resolutionCandidate) {
      resolutionCandidate.selectedChairCount = firstPassChairCount;
    }

    if ((index + 1) % 6 === 0 || index === limit - 1) {
      logPlanImport(debugContext, "image.chair_ocr.progress", {
        processed: index + 1,
        total: limit,
      });
    }
  }

  const firstPassResolutionCandidates = annotateSuspicionScores(
    reselectResolutionCandidates(resolutionCandidates, validatedPriors, validatedMesaNumberPriors),
    validatedPriors,
    hints?.expectedChairTotal,
  );
  logPlanImport(debugContext, "image.chair_ocr.suspicious_tables", {
    total: firstPassResolutionCandidates.filter((candidate) => candidate.suspicionScore > 0).length,
    indices: firstPassResolutionCandidates
      .filter((candidate) => candidate.suspicionScore > 0)
      .map((candidate) => candidate.positionIndex),
    stage: "first_pass",
  });

  let resolvedResolutionCandidates = firstPassResolutionCandidates;
  const suspiciousCropRegions = buildSuspiciousChairCropRegions(
    layout,
    firstPassResolutionCandidates,
    halfWidth,
    halfHeight,
  );

  let rereadCompleted = false;
  if (suspiciousCropRegions.length > 0) {
    const rereadRegionsByIndex = new Map<number, SuspiciousChairCropRegion>();
    for (const region of suspiciousCropRegions) {
      rereadRegionsByIndex.set(region.index, region);
    }

    logPlanImport(debugContext, "image.chair_ocr.reread.started", {
      tableCount: new Set(suspiciousCropRegions.map((region) => region.tableIndex)).size,
      cropCount: suspiciousCropRegions.length,
    });

    try {
      const rereadResults = await runPaddlePlanCropOcr(
        buffer,
        suspiciousCropRegions.map(({ source: _source, evidence: _evidence, ...region }) => region),
        debugContext,
      );

      for (const rereadResult of rereadResults) {
        const rereadRegion =
          typeof rereadResult.index === "number"
            ? rereadRegionsByIndex.get(rereadResult.index)
            : undefined;
        if (!rereadRegion) {
          continue;
        }

        const entry = orderedEntries[rereadRegion.tableIndex];
        const resolutionCandidate = resolvedResolutionCandidates[rereadRegion.tableIndex];
        if (!entry || !resolutionCandidate) {
          continue;
        }

        const numeroCandidates = Array.isArray(rereadResult?.numeroCandidates)
          ? rereadResult.numeroCandidates.filter((value) => Number.isInteger(value) && value > 0)
          : [];
        const sameMesaLikely =
          !rereadResult?.numero ||
          rereadResult.numero === entry.numero ||
          numeroCandidates.includes(entry.numero);
        if (!sameMesaLikely) {
          continue;
        }

        addChairCountCandidate(
          resolutionCandidate,
          rereadResult?.chairCount,
          rereadRegion.source,
          getSuspiciousRereadConfidence(rereadRegion.source),
          rereadRegion.evidence,
        );

        for (const [candidateIndex, chairCandidate] of (rereadResult?.chairCandidates ?? []).entries()) {
          addChairCountCandidate(
            resolutionCandidate,
            chairCandidate,
            rereadRegion.source,
            Math.max(0.38, getSuspiciousRereadConfidence(rereadRegion.source) - candidateIndex * 0.08),
            `${rereadRegion.evidence}-candidate-${candidateIndex + 1}`,
          );
        }
      }

      resolvedResolutionCandidates = annotateSuspicionScores(
        reselectResolutionCandidates(
          resolvedResolutionCandidates,
          validatedPriors,
          validatedMesaNumberPriors,
        ),
        validatedPriors,
        hints?.expectedChairTotal,
      );
      rereadCompleted = true;

      logPlanImport(debugContext, "image.chair_ocr.reread.completed", {
        tableCount: new Set(suspiciousCropRegions.map((region) => region.tableIndex)).size,
        cropCount: suspiciousCropRegions.length,
      });
    } catch (error) {
      if (isAbortLikeError(error)) {
        throw error;
      }

      logPlanImport(debugContext, "image.chair_ocr.reread.failed", serializeImportError(error));
    }
  }

  const suspiciousResolutionCandidates = resolvedResolutionCandidates.filter(
    (candidate) => candidate.suspicionScore > 0,
  );
  logPlanImport(debugContext, "image.chair_ocr.suspicious_tables", {
    total: suspiciousResolutionCandidates.length,
    indices: suspiciousResolutionCandidates.map((candidate) => candidate.positionIndex),
    stage: rereadCompleted ? "after_reread" : "first_pass",
  });

  const resolvedEntries = resolutionCandidatesToEntries(resolvedResolutionCandidates);
  const chairCandidatesByIndex = resolvedEntries.map((entry, index) =>
    buildNormalizationChairCandidates(entry, resolvedResolutionCandidates[index]),
  );
  const normalizedResolvedEntries = chooseChairCountsClosestToTarget(
    resolvedEntries,
    chairCandidatesByIndex,
    hints?.expectedChairTotal,
  );
  const swapResolution = maybeSwapNeighborCounts(
    applyChairCountsToResolutionCandidates(
      resolvedResolutionCandidates,
      normalizedResolvedEntries,
    ),
    validatedPriors,
    validatedMesaNumberPriors,
    hints?.expectedChairTotal,
  );
  const finalResolutionCandidates = annotateSuspicionScores(
    swapResolution.candidates,
    validatedPriors,
    hints?.expectedChairTotal,
  );
  const finalEntries = resolutionCandidatesToEntries(finalResolutionCandidates);

  logPlanImport(debugContext, "image.chair_ocr.final_resolution", {
    suspiciousRemaining: finalResolutionCandidates.filter((candidate) => candidate.suspicionScore > 0).length,
    chairTotal: getChairTotal(finalEntries),
    swapCount: swapResolution.appliedSwaps.length,
    swaps: swapResolution.appliedSwaps.map((swap) => ({
      leftIndex: swap.leftIndex,
      rightIndex: swap.rightIndex,
      leftChairCount: swap.leftChairCount,
      rightChairCount: swap.rightChairCount,
    })),
  });

  logPlanImport(debugContext, "image.chair_ocr.completed", {
    total: finalEntries.length,
    chairTotal: getChairTotal(finalEntries),
    suspiciousRemaining: finalResolutionCandidates.filter((candidate) => candidate.suspicionScore > 0).length,
  });

  return finalEntries;
}

async function recoverMesaSillaLabelsFromAiLayout(
  buffer: Buffer,
  aiEntries: MesaSillaPair[],
  aiSourceBounds: ImportSourceBounds | null | undefined,
  debugContext?: PlanImportDebugContext,
) {
  if (!aiSourceBounds || aiEntries.length === 0) {
    return aiEntries;
  }
  assertImportNotCancelled(debugContext);

  const tesseractModule = await import("tesseract.js");
  const tesseract = tesseractModule.default ?? tesseractModule;
  const worker = await tesseract.createWorker("eng", 1, {
    workerPath: path.resolve(
      process.cwd(),
      "node_modules",
      "tesseract.js",
      "src",
      "worker-script",
      "node",
      "index.js",
    ),
    logger: () => {},
    cacheMethod: "none",
  });

  try {
    await worker.setParameters({
      tessedit_pageseg_mode: tesseract.PSM.SINGLE_BLOCK,
      preserve_interword_spaces: "1",
      user_defined_dpi: "300",
      tessedit_char_whitelist: "MS:0123456789",
    });

    const originalImage = await Jimp.read(buffer);
    const originalWidth = originalImage.bitmap.width;
    const originalHeight = originalImage.bitmap.height;
    const nearestDistance = estimateNearestNeighborDistance(aiEntries);
    const scaleX = originalWidth / Math.max(1, aiSourceBounds.width);
    const scaleY = originalHeight / Math.max(1, aiSourceBounds.height);
    const averageScale = (scaleX + scaleY) / 2;
    const baseHalfWidth = clamp(
      Math.round((nearestDistance > 0 ? nearestDistance * 0.34 : aiSourceBounds.width / 18) * averageScale),
      54,
      112,
    );
    const baseHalfHeight = clamp(
      Math.round((nearestDistance > 0 ? nearestDistance * 0.28 : aiSourceBounds.height / 22) * averageScale),
      42,
      96,
    );

    logPlanImport(debugContext, "image.local_ocr.started", {
      aiEntries: aiEntries.length,
      nearestDistance,
      baseHalfWidth,
      baseHalfHeight,
    });

    const recoveredEntries: MesaSillaPair[] = [];
    const recoveredMesaNumbers = new Set<number>();
    const fallbackMesaNumbers = new Set(aiEntries.map((entry) => entry.numero));

    for (const entry of aiEntries) {
      assertImportNotCancelled(debugContext);
      if (typeof entry.x !== "number" || typeof entry.y !== "number") {
        recoveredEntries.push(entry);
        continue;
      }

      const centerX = Math.round(entry.x * scaleX);
      const centerY = Math.round(entry.y * scaleY);
      const attempts = [
        { halfWidth: baseHalfWidth, halfHeight: baseHalfHeight },
        { halfWidth: Math.round(baseHalfWidth * 1.15), halfHeight: Math.round(baseHalfHeight * 1.15) },
      ];

      let recovered: MesaSillaPair | null = null;

      for (const attempt of attempts) {
        const cropRegion = clampCropRegion(
          {
            x: centerX - attempt.halfWidth,
            y: centerY - attempt.halfHeight,
            width: attempt.halfWidth * 2,
            height: attempt.halfHeight * 2,
          },
          originalWidth,
          originalHeight,
        );

        const croppedBuffer = await cropBufferToRegion(buffer, cropRegion);
        const variants = await createOcrVariants(croppedBuffer, { mode: "crop" });
        let bestPair: MesaSillaPair | null = null;
        let bestPairScore = Number.NEGATIVE_INFINITY;

        for (const variant of variants.slice(0, 2)) {
          const result = await runOcrVariantBuffer(worker, variant);
          const candidate = result.pairs[0] ?? result.textFallback[0] ?? null;

          if (!candidate) {
            continue;
          }

          const score =
            (result.pairs[0] ? 200 : 0) +
            result.score +
            (candidate.chairCount === entry.chairCount ? 20 : 0);

          if (score > bestPairScore) {
            bestPairScore = score;
            bestPair = candidate;
          }
        }

        const validChairCount =
          bestPair &&
          Number.isInteger(bestPair.chairCount) &&
          bestPair.chairCount >= 2 &&
          bestPair.chairCount <= 16
            ? bestPair.chairCount
            : null;
        const canReplaceNumero =
          bestPair &&
          Number.isInteger(bestPair.numero) &&
          bestPair.numero > 0 &&
          (
            bestPair.numero === entry.numero ||
            (!fallbackMesaNumbers.has(bestPair.numero) && !recoveredMesaNumbers.has(bestPair.numero))
          );

        if (bestPair && (validChairCount || canReplaceNumero)) {
          recovered = {
            numero: canReplaceNumero ? bestPair.numero : entry.numero,
            chairCount: validChairCount ?? entry.chairCount,
            x: entry.x,
            y: entry.y,
          };
          recoveredMesaNumbers.add(recovered.numero);
          break;
        }
      }

      recoveredEntries.push(
        recovered ?? {
          ...entry,
        },
      );
    }

    const recoveredCount = recoveredEntries.filter((entry) => recoveredMesaNumbers.has(entry.numero)).length;
    logPlanImport(debugContext, "image.local_ocr.completed", {
      recoveredCount,
      total: recoveredEntries.length,
    });

    return recoveredEntries;
  } finally {
    await worker.terminate();
  }
}

function computeTableRegionFromTokens(
  tokens: OcrToken[],
  imageWidth: number,
  imageHeight: number,
) {
  const mesaTokens = tokens.filter((token) => token.kind === "mesa" && token.confidence >= 15);

  if (mesaTokens.length < 4) {
    return null;
  }

  const centers = mesaTokens.map((token) => ({
    token,
    centerX: token.x + token.width / 2,
    centerY: token.y + token.height / 2,
  }));
  const nearestNeighborDistances = centers.map((center, index) => {
    let bestDistance = Number.POSITIVE_INFINITY;

    for (let candidateIndex = 0; candidateIndex < centers.length; candidateIndex += 1) {
      if (candidateIndex === index) {
        continue;
      }

      const candidate = centers[candidateIndex];
      const distance = Math.hypot(
        candidate.centerX - center.centerX,
        candidate.centerY - center.centerY,
      );
      bestDistance = Math.min(bestDistance, distance);
    }

    return Number.isFinite(bestDistance) ? bestDistance : 0;
  });

  const medianNearestNeighbor = median(nearestNeighborDistances.filter((distance) => distance > 0));
  const averageWidth =
    mesaTokens.reduce((sum, token) => sum + token.width, 0) / Math.max(1, mesaTokens.length);
  const averageHeight =
    mesaTokens.reduce((sum, token) => sum + token.height, 0) / Math.max(1, mesaTokens.length);
  const linkThresholdX = Math.max(averageWidth * 7, medianNearestNeighbor * 2.4, imageWidth * 0.05);
  const linkThresholdY = Math.max(averageHeight * 7, medianNearestNeighbor * 1.9, imageHeight * 0.05);
  const visited = new Set<number>();
  const components: number[][] = [];

  for (let index = 0; index < centers.length; index += 1) {
    if (visited.has(index)) {
      continue;
    }

    const queue = [index];
    const component: number[] = [];
    visited.add(index);

    while (queue.length > 0) {
      const currentIndex = queue.shift()!;
      component.push(currentIndex);
      const current = centers[currentIndex];

      for (let candidateIndex = 0; candidateIndex < centers.length; candidateIndex += 1) {
        if (visited.has(candidateIndex)) {
          continue;
        }

        const candidate = centers[candidateIndex];
        if (
          Math.abs(candidate.centerX - current.centerX) <= linkThresholdX &&
          Math.abs(candidate.centerY - current.centerY) <= linkThresholdY
        ) {
          visited.add(candidateIndex);
          queue.push(candidateIndex);
        }
      }
    }

    components.push(component);
  }

  const bestComponent = components
    .map((component) => ({
      component,
      size: component.length,
      confidence: component.reduce((sum, componentIndex) => sum + centers[componentIndex].token.confidence, 0),
    }))
    .sort((a, b) => (b.size === a.size ? b.confidence - a.confidence : b.size - a.size))[0];

  if (!bestComponent || bestComponent.size < 4) {
    return null;
  }

  const selectedMesaTokens = bestComponent.component.map((componentIndex) => centers[componentIndex].token);
  const mesaBounds = {
    minX: Math.min(...selectedMesaTokens.map((token) => token.x)),
    minY: Math.min(...selectedMesaTokens.map((token) => token.y)),
    maxX: Math.max(...selectedMesaTokens.map((token) => token.x + token.width)),
    maxY: Math.max(...selectedMesaTokens.map((token) => token.y + token.height)),
  };
  const nearbyChairTokens = tokens.filter((token) => {
    if (token.kind !== "silla") {
      return false;
    }

    const centerX = token.x + token.width / 2;
    const centerY = token.y + token.height / 2;

    return (
      centerX >= mesaBounds.minX - linkThresholdX * 0.8 &&
      centerX <= mesaBounds.maxX + linkThresholdX * 0.8 &&
      centerY >= mesaBounds.minY - linkThresholdY &&
      centerY <= mesaBounds.maxY + linkThresholdY
    );
  });
  const allRelevantTokens = [...selectedMesaTokens, ...nearbyChairTokens];
  const tokenBounds = {
    minX: Math.min(...allRelevantTokens.map((token) => token.x)),
    minY: Math.min(...allRelevantTokens.map((token) => token.y)),
    maxX: Math.max(...allRelevantTokens.map((token) => token.x + token.width)),
    maxY: Math.max(...allRelevantTokens.map((token) => token.y + token.height)),
  };
  const paddingX = Math.max(averageWidth * 4.5, imageWidth * 0.03);
  const paddingY = Math.max(averageHeight * 5, imageHeight * 0.035);
  const x = clamp(Math.floor(tokenBounds.minX - paddingX), 0, imageWidth - 1);
  const y = clamp(Math.floor(tokenBounds.minY - paddingY), 0, imageHeight - 1);
  const maxX = clamp(Math.ceil(tokenBounds.maxX + paddingX), x + 1, imageWidth);
  const maxY = clamp(Math.ceil(tokenBounds.maxY + paddingY), y + 1, imageHeight);

  return {
    x,
    y,
    width: maxX - x,
    height: maxY - y,
  } satisfies CropRegion;
}

async function cropBufferToRegion(buffer: Buffer, region: CropRegion) {
  const image = await Jimp.read(buffer);
  const cropped = image.clone().crop({
    x: region.x,
    y: region.y,
    w: region.width,
    h: region.height,
  });

  return Buffer.from(await cropped.getBuffer("image/png"));
}

async function buildGeometryContactSheet(
  buffer: Buffer,
  layout: DetectedImageLayout,
  mode: "original" | "threshold" = "original",
) {
  const orderedTables = sortEntriesBySpatialOrder(layout.tables).filter(
    (entry): entry is MesaSillaPair & { x: number; y: number } =>
      typeof entry.x === "number" && typeof entry.y === "number",
  );

  if (orderedTables.length === 0) {
    return null;
  }

  const rows = groupEntriesIntoRows(orderedTables);
  const columns = Math.max(...rows.map((row) => row.length), 1);
  const nearestDistance = Math.max(90, layout.nearestDistance || 110);
  const halfWidth = clamp(Math.round(nearestDistance * 0.56), 82, 150);
  const halfHeight = clamp(Math.round(nearestDistance * 0.46), 72, 130);
  const cellWidth = 220;
  const cellHeight = 190;
  const padding = 18;
  const canvasWidth = columns * cellWidth;
  const canvasHeight = rows.length * cellHeight;
  const composites: sharp.OverlayOptions[] = [];
  let index = 0;

  for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
    for (let columnIndex = 0; columnIndex < rows[rowIndex].length; columnIndex += 1) {
      const table = rows[rowIndex][columnIndex];
      const cropRegion = clampCropRegion(
        {
          x: table.x - halfWidth,
          y: table.y - halfHeight,
          width: halfWidth * 2,
          height: halfHeight * 2,
        },
        layout.sourceBounds.width,
        layout.sourceBounds.height,
      );

      let cropPipeline = sharp(buffer)
        .extract({
          left: cropRegion.x,
          top: cropRegion.y,
          width: cropRegion.width,
          height: cropRegion.height,
        })
        .greyscale()
        .normalize();

      if (mode === "threshold") {
        cropPipeline = cropPipeline.modulate({ brightness: 1.05 }).threshold(178);
      }

      const cropped = await cropPipeline
        .resize({
          width: cellWidth - padding * 2,
          height: cellHeight - padding * 2,
          fit: "contain",
          background: { r: 255, g: 255, b: 255, alpha: 1 },
        })
        .png()
        .toBuffer();

      const labelSvg = Buffer.from(`
        <svg width="${cellWidth}" height="${cellHeight}" xmlns="http://www.w3.org/2000/svg">
          <rect x="0" y="0" width="${cellWidth}" height="${cellHeight}" rx="18" ry="18" fill="#ffffff"/>
          <text x="16" y="26" font-family="Arial, sans-serif" font-size="18" font-weight="700" fill="#111827">
            Pos ${index + 1}
          </text>
        </svg>
      `);

      composites.push({
        input: labelSvg,
        left: columnIndex * cellWidth,
        top: rowIndex * cellHeight,
      });
      composites.push({
        input: cropped,
        left: columnIndex * cellWidth + padding,
        top: rowIndex * cellHeight + padding + 10,
      });
      index += 1;
    }
  }

  const bufferOut = await sharp({
    create: {
      width: canvasWidth,
      height: canvasHeight,
      channels: 4,
      background: { r: 248, g: 250, b: 252, alpha: 1 },
    },
  })
    .composite(composites)
    .png()
    .toBuffer();

  return {
    buffer: bufferOut,
    rowCount: rows.length,
    columnCount: columns,
  };
}

async function runOcrVariantBuffer(
  worker: OcrWorkerLike,
  variant: OcrVariant,
) {
  const result = await worker.recognize(
    variant.buffer,
    {},
    { hocr: true, text: true },
  );
  const tokens = parseHocrTokens(String(result.data.hocr ?? ""));
  const pairs = buildMesaSillaPairsFromTokens(tokens);
  const textFallback = parseGenericMesaSillaText(String(result.data.text ?? ""));
  const score =
    pairs.length * 1000 +
    textFallback.length * 120 +
    pairs.reduce((sum, pair) => sum + pair.chairCount, 0) +
    tokens.reduce((sum, token) => sum + token.confidence, 0) * 0.01;

  return {
    label: variant.label,
    buffer: variant.buffer,
    width: variant.width,
    height: variant.height,
    scale: variant.scale,
    tokens,
    pairs,
    textFallback,
    score,
  } satisfies OcrRunResult;
}

function entriesToImportedTables(
  entries: MesaSillaPair[],
  existingTableCount: number,
  sourceBounds?: ImportSourceBounds,
) {
  const shouldRegularize = sourceBounds
    ? Boolean(sourceBounds.preferRegularized) || !hasReliableSpatialLayout(entries)
    : false;
  const regularizedEntries = shouldRegularize
    ? regularizeSpatialEntries(entries)
    : [];
  const regularizedByMesa = new Map(
    regularizedEntries.map((entry) => [entry.numero, entry]),
  );
  const contentBounds = sourceBounds
    ? {
        minX: 0,
        minY: 0,
        maxX: ROOM_LAYOUT_WIDTH,
        maxY: ROOM_LAYOUT_HEIGHT,
      }
    : getContentBounds(entries);

  return entries.map((entry, index) => {
    const regularizedEntry = regularizedByMesa.get(entry.numero);

    if (regularizedEntry) {
      return {
        numero: entry.numero,
        chairCount: entry.chairCount,
        posX: regularizedEntry.x,
        posY: regularizedEntry.y,
      };
    }

    if (
      typeof entry.x === "number" &&
      typeof entry.y === "number" &&
      !sourceBounds
    ) {
      return {
        numero: entry.numero,
        chairCount: entry.chairCount,
        posX: Math.round(entry.x),
        posY: Math.round(entry.y),
      };
    }

    if (
      typeof entry.x === "number" &&
      typeof entry.y === "number" &&
      sourceBounds &&
      sourceBounds.width > 0 &&
      sourceBounds.height > 0
    ) {
      const minX = contentBounds?.minX ?? 0;
      const minY = contentBounds?.minY ?? 0;
      const contentWidth = Math.max(1, (contentBounds?.maxX ?? sourceBounds.width) - minX);
      const contentHeight = Math.max(1, (contentBounds?.maxY ?? sourceBounds.height) - minY);
      const density = clamp(Math.sqrt(entries.length / 18), 0.42, 1);
      const usableWidth = lerp(ROOM_LAYOUT_WIDTH * 0.34, ROOM_LAYOUT_WIDTH - 420, density);
      const usableHeight = lerp(ROOM_LAYOUT_HEIGHT * 0.3, ROOM_LAYOUT_HEIGHT - 340, density);
      const marginX = (ROOM_LAYOUT_WIDTH - usableWidth) / 2;
      const marginY = (ROOM_LAYOUT_HEIGHT - usableHeight) / 2;

      return {
        numero: entry.numero,
        chairCount: entry.chairCount,
        posX: Math.round(marginX + ((entry.x - minX) / contentWidth) * usableWidth),
        posY: Math.round(marginY + ((entry.y - minY) / contentHeight) * usableHeight),
      };
    }

    const position = getNextMesaPosition(existingTableCount + index);
    return {
      numero: entry.numero,
      chairCount: entry.chairCount,
      posX: position.posX,
      posY: position.posY,
    };
  });
}

function parseExplicitMesaSillaLines(text: string) {
  const lines = normalizeText(text)
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  const results: MesaSillaPair[] = [];
  const usedMesaNumbers = new Set<number>();

  for (let index = 0; index < lines.length; index += 1) {
    const currentLine = lines[index];
    const mesaMatch = currentLine.match(/\bM\s*[:=-]\s*(\d{1,4})\b/i);
    const sillaSameLineMatch = currentLine.match(/\bS\s*[:=-]\s*(\d{1,3})\b/i);

    if (!mesaMatch) {
      continue;
    }

    const numero = Number(mesaMatch[1]);
    let chairCount = sillaSameLineMatch ? Number(sillaSameLineMatch[1]) : 0;

    if (!chairCount) {
      for (let lookahead = 1; lookahead <= 3; lookahead += 1) {
        const nextLine = lines[index + lookahead];
        if (!nextLine) {
          break;
        }

        const sillaMatch = nextLine.match(/\bS\s*[:=-]\s*(\d{1,3})\b/i);
        if (sillaMatch) {
          chairCount = Number(sillaMatch[1]);
          break;
        }
      }
    }

    if (!chairCount || usedMesaNumbers.has(numero)) {
      continue;
    }

    usedMesaNumbers.add(numero);
    results.push({ numero, chairCount });
  }

  return results;
}

function parseGenericMesaSillaText(text: string) {
  const normalized = normalizeText(text);
  const explicit = parseExplicitMesaSillaLines(normalized);

  if (explicit.length > 0) {
    return explicit;
  }

  const lines = normalized
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  const entries: MesaSillaPair[] = [];
  const usedMesaNumbers = new Set<number>();

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const mesaMatch = line.match(/mesa\s*(\d+)/i);

    if (!mesaMatch) {
      continue;
    }

    const numero = Number(mesaMatch[1]);
    let chairCount =
      Number(
        line.match(/(\d+)\s*(?:sillas?|personas?|pax|plazas?)/i)?.[1] ?? "",
      ) || 0;

    if (!chairCount) {
      for (let lookahead = 1; lookahead <= 3; lookahead += 1) {
        const nextLine = lines[index + lookahead];
        if (!nextLine) {
          break;
        }

        const directCount = Number(
          nextLine.match(/(\d+)\s*(?:sillas?|personas?|pax|plazas?)/i)?.[1] ?? "",
        );
        const explicitS = Number(nextLine.match(/\bS\s*[:=-]\s*(\d{1,3})\b/i)?.[1] ?? "");
        const rawCount = Number(nextLine.match(/^(\d{1,2})$/)?.[1] ?? "");

        if (directCount) {
          chairCount = directCount;
          break;
        }

        if (explicitS) {
          chairCount = explicitS;
          break;
        }

        if (rawCount) {
          chairCount = rawCount;
          break;
        }
      }
    }

    if (!chairCount || usedMesaNumbers.has(numero)) {
      continue;
    }

    usedMesaNumbers.add(numero);
    entries.push({ numero, chairCount });
  }

  return entries;
}

function parseJsonEntries(text: string) {
  const raw = JSON.parse(text) as unknown;
  const list = Array.isArray(raw)
    ? raw
    : typeof raw === "object" && raw && Array.isArray((raw as { mesas?: unknown[] }).mesas)
      ? (raw as { mesas: unknown[] }).mesas
      : [];

  return list
    .map((item) => {
      const value = item as {
        numero?: number | string;
        chairCount?: number | string;
        sillas?: number | string;
        posX?: number | string;
        posY?: number | string;
        x?: number | string;
        y?: number | string;
      };

      return {
        numero: Number(value.numero),
        chairCount: Number(value.chairCount ?? value.sillas),
        x: Number(value.posX ?? value.x),
        y: Number(value.posY ?? value.y),
      };
    })
    .filter(
      (item) =>
        Number.isInteger(item.numero) &&
        item.numero > 0 &&
        Number.isInteger(item.chairCount) &&
        item.chairCount > 0,
    );
}

function parseSpreadsheetEntries(rows: Record<string, unknown>[]) {
  const results: MesaSillaPair[] = [];

  for (const row of rows) {
    const normalizedRow = Object.fromEntries(
      Object.entries(row).map(([key, value]) => [key.toLowerCase().trim(), value]),
    );

    const numero = Number(
      normalizedRow.numero ??
        normalizedRow.m ??
        normalizedRow.mesa ??
        normalizedRow["mesa numero"],
    );
    const chairCount = Number(
      normalizedRow.chaircount ??
        normalizedRow.s ??
        normalizedRow.sillas ??
        normalizedRow.personas ??
        normalizedRow.plazas,
    );

    if (!Number.isInteger(numero) || numero <= 0) {
      continue;
    }

    if (!Number.isInteger(chairCount) || chairCount <= 0) {
      continue;
    }

    results.push({
      numero,
      chairCount,
      x: Number(normalizedRow.posx ?? normalizedRow.x),
      y: Number(normalizedRow.posy ?? normalizedRow.y),
    });
  }

  return results;
}

function sanitizeAiImportedTables(payload: AiImportedPlanPayload | null) {
  if (!payload || !Array.isArray(payload.tables)) {
    return null;
  }

  const seen = new Set<number>();
  const tables = payload.tables
    .map((table) => ({
      numero: Number(table.numero),
      chairCount: Number(table.chairCount),
      x: Number(table.x),
      y: Number(table.y),
      confidence: typeof table.confidence === "number" ? table.confidence : undefined,
    }))
    .filter(
      (table) =>
        Number.isInteger(table.numero) &&
        table.numero > 0 &&
        Number.isInteger(table.chairCount) &&
        table.chairCount > 0 &&
        Number.isFinite(table.x) &&
        Number.isFinite(table.y),
    )
    .filter((table) => {
      if (seen.has(table.numero)) {
        return false;
      }
      seen.add(table.numero);
      return true;
    });

  if (tables.length === 0) {
    return null;
  }

  return {
    width:
      typeof payload.width === "number" && Number.isFinite(payload.width)
        ? payload.width
        : undefined,
    height:
      typeof payload.height === "number" && Number.isFinite(payload.height)
        ? payload.height
        : undefined,
    tables,
  };
}

function extractResponseOutputText(responseJson: Record<string, unknown>) {
  const directOutput = responseJson.output_text;
  if (typeof directOutput === "string" && directOutput.trim()) {
    return directOutput.trim();
  }

  const output = Array.isArray(responseJson.output) ? responseJson.output : [];

  for (const item of output) {
    const message = item as { content?: unknown[] };
    const content = Array.isArray(message.content) ? message.content : [];

    for (const part of content) {
      const block = part as { type?: string; text?: string };
      if (block.type === "output_text" && typeof block.text === "string" && block.text.trim()) {
        return block.text.trim();
      }
    }
  }

  return "";
}

async function bufferToPngDataUrl(buffer: Buffer, fallbackMimeType = "image/png") {
  try {
    const image = await Jimp.read(buffer);
    const maxDimension = 1800;
    if (image.bitmap.width > maxDimension || image.bitmap.height > maxDimension) {
      image.scaleToFit({ w: maxDimension, h: maxDimension });
    }
    const pngBuffer = Buffer.from(await image.getBuffer("image/png"));
    return {
      dataUrl: `data:image/png;base64,${pngBuffer.toString("base64")}`,
      width: image.bitmap.width,
      height: image.bitmap.height,
    };
  } catch {
    return {
      dataUrl: `data:${fallbackMimeType};base64,${buffer.toString("base64")}`,
      width: undefined,
      height: undefined,
    };
  }
}

async function callOpenAIPlanImporter({
  inputItems,
  sourceLabel,
  debugContext,
}: {
  inputItems: Array<Record<string, unknown>>;
  sourceLabel: string;
  debugContext?: PlanImportDebugContext;
}) {
  const apiKey = getOpenAIApiKey();

  if (!apiKey) {
    logPlanImport(debugContext, "openai.skipped", { sourceLabel, reason: "missing_api_key" });
    return null;
  }

  logPlanImport(debugContext, "openai.request.started", {
    sourceLabel,
    inputItems: inputItems.length,
    model: OPENAI_IMPORT_MODEL,
  });

  const schema = {
    type: "object",
    additionalProperties: false,
    required: ["width", "height", "tables"],
    properties: {
      width: { type: ["number", "null"] },
      height: { type: ["number", "null"] },
      tables: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["numero", "chairCount", "x", "y", "confidence"],
          properties: {
            numero: { type: "integer" },
            chairCount: { type: "integer" },
            x: { type: "number" },
            y: { type: "number" },
            confidence: { type: ["number", "null"] },
          },
        },
      },
    },
  };

  const instructions = [
    "Eres un sistema de lectura de planos de mesas para eventos.",
    "Debes localizar unicamente mesas identificadas con etiquetas internas tipo M:x y la cantidad de sillas asociada S:x.",
    "Devuelve solo JSON valido siguiendo exactamente el esquema.",
    "x e y deben ser el centro aproximado de cada mesa dentro del plano.",
    "Si el archivo es visual, prioriza la colocacion espacial real.",
    "Si el archivo es textual o PDF digital, reconstruye el orden espacial mas plausible por filas y columnas.",
    "Ignora cualquier texto global del plano como 42 MESAS, 12 PAX, 500 PAX, nombres del evento, marcas o leyendas.",
    "No uses un valor global de PAX como chairCount de todas las mesas.",
    "No renumeres mesas en secuencia si no puedes leer su M:x real dentro de cada mesa.",
    "Cada mesa debe salir solo si puedes asociar visualmente su centro y su etiqueta M:x / S:x.",
    "No inventes mesas ni sillas si no hay evidencia razonable.",
  ].join(" ");

  let response: Response;
  try {
    response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      signal: getImportAbortSignal(debugContext),
      body: JSON.stringify({
        model: OPENAI_IMPORT_MODEL,
        max_output_tokens: 4000,
        input: [
          {
            role: "developer",
            content: [{ type: "input_text", text: instructions }],
          },
          {
            role: "user",
            content: [
              {
                type: "input_text",
                text: `Analiza este plano (${sourceLabel}) y extrae mesas y sillas. Si hay conflicto entre texto y dibujo, usa la distribucion visual real y corrige el texto usando el patron M:x / S:x.`,
              },
              ...inputItems,
            ],
          },
        ],
        text: {
          format: {
            type: "json_schema",
            name: "seating_plan",
            strict: true,
            schema,
          },
        },
      }),
    });
  } catch (error) {
    if (isAbortLikeError(error)) {
      throw new PlanImportCancelledError();
    }

    throw error;
  }

  if (!response.ok) {
    const errorText = await response.text().catch(() => "");
    logPlanImport(debugContext, "openai.request.failed", {
      sourceLabel,
      status: response.status,
      errorText,
    });
    throw new Error(`OpenAI import failed (${response.status}): ${errorText}`);
  }

  const responseJson = (await response.json()) as Record<string, unknown>;
  const rawOutput = extractResponseOutputText(responseJson);
  const parsed = parseJsonSafe<AiImportedPlanPayload>(rawOutput);
  const sanitized = sanitizeAiImportedTables(parsed);
  logPlanImport(debugContext, "openai.request.completed", {
    sourceLabel,
    outputLength: rawOutput.length,
    tableCount: sanitized?.tables.length ?? 0,
  });
  return sanitized;
}

async function callOpenAIOrderedLabelReader({
  inputItems,
  sourceLabel,
  hints,
  forceExactHints,
  reviewContext,
  debugContext,
}: {
  inputItems: Array<Record<string, unknown>>;
  sourceLabel: string;
  hints?: PlanImportHints;
  forceExactHints?: boolean;
  reviewContext?: string;
  debugContext?: PlanImportDebugContext;
}) {
  const apiKey = getOpenAIApiKey();

  if (!apiKey) {
    logPlanImport(debugContext, "openai.ordered_labels.skipped", {
      sourceLabel,
      reason: "missing_api_key",
    });
    return null;
  }

  logPlanImport(debugContext, "openai.ordered_labels.started", {
    sourceLabel,
    inputItems: inputItems.length,
    model: OPENAI_IMPORT_MODEL,
  });

  const schema = {
    type: "object",
    additionalProperties: false,
    required: ["tables"],
    properties: {
      tables: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["numero", "chairCount"],
          properties: {
            numero: { type: "integer" },
            chairCount: { type: "integer" },
          },
        },
      },
    },
  };

  const instructions = [
    "Eres un sistema de lectura de planos de mesas para eventos.",
    "Debes devolver UNICAMENTE la lista de mesas visibles dentro de la zona de mesas.",
    "Lee solo etiquetas internas M:x y S:x de cada mesa.",
    "Ignora por completo texto global del plano como 42 MESAS, 12 PAX, 500 PAX, nombres del evento, marcas, logos, leyendas, DJ, barra, cotas o anotaciones tecnicas.",
    "Devuelve las mesas exactamente en orden visual: de arriba a abajo y, dentro de cada fila, de izquierda a derecha.",
    "NO renumeres mesas, NO inventes sillas y NO uses un valor global de PAX para varias mesas.",
    "Si se aporta contexto validado, usalo solo como una referencia debil para comprobar coherencia global. Nunca copies secuencias historicas ni asignes M:x o S:x por analogia: cada valor debe leerse en la imagen actual.",
    "Si una mesa no se puede leer con suficiente seguridad, omítela antes de inventarla.",
    "Devuelve solo JSON valido siguiendo exactamente el esquema.",
    forceExactHints && typeof hints?.expectedTableCount === "number"
      ? `Debes devolver exactamente ${hints.expectedTableCount} mesas.`
      : "",
    forceExactHints && typeof hints?.expectedChairTotal === "number"
      ? `La suma total de chairCount debe ser exactamente ${hints.expectedChairTotal}.`
      : "",
  ].join(" ");

  const hintsText = [
    typeof hints?.expectedTableCount === "number"
      ? `Mesas esperadas: ${hints.expectedTableCount}.`
      : "",
    typeof hints?.expectedRowCount === "number"
      ? `Filas esperadas: ${hints.expectedRowCount}.`
      : "",
    typeof hints?.expectedColumnCount === "number"
      ? `Columnas esperadas: ${hints.expectedColumnCount}.`
      : "",
    typeof hints?.expectedChairTotal === "number"
      ? `Sillas totales esperadas: ${hints.expectedChairTotal}.`
      : "",
    hints?.learningContext
      ? `Contexto validado SOLO orientativo, nunca vinculante:\n${hints.learningContext}`
      : "",
  ]
    .filter(Boolean)
    .join(" ");

  let response: Response;
  try {
    response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      signal: getImportAbortSignal(debugContext),
      body: JSON.stringify({
        model: OPENAI_IMPORT_MODEL,
        max_output_tokens: 3000,
        input: [
          {
            role: "developer",
            content: [{ type: "input_text", text: instructions }],
          },
          {
            role: "user",
            content: [
              {
                type: "input_text",
                text: `Analiza esta imagen (${sourceLabel}) y devuelve solo la lista ordenada de mesas M:x con su S:x correspondiente en orden visual real. ${hintsText} ${reviewContext ?? ""}`.trim(),
              },
              ...inputItems,
            ],
          },
        ],
        text: {
          format: {
            type: "json_schema",
            name: "seating_plan_ordered_labels",
            strict: true,
            schema,
          },
        },
      }),
    });
  } catch (error) {
    if (isAbortLikeError(error)) {
      throw new PlanImportCancelledError();
    }

    throw error;
  }

  if (!response.ok) {
    const errorText = await response.text().catch(() => "");
    logPlanImport(debugContext, "openai.ordered_labels.failed", {
      sourceLabel,
      status: response.status,
      errorText,
    });
    throw new Error(`OpenAI ordered labels failed (${response.status}): ${errorText}`);
  }

  const responseJson = (await response.json()) as Record<string, unknown>;
  const rawOutput = extractResponseOutputText(responseJson);
  const parsed = parseJsonSafe<AiOrderedPlanPayload>(rawOutput);
  const seen = new Set<number>();
  const tables = Array.isArray(parsed?.tables)
    ? parsed.tables
        .filter(
          (table): table is AiOrderedPlanTable =>
            Number.isInteger(table?.numero) &&
            (table?.numero ?? 0) > 0 &&
            Number.isInteger(table?.chairCount) &&
            (table?.chairCount ?? 0) >= 2 &&
            (table?.chairCount ?? 0) <= 16,
        )
        .map((table) => ({
          numero: table.numero,
          chairCount: table.chairCount,
        }))
        .filter((table) => {
          if (seen.has(table.numero)) {
            return false;
          }

          seen.add(table.numero);
          return true;
        })
    : [];

  logPlanImport(debugContext, "openai.ordered_labels.completed", {
    sourceLabel,
    outputLength: rawOutput.length,
    tableCount: tables.length,
  });

  return tables;
}

async function importPlanWithOpenAIFromImage(
  buffer: Buffer,
  mimeType: string,
  debugContext?: PlanImportDebugContext,
) {
  if (!canUseOpenAIImporter()) {
    logPlanImport(debugContext, "image.openai.skipped", { reason: "missing_api_key" });
    return null;
  }

  const prepared = await bufferToPngDataUrl(buffer, mimeType || "image/png");
  const aiResult = await callOpenAIPlanImporter({
    sourceLabel: "imagen",
    debugContext,
    inputItems: [
      {
        type: "input_image",
        image_url: prepared.dataUrl,
        detail: "high",
      },
    ],
  });

  if (!aiResult) {
    logPlanImport(debugContext, "image.openai.empty");
    return null;
  }

  logPlanImport(debugContext, "image.openai.success", {
    tableCount: aiResult.tables.length,
    width: aiResult.width ?? null,
    height: aiResult.height ?? null,
  });

  const effectiveWidth =
    typeof aiResult.width === "number" && Number.isFinite(aiResult.width)
      ? aiResult.width
      : prepared.width;
  const effectiveHeight =
    typeof aiResult.height === "number" && Number.isFinite(aiResult.height)
      ? aiResult.height
      : prepared.height;

  return {
    tables: aiResult.tables,
    sourceBounds:
      typeof effectiveWidth === "number" && typeof effectiveHeight === "number"
        ? {
            width: effectiveWidth,
            height: effectiveHeight,
            ...(getContentBounds(aiResult.tables) ?? {}),
          }
        : null,
  };
}

function parseSvgFile(text: string) {
  const normalized = normalizeText(text);
  const svgTagMatch = normalized.match(/<svg\b([^>]*)>/i);
  const attributes = svgTagMatch?.[1] ?? "";
  const width =
    parseNumericDimension(attributes.match(/\bwidth\s*=\s*["']([^"']+)["']/i)?.[1]) ??
    parseNumericDimension(attributes.match(/\bviewBox\s*=\s*["'][^"']*\s[^"']*\s([^"'\s]+)\s([^"'\s]+)["']/i)?.[1]) ??
    1200;
  const height =
    parseNumericDimension(attributes.match(/\bheight\s*=\s*["']([^"']+)["']/i)?.[1]) ??
    parseNumericDimension(attributes.match(/\bviewBox\s*=\s*["'][^"']*\s[^"']*\s([^"'\s]+)\s([^"'\s]+)["']/i)?.[2]) ??
    800;

  const entries: SpatialTextEntry[] = [];
  const textRegex = /<text\b([^>]*)>([\s\S]*?)<\/text>/gi;

  for (const match of normalized.matchAll(textRegex)) {
    const attrText = match[1] ?? "";
    const innerText = normalizeText(decodeHtmlText((match[2] ?? "").replace(/<[^>]+>/g, " ")));

    if (!innerText) {
      continue;
    }

    const x = parseNumericDimension(attrText.match(/\bx\s*=\s*["']([^"']+)["']/i)?.[1]) ?? 0;
    const y = parseNumericDimension(attrText.match(/\by\s*=\s*["']([^"']+)["']/i)?.[1]) ?? 0;
    const fontSize =
      parseNumericDimension(attrText.match(/\bfont-size\s*=\s*["']([^"']+)["']/i)?.[1]) ?? 16;

    entries.push({
      text: innerText,
      x,
      y,
      width: Math.max(innerText.length * (fontSize * 0.55), fontSize * 1.6),
      height: Math.max(fontSize, 12),
    });
  }

  const textEntries = parseGenericMesaSillaText(spatialEntriesToText(entries));
  const spatialPairs = parseSpatialMesaSillaEntries(entries);
  const mergedPairs = mergeExactChairCounts(spatialPairs, textEntries);

  return {
    tables:
      mergedPairs.length > 0
        ? mergedPairs
        : assignOrderedFallbackPositions(textEntries),
    sourceBounds:
      entries.length > 0
        ? {
            width,
            height,
            ...(getContentBounds(mergedPairs.length > 0 ? mergedPairs : []) ?? {}),
          }
        : null,
  };
}

function parseSpatialMesaSillaEntries(entries: SpatialTextEntry[]) {
  const normalizedEntries = entries
    .map((entry) => ({
      ...entry,
      text: entry.text.replace(/\s+/g, " ").trim(),
    }))
    .filter((entry) => entry.text.length > 0)
    .sort((a, b) => (Math.abs(a.y - b.y) < 10 ? a.x - b.x : a.y - b.y));

  const results: MesaSillaPair[] = [];
  const usedMesaNumbers = new Set<number>();
  const usedSillaIndexes = new Set<number>();

  for (const entry of normalizedEntries) {
    const mesaMatch = entry.text.match(/\bM\s*[:=-]\s*(\d{1,4})\b/i);
    const sillaSameLineMatch = entry.text.match(/\bS\s*[:=-]\s*(\d{1,3})\b/i);

    if (!mesaMatch) {
      continue;
    }

    const numero = Number(mesaMatch[1]);
    if (usedMesaNumbers.has(numero)) {
      continue;
    }

    if (sillaSameLineMatch) {
      usedMesaNumbers.add(numero);
      results.push({
        numero,
        chairCount: Number(sillaSameLineMatch[1]),
        x: entry.x + entry.width / 2,
        y: entry.y + entry.height / 2,
      });
      continue;
    }

    let candidateIndex = -1;
    let bestScore = Number.POSITIVE_INFINITY;

    normalizedEntries.forEach((candidate, index) => {
      if (usedSillaIndexes.has(index)) {
        return;
      }

      const sillaMatch = candidate.text.match(/\bS\s*[:=-]\s*(\d{1,3})\b/i);
      if (!sillaMatch) {
        return;
      }

      const deltaY = candidate.y - entry.y;
      const deltaX = Math.abs(candidate.x - entry.x);

      if (deltaY < -12 || deltaY > 180 || deltaX > 320) {
        return;
      }

      const score = Math.abs(deltaY) * 2 + deltaX;
      if (score < bestScore) {
        bestScore = score;
        candidateIndex = index;
      }
    });

    if (candidateIndex >= 0) {
      const candidate = normalizedEntries[candidateIndex];
      const sillaMatch = candidate.text.match(/\bS\s*[:=-]\s*(\d{1,3})\b/i);

      if (sillaMatch) {
        usedMesaNumbers.add(numero);
        usedSillaIndexes.add(candidateIndex);
        results.push({
          numero,
          chairCount: Number(sillaMatch[1]),
          x: entry.x + entry.width / 2,
          y: entry.y + entry.height / 2,
        });
      }
    }
  }

  return results;
}

function spatialEntriesToText(entries: SpatialTextEntry[]) {
  return entries
    .slice()
    .sort((a, b) => (Math.abs(a.y - b.y) < 12 ? a.x - b.x : a.y - b.y))
    .map((entry) => entry.text)
    .join("\n");
}

function assignOrderedFallbackPositions(entries: MesaSillaPair[]) {
  if (entries.length === 0) {
    return [] as Array<MesaSillaPair & { x: number; y: number }>;
  }

  const columns = Math.max(2, Math.ceil(Math.sqrt(entries.length)));
  const rows = Math.max(1, Math.ceil(entries.length / columns));
  const horizontalGap = ROOM_LAYOUT_WIDTH / (columns + 1);
  const verticalGap = ROOM_LAYOUT_HEIGHT / (rows + 1);

  return entries.map((entry, index) => {
    const columnIndex = index % columns;
    const rowIndex = Math.floor(index / columns);

    return {
      ...entry,
      x: Math.round(horizontalGap * (columnIndex + 1)),
      y: Math.round(verticalGap * (rowIndex + 1)),
    };
  });
}

async function parseDigitalPdfSpatialEntries(buffer: Buffer) {
  const pdfjs = (await import("pdfjs-dist/legacy/build/pdf.mjs")) as {
    getDocument: (options: Record<string, unknown>) => { promise: Promise<any> };
  };
  const loadingTask = pdfjs.getDocument({
    data: new Uint8Array(buffer),
    useWorkerFetch: false,
    isEvalSupported: false,
    useSystemFonts: true,
  });
  const document = await loadingTask.promise;
  const entries: SpatialTextEntry[] = [];

  for (let pageIndex = 1; pageIndex <= document.numPages; pageIndex += 1) {
    const page = await document.getPage(pageIndex);
    const viewport = page.getViewport({ scale: 1 });
    const textContent = await page.getTextContent();

    for (const item of textContent.items as Array<{
      str?: string;
      transform?: number[];
      width?: number;
      height?: number;
    }>) {
      if (!item.str || !item.transform || item.transform.length < 6) {
        continue;
      }

      const text = normalizeText(item.str);
      if (!text) {
        continue;
      }

      const x = item.transform[4] ?? 0;
      const height = Math.abs(item.height ?? item.transform[0] ?? 12);
      const width = Math.abs(item.width ?? text.length * 6);
      const baselineY = item.transform[5] ?? 0;
      const y = viewport.height - baselineY - height;

      entries.push({
        text,
        x,
        y,
        width,
        height,
      });
    }
  }

  return entries;
}

function parseHocrWords(hocr: string) {
  const words: OcrWord[] = [];
  const wordRegex = /<span class='ocrx_word'[^>]*title='([^']+)'[^>]*>(.*?)<\/span>/g;

  for (const match of hocr.matchAll(wordRegex)) {
    const title = match[1];
    const rawText = match[2].replace(/<[^>]+>/g, "").trim();

    if (!rawText) {
      continue;
    }

    const bboxMatch = title.match(/bbox (\d+) (\d+) (\d+) (\d+)/);
    if (!bboxMatch) {
      continue;
    }

    const confidence = Number(title.match(/x_wconf (\d+)/)?.[1] ?? "0");
    const x0 = Number(bboxMatch[1]);
    const y0 = Number(bboxMatch[2]);
    const x1 = Number(bboxMatch[3]);
    const y1 = Number(bboxMatch[4]);

    words.push({
      text: rawText,
      x: x0,
      y: y0,
      width: Math.max(1, x1 - x0),
      height: Math.max(1, y1 - y0),
      confidence,
    });
  }

  return words;
}

function parseHocrTokens(hocr: string) {
  const words = parseHocrWords(hocr)
    .filter((word) => word.confidence >= 10)
    .sort((a, b) => (Math.abs(a.y - b.y) < 14 ? a.x - b.x : a.y - b.y));
  const tokens: OcrToken[] = [];
  const usedWordIndexes = new Set<number>();

  for (let index = 0; index < words.length; index += 1) {
    if (usedWordIndexes.has(index)) {
      continue;
    }

    const word = words[index];
    const direct = parseMesaOrSillaToken(word.text);

    if (direct) {
      usedWordIndexes.add(index);
      tokens.push({
        kind: direct.kind,
        value: direct.value,
        x: word.x,
        y: word.y,
        width: word.width,
        height: word.height,
        confidence: word.confidence,
      });
      continue;
    }

    const lineNeighbors: Array<{ word: OcrWord; index: number }> = [{ word, index }];

    for (let nextIndex = index + 1; nextIndex < Math.min(words.length, index + 4); nextIndex += 1) {
      const nextWord = words[nextIndex];
      const sameLineThreshold = Math.max(word.height, nextWord.height) * 0.75 + 10;
      const gapX = nextWord.x - (lineNeighbors[lineNeighbors.length - 1].word.x + lineNeighbors[lineNeighbors.length - 1].word.width);

      if (Math.abs(nextWord.y - word.y) > sameLineThreshold) {
        break;
      }

      if (gapX > Math.max(word.height * 2.8, 44)) {
        break;
      }

      lineNeighbors.push({ word: nextWord, index: nextIndex });
    }

    for (let length = Math.min(3, lineNeighbors.length); length >= 2; length -= 1) {
      const slice = lineNeighbors.slice(0, length);
      const compact = slice.map((entry) => entry.word.text).join("");
      const parsed = parseMesaOrSillaToken(compact);

      if (!parsed) {
        continue;
      }

      slice.forEach((entry) => usedWordIndexes.add(entry.index));
      const minX = Math.min(...slice.map((entry) => entry.word.x));
      const minY = Math.min(...slice.map((entry) => entry.word.y));
      const maxX = Math.max(...slice.map((entry) => entry.word.x + entry.word.width));
      const maxY = Math.max(...slice.map((entry) => entry.word.y + entry.word.height));
      const confidence =
        slice.reduce((sum, entry) => sum + entry.word.confidence, 0) / slice.length;

      tokens.push({
        kind: parsed.kind,
        value: parsed.value,
        x: minX,
        y: minY,
        width: Math.max(1, maxX - minX),
        height: Math.max(1, maxY - minY),
        confidence,
      });
      break;
    }
  }

  return tokens;
}

function buildMesaSillaPairsFromTokens(tokens: OcrToken[]) {
  const mesas = tokens
    .filter((token) => token.kind === "mesa")
    .sort((a, b) => (Math.abs(a.y - b.y) < 30 ? a.x - b.x : a.y - b.y));
  const sillas = tokens.filter((token) => token.kind === "silla");
  const usedMesaNumbers = new Set<number>();
  const usedChairIndexes = new Set<number>();
  const pairs: MesaSillaPair[] = [];

  for (const mesa of mesas) {
    if (usedMesaNumbers.has(mesa.value)) {
      continue;
    }

    let bestChairIndex = -1;
    let bestScore = Number.POSITIVE_INFINITY;

    for (let index = 0; index < sillas.length; index += 1) {
      if (usedChairIndexes.has(index)) {
        continue;
      }

      const silla = sillas[index];
      const sillaCenterX = silla.x + silla.width / 2;
      const sillaCenterY = silla.y + silla.height / 2;
      const mesaCenterX = mesa.x + mesa.width / 2;
      const mesaCenterY = mesa.y + mesa.height / 2;
      const deltaX = Math.abs(sillaCenterX - mesaCenterX);
      const deltaY = sillaCenterY - mesaCenterY;

      if (deltaY < -mesa.height * 0.75 || deltaY > Math.max(220, mesa.height * 10)) {
        continue;
      }

      if (deltaX > Math.max(180, mesa.width * 6)) {
        continue;
      }

      const score =
        deltaX * 1.75 +
        Math.abs(deltaY - Math.max(20, mesa.height * 1.8)) -
        silla.confidence * 0.2;

      if (score < bestScore) {
        bestScore = score;
        bestChairIndex = index;
      }
    }

    if (bestChairIndex >= 0) {
      const silla = sillas[bestChairIndex];
      usedMesaNumbers.add(mesa.value);
      usedChairIndexes.add(bestChairIndex);
      pairs.push({
        numero: mesa.value,
        chairCount: silla.value,
        x: mesa.x + mesa.width / 2,
        y: mesa.y + mesa.height / 2,
      });
    }
  }

  return pairs;
}

function mergeExactChairCounts(spatialPairs: MesaSillaPair[], exactPairs: MesaSillaPair[]) {
  const exactByMesa = new Map(exactPairs.map((pair) => [pair.numero, pair.chairCount]));
  const merged = spatialPairs.map((pair) => ({
    ...pair,
    chairCount: exactByMesa.get(pair.numero) ?? pair.chairCount,
  }));
  const mergedNumbers = new Set(merged.map((pair) => pair.numero));

  for (const exactPair of exactPairs) {
    if (!mergedNumbers.has(exactPair.numero)) {
      merged.push(exactPair);
    }
  }

  return merged;
}

async function createOcrVariants(
  buffer: Buffer,
  options?: {
    mode?: "full" | "crop";
  },
) {
  const baseImage = await Jimp.read(buffer);
  const variants: OcrVariant[] = [];
  const mode = options?.mode ?? "full";
  const maxDimension = Math.max(baseImage.bitmap.width, baseImage.bitmap.height);
  const isVeryLargeImage = maxDimension >= 3200;

  const gray2xScale = mode === "crop" && isVeryLargeImage ? 1.6 : 2;
  const gray2x = baseImage.clone().greyscale().contrast(0.6).scale(gray2xScale);
  variants.push({
    label: `gray${gray2xScale}x`,
    buffer: await gray2x.getBuffer("image/png"),
    width: gray2x.bitmap.width,
    height: gray2x.bitmap.height,
    scale: gray2xScale,
  });

  const gray3xScale = mode === "crop" && isVeryLargeImage ? 2 : 3;
  const gray3x = baseImage.clone().greyscale().contrast(0.75).normalize().scale(gray3xScale);
  variants.push({
    label: `gray${gray3xScale}x`,
    buffer: await gray3x.getBuffer("image/png"),
    width: gray3x.bitmap.width,
    height: gray3x.bitmap.height,
    scale: gray3xScale,
  });

  const threshold3x = baseImage
    .clone()
    .greyscale()
    .contrast(1)
    .normalize()
    .scale(mode === "crop" && isVeryLargeImage ? 2 : 3)
    .threshold({ max: 180 });
  variants.push({
    label: mode === "crop" && isVeryLargeImage ? "threshold2x" : "threshold3x",
    buffer: await threshold3x.getBuffer("image/png"),
    width: threshold3x.bitmap.width,
    height: threshold3x.bitmap.height,
    scale: mode === "crop" && isVeryLargeImage ? 2 : 3,
  });

  if (!(mode === "crop" && isVeryLargeImage)) {
    const threshold4x = baseImage
      .clone()
      .greyscale()
      .contrast(1)
      .normalize()
      .scale(mode === "crop" ? 3 : 4)
      .threshold({ max: 170 });
    variants.push({
      label: mode === "crop" ? "threshold3x" : "threshold4x",
      buffer: await threshold4x.getBuffer("image/png"),
      width: threshold4x.bitmap.width,
      height: threshold4x.bitmap.height,
      scale: mode === "crop" ? 3 : 4,
    });
  }

  return variants;
}

async function renderPdfFirstPageVariants(buffer: Buffer, scales = [2.2, 3]) {
  const pdfjs = (await import("pdfjs-dist/legacy/build/pdf.mjs")) as {
    getDocument: (options: Record<string, unknown>) => { promise: Promise<any> };
  };
  const canvasModule = await import("@napi-rs/canvas");
  const createCanvas =
    (canvasModule as { createCanvas?: (width: number, height: number) => any }).createCanvas;

  if (!createCanvas) {
    return [] as Array<{ buffer: Buffer; width: number; height: number }>;
  }

  const loadingTask = pdfjs.getDocument({
    data: new Uint8Array(buffer),
    useWorkerFetch: false,
    isEvalSupported: false,
    useSystemFonts: true,
  });
  const document = await loadingTask.promise;

  try {
    const page = await document.getPage(1);
    const renderedPages: Array<{ buffer: Buffer; width: number; height: number }> = [];

    for (const scale of scales) {
      const viewport = page.getViewport({ scale });
      const canvas = createCanvas(
        Math.max(1, Math.ceil(viewport.width)),
        Math.max(1, Math.ceil(viewport.height)),
      );
      const context = canvas.getContext("2d");

      await page.render({
        canvasContext: context,
        viewport,
      }).promise;

      renderedPages.push({
        buffer: Buffer.from(canvas.toBuffer("image/png")),
        width: canvas.width,
        height: canvas.height,
      });
    }

    return renderedPages;
  } finally {
    if (typeof document.destroy === "function") {
      await document.destroy();
    }
  }
}

async function extractOcrPairsFromBuffer(
  buffer: Buffer,
  debugContext?: PlanImportDebugContext,
) {
  const tesseractModule = await import("tesseract.js");
  const tesseract = tesseractModule.default ?? tesseractModule;
  const worker = await tesseract.createWorker("eng", 1, {
    workerPath: path.resolve(
      process.cwd(),
      "node_modules",
      "tesseract.js",
      "src",
      "worker-script",
      "node",
      "index.js",
    ),
    logger: () => {},
    cacheMethod: "none",
  });

  try {
    const originalImage = await Jimp.read(buffer);
    const originalWidth = originalImage.bitmap.width;
    const originalHeight = originalImage.bitmap.height;

    await worker.setParameters({
      tessedit_pageseg_mode: tesseract.PSM.SPARSE_TEXT,
      preserve_interword_spaces: "1",
      user_defined_dpi: "300",
      tessedit_char_whitelist: "MS:0123456789",
    });

    const variants = await createOcrVariants(buffer);
    const runningOnVercel = Boolean(process.env.VERCEL);
    const aggregatedTokens: OcrToken[] = [];
    logPlanImport(debugContext, "ocr.started", {
      variants: variants.length,
      runningOnVercel,
    });
    let bestResult: OcrRunResult | null = null;
    let bestTextFallback: MesaSillaPair[] = [];

    for (const [index, variant] of variants.entries()) {
      if (runningOnVercel && index >= OCR_VARIANT_LIMIT_VERCEL) {
        break;
      }

      const result = await runOcrVariantBuffer(worker, variant);
      aggregatedTokens.push(
        ...result.tokens.map((token) => ({
          ...token,
          x: token.x / variant.scale,
          y: token.y / variant.scale,
          width: token.width / variant.scale,
          height: token.height / variant.scale,
        })),
      );

      if (result.textFallback.length > bestTextFallback.length) {
        bestTextFallback = result.textFallback;
      }

      if (!bestResult || result.score > bestResult.score) {
        bestResult = result;
      }

      if (
        runningOnVercel &&
        bestResult.pairs.length >= Math.max(10, bestTextFallback.length)
      ) {
        break;
      }
    }

    if (!bestResult) {
      logPlanImport(debugContext, "ocr.no_result");
      return {
        tables: [] as MesaSillaPair[],
        sourceBounds: null as { width: number; height: number } | null,
      };
    }

    const cropRegion = computeTableRegionFromTokens(
      bestResult.tokens,
      bestResult.width,
      bestResult.height,
    );
    let finalResult = bestResult;

    if (
      cropRegion &&
      cropRegion.width < bestResult.width * 0.94 &&
      cropRegion.height < bestResult.height * 0.94
    ) {
      const originalCropRegion = clampCropRegion(
        {
          x: Math.floor(cropRegion.x / bestResult.scale),
          y: Math.floor(cropRegion.y / bestResult.scale),
          width: Math.ceil(cropRegion.width / bestResult.scale),
          height: Math.ceil(cropRegion.height / bestResult.scale),
        },
        originalWidth,
        originalHeight,
      );
      logPlanImport(debugContext, "ocr.crop_region.detected", {
        scaled: cropRegion,
        original: originalCropRegion,
        originalWidth,
        originalHeight,
        bestVariant: bestResult.label,
        bestVariantScale: bestResult.scale,
      });
      const croppedBuffer = await cropBufferToRegion(buffer, originalCropRegion);
      const croppedVariants = await createOcrVariants(croppedBuffer, { mode: "crop" });
      let bestCropResult: OcrRunResult | null = null;

      for (const [index, variant] of croppedVariants.entries()) {
        if (runningOnVercel && index >= OCR_VARIANT_LIMIT_VERCEL) {
          break;
        }

        const cropResult = await runOcrVariantBuffer(worker, variant);
        if (!bestCropResult || cropResult.score > bestCropResult.score) {
          bestCropResult = cropResult;
        }
      }

      if (bestCropResult) {
        logPlanImport(debugContext, "ocr.crop_region.completed", {
          fullPairs: bestResult.pairs.length,
          croppedPairs: bestCropResult.pairs.length,
          croppedVariant: bestCropResult.label,
          croppedVariantScale: bestCropResult.scale,
        });

        if (
          bestCropResult.pairs.length > bestResult.pairs.length ||
          (
            bestCropResult.pairs.length === bestResult.pairs.length &&
            hasReliableSpatialLayout(bestCropResult.pairs) &&
            !hasReliableSpatialLayout(bestResult.pairs)
          )
        ) {
          finalResult = bestCropResult;
        }
      }
    }

    const aggregatedPairs = buildMesaSillaPairsFromTokens(dedupeOcrTokens(aggregatedTokens));
    if (aggregatedPairs.length > finalResult.pairs.length) {
      logPlanImport(debugContext, "ocr.aggregated.completed", {
        pairs: aggregatedPairs.length,
        previousPairs: finalResult.pairs.length,
      });
      finalResult = {
        ...finalResult,
        width: originalWidth,
        height: originalHeight,
        scale: 1,
        pairs: aggregatedPairs,
      };
    }

    logPlanImport(debugContext, "ocr.completed", {
      pairs: finalResult.pairs.length,
      textFallbackPairs: bestTextFallback.length,
      width: finalResult.width,
      height: finalResult.height,
    });

    return {
      tables: finalResult.pairs.length > 0 ? finalResult.pairs : bestTextFallback,
      sourceBounds:
        finalResult.pairs.length > 0
          ? {
              width: finalResult.width,
              height: finalResult.height,
              ...(getContentBounds(finalResult.pairs) ?? {}),
            }
          : null,
    };
  } finally {
    await worker.terminate();
  }
}

async function parseTextLikeFile(buffer: Buffer) {
  return normalizeText(buffer.toString("utf8"));
}

async function parseDocxFile(buffer: Buffer) {
  const mammothModule = await import("mammoth");
  const mammoth = mammothModule.default ?? mammothModule;
  const result = await mammoth.extractRawText({ buffer });
  return normalizeText(result.value ?? "");
}

async function parseSpreadsheetFile(buffer: Buffer) {
  const xlsxModule = await import("xlsx");
  const XLSX = xlsxModule.default ?? xlsxModule;
  const workbook = XLSX.read(buffer, { type: "buffer" });
  const rows: Record<string, unknown>[] = [];

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    const objects = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
      defval: "",
    });
    rows.push(...objects);
  }

  const parsedRows = parseSpreadsheetEntries(rows);
  if (parsedRows.length > 0) {
    return parsedRows;
  }

  const csvText = workbook.SheetNames.map((sheetName: string) =>
    XLSX.utils.sheet_to_csv(workbook.Sheets[sheetName]),
  ).join("\n");

  return parseGenericMesaSillaText(csvText);
}

async function parsePdfFileWithDebug(
  buffer: Buffer,
  debugContext?: PlanImportDebugContext,
) {
  const rawTextFallback = parseGenericMesaSillaText(buffer.toString("utf8"));
  let textEntries = rawTextFallback;
  let digitalSpatialEntries: SpatialTextEntry[] = [];
  let digitalSpatialPairs: MesaSillaPair[] = [];

  logPlanImport(debugContext, "pdf.started", {
    rawTextFallbackCount: rawTextFallback.length,
  });

  try {
    digitalSpatialEntries = await parseDigitalPdfSpatialEntries(buffer);
    digitalSpatialPairs = parseSpatialMesaSillaEntries(digitalSpatialEntries);
    const digitalTextEntries = parseGenericMesaSillaText(
      spatialEntriesToText(digitalSpatialEntries),
    );

    if (digitalTextEntries.length > 0) {
      textEntries = digitalTextEntries;
    }
    logPlanImport(debugContext, "pdf.digital_spatial.completed", {
      textEntries: digitalTextEntries.length,
      spatialEntries: digitalSpatialEntries.length,
      spatialPairs: digitalSpatialPairs.length,
    });
  } catch {
    logPlanImport(debugContext, "pdf.digital_spatial.failed");
    digitalSpatialEntries = [];
    digitalSpatialPairs = [];
  }

  if (canUseOpenAIImporter()) {
    const digitalText = normalizeText(spatialEntriesToText(digitalSpatialEntries));
    if (digitalText) {
      const aiResult = await callOpenAIPlanImporter({
        sourceLabel: "pdf",
        debugContext,
        inputItems: [
          {
            type: "input_text",
            text: `Texto extraido del PDF:\n${digitalText}`,
          },
        ],
      });

      if (aiResult) {
        logPlanImport(debugContext, "pdf.openai.success", {
          tableCount: aiResult.tables.length,
          mergedWithSpatial: digitalSpatialPairs.length > 0,
        });
        const mergedTables = digitalSpatialPairs.length > 0
          ? mergeSpatialAndAiEntries(digitalSpatialPairs, aiResult.tables)
          : aiResult.tables;

        return {
          tables: mergedTables,
          sourceBounds:
            digitalSpatialEntries.length > 0
              ? {
                  width: Math.max(
                    ...digitalSpatialEntries.map((entry) => entry.x + entry.width),
                    0,
                  ),
                  height: Math.max(
                    ...digitalSpatialEntries.map((entry) => entry.y + entry.height),
                    0,
                  ),
                  ...(getContentBounds(digitalSpatialPairs) ?? {}),
                }
              : typeof aiResult.width === "number" && typeof aiResult.height === "number"
                ? {
                    width: aiResult.width,
                    height: aiResult.height,
                    ...(getContentBounds(aiResult.tables) ?? {}),
                  }
                : null,
        };
      }
    }
  }

  const mergedDigitalPairs = mergeExactChairCounts(digitalSpatialPairs, textEntries);

  if (mergedDigitalPairs.length > 0) {
    logPlanImport(debugContext, "pdf.digital_fallback.success", {
      tableCount: mergedDigitalPairs.length,
    });
    return {
      tables: mergedDigitalPairs,
      sourceBounds:
        digitalSpatialPairs.length > 0
          ? {
              width: Math.max(
                ...digitalSpatialEntries.map((entry) => entry.x + entry.width),
                0,
              ),
              height: Math.max(
                ...digitalSpatialEntries.map((entry) => entry.y + entry.height),
                0,
              ),
              ...(getContentBounds(digitalSpatialPairs) ?? {}),
            }
          : null,
    };
  }

  if (textEntries.length > 0) {
    return {
      tables: assignOrderedFallbackPositions(textEntries),
      sourceBounds: null,
    };
  }

  const renderedPages = await renderPdfFirstPageVariants(buffer).catch(() => []);
  logPlanImport(debugContext, "pdf.rendered_variants.completed", {
    renderedPages: renderedPages.length,
  });
  let bestRenderedResult:
    | {
        tables: MesaSillaPair[];
        sourceBounds: { width: number; height: number } | null;
      }
    | null = null;

  for (const renderedPage of renderedPages) {
    const ocrResult = await extractOcrPairsFromBuffer(renderedPage.buffer, debugContext).catch(() => ({
      tables: [] as MesaSillaPair[],
      sourceBounds: null as { width: number; height: number } | null,
    }));

    let candidateTables = ocrResult.tables;
    let candidateSourceBounds =
      ocrResult.sourceBounds ??
      {
        width: renderedPage.width,
        height: renderedPage.height,
      };

    if (canUseOpenAIImporter()) {
      const prepared = await bufferToPngDataUrl(renderedPage.buffer, "image/png");
      const aiResult = await callOpenAIPlanImporter({
        sourceLabel: "pdf-render",
        debugContext,
        inputItems: [
          {
            type: "input_image",
            image_url: prepared.dataUrl,
            detail: "high",
          },
        ],
      }).catch(() => null);

      if (ocrResult.tables.length >= 6) {
        candidateTables = aiResult
          ? mergeExactChairCounts(ocrResult.tables, aiResult.tables)
          : ocrResult.tables;
      } else if (aiResult?.tables.length) {
        candidateTables = aiResult.tables;
        candidateSourceBounds =
          typeof aiResult.width === "number" && typeof aiResult.height === "number"
            ? {
                width: aiResult.width,
                height: aiResult.height,
                ...(getContentBounds(aiResult.tables) ?? {}),
              }
            : candidateSourceBounds;
      }
    }

    if (
      !bestRenderedResult ||
      candidateTables.length > bestRenderedResult.tables.length
    ) {
      bestRenderedResult = {
        tables: candidateTables,
        sourceBounds: candidateSourceBounds,
      };
    }
  }

  if (bestRenderedResult && bestRenderedResult.tables.length > 0) {
    logPlanImport(debugContext, "pdf.rendered_fallback.success", {
      tableCount: bestRenderedResult.tables.length,
    });
    return bestRenderedResult;
  }

  logPlanImport(debugContext, "pdf.completed.empty");
  return {
    tables: assignOrderedFallbackPositions(textEntries),
    sourceBounds: null,
  };
}

async function runImageOcr(buffer: Buffer, widthHint?: number, heightHint?: number) {
  const ocrResult = await extractOcrPairsFromBuffer(buffer);
  return ocrResult.tables.length > 0
    ? entriesToImportedTables(
        ocrResult.tables,
        0,
        ocrResult.sourceBounds ??
          (widthHint && heightHint ? { width: widthHint, height: heightHint } : undefined),
      )
    : [];
}

export async function importTablesFromPlanFile(
  file: File,
  existingTableCount: number,
  hints?: PlanImportHints,
  debugContext?: PlanImportDebugContext,
) {
  assertImportNotCancelled(debugContext);
  const bytes = Buffer.from(await file.arrayBuffer());
  const lowercaseName = file.name.toLowerCase();
  const mimeType = file.type.toLowerCase();

  logPlanImport(debugContext, "file.received", {
    fileName: file.name,
    mimeType,
    size: file.size,
    existingTableCount,
  });

  if (!mimeType.startsWith("image/")) {
    logPlanImport(debugContext, "file.rejected", {
      reason: "non_image_format",
      mimeType,
      fileName: file.name,
    });
    throw new Error("El importador de planos solo admite imagenes por ahora.");
  }

  logPlanImport(debugContext, "file.branch.image");
  logPlanImport(debugContext, "image.geometry.attempt");
  const geometricLayout = await withTimeout(
    (signal) => detectTableLayoutFromImageGeometry(bytes, debugContext, signal),
    IMAGE_GEOMETRY_TIMEOUT_MS,
    "image geometry detection",
    { signal: getImportAbortSignal(debugContext) },
  ).catch((error) => {
    logPlanImport(debugContext, "image.geometry.failed", serializeImportError(error));
    return null;
  });
  assertImportNotCancelled(debugContext);
  if (geometricLayout && geometricLayout.tables.length >= 12) {
    const geometryBounds = getGeometryBounds(geometricLayout.tables);
    const geometryFocusBuffer =
      geometryBounds &&
      geometricLayout.sourceBounds.width > 0 &&
      geometricLayout.sourceBounds.height > 0
        ? await cropBufferToRegion(
            bytes,
            clampCropRegion(
              {
                x: geometryBounds.minX,
                y: geometryBounds.minY,
                width: geometryBounds.maxX - geometryBounds.minX,
                height: geometryBounds.maxY - geometryBounds.minY,
              },
              geometricLayout.sourceBounds.width,
              geometricLayout.sourceBounds.height,
            ),
          )
        : bytes;
    const geometryFocusImage = await bufferToPngDataUrl(
      geometryFocusBuffer,
      mimeType || "image/png",
    );
    const geometryContactSheet = await buildGeometryContactSheet(bytes, geometricLayout, "original");
    const geometryContactSheetImage = geometryContactSheet
      ? await bufferToPngDataUrl(geometryContactSheet.buffer, "image/png")
      : null;
    const geometryThresholdSheet = await buildGeometryContactSheet(bytes, geometricLayout, "threshold");
    const geometryThresholdSheetImage = geometryThresholdSheet
      ? await bufferToPngDataUrl(geometryThresholdSheet.buffer, "image/png")
      : null;

    let orderedAiLabels = await callOpenAIOrderedLabelReader({
      sourceLabel: "imagen-zona-mesas",
      hints,
      debugContext,
      inputItems: [
        ...(geometryContactSheetImage
          ? [
              {
                type: "input_text" as const,
                text: `La primera imagen es un mosaico de recortes individuales de mesas ordenadas por posicion: de izquierda a derecha y de arriba a abajo. Cada recorte tiene una etiqueta Pos N fuera de la mesa. La segunda imagen, si aparece, es el mismo mosaico en alto contraste para distinguir mejor numeros como 5, 6, 7, 8, 9 y 10. Usa esos mosaicos como fuente principal para leer M:x y S:x.`,
              },
              {
                type: "input_image" as const,
                image_url: geometryContactSheetImage.dataUrl,
                detail: "high" as const,
              },
              ...(geometryThresholdSheetImage
                ? [
                    {
                      type: "input_image" as const,
                      image_url: geometryThresholdSheetImage.dataUrl,
                      detail: "high" as const,
                    },
                  ]
                : []),
            ]
          : []),
        {
          type: "input_image",
          image_url: geometryFocusImage.dataUrl,
          detail: "high",
        },
      ],
    }).catch((error) => {
      logPlanImport(debugContext, "image.ordered_labels.failed", serializeImportError(error));
      return null;
    });

    const candidateLabelSets: AiOrderedPlanTable[][] = orderedAiLabels ? [orderedAiLabels] : [];
    const expectedTableMismatch =
      typeof hints?.expectedTableCount === "number" &&
      orderedAiLabels &&
      orderedAiLabels.length !== hints.expectedTableCount;
    const expectedChairMismatch =
      typeof hints?.expectedChairTotal === "number" &&
      orderedAiLabels &&
      getChairTotal(orderedAiLabels) !== hints.expectedChairTotal;

    if ((expectedTableMismatch || expectedChairMismatch) && geometricLayout.tables.length > 0) {
      logPlanImport(debugContext, "image.ordered_labels.retrying_with_hints", {
        previousCount: orderedAiLabels?.length ?? 0,
        previousChairTotal: orderedAiLabels ? getChairTotal(orderedAiLabels) : 0,
        expectedTableCount: hints?.expectedTableCount ?? null,
        expectedChairTotal: hints?.expectedChairTotal ?? null,
      });

      const retriedOrderedLabels = await callOpenAIOrderedLabelReader({
        sourceLabel: "imagen-zona-mesas-reintento",
        hints,
        forceExactHints: true,
        reviewContext:
          orderedAiLabels && orderedAiLabels.length > 0
            ? `Tu lectura anterior fue esta:\n${serializeOrderedLabels(orderedAiLabels)}\nEsa lectura suma ${getChairTotal(orderedAiLabels)} sillas. Corrige solo las mesas equivocadas para que el resultado final cuadre exactamente con las pistas dadas, manteniendo el orden visual real.`
            : undefined,
        debugContext,
        inputItems: [
          ...(geometryContactSheetImage
            ? [
                {
                  type: "input_text" as const,
                  text: `La primera imagen es un mosaico ordenado de mesas individuales con etiqueta Pos N. Corrige solo las posiciones dudosas y mantén estrictamente ese orden de lectura.`,
                },
                {
                  type: "input_image" as const,
                  image_url: geometryContactSheetImage.dataUrl,
                  detail: "high" as const,
                },
                ...(geometryThresholdSheetImage
                  ? [
                      {
                        type: "input_image" as const,
                        image_url: geometryThresholdSheetImage.dataUrl,
                        detail: "high" as const,
                      },
                    ]
                  : []),
              ]
            : []),
          {
            type: "input_image",
            image_url: geometryFocusImage.dataUrl,
            detail: "high",
          },
        ],
      }).catch((error) => {
        logPlanImport(debugContext, "image.ordered_labels.retry_failed", serializeImportError(error));
        return null;
      });

      if (retriedOrderedLabels && retriedOrderedLabels.length > 0) {
        candidateLabelSets.push(retriedOrderedLabels);
      }

      const followUpOrderedLabels = await callOpenAIOrderedLabelReader({
        sourceLabel: "imagen-zona-mesas-revision-final",
        hints,
        forceExactHints: true,
        reviewContext:
          candidateLabelSets.length > 0
            ? `Tienes estas lecturas previas candidatas:\n\nCandidata 1:\n${serializeOrderedLabels(candidateLabelSets[0])}\nSuma=${getChairTotal(candidateLabelSets[0])}\n${
                candidateLabelSets[1]
                  ? `\nCandidata 2:\n${serializeOrderedLabels(candidateLabelSets[1])}\nSuma=${getChairTotal(candidateLabelSets[1])}\n`
                  : ""
              }\nDevuelve la mejor version final que respete el orden visual y cuadre exactamente con las pistas esperadas.`
            : undefined,
        debugContext,
        inputItems: [
          ...(geometryContactSheetImage
            ? [
                {
                  type: "input_text" as const,
                  text: `La primera imagen es el mosaico definitivo de recortes de mesas en orden Pos N. Prioriza esa imagen sobre el plano general para leer M:x y S:x correctamente.`,
                },
                {
                  type: "input_image" as const,
                  image_url: geometryContactSheetImage.dataUrl,
                  detail: "high" as const,
                },
                ...(geometryThresholdSheetImage
                  ? [
                      {
                        type: "input_image" as const,
                        image_url: geometryThresholdSheetImage.dataUrl,
                        detail: "high" as const,
                      },
                    ]
                  : []),
              ]
            : []),
          {
            type: "input_image",
            image_url: geometryFocusImage.dataUrl,
            detail: "high",
          },
        ],
      }).catch((error) => {
        logPlanImport(debugContext, "image.ordered_labels.final_retry_failed", serializeImportError(error));
        return null;
      });

      if (followUpOrderedLabels && followUpOrderedLabels.length > 0) {
        candidateLabelSets.push(followUpOrderedLabels);
      }

      orderedAiLabels =
        [...candidateLabelSets].sort(
          (a, b) =>
            scoreOrderedLabelCandidate(a, hints, geometricLayout.tables.length) -
            scoreOrderedLabelCandidate(b, hints, geometricLayout.tables.length),
        )[0] ?? orderedAiLabels;
    }
    assertImportNotCancelled(debugContext);

    if (orderedAiLabels && orderedAiLabels.length >= Math.max(24, Math.floor(geometricLayout.tables.length * 0.7))) {
      const mergedGeometryLabels = mergeGeometryWithOrderedLabels(
        geometricLayout.tables,
        orderedAiLabels,
      );
      const mergedGeometryLabelsWithOcrChairs = await recoverChairCountsFromGeometryLayout(
        bytes,
        geometricLayout,
        mergedGeometryLabels,
        hints,
        debugContext,
      ).catch((error) => {
        logPlanImport(debugContext, "image.chair_ocr.failed", serializeImportError(error));
        return mergedGeometryLabels;
      });
        logPlanImport(debugContext, "file.branch.image.completed", {
          strategy: "geometry_with_ordered_ai_labels_and_paddle_chairs",
          geometryEntryCount: geometricLayout.tables.length,
          orderedLabelCount: orderedAiLabels.length,
        });
      return entriesToImportedTables(
        applyHintGridLayout(mergedGeometryLabelsWithOcrChairs, hints),
        existingTableCount,
        hints?.expectedRowCount && hints?.expectedColumnCount
          ? undefined
          : geometricLayout.sourceBounds,
      );
    }

    logPlanImport(debugContext, "image.geometry_ocr.attempt", {
      geometryEntryCount: geometricLayout.tables.length,
    });
    const geometricLabels = await withTimeout(
      (signal) => readLabelsFromDetectedImageLayout(bytes, geometricLayout, debugContext, signal),
      IMAGE_GEOMETRY_OCR_TIMEOUT_MS,
      "image geometry OCR",
      { signal: getImportAbortSignal(debugContext) },
    ).catch((error) => {
      logPlanImport(debugContext, "image.geometry_ocr.failed", serializeImportError(error));
      return [] as MesaSillaPair[];
    });

    if (geometricLabels.length >= Math.max(18, Math.floor(geometricLayout.tables.length * 0.55))) {
      logPlanImport(debugContext, "file.branch.image.completed", {
        strategy: "geometry_primary",
        geometryEntryCount: geometricLayout.tables.length,
        recognizedLabels: geometricLabels.length,
      });
      return entriesToImportedTables(
        applyHintGridLayout(geometricLabels, hints),
        existingTableCount,
        hints?.expectedRowCount && hints?.expectedColumnCount
          ? undefined
          : geometricLayout.sourceBounds,
      );
    }
  }

  const advancedVisionLayout = await withTimeout(
    (signal) => runAdvancedPlanVision(bytes, hints, debugContext, signal),
    IMAGE_ADVANCED_VISION_TIMEOUT_MS,
    "image advanced vision",
    { signal: getImportAbortSignal(debugContext) },
  ).catch((error) => {
    logPlanImport(debugContext, "image.advanced.failed", serializeImportError(error));
    return null;
  });
  assertImportNotCancelled(debugContext);

  if (
    advancedVisionLayout &&
    advancedVisionLayout.tables.length >=
      Math.max(6, Math.floor((hints?.expectedTableCount ?? 12) * 0.55))
  ) {
    let advancedTables: MesaSillaPair[] = advancedVisionLayout.tables;
    const advancedDetectedLayout: DetectedImageLayout | null =
      advancedVisionLayout.sourceBounds
        ? {
            tables: advancedVisionLayout.tables,
            sourceBounds: {
              width: advancedVisionLayout.sourceBounds.width,
              height: advancedVisionLayout.sourceBounds.height,
            },
            nearestDistance: estimateNearestNeighborDistance(advancedVisionLayout.tables),
          }
        : null;

    if (advancedDetectedLayout) {
      const advancedFocusBounds = getGeometryBounds(advancedDetectedLayout.tables);
      const advancedFocusBuffer =
        advancedFocusBounds &&
        advancedDetectedLayout.sourceBounds.width > 0 &&
        advancedDetectedLayout.sourceBounds.height > 0
          ? await cropBufferToRegion(
              bytes,
              clampCropRegion(
                {
                  x: advancedFocusBounds.minX,
                  y: advancedFocusBounds.minY,
                  width: advancedFocusBounds.maxX - advancedFocusBounds.minX,
                  height: advancedFocusBounds.maxY - advancedFocusBounds.minY,
                },
                advancedDetectedLayout.sourceBounds.width,
                advancedDetectedLayout.sourceBounds.height,
              ),
            )
          : bytes;
      const advancedFocusImage = await bufferToPngDataUrl(
        advancedFocusBuffer,
        mimeType || "image/png",
      );
      const advancedContactSheet = await buildGeometryContactSheet(
        bytes,
        advancedDetectedLayout,
        "original",
      );
      const advancedThresholdSheet = await buildGeometryContactSheet(
        bytes,
        advancedDetectedLayout,
        "threshold",
      );
      const advancedContactSheetImage = advancedContactSheet
        ? await bufferToPngDataUrl(advancedContactSheet.buffer, "image/png")
        : null;
      const advancedThresholdSheetImage = advancedThresholdSheet
        ? await bufferToPngDataUrl(advancedThresholdSheet.buffer, "image/png")
        : null;

      const orderedAdvancedLabels = await callOpenAIOrderedLabelReader({
        sourceLabel: "imagen-zona-mesas-avanzada",
        hints,
        debugContext,
        inputItems: [
          ...(advancedContactSheetImage
            ? [
                {
                  type: "input_text" as const,
                  text: `La primera imagen es un mosaico de recortes individuales de mesas ordenadas por posicion visual. Usa ese mosaico como fuente principal para leer M:x y S:x. La segunda imagen, si aparece, es el mismo mosaico en alto contraste.`,
                },
                {
                  type: "input_image" as const,
                  image_url: advancedContactSheetImage.dataUrl,
                  detail: "high" as const,
                },
                ...(advancedThresholdSheetImage
                  ? [
                      {
                        type: "input_image" as const,
                        image_url: advancedThresholdSheetImage.dataUrl,
                        detail: "high" as const,
                      },
                    ]
                  : []),
              ]
            : []),
          {
            type: "input_image",
            image_url: advancedFocusImage.dataUrl,
            detail: "high",
          },
        ],
      }).catch((error) => {
        logPlanImport(debugContext, "image.advanced.ordered_labels_failed", serializeImportError(error));
        return null;
      });

      if (
        orderedAdvancedLabels &&
        hasSufficientOrderedLabelCoverage(
          advancedDetectedLayout.tables.length,
          orderedAdvancedLabels.length,
        )
      ) {
        const mergedAdvancedLabels = mergeGeometryWithOrderedLabels(
          advancedDetectedLayout.tables,
          orderedAdvancedLabels,
        ).map((entry, index) => ({
          ...entry,
          x: advancedDetectedLayout.tables[index]?.x ?? entry.x ?? 0,
          y: advancedDetectedLayout.tables[index]?.y ?? entry.y ?? 0,
        }));
        advancedTables = await recoverChairCountsFromGeometryLayout(
          bytes,
          advancedDetectedLayout,
          mergedAdvancedLabels,
          hints,
          debugContext,
        ).catch((error) => {
          logPlanImport(debugContext, "image.advanced.chair_ocr_failed", serializeImportError(error));
          return mergedAdvancedLabels;
        });
      } else {
        if (orderedAdvancedLabels?.length) {
          logPlanImport(debugContext, "image.advanced.ordered_labels_incomplete", {
            geometryEntryCount: advancedDetectedLayout.tables.length,
            orderedLabelCount: orderedAdvancedLabels.length,
          });
        }

        const advancedAiSupport = await importPlanWithOpenAIFromImage(
          bytes,
          mimeType,
          debugContext,
        ).catch((error) => {
          logPlanImport(debugContext, "image.advanced.openai_failed", serializeImportError(error));
          return null;
        });

        if (advancedAiSupport?.tables.length) {
          const mergedAdvancedTables = mergeExactChairCounts(
            advancedTables,
            advancedAiSupport.tables,
          ).map((entry, index) => ({
            ...entry,
            x: advancedTables[index]?.x ?? entry.x ?? 0,
            y: advancedTables[index]?.y ?? entry.y ?? 0,
          }));
          const advancedCandidates = [advancedTables, mergedAdvancedTables];
          advancedTables = [...advancedCandidates].sort((a, b) => {
            const expectedChairTotal = hints?.expectedChairTotal;
            if (typeof expectedChairTotal !== "number") {
              return 0;
            }

            return (
              Math.abs(getChairTotal(a) - expectedChairTotal) -
              Math.abs(getChairTotal(b) - expectedChairTotal)
            );
          })[0];
        }
      }
    }

    logPlanImport(debugContext, "file.branch.image.completed", {
      strategy: "advanced_paddle_structure_openai",
      entryCount: advancedTables.length,
      advancedMeta: advancedVisionLayout.meta ?? null,
    });

    return entriesToImportedTables(
      applyHintGridLayout(advancedTables, hints),
      existingTableCount,
      hints?.expectedRowCount && hints?.expectedColumnCount
        ? undefined
        : advancedVisionLayout.sourceBounds
        ? {
            ...advancedVisionLayout.sourceBounds,
            preferRegularized: true,
          }
        : undefined,
    );
  }

  const ocrResult = await extractOcrPairsFromBuffer(bytes, debugContext);
  assertImportNotCancelled(debugContext);
  const aiResult = await importPlanWithOpenAIFromImage(bytes, mimeType, debugContext).catch((error) => {
    logPlanImport(debugContext, "image.openai.failed", serializeImportError(error));
    return null;
  });

  if (aiResult?.tables.length && shouldPreferAiLayoutForImage(ocrResult.tables, aiResult.tables)) {
    const aiLabelAlignedTables = mergeAiLayoutWithOrderedLabels(aiResult.tables, ocrResult.tables);
    const aiRecoveredTables = await recoverMesaSillaLabelsFromAiLayout(
      bytes,
      aiLabelAlignedTables,
      aiResult.sourceBounds,
      debugContext,
    );
    logPlanImport(debugContext, "file.branch.image.completed", {
      strategy: "ai_preferred",
      ocrEntryCount: ocrResult.tables.length,
      aiEntryCount: aiResult.tables.length,
      alignedAiEntryCount: aiLabelAlignedTables.length,
      recoveredAiEntryCount: aiRecoveredTables.length,
    });
    return entriesToImportedTables(
      applyHintGridLayout(aiRecoveredTables, hints),
      existingTableCount,
      hints?.expectedRowCount && hints?.expectedColumnCount
        ? undefined
        : aiResult.sourceBounds
        ? {
            ...aiResult.sourceBounds,
            preferRegularized: true,
          }
        : undefined,
    );
  }

  if (ocrResult.tables.length >= 6) {
    const mergedTables = aiResult?.tables.length && shouldUseAiCountsForImage(ocrResult.tables, aiResult.tables)
      ? mergeExactChairCounts(ocrResult.tables, aiResult.tables)
      : ocrResult.tables;
    logPlanImport(debugContext, "file.branch.image.completed", {
      strategy:
        aiResult?.tables.length && shouldUseAiCountsForImage(ocrResult.tables, aiResult.tables)
          ? "ocr_with_ai_counts"
          : "ocr_only",
      entryCount: mergedTables.length,
    });
    return entriesToImportedTables(
      applyHintGridLayout(mergedTables, hints),
      existingTableCount,
      hints?.expectedRowCount && hints?.expectedColumnCount
        ? undefined
        : ocrResult.sourceBounds
        ? {
            ...ocrResult.sourceBounds,
            preferRegularized: true,
          }
        : undefined,
    );
  }

  if (aiResult) {
    logPlanImport(debugContext, "file.branch.image.completed", {
      strategy: "ai_only",
      entryCount: aiResult.tables.length,
    });
    return entriesToImportedTables(
      applyHintGridLayout(aiResult.tables, hints),
      existingTableCount,
      hints?.expectedRowCount && hints?.expectedColumnCount
        ? undefined
        : aiResult.sourceBounds
        ? {
            ...aiResult.sourceBounds,
            preferRegularized: true,
          }
        : undefined,
    );
  }

  logPlanImport(debugContext, "file.branch.image.completed", {
    strategy: "empty",
    entryCount: 0,
  });
  return [];
}
