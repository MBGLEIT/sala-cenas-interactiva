# Image Plan Importer Rebuild Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the image-only seating-plan importer so it detects table positions from geometry, reads `M:x` and `S:x` per table crop, and uses GPT only as a fallback for ambiguous single-table reads.

**Architecture:** Replace the current plan-wide OCR/vision blend with a deterministic pipeline. First detect the table cloud and table centers from image geometry, then sort those centers into spatial rows/columns, then OCR each table crop individually and reconcile labels against the detected layout. GPT is reserved for rescuing unreadable single-table crops, never for deciding the whole layout.

**Tech Stack:** Next.js route handler, Node.js, `@techstark/opencv-js`, `sharp`, `tesseract.js`, existing OpenAI fallback.

---

### Task 1: Add image-vision dependencies

**Files:**
- Modify: `C:\Users\Administrador\Documents\PROYECTO SALA DE CENAS MIGUEL\sala-cenas-interactiva\package.json`

- [ ] Install `@techstark/opencv-js` and `sharp`
- [ ] Verify `npm.cmd run build` still passes

### Task 2: Isolate image-only pipeline utilities

**Files:**
- Create: `C:\Users\Administrador\Documents\PROYECTO SALA DE CENAS MIGUEL\sala-cenas-interactiva\src\lib\plan-import-image.ts`
- Modify: `C:\Users\Administrador\Documents\PROYECTO SALA DE CENAS MIGUEL\sala-cenas-interactiva\src\lib\plan-import.ts`

- [ ] Move image-specific detection logic into a focused module
- [ ] Split responsibilities into:
  - image preprocessing
  - table cloud detection
  - table center extraction
  - row/column ordering
  - per-table OCR
  - GPT single-table fallback

### Task 3: Implement geometric table detection

**Files:**
- Modify: `C:\Users\Administrador\Documents\PROYECTO SALA DE CENAS MIGUEL\sala-cenas-interactiva\src\lib\plan-import-image.ts`

- [ ] Preprocess image for geometry detection
- [ ] Detect the main seating area and ignore external plan decoration/text
- [ ] Detect repeated table shapes and derive table centers
- [ ] Return stable `x/y` centers and a crop box per detected table

### Task 4: Implement deterministic spatial ordering

**Files:**
- Modify: `C:\Users\Administrador\Documents\PROYECTO SALA DE CENAS MIGUEL\sala-cenas-interactiva\src\lib\plan-import-image.ts`

- [ ] Group detected tables into rows by `y`
- [ ] Sort each row by `x`
- [ ] Preserve the true visual order from the plan instead of renumbering sequentially

### Task 5: Implement per-table OCR and fallback

**Files:**
- Modify: `C:\Users\Administrador\Documents\PROYECTO SALA DE CENAS MIGUEL\sala-cenas-interactiva\src\lib\plan-import-image.ts`

- [ ] OCR each table crop for `M:x` and `S:x`
- [ ] Accept only plausible values
- [ ] If OCR is ambiguous, call GPT on that crop only
- [ ] Reject duplicates and impossible counts before returning results

### Task 6: Wire route and logging

**Files:**
- Modify: `C:\Users\Administrador\Documents\PROYECTO SALA DE CENAS MIGUEL\sala-cenas-interactiva\src\lib\plan-import.ts`
- Modify: `C:\Users\Administrador\Documents\PROYECTO SALA DE CENAS MIGUEL\sala-cenas-interactiva\src\app\api\admin\mesas\import-plan\route.ts`

- [ ] Replace current image branch with the new pipeline
- [ ] Keep trace logging for each phase
- [ ] Return meaningful conflicts/errors instead of broken inserts

### Task 7: Verify against the 42-table sample

**Files:**
- Test with: `C:\Users\Administrador\Downloads\PLANO NUMERADO PRUEBA1.png`

- [ ] Confirm table count is `42`
- [ ] Confirm order matches the real visual order of the plan
- [ ] Confirm chair counts match per table as closely as possible
- [ ] Run `npm.cmd run lint`
- [ ] Run `npm.cmd run build`
