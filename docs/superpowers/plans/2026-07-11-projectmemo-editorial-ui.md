# ProjectMemo Editorial UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Re-style ProjectMemo into an editorial project-archive experience without changing any application behavior, routes, API contracts, or data models.

**Architecture:** Keep the existing Next.js component boundaries. Centralize color, surface, spacing, typography, and motion rules in `app/globals.css`, then apply those semantic utility classes to the current page and component structure. Do not add a visual-component dependency or new runtime state.

**Tech Stack:** Next.js 16, React 19, TypeScript, Tailwind CSS 4, lucide-react, Vitest, Playwright.

## Global Constraints

- Preserve all existing Chinese copy, API routes, Prisma models, Agent behavior, and page URLs.
- Do not add images, external fonts, UI packages, or animation dependencies.
- Use deep ink for primary hierarchy, restrained teal for Agent/action states, and brick red only for risk states.
- Respect `prefers-reduced-motion`; interaction transitions must be 200ms or shorter.
- Keep all existing E2E selectors and accessible names usable.
- The workspace is not a Git repository; do not create commits.

---

### Task 1: Build the editorial visual foundation

**Files:**
- Modify: `app/globals.css`
- Modify: `app/layout.tsx`
- Test: `npm.cmd run lint`

**Interfaces:**
- Consumes: existing `card-surface` and `focus-ring` class names.
- Produces: reusable `archive-*`, `editorial-*`, `timeline-*`, and motion utility classes used by current pages.

- [ ] **Step 1: Add a visual regression-free CSS foundation**

Add CSS custom properties for `--paper`, `--paper-strong`, `--ink`, `--ink-soft`, `--navy`, `--teal`, `--brick`, `--rule`, and three shadow levels. Add `body::before` as a pointer-events-none paper grain/grid layer, update `.shell` width to `min(1240px, calc(100% - 40px))`, make `.card-surface` use a 1px warm rule with low elevation, and define `.editorial-button`, `.editorial-button-secondary`, `.archive-label`, `.archive-rule`, `.timeline-rail`, and `.hover-lift`.

- [ ] **Step 2: Add reduced-motion behavior**

Add exactly this rule to the global stylesheet:

```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { scroll-behavior: auto !important; transition-duration: 0.01ms !important; animation-duration: 0.01ms !important; }
}
```

- [ ] **Step 3: Reframe global navigation**

Update `app/layout.tsx` so the logo reads as a small archive mark, the mock badge is visually subdued, and the navigation uses the semantic classes from Step 1. Do not change the `ProjectMemo` or `项目` accessible names.

- [ ] **Step 4: Run static validation**

Run: `npm.cmd run lint`

Expected: exit code 0 with no lint errors.

### Task 2: Apply the archive hierarchy to landing, project list, and forms

**Files:**
- Modify: `app/page.tsx`
- Modify: `components/ProjectCard.tsx`
- Modify: `components/PageHeading.tsx`
- Modify: `components/NewProjectForm.tsx`
- Modify: `app/projects/page.tsx`
- Modify: `app/projects/new/page.tsx`
- Test: `e2e/demo.spec.ts`

**Interfaces:**
- Consumes: semantic classes from Task 1 and existing `ProjectCard`, `PageHeading`, and `NewProjectForm` props.
- Produces: the same routes and accessible controls with editorial visual hierarchy.

- [ ] **Step 1: Recompose the landing hero**

Replace the oversized hero treatment with a compact archive masthead: keep the existing value proposition and links, add a small `项目知识档案` kicker, place the CTA in an ink button, and turn the right-side preview into a stacked file-card composition. Keep the exact `进入 Demo` link and `查看完整闭环` anchor.

- [ ] **Step 2: Differentiate the three value cards**

Keep the existing `values` array and icons, but give each item an ordinal archive index, a paper label, and an alternating low-contrast surface. Do not change their Chinese title or description strings.

- [ ] **Step 3: Restyle list and create-project surfaces**

Update `ProjectCard` to use an archive tab, a thinner top rule, restrained hover lift, and explicit count typography. Update `PageHeading` and `NewProjectForm` to use the global button/input classes; retain every field `id`, `name`, validation rule, and submit button accessible name.

- [ ] **Step 4: Validate user flows**

Run: `npm.cmd run test:e2e`

Expected: both existing flows pass unchanged: seed project generation and project creation/capture.

### Task 3: Turn project workspaces into a readable project record

**Files:**
- Modify: `app/projects/[id]/page.tsx`
- Modify: `components/ProactiveSuggestions.tsx`
- Modify: `components/CaptureBox.tsx`
- Modify: `components/KnowledgeCardView.tsx`
- Modify: `components/ArtifactGenerator.tsx`
- Modify: `app/projects/[id]/generate/page.tsx`
- Test: `e2e/demo.spec.ts`

**Interfaces:**
- Consumes: existing project-detail query result, `Suggestion`, card view props, and artifact API responses.
- Produces: identical capture, relation, artifact, copy, and history interactions with improved visual order.

- [ ] **Step 1: Establish the detail-page archive header**

Use `app/projects/[id]/page.tsx` to separate project metadata, title, project goal, deadline, and primary artifact action with hairline rules. Keep `生成项目成果`, `返回项目列表`, and the current project query unchanged.

- [ ] **Step 2: Reduce alert and input noise**

Update `ProactiveSuggestions` to give each semantic tone a narrow color accent and low-saturation paper surface. Update `CaptureBox` to look like a project-record editor with a labeled source selector, cleaner textarea, and the existing `沉淀为知识资产` button unchanged.

- [ ] **Step 3: Create a timeline knowledge stream**

Wrap the card stack in a `timeline-rail` container, then update `KnowledgeCardView` to show type, timestamp, importance, keywords, actions, and relations as a readable record rather than nested bordered panels. Preserve the `相关知识资产` text and every relation title.

- [ ] **Step 4: Create a document-reader artifact page**

Update `ArtifactGenerator` and the generate page to visually separate the archive index (artifact type and history) from the document reader (generated content and copy action). Preserve `生成新版本`, every artifact type button name, and `复制文本`.

- [ ] **Step 5: Run full final verification**

Run these commands in order:

```powershell
npm.cmd test
npm.cmd run lint
npm.cmd run build
npm.cmd run test:e2e
```

Expected: all commands exit code 0; the generated app keeps all current dynamic routes and both Playwright scenarios pass.

### Task 4: Browser visual review

**Files:**
- Verify: `/`, `/projects`, `/projects/[seed-id]`, `/projects/[seed-id]/generate`

**Interfaces:**
- Consumes: running local Next.js app and seed project.
- Produces: visual acceptance evidence for desktop and mobile layout.

- [ ] **Step 1: Review desktop pages**

Start the application with `npm.cmd run dev -- --hostname 127.0.0.1 --port 3210`. Confirm each page has a warm paper background, clear title hierarchy, restrained teal use, no overlapping cards, and all primary actions remain visible.

- [ ] **Step 2: Review mobile layout**

At a 390px viewport, confirm the header, hero, project metadata, capture controls, knowledge stream, artifact directory, and document content stack into one column without horizontal overflow.

- [ ] **Step 3: Record the final state**

Confirm the seed project shows 8 cards, at least one `相关知识资产` annotation, and the four proactive suggestions. Stop the local server after review.
