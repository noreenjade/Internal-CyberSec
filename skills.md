# 🛡️ CyberOps Task Tracker - Developer System Guidelines & Technical Directives (`skills.md`)

## 🎯 1. System Overview & Core Philosophy
* **Project Name:** CyberOps Task Tracker (Unified Kanban & Operational Dashboard)
* **Target Audience:** Internal Security Operations Center (SOC) L1/L2 Analysts & Threat Hunting Team members.
* **Architecture:** Single-file monolithic web application (`cyberops-task-tracker.html`) utilizing embedded Vanilla JavaScript, HTML5, CSS3/Tailwind styling, and local browser persistence.
* **Primary Objective:** Provide a high-velocity, clutter-free ticket tracking interface with real-time SLA metrics, team workload distributions, and quick administrative data management without unnecessary UI friction.

---

## 🛑 2. NON-NEGOTIABLE CORE DEVELOPMENT DIRECTIVES
*(Claude Code MUST strictly adhere to these 5 operational rules for every code modification.)*

### Rule 1: Zero Regression Policy (Never Break Existing Features)
- **Do NOT delete, overwrite, or refactor working business logic** unless explicitly instructed by the user.
- Existing functions handling modal toggles, ticket filtering, state updates, metric calculations, and table rendering MUST remain functional after every edit.
- Always perform a mental syntax and logic check before modifying script blocks inside `cyberops-task-tracker.html`.

### Rule 2: Preserve Local Storage State Persistence
- All state changes (ticket updates, dynamic assignments, custom settings, user profile edits) MUST continue to sync seamlessly with browser `localStorage`.
- Never wipe out default schema structures or existing local key-value pairs (`cyberops_tickets`, `cyberops_settings`, `cyberops_users`, etc.).
- Ensure fallback/initialization data is always safely parsed using `JSON.parse()` with proper error handling/defaults.

### Rule 3: Streamlined Ticket Form (No Extra Friction)
- Maintain a fast, lean ticket submission and editing workflow.
- **Allowed Ticket Fields:** Title, Severity/Priority (`CRITICAL`, `HIGH`, `MEDIUM`, `LOW`), SLA Target, Assignee, Category (`Rule Development`, `Rule Finetuning`, `Threat Hunt`, etc.), Description/Notes, and Attachments.
- **STRICTLY PROHIBITED:** Do NOT inject additional required drop-downs, TLP/PAP classification badges, or multi-step form approvals unless explicitly asked by the user in a future prompt.

### Rule 4: SLA Logic & Real-time Metrics Protection
- Do NOT tamper with the active SLA countdown timer algorithms or visual urgency indicators (e.g., overdue flags, time-remaining countdowns).
- Ensure metric cards (Total Active Tickets, SLA Compliance Rate %, Overdue Count, Avg. Resolution Time) and distribution progress bars accurately compute data from active ticket arrays.

### Rule 5: Strict Superadmin Access Control
- The **"Data Backup & Restore"** tab and high-privilege configuration options MUST remain strictly restricted to **Superadmin** roles (e.g., Noreen Jade Lozano / SE account).
- Standard Analysts should only see operational tabs (Kanban, Dashboard/Analytics, Team Roster) and be unable to tamper with system-wide data resets.

---

## 🎨 3. UI, DESIGN SYSTEM & LAYOUT STANDARDS

### Palette & Visual Theme
- Maintain consistency with the current **CyberOps Dark/Light Cyber Theme**:
  - Backgrounds: Deep Slate/Charcoal `#0B0F17` / `#111827` (Dark Mode) or Crisp Minimal White/Slate (Light Mode).
  - Accents: Vivid Cyber Cyan (`#06B6D4`), Emerald Green (`#10B981` for On-Time/Active), Amber (`#F59E0B` for Paused/Warning), and Crimson Red (`#EF4444` for Critical/Breached).
- Cards & Panels: Rounded borders (`border-radius: 8px` to `12px`) with subtle borders (`rgba(255,255,255,0.08)`) and high-contrast readable typography.

### Layout & Alignment Alignment Rules
- Grid structure for the Kanban Board must maintain equal-width column rendering (`New`, `In Progress`, `Paused`, `Resolved`).
- Spacing between metric cards, action buttons, and form inputs must use uniform padding (`12px` to `24px`).
- Responsive Design: All modals, drawers, and sidebars must remain functional without overflowing off-screen.

---

## 🛠️ 4. WORKFLOW FOR CLAUDE CODE IN VS CODE

When responding to prompts and applying changes in `cyberops-task-tracker.html`:

1. **Read Before Writing:** Inspect existing CSS selectors, DOM IDs, and JS function signatures inside `cyberops-task-tracker.html` before proposing or inserting changes.
2. **Targeted In-Place Editing:** Modify code blocks directly inside the file while preserving surrounding script tags and markup structure.
3. **Validate HTML Integrity:** Ensure all open HTML tags (`<div>`, `<modal>`, `<button>`) and JavaScript brackets (`{}`) are closed properly to prevent breaking render output.
4. **Clean Code Output:** Keep CSS modular, avoid inline redundant styles where existing CSS variables are defined, and keep JavaScript functions clean and documented.

---

## 5. SPECIFIC CODE MODIFICATION RULES
- **Additive-Only Integration:** Whenever adding new tabs, features, or external script links (e.g., `<script src="guidelines.js"></script>`), inject them purely as additive code. Never overwrite main container structures, existing event handlers, or existing variable declarations.
- **Strict File Target:** Edits must be isolated strictly to `cyberops-task-tracker.html` unless explicit creation of a separate JS/JSON asset is requested.
- **Console Errors Check:** Ensure any new DOM queries or functions check for null elements before executing to prevent silent JS breaks.

---

## 6. PROMPT & WORKFLOW PROTOCOL FOR CLAUDE CODE
1. Always confirm understanding of `skills.md` constraints before outputting major edits.
2. If an instruction is ambiguous or might break an existing feature, **ask a clarifying question** before modifying the codebase.
3. Summarize modifications in 2-3 short bullet points after updating the file.