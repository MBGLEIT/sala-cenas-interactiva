# Plan Importer Precision Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Improve the image plan importer so it corrects the remaining `chairCount` mistakes by re-reading only suspicious tables, ranking candidates more intelligently, and using validated examples as soft priors.

**Architecture:** Keep the existing import pipeline intact for the first pass, then add a second backend-only precision layer. This layer will build per-table candidates, score suspicion, selectively re-read doubtful tables, and resolve the final table counts using local OCR evidence plus global consistency and validated-example priors.

**Tech Stack:** Next.js app routes, TypeScript, Supabase admin client, PaddleOCR Python scripts, OpenAI Responses API, existing validated sample index in `.plan-import-feedback`.

---

## File Structure

### Existing files to modify

- `C:\Users\Administrador\Documents\PROYECTO SALA DE CENAS MIGUEL\sala-cenas-interactiva\src\lib\plan-import.ts`
  - Main importer logic
  - Best place for per-table candidate model, suspicion scoring, selective re-read, and final resolution

- `C:\Users\Administrador\Documents\PROYECTO SALA DE CENAS MIGUEL\sala-cenas-interactiva\src\lib\plan-import-feedback.ts`
  - Existing validated-example storage and retrieval
  - Extend to provide position-aware priors for similar plans

- `C:\Users\Administrador\Documents\PROYECTO SALA DE CENAS MIGUEL\sala-cenas-interactiva\src\app\api\admin\mesas\import-plan\route.ts`
  - Keep cancellation and logging compatible
  - Add or adjust trace logs for the new precision phases if needed

### Optional new helper file

- `C:\Users\Administrador\Documents\PROYECTO SALA DE CENAS MIGUEL\sala-cenas-interactiva\src\lib\plan-import-precision.ts`
  - Only create if `plan-import.ts` becomes too large while implementing the candidate-scoring layer
  - Holds focused logic for suspicion scoring and candidate resolution

## Task 1: Add Internal Table Candidate Model

**Files:**
- Modify: `C:\Users\Administrador\Documents\PROYECTO SALA DE CENAS MIGUEL\sala-cenas-interactiva\src\lib\plan-import.ts`

- [ ] **Step 1: Add failing type-level scaffolding expectations**

Define the new internal model near the existing import types:

```ts
type TableChairCandidateSource =
  | "current_selected"
  | "paddle_full"
  | "paddle_bottom_band"
  | "paddle_tight"
  | "paddle_wide"
  | "gpt_ordered"
  | "ocr_fallback"
  | "validated_prior";

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
```

- [ ] **Step 2: Run typecheck via build to confirm the new types integrate cleanly**

Run: `npm.cmd run build`
Expected: PASS or only expected implementation references still missing in this task

- [ ] **Step 3: Add a builder function for the first-pass table candidate objects**

Add a helper that converts current ordered entries into internal candidates:

```ts
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
```

- [ ] **Step 4: Run build again**

Run: `npm.cmd run build`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/plan-import.ts
git commit -m "feat: add internal importer candidate model"
```

## Task 2: Add Validated Example Position Priors

**Files:**
- Modify: `C:\Users\Administrador\Documents\PROYECTO SALA DE CENAS MIGUEL\sala-cenas-interactiva\src\lib\plan-import-feedback.ts`
- Modify: `C:\Users\Administrador\Documents\PROYECTO SALA DE CENAS MIGUEL\sala-cenas-interactiva\src\lib\plan-import.ts`

- [ ] **Step 1: Add a failing helper contract for position-aware priors**

In `plan-import-feedback.ts`, define the shape:

```ts
export type ValidatedPositionPrior = {
  positionIndex: number;
  chairCounts: number[];
  mostCommonChairCount: number | null;
};

export type ValidatedPlanPriors = {
  matchingExampleCount: number;
  priorsByPosition: ValidatedPositionPrior[];
};
```

- [ ] **Step 2: Implement a helper that aggregates priors from similar validated samples**

Add:

```ts
export async function getValidatedPlanPriors(
  hints: Pick<
    PlanImportSampleRecord["hints"],
    "expectedTableCount" | "expectedChairTotal" | "expectedRowCount" | "expectedColumnCount"
  >,
): Promise<ValidatedPlanPriors | null>
```

Implementation notes:
- reuse the same matching logic already used for `getValidatedPlanLearningContext`
- for each matched validated example, sort tables by visual order
- aggregate `chairCount` values per `positionIndex`
- compute `mostCommonChairCount`

- [ ] **Step 3: In `plan-import.ts`, import and use those priors**

Add an internal helper:

```ts
function findValidatedPriorForPosition(
  priors: ValidatedPlanPriors | null | undefined,
  positionIndex: number,
) {
  return priors?.priorsByPosition.find((prior) => prior.positionIndex === positionIndex) ?? null;
}
```

- [ ] **Step 4: Run verification**

Run: `npm.cmd run build`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/plan-import-feedback.ts src/lib/plan-import.ts
git commit -m "feat: add validated example position priors"
```

## Task 3: Suspicion Scoring for First-pass Results

**Files:**
- Modify: `C:\Users\Administrador\Documents\PROYECTO SALA DE CENAS MIGUEL\sala-cenas-interactiva\src\lib\plan-import.ts`

- [ ] **Step 1: Add a failing suspicion scoring helper**

Add:

```ts
function scoreResolutionCandidateSuspicion(
  candidate: TableResolutionCandidate,
  options: {
    expectedChairTotal?: number;
    validatedPriorChairCount?: number | null;
    competingCounts?: number[];
  },
) {
  let score = 0;
  const flags: SuspicionFlag[] = [];

  if (options.competingCounts.some((value) => value !== candidate.selectedChairCount)) {
    score += 2;
    flags.push("source_disagreement");
  }

  if (
    typeof options.validatedPriorChairCount === "number" &&
    options.validatedPriorChairCount !== candidate.selectedChairCount
  ) {
    score += 1;
    flags.push("validated_prior_mismatch");
  }

  return {
    suspicionScore: score,
    suspicionFlags: [...new Set(flags)],
  };
}
```

- [ ] **Step 2: Build a first pass that annotates every table with suspicion**

Add a helper:

```ts
function annotateSuspicionScores(
  candidates: TableResolutionCandidate[],
  validatedPriors: ValidatedPlanPriors | null | undefined,
) {
  return candidates.map((candidate) => {
    const prior = findValidatedPriorForPosition(validatedPriors, candidate.positionIndex);
    const competingCounts = candidate.candidates.map((entry) => entry.chairCount);
    const scored = scoreResolutionCandidateSuspicion(candidate, {
      validatedPriorChairCount: prior?.mostCommonChairCount ?? null,
      competingCounts,
    });

    return {
      ...candidate,
      ...scored,
    };
  });
}
```

- [ ] **Step 3: Log suspicious tables in the trace**

Add a new log point in the chair recovery path:

```ts
logPlanImport(debugContext, "image.chair_ocr.suspicious_tables", {
  total: suspicious.length,
  indices: suspicious.map((entry) => entry.positionIndex),
});
```

- [ ] **Step 4: Run verification**

Run: `npm.cmd run build`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/plan-import.ts
git commit -m "feat: add suspicion scoring for imported tables"
```

## Task 4: Selective Re-read for Suspicious Tables

**Files:**
- Modify: `C:\Users\Administrador\Documents\PROYECTO SALA DE CENAS MIGUEL\sala-cenas-interactiva\src\lib\plan-import.ts`
- Reuse: `C:\Users\Administrador\Documents\PROYECTO SALA DE CENAS MIGUEL\sala-cenas-interactiva\scripts\paddle-plan-ocr.py`

- [ ] **Step 1: Add a helper that prepares extra crop variants only for suspicious tables**

Add:

```ts
function buildSuspiciousChairCropRegions(
  layout: DetectedImageLayout,
  entries: TableResolutionCandidate[],
) {
  return entries
    .filter((entry) => entry.suspicionScore > 0)
    .flatMap((entry) => {
      const centerX = entry.x ?? 0;
      const centerY = entry.y ?? 0;
      return [
        { index: entry.positionIndex, x: centerX - 40, y: centerY - 12, width: 80, height: 40 },
        { index: entry.positionIndex, x: centerX - 52, y: centerY - 20, width: 104, height: 56 },
        { index: entry.positionIndex, x: centerX - 64, y: centerY - 28, width: 128, height: 72 },
      ];
    });
}
```

Adjust numbers to the existing coordinate conventions and clamp later with the same helper used elsewhere.

- [ ] **Step 2: Re-run PaddleOCR only for those suspicious crops**

Inside `recoverChairCountsFromGeometryLayout`, after the first candidate recovery:
- build suspicious crop regions
- call `runPaddlePlanCropOcr` only if at least one suspicious table exists
- merge the returned candidates into the corresponding `TableResolutionCandidate`

- [ ] **Step 3: Add source-specific candidate entries**

For each suspicious-table reread, append candidates like:

```ts
candidate.candidates.push({
  chairCount: resolvedChairCount,
  source: "paddle_bottom_band",
  confidence: 0.82,
  evidence: `reread-index-${candidate.positionIndex}`,
});
```

- [ ] **Step 4: Recompute suspicion scores after reread**

Run the same scoring helper again so tables can become clean if reread resolves the disagreement.

- [ ] **Step 5: Run verification**

Run: `npm.cmd run build`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/lib/plan-import.ts
git commit -m "feat: reread suspicious tables during plan import"
```

## Task 5: Final Candidate Resolver and Swap Correction

**Files:**
- Modify: `C:\Users\Administrador\Documents\PROYECTO SALA DE CENAS MIGUEL\sala-cenas-interactiva\src\lib\plan-import.ts`

- [ ] **Step 1: Add a deterministic per-table candidate selector**

Add:

```ts
function selectBestChairCandidate(
  candidate: TableResolutionCandidate,
  validatedPriorChairCount: number | null,
) {
  return [...candidate.candidates].sort((a, b) => {
    const priorPenaltyA =
      typeof validatedPriorChairCount === "number" ? Math.abs(a.chairCount - validatedPriorChairCount) : 0;
    const priorPenaltyB =
      typeof validatedPriorChairCount === "number" ? Math.abs(b.chairCount - validatedPriorChairCount) : 0;

    const scoreA = a.confidence * 10 - priorPenaltyA;
    const scoreB = b.confidence * 10 - priorPenaltyB;

    return scoreB - scoreA;
  })[0] ?? null;
}
```

- [ ] **Step 2: Add local swap testing for nearby suspicious tables**

Add a helper that tests whether swapping the selected `chairCount` between two nearby suspicious tables improves the match to:
- validated priors
- expected global total
- local source confidence

Suggested skeleton:

```ts
function maybeSwapNeighborCounts(
  candidates: TableResolutionCandidate[],
  validatedPriors: ValidatedPlanPriors | null | undefined,
) {
  const next = [...candidates];
  for (let index = 0; index < next.length - 1; index += 1) {
    const current = next[index];
    const neighbor = next[index + 1];
    if (current.suspicionScore === 0 && neighbor.suspicionScore === 0) {
      continue;
    }

    // compare "keep" vs "swap" against validated priors and confidence
    // only apply if swap wins clearly
  }

  return next;
}
```

- [ ] **Step 3: Integrate final resolution into the geometry and advanced branches**

Where the importer currently normalizes recovered entries, replace that final stage with:
- build resolution candidates
- annotate suspicion
- reread suspicious tables
- resolve best candidates
- maybe apply local swap correction
- convert back to `MesaSillaPair[]`

- [ ] **Step 4: Add trace logs**

Add:

```ts
logPlanImport(debugContext, "image.chair_ocr.final_resolution", {
  suspiciousRemaining: resolved.filter((entry) => entry.suspicionScore > 0).length,
  chairTotal: getChairTotal(resolved),
});
```

- [ ] **Step 5: Run verification**

Run: `npm.cmd run build`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/lib/plan-import.ts
git commit -m "feat: resolve final chair counts with local swap correction"
```

## Task 6: Regression Verification on Known Plans

**Files:**
- Modify if needed after findings: `C:\Users\Administrador\Documents\PROYECTO SALA DE CENAS MIGUEL\sala-cenas-interactiva\src\lib\plan-import.ts`
- Verify: importer routes and logs

- [ ] **Step 1: Run static verification**

Run:

```bash
npm.cmd run lint
npm.cmd run build
```

Expected: both PASS

- [ ] **Step 2: Run manual regression pass on the known plans**

Check these plans through the real importer flow:

- `PLANO NUMERADO PRUEBA1`
- `PLANO NUMERADO PRUEBA2`
- `ChatGPT Image 29 abr 2026, 09_57_28`
- `prueba plano imagen.png`

Expected:
- no regression in already-good plans
- reduced isolated `chairCount` mistakes
- suspicious-table logs appear only where needed

- [ ] **Step 3: Verify cancellation still works during reread path**

Expected:
- cancel during first pass stops import
- cancel during suspicious-table reread stops import
- no residual mesas remain for cancelled sessions

- [ ] **Step 4: Apply only targeted fixes if regressions appear**

If a regression appears:
- fix the exact scorer or reread integration point
- do not rewrite the whole importer in this task

- [ ] **Step 5: Commit**

```bash
git add src/lib/plan-import.ts src/lib/plan-import-feedback.ts
git commit -m "test: verify precision import regression coverage"
```

## Self-Review

### Spec coverage

- candidate scoring: covered by Tasks 1 and 3
- selective reread: covered by Task 4
- validated-example ranking: covered by Task 2
- local swap correction: covered by Task 5
- regression and cancellation safety: covered by Task 6

### Placeholder scan

- no `TODO` / `TBD`
- every task includes exact files and explicit code or commands

### Type consistency

- `TableResolutionCandidate`, `TableChairCandidate`, `ValidatedPlanPriors`, and `ValidatedPositionPrior` are introduced before later tasks depend on them
- all later tasks refer back to those exact names

