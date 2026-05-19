const fs = require("node:fs/promises");
const sharp = require("sharp");
const cvReady = require("@techstark/opencv-js");

function groupRows(entries) {
  const sorted = [...entries].sort((a, b) => (Math.abs(a.y - b.y) < 18 ? a.x - b.x : a.y - b.y));
  const rows = [];

  for (const entry of sorted) {
    const currentRow = rows[rows.length - 1];
    if (!currentRow) {
      rows.push([entry]);
      continue;
    }

    const averageY = currentRow.reduce((sum, rowEntry) => sum + rowEntry.y, 0) / currentRow.length;
    if (Math.abs(entry.y - averageY) <= 28) {
      currentRow.push(entry);
      continue;
    }

    rows.push([entry]);
  }

  return rows.map((row) => row.sort((a, b) => a.x - b.x));
}

function nearestNeighborDistance(entries) {
  if (entries.length < 2) {
    return 0;
  }

  const distances = entries
    .map((entry, index) => {
      let best = Number.POSITIVE_INFINITY;
      for (let candidateIndex = 0; candidateIndex < entries.length; candidateIndex += 1) {
        if (candidateIndex === index) {
          continue;
        }

        const candidate = entries[candidateIndex];
        const distance = Math.hypot(candidate.x - entry.x, candidate.y - entry.y);
        if (distance < best) {
          best = distance;
        }
      }
      return best;
    })
    .filter((value) => Number.isFinite(value) && value > 0)
    .sort((a, b) => a - b);

  if (distances.length === 0) {
    return 0;
  }

  const middle = Math.floor(distances.length / 2);
  return distances.length % 2 === 0
    ? (distances[middle - 1] + distances[middle]) / 2
    : distances[middle];
}

async function main() {
  const imagePath = process.argv[2];
  if (!imagePath) {
    throw new Error("Missing image path");
  }

  console.error("stage:read");
  const imageBuffer = await fs.readFile(imagePath);
  console.error("stage:metadata");
  const metadata = await sharp(imageBuffer).metadata();
  const originalWidth = metadata.width ?? 0;
  const originalHeight = metadata.height ?? 0;
  const resizedWidth = Math.min(1400, Math.max(1, originalWidth || 1400));
  console.error("stage:prepare-image");
  const { data, info } = await sharp(imageBuffer)
    .resize({ width: resizedWidth })
    .greyscale()
    .threshold(210)
    .raw()
    .toBuffer({ resolveWithObject: true });

  console.error("stage:await-cv");
  const cv = await new Promise((resolve, reject) => {
    const candidate = cvReady.default ?? cvReady;
    if (candidate && typeof candidate.then === "function") {
      try {
        candidate.then((resolved) => resolve(resolved));
      } catch (error) {
        reject(error);
      }
      return;
    }

    if (candidate) {
      resolve(candidate);
      return;
    }

    reject(new Error("OpenCV module could not be initialized"));
  });
  console.error("stage:cv-ready");
  const mat = cv.matFromArray(info.height, info.width, cv.CV_8UC1, Array.from(data));
  const contours = new cv.MatVector();
  const hierarchy = new cv.Mat();

  try {
    console.error("stage:find-contours");
    cv.findContours(mat, contours, hierarchy, cv.RETR_LIST, cv.CHAIN_APPROX_SIMPLE);
    console.error("stage:contours-done");

    const candidates = [];
    for (let index = 0; index < contours.size(); index += 1) {
      const contour = contours.get(index);
      const area = cv.contourArea(contour);
      const rect = cv.boundingRect(contour);
      contour.delete();

      const ratio = rect.width / Math.max(1, rect.height);
      if (area < 1500 || area > 8000 || ratio < 0.75 || ratio > 1.3) {
        continue;
      }

      candidates.push({
        x: rect.x + rect.width / 2,
        y: rect.y + rect.height / 2,
        area,
      });
    }

    candidates.sort((a, b) => b.area - a.area);
    const deduped = [];
    for (const candidate of candidates) {
      const duplicate = deduped.some((existing) => Math.hypot(existing.x - candidate.x, existing.y - candidate.y) < 25);
      if (!duplicate) {
        deduped.push(candidate);
      }
    }

    const rows = groupRows(deduped).filter((row) => row.length >= 3);
    const flattened = rows.flat();
    const scaleX = originalWidth / Math.max(1, info.width);
    const scaleY = originalHeight / Math.max(1, info.height);
    const nearestDistance = nearestNeighborDistance(flattened) * ((scaleX + scaleY) / 2);

    console.error("stage:write-json");
    process.stdout.write(
      JSON.stringify({
        rawCandidates: candidates.length,
        dedupedCandidates: deduped.length,
        rowLengths: rows.map((row) => row.length),
        tables: flattened.map((entry, index) => ({
          numero: index + 1,
          chairCount: 8,
          x: Math.round(entry.x * scaleX),
          y: Math.round(entry.y * scaleY),
        })),
        sourceBounds: {
          width: originalWidth,
          height: originalHeight,
        },
        nearestDistance,
      }),
    );
    console.error("stage:exit");
    process.exit(0);
  } finally {
    mat.delete();
    contours.delete();
    hierarchy.delete();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exit(1);
});
