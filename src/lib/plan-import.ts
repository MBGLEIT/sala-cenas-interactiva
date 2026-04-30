import "server-only";

import path from "node:path";

import { Jimp } from "jimp";

import {
  ROOM_LAYOUT_HEIGHT,
  ROOM_LAYOUT_WIDTH,
  getNextMesaPosition,
  getTableDimensions,
} from "@/lib/room-layout";

export type ImportedPlanTable = {
  numero: number;
  chairCount: number;
  posX: number;
  posY: number;
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

type ImportSourceBounds = {
  width: number;
  height: number;
  minX?: number;
  minY?: number;
  maxX?: number;
  maxY?: number;
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

type OcrVariant = {
  label: string;
  buffer: Buffer;
  width: number;
  height: number;
};

function normalizeText(text: string) {
  return text
    .replace(/\u0000/g, " ")
    .replace(/\r/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{2,}/g, "\n")
    .trim();
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

function lerp(start: number, end: number, amount: number) {
  return start + (end - start) * amount;
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

function entriesToImportedTables(
  entries: MesaSillaPair[],
  existingTableCount: number,
  sourceBounds?: ImportSourceBounds,
) {
  const regularizedEntries = sourceBounds
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

function parseHocrTokens(hocr: string) {
  const tokens: OcrToken[] = [];
  const wordRegex = /<span class='ocrx_word'[^>]*title='([^']+)'[^>]*>(.*?)<\/span>/g;

  for (const match of hocr.matchAll(wordRegex)) {
    const title = match[1];
    const rawText = match[2].replace(/<[^>]+>/g, "").trim();

    if (!rawText) {
      continue;
    }

    const parsed = parseMesaOrSillaToken(rawText);
    if (!parsed) {
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

    tokens.push({
      kind: parsed.kind,
      value: parsed.value,
      x: x0,
      y: y0,
      width: Math.max(1, x1 - x0),
      height: Math.max(1, y1 - y0),
      confidence,
    });
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

async function createOcrVariants(buffer: Buffer) {
  const baseImage = await Jimp.read(buffer);
  const variants: OcrVariant[] = [];

  const gray2x = baseImage.clone().greyscale().contrast(0.6).scale(2);
  variants.push({
    label: "gray2x",
    buffer: await gray2x.getBuffer("image/png"),
    width: gray2x.bitmap.width,
    height: gray2x.bitmap.height,
  });

  const gray3x = baseImage.clone().greyscale().contrast(0.75).normalize().scale(3);
  variants.push({
    label: "gray3x",
    buffer: await gray3x.getBuffer("image/png"),
    width: gray3x.bitmap.width,
    height: gray3x.bitmap.height,
  });

  const threshold3x = baseImage
    .clone()
    .greyscale()
    .contrast(1)
    .normalize()
    .scale(3)
    .threshold({ max: 180 });
  variants.push({
    label: "threshold3x",
    buffer: await threshold3x.getBuffer("image/png"),
    width: threshold3x.bitmap.width,
    height: threshold3x.bitmap.height,
  });

  return variants;
}

async function extractOcrPairsFromBuffer(buffer: Buffer) {
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
    corePath: path.resolve(process.cwd(), "node_modules", "tesseract.js-core"),
    logger: () => {},
  });

  try {
    await worker.setParameters({
      tessedit_pageseg_mode: tesseract.PSM.SPARSE_TEXT,
      preserve_interword_spaces: "1",
      user_defined_dpi: "300",
    });

    const variants = await createOcrVariants(buffer);
    let bestResult: {
      pairs: MesaSillaPair[];
      width: number;
      height: number;
      score: number;
    } | null = null;
    let bestTextFallback: MesaSillaPair[] = [];

    for (const variant of variants) {
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
        pairs.reduce((sum, pair) => sum + pair.chairCount, 0) +
        tokens.reduce((sum, token) => sum + token.confidence, 0) * 0.01;

      if (textFallback.length > bestTextFallback.length) {
        bestTextFallback = textFallback;
      }

      if (!bestResult || score > bestResult.score) {
        bestResult = {
          pairs,
          width: variant.width,
          height: variant.height,
          score,
        };
      }
    }

    if (!bestResult) {
      return {
        tables: [] as MesaSillaPair[],
        sourceBounds: null as { width: number; height: number } | null,
      };
    }

    return {
      tables: bestResult.pairs.length > 0 ? bestResult.pairs : bestTextFallback,
      sourceBounds:
        bestResult.pairs.length > 0
          ? {
              width: bestResult.width,
              height: bestResult.height,
              ...(getContentBounds(bestResult.pairs) ?? {}),
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

async function parsePdfFile(buffer: Buffer) {
  const rawTextFallback = parseGenericMesaSillaText(buffer.toString("utf8"));
  const pdfModule = await import("pdf-parse");
  const { PDFParse } = pdfModule;
  const parser = new PDFParse({ data: new Uint8Array(buffer) });

  try {
    let textEntries = rawTextFallback;

    try {
      const textResult = await parser.getText();
      const parsedTextEntries = parseGenericMesaSillaText(textResult.text ?? "");
      if (parsedTextEntries.length > 0) {
        textEntries = parsedTextEntries;
      }
    } catch {
      textEntries = rawTextFallback;
    }

    try {
      const digitalSpatialEntries = await parseDigitalPdfSpatialEntries(buffer);
      const digitalSpatialPairs = parseSpatialMesaSillaEntries(digitalSpatialEntries);
      const mergedDigitalPairs = mergeExactChairCounts(digitalSpatialPairs, textEntries);

      if (mergedDigitalPairs.length > 0) {
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
    } catch {
      // Si el PDF digital no nos da coordenadas utiles, seguimos con OCR o texto.
    }

    if (textEntries.length > 0) {
      return {
        tables: assignOrderedFallbackPositions(textEntries),
        sourceBounds: null,
      };
    }

    const screenshotScales = [1.8, 2.4, 3];
    let bestOcrResult:
      | {
          tables: MesaSillaPair[];
          sourceBounds: { width: number; height: number } | null;
        }
      | null = null;

    for (const scale of screenshotScales) {
      try {
        const screenshotResult = await parser.getScreenshot({
          first: 1,
          scale,
          imageBuffer: true,
          imageDataUrl: false,
        });

        const firstPage = screenshotResult.pages[0];
        if (!firstPage?.data?.length) {
          continue;
        }

        const ocrResult = await extractOcrPairsFromBuffer(Buffer.from(firstPage.data));

        if (
          !bestOcrResult ||
          ocrResult.tables.length > bestOcrResult.tables.length
        ) {
          bestOcrResult = ocrResult;
        }
      } catch {
        // Probamos la siguiente escala sin romper toda la importacion.
      }
    }

    if (bestOcrResult && bestOcrResult.tables.length > 0) {
      const mergedPairs = mergeExactChairCounts(bestOcrResult.tables, textEntries);

      if (mergedPairs.length > 0) {
        return {
          tables: mergedPairs,
          sourceBounds: bestOcrResult.sourceBounds,
        };
      }
    }

    return {
      tables: assignOrderedFallbackPositions(textEntries),
      sourceBounds: null,
    };
  } finally {
    await parser.destroy();
  }
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
) {
  const bytes = Buffer.from(await file.arrayBuffer());
  const lowercaseName = file.name.toLowerCase();
  const mimeType = file.type.toLowerCase();

  if (mimeType.includes("json") || lowercaseName.endsWith(".json")) {
    const text = await parseTextLikeFile(bytes);
    const entries = parseJsonEntries(text);
    return entriesToImportedTables(entries, existingTableCount);
  }

  if (
    mimeType.includes("spreadsheet") ||
    mimeType.includes("csv") ||
    lowercaseName.endsWith(".xlsx") ||
    lowercaseName.endsWith(".xls") ||
    lowercaseName.endsWith(".csv")
  ) {
    const result = await parseSpreadsheetFile(bytes);
    return entriesToImportedTables(result, existingTableCount);
  }

  if (
    mimeType.includes("wordprocessingml") ||
    lowercaseName.endsWith(".docx")
  ) {
    const text = await parseDocxFile(bytes);
    const entries = parseGenericMesaSillaText(text);
    return entriesToImportedTables(entries, existingTableCount);
  }

  if (mimeType.includes("pdf") || lowercaseName.endsWith(".pdf")) {
    const result = await parsePdfFile(bytes);
    return entriesToImportedTables(
      result.tables,
      existingTableCount,
      result.sourceBounds ?? undefined,
    );
  }

  if (mimeType.startsWith("image/")) {
    const ocrTables = await runImageOcr(bytes);
    return ocrTables;
  }

  const text = await parseTextLikeFile(bytes);
  const entries = parseGenericMesaSillaText(text);
  return entriesToImportedTables(entries, existingTableCount);
}
