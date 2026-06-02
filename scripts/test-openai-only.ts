import { readFileSync } from "node:fs";
import type { PlanImportHints } from "../src/lib/plan-import";

function loadDotEnvLocal() {
  const raw = readFileSync(".env.local", "utf8");
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex <= 0) {
      continue;
    }

    const key = trimmed.slice(0, separatorIndex).trim();
    const value = trimmed.slice(separatorIndex + 1).trim();
    if (!(key in process.env)) {
      process.env[key] = value;
    }
  }
}

async function main() {
  loadDotEnvLocal();

  const imagePath = process.argv[2];
  const hintsArg = process.argv[3];

  if (!imagePath || !hintsArg) {
    throw new Error(
      "Uso: tsx scripts/test-openai-only.ts <imagePath> <jsonHints> | <expectedTables> <expectedRows> <expectedColumns> <expectedChairs>",
    );
  }

  let hints: PlanImportHints;
  if (hintsArg.trim().startsWith("{")) {
    hints = JSON.parse(hintsArg) as PlanImportHints;
  } else {
    hints = {
      expectedTableCount: Number(hintsArg),
      expectedRowCount: Number(process.argv[4]),
      expectedColumnCount: Number(process.argv[5]),
      expectedChairTotal: Number(process.argv[6]),
    };
  }
  const bytes = readFileSync(imagePath);
  const { importTablesFromPlanFile } = await import("../src/lib/plan-import");
  const file = new File([bytes], imagePath.split(/[\\/]/).pop() ?? "plan.png", {
    type: "image/png",
  });

  const result = await importTablesFromPlanFile(file, 0, hints, {
    traceId: `openai-only-${Date.now()}`,
  });

  const chairTotal = result.reduce((sum, table) => sum + table.chairCount, 0);

  console.log(
    JSON.stringify(
      {
        tableCount: result.length,
        chairTotal,
        tables: result.map((table) => ({
          numero: table.numero,
          chairCount: table.chairCount,
        })),
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
