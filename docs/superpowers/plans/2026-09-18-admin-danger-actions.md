# Admin Danger Actions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add admin controls to permanently delete admin users and force 2FA reconfiguration.

**Architecture:** Extend the existing admin user management API with two protected actions and add matching buttons in the admin user list. Keep audit logs when deleting users by relying on `on delete set null`.

**Tech Stack:** Next.js App Router, Supabase service role, React admin dashboard, Zod validation.

---

### Task 1: API Actions

**Files:**
- Modify: `src/lib/schemas.ts`
- Modify: `src/app/api/admin/access-requests/route.ts`

- [ ] Add `delete` and `reset_2fa` to accepted admin user actions.
- [ ] Block self-delete.
- [ ] For `reset_2fa`, set status `approved`, `totp_enabled=false`, and `totp_secret=null`.
- [ ] For `delete`, log first and then delete the admin user.

### Task 2: Admin UI

**Files:**
- Modify: `src/components/admin-dashboard.tsx`

- [ ] Add `Reactivar 2FA` button for each admin user.
- [ ] Add `Eliminar definitivamente` button for each admin user.
- [ ] Use existing realtime refresh after successful actions.

### Task 3: Verification

**Files:**
- Verify changed files.

- [ ] Run lint.
- [ ] Run build.
- [ ] Commit and push.
