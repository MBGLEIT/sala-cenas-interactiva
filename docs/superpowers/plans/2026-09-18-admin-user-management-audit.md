# Admin User Management Audit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a collapsed admin user management panel with access requests, all admin users, revoke/restore actions, and action history.

**Architecture:** Store audit records in Supabase through server routes using the existing admin session. Add focused helpers for audit logging and expand the existing admin access API instead of changing reservation/import flows.

**Tech Stack:** Next.js App Router, Supabase service role, React admin dashboard, Zod validation.

---

### Task 1: Database And Audit Helper

**Files:**
- Create: `supabase/migrations/20260918000200_admin_audit_logs.sql`
- Create: `src/lib/admin-audit.ts`

- [ ] Add `admin_audit_logs` with actor id, action, target, details, and timestamp.
- [ ] Add a server helper that writes audit rows and never breaks the main admin action if logging fails.

### Task 2: Admin Users API

**Files:**
- Modify: `src/app/api/admin/access-requests/route.ts`
- Modify: `src/lib/admin-users.ts`
- Modify: `src/lib/schemas.ts`

- [ ] Return both access requests and all admin users.
- [ ] Add review actions `approve`, `reject`, `revoke`, and `restore`.
- [ ] Add audit entries for every review/revoke/restore action.

### Task 3: Admin Action Audit Coverage

**Files:**
- Modify: admin API route files under `src/app/api/admin`.

- [ ] Log successful create/update/delete/upsert actions for events, assistants, mesas, sillas, reservations, and plan imports.
- [ ] Keep the log details compact: ids and action-specific labels only.

### Task 4: Admin Dashboard UI

**Files:**
- Modify: `src/components/admin-dashboard.tsx`

- [ ] Move the current access request section into a closed-by-default `<details>`.
- [ ] Name it `Gestión de usuarios administradores`.
- [ ] Show access requests, all admin users, revoke/restore buttons, and a history viewer per user.

### Task 5: Verification And Delivery

**Files:**
- Verify all changed files.

- [ ] Run lint.
- [ ] Run build.
- [ ] Commit only relevant admin/audit changes.
- [ ] Push `main`.
