# AI Arena Workbench Alignment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild `/arena` from a simple prompt sender into a browser-companion-only AI Arena workbench that visually and behaviorally matches the upstream Chrome extension.

**Architecture:** Keep the website as the command surface and keep the Chrome companion extension as the browser executor. The page owns participants, task mode, prompt assembly, history UI, and status display; the companion extension owns opening logged-in AI pages and filling/submitting prompts. No model API route is reintroduced.

**Tech Stack:** Plain Node server, browser ES modules, Chrome MV3 extension, Node built-in test runner.

---

### Task 1: Regression Contract

**Files:**
- Modify: `test/arena-companion.test.js`
- Modify: `public/arena-companion.js`
- Modify: `companion-extension/background-core.js`

- [ ] **Step 1: Write failing tests**

Add tests that require all 9 upstream AI services, explicit service routing, and original workbench affordances.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`

Expected: tests fail because only ChatGPT / Claude / Gemini and simple prompt UI exist.

- [ ] **Step 3: Implement service metadata and task mapping**

Add 9 service definitions and make task mapping respect selected participant service ids.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`

Expected: all tests pass.

### Task 2: Workbench UI

**Files:**
- Modify: `public/app.js`
- Modify: `public/styles.css`
- Create/copy assets under: `public/arena-assets/`

- [ ] **Step 1: Replace `/arena` layout with immersive workbench**

Hide the outer product shell while in arena mode and render left time-machine sidebar, center chat surface, right 5-tab control panel, bottom task picker and contenteditable input.

- [ ] **Step 2: Add member slots and 9 AI add buttons**

Use original service order and brand names. Enforce max 3 selected participants.

- [ ] **Step 3: Add task picker and right-side tab content**

Support ask, debate free/collab, summary, PPT, baton labels and controls. Browser companion remains the only execution path.

### Task 3: Companion Executor Upgrade

**Files:**
- Modify: `companion-extension/manifest.json`
- Modify: `companion-extension/background-core.js`
- Modify: `companion-extension/ai-page.js`
- Modify: `companion-extension/README.md`

- [ ] **Step 1: Add host permissions for all 9 AI pages**

Mirror upstream targets: Claude, Gemini, ChatGPT, DeepSeek, 豆包, 千问, Kimi, 元宝, Grok.

- [ ] **Step 2: Add robust input selectors**

Use upstream selector strategy where practical, with safe contenteditable text injection.

- [ ] **Step 3: Preserve draft-by-default behavior**

Auto-submit remains opt-in.

### Task 4: Verification

**Files:**
- Test commands only.

- [ ] **Step 1: Static and unit checks**

Run: `npm test`, `node --check public/app.js`, `node --check public/arena-companion.js`, `node --check companion-extension/background.js`, `node --check companion-extension/ai-page.js`

- [ ] **Step 2: Restart local server**

Run: `npm start`

- [ ] **Step 3: Browser verification**

Open `http://127.0.0.1:5173/arena`, verify original-like layout, 9 AI add buttons, 5 right tabs, bottom task picker/input, companion connection, and no API model wording.
