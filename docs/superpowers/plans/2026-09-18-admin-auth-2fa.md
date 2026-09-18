# Admin Auth 2FA Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the shared admin password with admin accounts, pending registration approval, and mandatory authenticator-app 2FA.

**Architecture:** Admin users live in Supabase and all admin-only operations continue through server routes. Passwords use server-side scrypt hashes, 2FA uses TOTP secrets, and admin sessions are signed cookies with the user id.

**Tech Stack:** Next.js App Router, Supabase service role, Node crypto, React client forms, Zod validation.

---

### Task 1: Database And Auth Primitives

**Files:**
- Create: `supabase/migrations/20260918000100_admin_users.sql`
- Create: `src/lib/admin-password.ts`
- Create: `src/lib/admin-totp.ts`
- Modify: `src/lib/admin-auth.ts`
- Modify: `src/lib/schemas.ts`

- [ ] Add `admin_users` with statuses `pending`, `approved`, `active`, `rejected`, `disabled`.
- [ ] Add password hashing and verification helpers using `scrypt`.
- [ ] Add TOTP secret generation and code verification helpers.
- [ ] Replace the old shared-password cookie with signed session/challenge tokens.
- [ ] Add schemas for register, login, 2FA setup/verify, and request review.

### Task 2: API Routes

**Files:**
- Modify: `src/app/api/admin/login/route.ts`
- Create: `src/app/api/admin/register/route.ts`
- Create: `src/app/api/admin/2fa/setup/route.ts`
- Create: `src/app/api/admin/2fa/verify/route.ts`
- Create: `src/app/api/admin/access-requests/route.ts`

- [ ] Login validates email/password and returns either 2FA setup, 2FA challenge, pending/rejected state, or an error.
- [ ] Registration creates a pending admin request.
- [ ] 2FA setup verifies the first authenticator code, activates the user, and opens the admin session.
- [ ] 2FA verify opens the admin session for active users.
- [ ] Access request route lists pending users and lets any active admin approve or reject them.

### Task 3: Admin UI

**Files:**
- Modify: `src/components/admin-login-form.tsx`
- Modify: `src/components/admin-dashboard.tsx`

- [ ] Replace password-only form with login, registration, 2FA setup, and 2FA verification states.
- [ ] Add a compact admin access request section inside the admin dashboard.
- [ ] Keep the rest of the admin panel behavior unchanged.

### Task 4: Initial Admin Script

**Files:**
- Create: `scripts/create-initial-admin.ts`
- Modify: `package.json`

- [ ] Add a script to create the first approved admin from command-line arguments.
- [ ] Print the exact command usage when arguments are missing.

### Task 5: Verification And Delivery

**Files:**
- Verify all changed files.

- [ ] Run lint.
- [ ] Run build.
- [ ] Commit only the admin-auth app changes, excluding portable worker files.
- [ ] Push `main` when verification passes.
