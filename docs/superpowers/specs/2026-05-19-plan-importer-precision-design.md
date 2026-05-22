# Plan Importer Precision Design

## Goal

Reduce the remaining import errors in image-based seating plans, especially the recurring cases where `1-4` tables are misread even though the rest of the plan is imported correctly.

This phase focuses only on backend import accuracy. It does not change the review UI beyond what already exists.

## Current State

The importer already combines:

- geometry-based table detection
- PaddleOCR
- GPT support for ordered label reading
- OpenCV / advanced vision fallback
- validated examples saved from confirmed-good imports

The main remaining failures are:

- isolated `chairCount` mistakes such as `6 -> 8` or `8 -> 10`
- occasional cross-table assignment errors where one table inherits the count that belongs to a nearby table
- weak handling of ambiguous tables despite the rest of the plan being correct

## Success Criteria

The improved importer should:

- keep current successful imports working
- reduce residual mistakes in otherwise-correct plans
- avoid reprocessing the full plan when only a few tables are doubtful
- use validated examples as a real input to ranking decisions
- produce deterministic final choices when multiple candidate counts are available

## Approach Options

### Option 1: Re-read only doubtful tables

After the current first pass, mark suspicious tables and run extra OCR only for those tables using tighter and alternative crops.

Pros:

- directly targets the remaining failures
- low impact on plans that already import well
- easier to debug than a fully global rework

Cons:

- requires a clear suspicion model
- still needs a final resolver when multiple re-read candidates disagree

### Option 2: Stronger all-table consensus

Run multiple OCR and AI passes for every table and always rank all candidates globally.

Pros:

- very robust in theory
- consistent logic for every table

Cons:

- slower
- more expensive
- harder to tune without overfitting

### Option 3: Global pattern correction only

Keep the current first pass and mainly correct outliers afterwards using hints, validated examples, and overall plan consistency.

Pros:

- cheap
- easier to layer on current code

Cons:

- helps after the mistake already happened
- weaker when the local OCR evidence is poor

## Recommended Design

Combine **Option 1** and **Option 3**:

1. keep the current first-pass importer
2. assign a suspicion score per table
3. re-read only suspicious tables with more aggressive crops
4. choose final chair counts using local evidence plus global consistency

## Detailed Design

### 1. Table Candidate Model

For each table position, maintain an internal candidate structure that includes:

- table number
- current `chairCount`
- candidate chair counts from each source
- source labels such as `paddle_full`, `paddle_bottom_band`, `gpt_ordered`, `ocr_fallback`
- lightweight confidence score
- suspicion flags

This model stays backend-only for now.

### 2. Suspicion Detection

A table should be treated as suspicious when one or more of the following happen:

- different sources disagree materially on `chairCount`
- the best source is weak or low-confidence
- the bottom-band OCR conflicts with the full-table OCR
- the chosen count forces an awkward normalization to hit the global chair total
- the result is unusual compared with validated examples that have similar shape and hints
- the table sits near another one with overlapping candidate values that suggest a swap

### 3. Selective Re-read

Only suspicious tables go through extra passes. These passes will generate additional candidates from:

- tighter crop around the inner label
- wider crop including more of the table body
- lower band crop optimized for `S:x`
- higher-contrast and thresholded variants
- optional single-table GPT rescue only when OCR evidence remains inconsistent

This stage should be bounded so it does not explode runtime.

### 4. Candidate Ranking

Each table candidate receives a score built from:

- OCR evidence strength
- agreement between sources
- agreement with validated-example priors
- compatibility with the plan-wide expected chair total
- compatibility with nearby tables and probable swap scenarios

The importer then chooses the best global combination, not just the best local guess.

### 5. Validated Example Support

Validated examples already stored in `.plan-import-feedback/validated` and `validated-index.json` should be used more directly:

- find the closest examples by expected tables, rows, columns, and chair totals
- use their table-position distributions as soft priors
- prefer candidate values that match repeated patterns seen in confirmed-good examples

This is not a full retraining pipeline yet. It is a strong retrieval-and-ranking layer.

### 6. Cross-table Swap Handling

Some current errors look like a nearby table taking the wrong `chairCount`. Add a late correction stage that explicitly tests:

- whether two nearby suspicious tables fit better if their selected counts are swapped
- whether a table count is more plausible in a neighboring slot

This should be limited to local neighborhoods so the logic stays explainable.

## Error Handling

- If selective re-read still leaves unresolved ambiguity, keep the best deterministic result rather than randomizing.
- If cancellation is requested during the new re-read stage, it must stop through the same cancellation pipeline already in place.
- If no improved candidate is found, fall back to the first-pass result rather than dropping the table.

## Testing Strategy

Use the existing validated plans as regression fixtures:

- `PLANO NUMERADO PRUEBA1`
- `PLANO NUMERADO PRUEBA2`
- `ChatGPT Image 29 abr 2026, 09_57_28`
- the small `6 mesas / 34 sillas` plan

Add focused checks for:

- isolated `6/8/10` ambiguity cases
- swap-like failures between nearby tables
- plans that already import perfectly and must remain stable
- cancellation during the selective re-read path

## Scope Boundaries

Included now:

- backend-only candidate scoring
- suspicious-table re-read
- validated-example ranking support
- local swap correction

Not included in this phase:

- new review UI indicators
- manual table editing tools
- full retraining of a separate OCR model
- background training jobs

## Recommendation

Implement this in phases:

1. internal candidate model and suspicion scoring
2. selective re-read for suspicious tables
3. validated-example ranking integration
4. local swap correction
5. regression verification on the known plans
