# PRD: Shiftora — Shift Scheduling and Attendance SaaS

> Product name: **Shiftora**
> Owner: Pratham · Status: Draft v0.2 · Last updated: 2026-11-03
> Source: `PROJECT_NOTES.md` (idea #14, chosen direction)

---

## 1. Summary

A multi-tenant SaaS that lets small businesses (clinics first) build weekly shift schedules,
notify staff over WhatsApp, track attendance with geofenced / QR clock-in, and export
payroll-ready timesheets. It is priced flat per location rather than per user.

The project has two goals:
1. **Product goal:** get real paying users (5 paying pilots beat 1,000 signups).
2. **Career goal:** a backend-heavy, production-grade system that demonstrates SDE-2 level
   topics (multi-tenancy, concurrency, time zones, queues, constraint solving, audit) and
   continues the HRM domain story from my current job.

## 2. Problem

Clinics, restaurants, salons, retail shops and gyms plan shifts in WhatsApp groups, Excel or
on paper. Pain points:

| Pain | Today | Consequence |
|---|---|---|
| Availability and role coverage | Manager juggles messages and a spreadsheet | Hours per week spent on scheduling, coverage gaps |
| Last-minute sick calls | Phone calls / group messages | Shifts left unfilled |
| Buddy punching | Paper register or none | Paid hours that were never worked |
| Overtime and payroll | Manual calculation | Errors, disputes, wasted admin time |
| Labour-law compliance | Not tracked | Max-hours and rest-period violations |
| Clinical credentials (clinic-specific) | Not tracked | Staff working with expired licences |

## 3. Target users and positioning

**Positioning:** *Clinics first, WhatsApp-first, flat price per location.* Do not build
"Deputy but cheaper"; stay niche.

**Competitors:** Deputy, When I Work, Homebase, 7shifts, Sling, Connecteam. Mostly
US/EU-focused, per-user pricing, expensive for small teams.

### Personas

| Persona | Description | Primary jobs |
|---|---|---|
| **Owner / Admin** | Clinic owner or practice manager, 1–3 locations | Set up org, pay rules, view labour cost, export payroll |
| **Manager / Scheduler** | Builds the weekly rota | Build and publish schedule, approve swaps, fill gaps, fix timesheets |
| **Employee** | Nurse, receptionist, doctor, assistant; mobile-only, uses WhatsApp | See schedule, clock in/out, request swap/drop, pick up open shifts |
| **Front-desk tablet** | Shared device at a location | Show rotating QR code for clock-in |

## 4. Goals and success metrics

| Metric | Target by end of week 8 | Target by month 6 |
|---|---|---|
| Pilot businesses onboarded | 3–5 | 40+ |
| Paying customers | 1 | 10+ |
| Active employees on platform | 50 | 1,000+ |
| Schedule creation time (manager) | < 30 min/week | ~5 min with auto-scheduler |
| Notification delivery success | ≥ 99% | ≥ 99.9% |
| Clock-in p95 latency (API) | < 300 ms | < 200 ms |
| Cross-tenant data leaks | 0 (enforced by RLS + tests) | 0 |

Career-side deliverables: live demo with "Try as demo clinic", case-study README, 1–2
engineering blog posts, 3 resume bullets backed by real numbers.

## 5. Scope

### 5.1 MVP features (weeks 1–6)

| # | Feature | Key requirements / acceptance criteria |
|---|---|---|
| F1 | **Multi-tenant orgs, multi-location from day one**, with departments and roles | Signup creates an org; owner invites users by email/phone; every row belongs to exactly one org; RLS blocks cross-org reads even if the app forgets a filter (covered by automated test). An org has **1..N locations**, each with lat/lng, geofence radius and its own IANA time zone. Managers can be scoped to specific locations; employees can be assigned to several locations; a location switcher is in the UI from the start. Max-hours, overlap and overtime checks count an employee's hours **across all locations** in the org. |
| F2 | **Employee profiles** | Roles/skills (many-to-many), hourly rate, max weekly hours, recurring weekly availability + date-specific unavailability, contact channel preference. |
| F3 | **Drag-and-drop weekly schedule builder** | Week view per location, rows by employee or by role; create shifts from templates; drag to move/assign; warnings for availability conflicts, overlap, max-hours and min-rest violations; schedule is `draft` until **Publish**, which notifies affected employees. Edits after publish notify only changed employees. Live updates for other managers viewing the board. |
| F4 | **Geofenced clock in/out (PWA)** | Employee taps Clock In; browser location checked server-side against location radius; outside the geofence → rejected or flagged (configurable). Location captured only at clock-in/out. Early/late tolerance configurable. |
| F5 | **Shift swap and drop requests** | Employee requests swap (with a named colleague) or drop; colleague accepts (for swaps); manager approves/rejects; validation re-runs on approval (role, overlap, hours). |
| F6 | **Timesheets + payroll export** | Time entries roll up into timesheets per pay period; manager can edit with a required reason (audited); overtime computed; export CSV/XLSX per pay period. |
| F7 | **Notifications** | Channels: email (all plans), web push (all plans), WhatsApp via **Meta WhatsApp Cloud API** and SMS (Pro). Events: schedule published, shift changed, swap request/approval, shift reminder (e.g. 2 h before), missed clock-in. Delivery status tracked per message. |

### 5.2 Advanced features (weeks 5–8 and after) — the resume weight

| # | Feature | Key requirements |
|---|---|---|
| A1 | **Auto-scheduler** (TypeScript heuristic first; OR-Tools CP-SAT later) | Given coverage requirements and employees, generate a draft schedule. Hard constraints: role coverage, availability, no overlap, max weekly hours, min rest between shifts, valid credentials. Soft: fairness (even hours/weekends/nights), employee preferences, labour cost. Output is an editable draft with an explanation of unfilled slots. |
| A2 | **Open-shift marketplace** | Manager posts open shift; eligible employees notified; first valid accept wins; exactly one winner under concurrent accepts; retries are idempotent. |
| A3 | **Anti-fraud attendance** | Geofence + rotating QR on a front-desk tablet (code changes every 30 s) + optional selfie. Suspicious entries flagged (outside geofence, device-time skew, reused QR, impossible travel). |
| A4 | **Per-tenant pay rules engine** | Rules stored as data: daily/weekly overtime thresholds and multipliers, night premium windows, weekend/holiday premium, automatic break deduction. Versioned so old pay periods recalculate with the rules in force at the time. |
| A5 | **Credential / licence expiry alerts** | Credential type, number, expiry date; alerts at 60/30/7 days; scheduler blocks assigning roles requiring an expired credential. |
| A6 | **Labour-cost forecasting vs budget** | Projected cost of a draft/published schedule (incl. overtime and premiums) vs weekly budget per location. |
| A7 | **Offline clock-in** | PWA queues clock events offline; syncs when online; server deduplicates and reconciles; tampering heuristics flag entries. |
| A8 | **Immutable audit log** | Append-only record of who changed what (before/after) for schedules, timesheets, pay rules, permissions. Viewable by owners. |

### 5.3 Non-goals (for now)

- Full payroll processing, tax calculation or salary payouts (export only).
- Native iOS/Android apps in the MVP (PWA first). A native app (React Native, sharing
  `packages/shared` and `packages/domain`) is a **future enhancement**, triggered by pilot
  needs such as reliable iOS push or background location.
- Generic HRIS (leave management, appraisals, documents) beyond what scheduling needs.
- Enterprise SSO/SAML, multi-country labour-law packs.
- Microservices. This is a modular monolith by design.

## 6. Key user flows

1. **Onboarding:** owner signs up → creates org + first location (map pin, radius, time zone)
   → adds roles → imports employees (CSV or one by one) → invites them via WhatsApp/email link.
2. **Weekly scheduling:** manager opens next week → applies templates or runs auto-scheduler →
   adjusts via drag-and-drop → resolves warnings → publishes → employees get WhatsApp link.
3. **Attendance:** employee arrives → opens PWA → scans tablet QR or taps clock-in (GPS) →
   entry recorded → clocks out → timesheet updated.
4. **Swap:** employee requests swap → colleague accepts → manager approves → both notified,
   schedule updated, audit event written.
5. **Open shift:** sick call → manager marks shift open → eligible staff notified → first to
   accept gets it → others see "already taken".
6. **Payroll:** end of pay period → manager reviews flagged entries → approves timesheets →
   exports CSV/XLSX.

## 7. Plans and pricing

| Plan | Monthly price | Employees | Includes |
|---|---|---|---|
| Free | ₹0 | Up to 10 | 1 location, email + push notifications, schedule builder, clock-in, timesheets |
| Pro | ₹999 | Unlimited | 1 location, WhatsApp/SMS, auto-scheduler, pay rules engine, payroll exports, credential alerts |
| Additional location | ₹999 per location | Unlimited | Each extra location on Pro |

Example: a clinic group with 3 locations pays ₹999 + 2 × ₹999 = ₹2,997/month, regardless of headcount.

Plan limits are enforced server-side (employee count on Free, number of active locations =
1 + paid add-on locations on Pro). Downgrades never delete data; they make extra locations
read-only until paid.

### 7.1 Billing (INR)
- All prices in **Indian Rupees**, billed monthly through **Razorpay Subscriptions**
  (cards, UPI AutoPay, netbanking). No annual plan for now; discounts are handled with coupons.
- **GST:** listed prices are **exclusive of 18% GST** (GST added on top), so Pro = ₹999 + ₹179.82 GST = ₹1,178.82;
  each additional location = ₹999 + ₹179.82 GST. Pricing page and checkout show "+ GST".
  - Customers can enter a GSTIN and legal name at checkout (B2B input tax credit).
  - Shiftora generates its own **GST tax invoice** (PDF + email) for every successful payment: sequential invoice
    number per financial year (e.g. `SHF/2026-27/000123`), seller GSTIN, buyer GSTIN if given,
    place of supply, SAC code, taxable value, CGST + SGST (same state) or IGST (other state).
  - Exact SAC code, invoice format and GST registration are deferred until development is
    done; they need a CA's sign-off before taking real payments (build with configurable values).
- Failed payments: Razorpay retries; 7-day grace period, then extra locations go read-only and
  the org falls back to Free limits (no data deleted).

### 7.2 Coupon codes
Platform admins (the Shiftora team, not customer owners) manage coupons from an internal admin page.

| Field | Options |
|---|---|
| Code | Custom (e.g. `CLINIC50`) or **auto-generated random** (e.g. `SHF-7KQ2-M9XD`), single or bulk (generate N unique codes) |
| Discount | Percentage (1–100%) or fixed amount (₹) |
| Applies to | Pro base plan, additional locations, or both |
| Duration | Once (first invoice), repeating for N months, or forever |
| Limits | Valid from/to dates, max total redemptions, one redemption per org, first-time customers only (optional) |
| Status | Active / paused / expired; usage count and redeemed orgs visible |

Rules: one coupon per subscription at a time; discount is applied before GST; the invoice shows the
coupon code and discount line; redemption is race-safe (max redemptions never exceeded).

### 7.3 Messaging quotas (Pro)
WhatsApp sends cost Shiftora money per message (Meta's India utility rates are roughly ₹0.12–0.15 per
message; check Meta's current rate card before launch). Typical use is about 30 messages per employee per month
(publish/changes, open shifts, swaps, reminders), so a 25-person clinic sends about 750.

| Item | Included per paid location per month |
|---|---|
| WhatsApp messages | **1,000** (about ₹150 max cost, ~15% of ₹999) |
| SMS | **200** (fallback only, e.g. employee without WhatsApp) |
| Email + web push | Unlimited |

- Quotas pool across the org's paid locations (3 locations = 3,000 WhatsApp messages).
- Owner is warned at 80% and 100%. Over quota, messages **automatically fall back to push + email**
  (no surprise overage charges in v1; paid top-ups can come later).
- To save quota, shift reminders default to push; WhatsApp is used for publish/changes, open shifts and swaps.
- Free plan: no WhatsApp/SMS, only email + push.

## 8. Go-to-market and traffic

1. Free SEO tools: shift schedule template generator, overtime calculator, nurse rota templates.
2. Free plan up to 10 employees.
3. Viral loop: every employee receives the schedule via a WhatsApp link (branded, with signup CTA).
4. In-person outreach to 10 local clinics/restaurants; convert 3–5 into pilots.
5. Build in public on X/LinkedIn; launch on Product Hunt and Indie Hackers.

## 9. Non-functional requirements

| Area | Requirement |
|---|---|
| Security | Tenant isolation via Postgres RLS; RBAC (owner, manager, employee, kiosk); passwords hashed with argon2; secrets never in repo. |
| Privacy | Location captured only at clock-in/out; selfie optional and per-org opt-in; retention policy documented; privacy policy states it. |
| Time | All instants stored in UTC; each location has an IANA zone; overnight and DST shifts handled correctly (tested). |
| Reliability | Notifications retried with backoff; DLQ for permanent failures; outbox pattern so no event is lost on crash. |
| Performance | Schedule board for 100 employees × 7 days loads < 1 s; clock-in p95 < 300 ms. |
| Observability | OpenTelemetry traces, structured JSON logs, Grafana dashboards for API latency, queue depth, delivery success. |
| Accessibility | Employee PWA usable on low-end Android over 3G; WCAG AA for core flows. |

## 10. Risks and mitigations

| Risk | Mitigation |
|---|---|
| Crowded market at the generic level | Stay niche: clinics, WhatsApp-first, flat pricing, credential tracking |
| WhatsApp/SMS costs (Meta charges per conversation) | Email/push on free tier; WhatsApp/SMS only on Pro; per-org monthly quotas; prefer utility templates |
| Location data is personal data | Collect only at clock events; explicit consent; documented retention |
| Slow small-business sales | In-person outreach and pilots before scaling marketing |
| Scope creep / burnout (part-time) | Strict weekly goals; advanced features only after MVP is live |
| Project goes stale | Weekly commits, public changelog, monthly build-in-public post |

## 11. Milestones and day-by-day plan (part-time, 8 weeks)

Assumes ~6 working sessions per week (weekday evenings ~2 h, Saturday ~5 h). Sunday is
buffer/review: update changelog, write a build-in-public post, plan next week.

### Week 1 — Foundations: auth, multi-tenancy (RLS), orgs, locations, roles, employees
| Day | Tasks |
|---|---|
| D1 | Monorepo setup (pnpm + Turborepo), TS config, ESLint/Prettier, Docker Compose (Postgres, Redis), CI skeleton |
| D2 | NestJS API skeleton, config module, health check, Drizzle setup, first migration |
| D3 | Auth (identity): users + sessions, signup/login/refresh/logout/me, argon2id, JWT access + rotating refresh tokens with reuse detection, default-deny auth guard, RFC 7807 errors, rate limits ✅ |
| D4 | Org/membership tables, RBAC guard, RLS policies + `app.org_id` per-request transaction context, invites (moved from D3: they need orgs) |
| D5 | Multi-location: locations (geo, radius, timezone), manager location scopes, departments, roles CRUD; cross-tenant isolation tests + manager-cannot-see-other-location tests |
| D6 | Employees CRUD + roles + availability + location assignments; React app shell (Vite, router, auth pages, org setup wizard, location switcher) |

### Week 2 — Schedule builder, shifts, publish flow
| Day | Tasks |
|---|---|
| D1 | Schedule + Shift + ShiftTemplate schema; week boundaries in location timezone |
| D2 | Shift CRUD API with validation (overlap, availability, max hours, min rest) as pure functions + unit tests |
| D3 | Week board UI (rows by employee), shift create/edit modal |
| D4 | Drag-and-drop (dnd-kit) with optimistic updates and conflict warnings |
| D5 | Publish flow: draft → published, diff of changed shifts, `schedule.published` domain event via outbox |
| D6 | Socket.IO + Redis adapter for live board; overnight + DST test cases |

### Week 3 — Geofenced clock in/out, timesheets
| Day | Tasks |
|---|---|
| D1 | PWA setup (manifest, service worker via vite-plugin-pwa), employee "My shifts" view |
| D2 | TimeEntry schema; clock-in/out API; server-side haversine geofence check |
| D3 | Clock-in UI with geolocation permission handling and error states |
| D4 | Early/late tolerance, matching time entries to shifts, flags |
| D5 | Timesheet view per pay period; manager edit with reason (audited) |
| D6 | Buffer: tests for clock-in path, seed "demo clinic" data |

### Week 4 — Notification queue, reminders
| Day | Tasks |
|---|---|
| D1 | Worker app; BullMQ queues; outbox relay (poll outbox → enqueue) |
| D2 | Notification module: templates, channel preference, Notification + Delivery tables |
| D3 | Email provider adapter (Resend/SES) + web push (VAPID) |
| D4 | WhatsApp (Meta WhatsApp Cloud API: business number, approved utility templates) + SMS adapters; per-provider rate limit, retries with backoff, DLQ |
| D5 | Delivery status webhooks; repeatable jobs: shift reminders, missed clock-in detection |
| D6 | End-to-end: publish schedule → employees get WhatsApp/email; failure-injection tests |

### Week 5 — Shift swap and open-shift marketplace (concurrency)
| Day | Tasks |
|---|---|
| D1 | ShiftRequest schema and state machine (swap/drop/pickup) |
| D2 | Swap/drop API + manager approval, re-validation on approve |
| D3 | Open shifts: post, eligibility query, notify eligible staff |
| D4 | Race-safe accept (conditional UPDATE + version) + idempotency keys; concurrent-accept test |
| D5 | Employee UI for requests and open shifts; manager inbox |
| D6 | Buffer + blog draft: "How I prevent two nurses from taking the same shift" |

### Week 6 — Pay rules, overtime, payroll export
| Day | Tasks |
|---|---|
| D1 | PayRule schema (JSON rules, versioned with effective dates) |
| D2 | Rules engine: pure function `computePay(entries, rules, tz)` → line items |
| D3 | Overtime (daily/weekly), night premium splitting across midnight, break deduction; property tests |
| D4 | Pay-period approval flow; payroll calc as a worker job |
| D5 | CSV/XLSX export (exceljs), streaming for large periods |
| D6 | Labour-cost projection for schedules (basis for A6) |

### Week 7 — Auto-scheduler v1, audit log, observability
| Day | Tasks |
|---|---|
| D1 | CoverageRequirement schema + UI; auto-scheduler input/output contracts |
| D2 | Greedy assignment with scoring (cost, fairness, preference) |
| D3 | Bounded backtracking for unfilled slots; explanation of unfilled slots; runs in worker with progress events |
| D4 | Audit log: append-only table, write in same transaction, owner UI |
| D5 | OpenTelemetry (API + worker), pino JSON logs, Grafana dashboards |
| D6 | Benchmark auto-scheduler (50 employees × 7 days); record numbers for README |

### Week 8 — Launch
| Day | Tasks |
|---|---|
| D1 | Deploy to production (managed Postgres + Redis), backups, TLS |
| D2 | Razorpay subscriptions (Pro + location add-on quantity), webhooks, plan-limit enforcement, WhatsApp/SMS quotas |
| D3 | GST invoice generation (sequential numbering, CGST/SGST vs IGST, PDF + email); coupons + platform-admin coupon page |
| D4 | Landing page + pricing (Free / Pro ₹999 / +₹999 per location, + GST) + "Try as demo clinic" button |
| D5 | README as case study; visit clinics; onboard first pilots (give them pilot coupons) |
| D6 | Fix pilot feedback; changelog; launch posts (LinkedIn/X) |

Free SEO tools (overtime calculator, rota template generator) move to the first week after launch.

### After week 8
Rotating QR + selfie (A3), credential alerts (A5), offline clock-in (A7), forecasting vs
budget (A6), OR-Tools solver worker (A1 v2), Product Hunt launch, second blog post (DST).

### Future enhancements
- Native mobile app (React Native) for employees, reusing shared schemas and domain logic.
- Paid WhatsApp top-ups beyond the included quota.
- Annual plans.

## 12. Decisions and open questions

### Decided (2026-11-03)
| Topic | Decision |
|---|---|
| Product name | **Shiftora** |
| Pricing | Free ₹0 (≤ 10 employees) · Pro ₹999/month (unlimited employees) · +₹999/month per additional location |
| WhatsApp provider | Meta WhatsApp Cloud API (direct, no BSP) |
| Locations | Multi-location data model and UI from day one |
| Auto-scheduler | TypeScript heuristic first; OR-Tools CP-SAT later, behind the same contract |
| Currency and billing | INR via Razorpay Subscriptions; Shiftora issues its own GST invoices (§7.1) |
| Discounts | Platform-admin coupon codes (custom or random, % or ₹, once/repeating/forever); no annual plan for now (§7.2) |
| Messaging quotas | 1,000 WhatsApp + 200 SMS per paid location/month, pooled; fall back to push/email over quota (§7.3) |

| GST | Prices exclusive of 18% GST; GST added on top |
| Backend framework | NestJS (Fastify adapter) |
| Mobile | PWA for MVP; native app (React Native) as a future enhancement |
| Database toolkit | Drizzle ORM + SQL migrations (not Prisma) |
| Free plan | 1 location, up to 10 employees |

### Deferred (revisit after development)
- Domain name and trademark check for "Shiftora".
- GST registration, SAC code and invoice format sign-off with a CA (seller GSTIN, SAC code and
  invoice prefix are config values, not hardcoded).

### Still open
- None blocking development. Start with Week 1 (§11).
