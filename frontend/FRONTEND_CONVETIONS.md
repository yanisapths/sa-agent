# Frontend Conventions

The words **must**, **should**, and **may** indicate requirement levels:

- **Must**: required for new or changed code.
- **Should**: the default; deviations need a clear reason.
- **May**: optional.

Existing code does not need to be rewritten solely to match this guide. Apply these conventions when a feature is
created or materially changed, and keep refactors separate from product changes where possible.

## Table of contents

1. [Principles](#principles)
2. [Current project stack](#current-project-stack)
3. [Project setup](#project-setup)
4. [Folder structure](#folder-structure)
5. [Naming and file conventions](#naming-and-file-conventions)
6. [Formatting, linting, and imports](#formatting-linting-and-imports)
7. [TypeScript conventions](#typescript-conventions)
8. [Next.js and React conventions](#nextjs-and-react-conventions)
9. [Data fetching and API integration](#data-fetching-and-api-integration)
10. [Forms and validation](#forms-and-validation)
11. [State management](#state-management)
12. [Styling and the design system](#styling-and-the-design-system)
13. [Accessibility](#accessibility)
14. [Performance](#performance)
15. [Error handling and observability](#error-handling-and-observability)
16. [Environment variables and security](#environment-variables-and-security)
17. [Git, commits, and pull requests](#git-commits-and-pull-requests)
18. [CI quality gates](#ci-quality-gates)
19. [Definition of done](#definition-of-done)

## Principles

- Organize product code by feature.
- Keep route files thin and move feature behavior into feature modules.
- Prefer the internal design system over direct third-party UI usage.
- Keep remote data in TanStack Query, form data in React Hook Form, and truly shared client state in Zustand or context.
- Make invalid states difficult to represent with TypeScript and Zod.
- Optimize only when there is evidence of a user-visible or measured problem.
- Preserve accessibility, loading, empty, error, and mobile states as part of the feature—not as follow-up work.
- Use automated tools for formatting and correctness instead of debating style in reviews.

## Current project stack

These are the established technologies in this repository:

- Next.js 15 App Router
- React 18
- TypeScript in strict mode
- Static export via `output: "export"`
- Bun for installing dependencies and running scripts
- Tailwind CSS 3, Sass, and Tailwind Variants
- Aster design system built primarily on HeroUI
- TanStack Query for remote/server state
- Axios-based HTTP clients
- React Hook Form and Zod for forms
- Zustand and React context for shared client state
- Prettier with import sorting and Tailwind class sorting
- ESLint with Next.js and TanStack Query rules
- Sentry for production observability

Do not introduce another library that solves an existing stack responsibility without an architecture discussion.
Examples include a second query library, form library, schema validator, global state library, or primary component
library.

## Project setup

### Prerequisites

- Use the Node.js version supported by the delivery pipeline.
- Use Bun as the project package manager.
- Do not mix `npm install`, Yarn, or pnpm with Bun.

### Install and run

```bash
bun install
bun dev
```

The local application is available at `http://localhost:3000`.

The repository uses the Python `pre-commit` framework rather than Husky. After installing `pre-commit` on the
workstation, enable the configured commit hook:

```bash
pre-commit install
```

### Common checks

```bash
bun run format
bun run lint
bunx tsc --noEmit
bun test
bun run test:coverage
bun run knip
bun run build:nonprd
pre-commit run --all-files
```

Run focused checks during development and all relevant checks before requesting review. A production-like build is
required for changes involving routing, environment variables, build configuration, dynamic imports, or browser-only
libraries.

> Repository note: `package.json` currently declares Yarn in `packageManager`, while the README and active scripts use
> Bun. Bun is the team convention; the package metadata should be aligned separately to avoid ambiguous tooling.

## Folder structure

The target structure combines Next.js route conventions with feature-based organization:

```text
src/
├── app/
│   ├── (route-group)/
│   │   └── feature-route/
│   │       ├── page.tsx
│   │       ├── layout.tsx
│   │       ├── loading.tsx
│   │       └── error.tsx
│   ├── features/
│   │   └── feature-name/
│   │       ├── components/
│   │       ├── hooks/
│   │       ├── FeatureName.tsx
│   │       ├── form.ts
│   │       ├── service.ts
│   │       ├── types.ts
│   │       └── index.ts
│   ├── layout.tsx
│   └── providers.tsx
├── components/
├── design-system/
│   ├── components/
│   ├── constants/
│   └── styles/
├── services/
│   ├── api-v2/
│   ├── factory/
│   └── hook/
├── hooks/
├── stores/
├── context/
├── config/
├── helpers/
├── constants/
├── model/
├── assets/
└── styles/
```

### Directory responsibilities

#### `src/app`

Contains App Router entry points and application composition.

- Route files must use Next.js names such as `page.tsx`, `layout.tsx`, `loading.tsx`, `error.tsx`, and `not-found.tsx`.
- Route groups such as `(base)` and `(auth)` organize routes without changing URLs.
- Route files should compose feature modules and avoid containing large components, API details, or business rules.
- Server route files should export metadata with the existing `createPageMetadata` helper when the page needs
  discoverable metadata.
- Configure route chrome once through the existing page-config pattern (`usePageConfigStoreSync` in client routes or
  `AppHooks` from server routes). Do not configure the same route in both its page and layout unless intentional.
- Because the app is statically exported, do not add runtime-dependent Route Handlers, Server Actions, or server-only
  rendering assumptions without first changing the deployment architecture.
- Existing detail routes commonly use search parameters. Do not introduce a second URL pattern for the same domain
  without agreeing on a migration to dynamic route segments.

#### `src/app/features/<feature-name>`

Contains code owned by one product capability. Components, hooks, forms, feature-specific types, and local helpers
should stay together here.

Create subdirectories only when they make the feature easier to navigate. Avoid generic folders such as `misc`,
`common`, or `utils` inside a feature.

#### `src/design-system`

Contains reusable, product-agnostic UI primitives and design tokens.

- Use components exported from `@/design-system/components` before importing HeroUI directly.
- Prefer HeroUI behavior and accessibility primitives when implementing or extending a design-system component.
- Use tokens from `src/design-system/constants`; do not add one-off colors, spacing, typography, or shadows when a
  suitable token exists.
- A design-system component must not depend on a product feature, API service, wallet state, or route.

#### `src/components`

Contains reusable product-level components shared by multiple features and self-contained campaign or mini-application
experiences. Some current domains are split between this directory and `src/app/features`; new code should have one
clear domain owner. If a component is used by only one feature, keep it in that feature.

#### `src/services`

Contains HTTP clients, endpoint functions, shared API response types, and service factories. Service functions should
not render UI or control component state.

Use `api-v2` for current API integrations unless an endpoint is explicitly part of the legacy API surface.

#### `src/hooks`

Contains cross-feature hooks. Feature-specific hooks belong with their feature.

#### `src/stores` and `src/context`

- `stores` contains narrowly scoped Zustand stores.
- `context` contains React providers for cross-cutting integrations or state that naturally belongs to a component
  tree.
- Do not place TanStack Query data into a store or context merely to make it globally available.

#### `src/helpers`, `src/constants`, and `src/model`

Use these only for genuinely cross-feature code. New feature-specific helpers, constants, and types should be
co-located with their feature. Treat `src/model` as a legacy shared-types location rather than the default for new
types.

### Feature module example

```text
src/app/features/session/
├── components/
│   ├── SessionCard.tsx
│   └── SessionList.tsx
├── hooks/
│   ├── useSessionById.ts
│   └── useSessionList.ts
├── SessionDetail.tsx
├── service.ts
├── types.ts
└── index.ts
```

Do not create a barrel file for every directory. Add `index.ts` only when it provides an intentional public API and
does not create circular dependencies.

## Naming and file conventions

### Files and directories

- React component files: `PascalCase.tsx`
- Hooks: `useDescriptiveName.ts` or `.tsx` only when the hook returns JSX
- Feature and route directories: `kebab-case`
- General TypeScript modules: descriptive `camelCase.ts`; established role names such as `form.ts`, `types.ts`,
  `constants.ts`, and `service.ts` are acceptable
- Tests: `Subject.test.ts` or `Subject.test.tsx`, co-located with the subject

Avoid vague filenames such as `helper.ts`, `utils.ts`, or `use.ts` when a more specific name explains the module's
purpose. Existing files may retain their names until touched.

### Identifiers

- Components, types, interfaces, and enums: `PascalCase`
- Variables and functions: `camelCase`
- Constants that are true configuration constants: `UPPER_SNAKE_CASE`
- Hooks: `use...`
- Event handlers implemented by a component: `handle...`
- Callback props exposed by a component: `on...`

```tsx
interface RewardCardProps {
  isClaimed: boolean;
  hasBonus: boolean;
  onClaim: () => void;
}

const RewardCard = ({ isClaimed, hasBonus, onClaim }: RewardCardProps) => {
  const handleClaim = () => {
    onClaim();
  };

  return (
    <Button onPress={handleClaim}>{hasBonus ? "Claim bonus" : "Claim"}</Button>
  );
};
```

Boolean names should read as a question:

- `isLoading`, `isOpen`, `isDisabled`
- `hasError`, `hasPermission`, `hasRewards`
- `canSubmit`, `shouldRefetch`

Avoid ambiguous names such as `flag`, `status`, `show`, or `data` when a domain-specific name is available.

### Domain language

Use the same term in routes, UI, types, API functions, and tests. Do not use multiple names for the same concept.
Preserve backend field names only at the service boundary; map them to clear frontend names when needed.

## Formatting, linting, and imports

Prettier is the formatting authority. The current configuration requires:

- Tabs for indentation
- No semicolons
- Single quotes
- Trailing commas
- 120-character print width
- Sorted imports
- Sorted Tailwind classes, including classes passed to `tv`

Do not manually align code with spaces or reorder imports against Prettier.

### Import order

Imports are sorted by `.prettierrc.mjs`:

1. Third-party packages
2. Absolute `@/` imports grouped by source directory
3. Relative imports

Use the `@/` alias for cross-directory imports:

```ts
import { Button } from "@/design-system/components";

import { getSessionById } from "@/services/api-v2/session";

import { SessionHeader } from "./SessionHeader";
```

Use relative imports within the same feature or component directory. Avoid long paths such as
`../../../../services/...`.

Import types with `type` when possible:

```ts
import { type ReactNode } from "react";
```

## TypeScript conventions

- New code must pass strict TypeScript checks.
- Do not use `any`. Use a concrete type, generic, discriminated union, or `unknown` followed by narrowing.
- Do not suppress errors with `@ts-ignore`. If a temporary suppression is unavoidable, use `@ts-expect-error` with
  a reason and tracking reference.
- Prefer type inference for local implementation details; annotate public boundaries and non-obvious return values.
- Prefer unions to booleans when more than two states exist.
- Prefer `Readonly<T>` or readonly properties when callers should not mutate input.
- Avoid non-null assertions (`!`). Prove the value exists or handle the absent state.
- Avoid unsafe type assertions. Validate external data or narrow it before use.
- Keep API response types close to the endpoint function.
- Derive form value types from Zod schemas with `z.infer`.

Use `interface` for object-shaped public component props when extension is useful, and `type` for unions,
intersections, mapped types, or local aliases. Consistency within a module matters more than converting existing code.

Do not include React's special `key` attribute in component props. `key` is consumed by React and is not available to
the component.

## Next.js and React conventions

### Server and client boundaries

App Router modules are server components by default, but this application is statically exported.

- Add `'use client'` only when a module uses state, effects, event handlers, browser APIs, or client-only providers.
- Keep client boundaries as low as practical.
- Do not add `'use client'` pre-emptively to every component.
- Pass serializable props across server/client boundaries.
- Access `window`, `document`, `localStorage`, wallets, and similar browser APIs only in client code.
- Use `next/dynamic` with `ssr: false` for libraries that cannot run during prerendering.

### Components

- Use function components and explicit props types.
- Do not use `React.FC` by default; it adds little value and can obscure the component's actual return and children
  contract.
- Destructure props in the parameter list when it remains readable.
- Use default parameter values for optional props.
- Keep components focused. Extract meaningful subcomponents or hooks when a component mixes orchestration, data
  access, and a large amount of rendering.
- Prefer composition over numerous boolean props.
- Do not mutate props, query data, or state objects.

```tsx
interface EmptyStateProps {
  title?: string;
  onRetry?: () => void;
}

export const EmptyState = ({
  title = "Nothing found",
  onRetry,
}: EmptyStateProps) => {
  return (
    <section>
      <h2>{title}</h2>
      {onRetry && <Button onPress={onRetry}>Try again</Button>}
    </section>
  );
};
```

### Event handlers

Use `handle<Event>` for local handlers and `on<Event>` for component callback props.

Inline arrow functions are acceptable for small, clear handlers. They are not inherently a performance problem.
Extract a handler when it contains logic, is reused, improves readability, or must have a stable reference for a
memoized child or hook dependency.

### Lists

- Every rendered list item must have a stable, unique key from the data.
- Do not use an array index as a key when items can be inserted, removed, filtered, or reordered.
- The key belongs on the outermost element returned by `map`.

```tsx
{
  rewards.map((reward) => <RewardCard key={reward.id} reward={reward} />);
}
```

### Native buttons and links

- Native `<button>` elements must declare `type="button"`, `type="submit"`, or `type="reset"`.
- Use `next/link` for internal navigation.
- Use a button for actions and a link for navigation; do not use clickable `div` or `span` elements.
- For HeroUI/Aster components, use the component's supported event API consistently, such as `onPress`.

### Hooks

- Hooks must begin with `use`.
- Call hooks unconditionally at the top level.
- Include complete dependency arrays.
- Follow the TanStack Query ESLint rules already configured in the project.
- A custom hook should expose domain behavior, not merely rename a built-in hook.

### Effects

Use `useEffect` only to synchronize React with an external system, such as a subscription, timer, browser API, or
imperative third-party library.

Do not use effects for:

- Derived values that can be calculated during render
- User actions that belong in event handlers
- Resetting state that can be modeled with keys or controlled state
- Data fetching already handled by TanStack Query

Effects must clean up timers, listeners, observers, and subscriptions. Do not make the effect callback itself `async`;
define and call an inner async function or use a query/mutation.

### Memoization

Do not automatically wrap functions in `useCallback`, values in `useMemo`, or components in `memo`.

Use memoization when:

- Profiling identifies expensive repeated work
- A stable reference is required by an effect or external API
- A memoized child would otherwise re-render because a callback or object identity changes
- A computation is demonstrably expensive

Memoization has a maintenance and runtime cost. Trivial calculations should remain direct.

## Data fetching and API integration

### Service layer

API calls belong in `src/services` or a feature-local service module:

```ts
export const getSessionSummary = async () => {
  return HttpClient.get<APIGetResponse<SessionSummary>>("/v2/summary/session");
};
```

- Reuse the configured HTTP client.
- Type request parameters and response bodies.
- Keep URL construction and transport details out of components.
- Do not show toasts, navigate, or update UI state from a low-level endpoint function.
- Validate untrusted or unstable responses with Zod when runtime shape cannot be guaranteed.
- Normalize backend errors at the service/query boundary.

### TanStack Query

Use queries for reads and mutations for writes.

- Query keys must be stable arrays and include every parameter used by the query function.
- Prefer a feature-level query-key factory for a family of related queries.
- Use `enabled` when required inputs are unavailable.
- Return useful domain data from the query function rather than repeatedly unwrapping Axios responses in components.
- Invalidate or update the narrowest relevant query after a successful mutation.
- Do not copy query data into local state unless the user is editing a snapshot or there is another clear ownership
  reason.
- Render explicit loading, empty, error, and success states.
- Choose retry, stale time, refetch, and polling behavior intentionally; do not poll by default.

```ts
const sessionKeys = {
  all: ["sessions"] as const,
  detail: (sessionId: string) =>
    [...sessionKeys.all, "detail", sessionId] as const,
};

export const useSessionById = (sessionId: string) =>
  useQuery({
    queryKey: sessionKeys.detail(sessionId),
    queryFn: () => getSessionById(sessionId),
    enabled: sessionId.length > 0,
  });
```

Never use a query solely to run arbitrary side effects. Use an effect, event handler, mutation, or explicit
authentication flow as appropriate.

## Forms and validation

Use React Hook Form with Zod and `zodResolver`.

- Define the schema, inferred form type, default values, and form hook together in `form.ts`.
- Derive the value type with `z.infer<typeof schema>`.
- Keep UI-independent validation in the schema.
- Convert form values to API input in an explicit mapper such as `toAPIData`.
- Display field errors next to the relevant field and provide an accessible form-level error when submission fails.
- Disable or guard repeated submissions while a mutation is pending.
- Do not maintain duplicate `useState` values for fields already owned by React Hook Form.
- Reset forms deliberately after success or when the edited entity changes.

## State management

Use the narrowest state owner:

1. Derived value: calculate it during render.
2. Local interaction state: `useState` or `useReducer`.
3. Form state: React Hook Form.
4. Remote state: TanStack Query.
5. URL-shareable state: route segments or search parameters.
6. Cross-tree integration state: context.
7. Cross-feature client state: a small Zustand store.

Zustand stores should:

- Represent one domain or UI concern
- Expose actions instead of allowing ad hoc mutation
- Use selectors so components subscribe only to what they need
- Avoid storing query responses, derived values, or sensitive credentials
- Have an explicit reset strategy when state is user-specific

Context providers should expose a memoized value when object identity would otherwise trigger broad rerenders. Split
large contexts by update frequency and responsibility.

## Styling and the design system

### Component priority

Use UI building blocks in this order:

1. Existing Aster component from `@/design-system/components`
2. Extend an existing design-system component
3. HeroUI primitive or headless hook wrapped by the design system
4. A custom accessible component

Do not import a new UI framework for a single component.

Flowbite, MUI, and Emotion remain in legacy areas. Do not expand their use in new work; migrate touched code to the
Aster design system and Tailwind when the change can be kept focused and low-risk.

### Tailwind and tokens

- Prefer Tailwind utilities for component styling.
- Use design tokens from `src/design-system/constants` through the configured Tailwind theme.
- Use `clsx` for conditional classes and `tailwind-variants` for reusable variants.
- Let Prettier sort Tailwind classes.
- Avoid arbitrary values such as `text-[#8A94A8]` when a token exists.
- Avoid dynamic class fragments that Tailwind cannot detect. Use complete class names or update the safelist.
- Keep responsive behavior mobile-first and use the configured design-system breakpoints.

### CSS and Sass

Use Sass/CSS for global styles, complex selectors, third-party overrides, and effects that are clearer than utility
classes. Keep component-specific styles close to the component and avoid leaking global selectors.

### Images and icons

- Prefer `next/image` for raster images and declare meaningful `alt` text.
- Image optimization is disabled because the application is statically exported. Still provide correct dimensions,
  responsive `sizes`, and appropriately sized source assets.
- Use `alt=""` only for decorative images.
- Prefer design-system icons and the existing Untitled UI icon wrapper. React Icons and local SVG components remain in
  legacy areas. Do not add Iconify solely because it appears in a generic guideline.
- Give icon-only controls an accessible name.

## Accessibility

Accessibility is a release requirement.

- Use semantic HTML before ARIA.
- All interactive elements must be reachable and operable by keyboard.
- Focus indicators must remain visible.
- Modals and drawers must trap focus, label themselves, and restore focus when closed; prefer design-system/HeroUI
  primitives.
- Inputs must have associated labels, instructions, and error messages.
- Do not communicate state by color alone.
- Maintain sufficient text and control contrast.
- Respect reduced-motion preferences for non-essential animation.
- Announce asynchronous status changes when needed with an appropriate live region.
- Use headings in logical order.
- Decorative images use empty alt text; informative images use concise meaningful alt text.
- Test responsive layouts at keyboard and touch target sizes.

Lint rules cannot prove accessibility. Review and test the actual interaction.

## Performance

- Measure with React DevTools, browser performance tools, or the bundle analyzer before optimizing.
- Keep client component boundaries narrow to reduce shipped JavaScript.
- Dynamically import large, optional, browser-only, or below-the-fold features.
- Avoid loading an entire utility or icon package for one function or icon when a tree-shakeable import exists.
- Use responsive image sizes and avoid unnecessarily large source assets.
- Debounce network-backed search input where appropriate; cancel or ignore stale requests.
- Virtualize only genuinely large lists.
- Avoid context providers whose values change on every render.
- Use `startTransition` or `useDeferredValue` only for non-urgent rendering work that is proven to block interaction.
- Check bundle impact before adding dependencies.
- Run `ANALYZE=true bun run build:nonprd` when investigating bundle size.

### JavaScript bundle optimization: Do / Don't

**Do**

- Use `next/dynamic` for large optional UI such as modals, editors, charts, games, particles, and below-the-fold
  sections. Add `ssr: false` only when the module requires browser APIs.
- Mount only the active tab, breakpoint variant, or opened modal. A hidden component can still execute hooks, fetch
  data, and load its dependencies.
- Import a component, ABI, or utility from its direct module when a broad barrel may expose unrelated feature code.
- Prefer tree-shakeable named utilities from the existing stack, such as `formatEther`, `parseEther`, and
  `encodeAbiParameters` from `viem`.
- Initialize expensive browser libraries inside the feature that uses them. Keep root layouts and global providers
  limited to capabilities required by nearly every route.
- Keep package declarations accurate: production imports belong in `dependencies`, tooling belongs in
  `devDependencies`, and direct package imports must be declared directly.
- Run `bun run knip`, `bunx tsc --noEmit`, and an analyzer build after dependency or chunk-boundary changes.

**Don't**

- Do not eagerly import interaction-only UI from a root layout, provider, navigation shell, or route entry.
- Do not initialize all plugins or presets globally when a slim or feature-specific loader is available.
- Do not import a large namespace when a focused utility exists, for example `import { ethers } from "ethers"`.
- Do not rely on transitive or hoisted dependencies; installs must remain reproducible from `package.json`.
- Do not add duplicate libraries for functionality already provided by `viem`, HeroUI, the design system, or existing
  helpers.
- Do not assume `display: none`, an inactive tab, or a closed modal reduces JavaScript. Split or conditionally mount it.
- Do not add manual Webpack chunk rules without analyzer evidence and a documented reason.

## Error handling and observability

- Never silently swallow an error.
- Show users actionable, plain-language messages; do not expose raw backend or wallet errors.
- Preserve the original error for logging and Sentry.
- Handle expected domain failures separately from unexpected application failures.
- Use route-level `error.tsx` where a route needs a recovery boundary.
- Use query and mutation error states for recoverable request failures.
- Remove debug logs from changed production paths. Production console output is stripped, so console logging is not an
  observability strategy.
- Do not log tokens, wallet signatures, personal data, or secrets.

## Environment variables and security

- Browser-readable variables must use the `NEXT_PUBLIC_` prefix.
- Assume every `NEXT_PUBLIC_` value is visible to users.
- Never place secrets, private keys, credentials, or privileged API tokens in frontend environment files.
- Add environment variable types to `src/environment.d.ts`.
- Read variables through `src/config/env.ts` when a typed project helper exists.
- Validate required configuration early and fail with a clear message.
- Keep `.env.*` files out of commits unless the file contains documented, non-secret example values.
- Sanitize untrusted HTML. Avoid `dangerouslySetInnerHTML`; if it is unavoidable, use an approved sanitizer.
- Do not weaken Content Security Policy or add remote asset domains without reviewing the source.

## Git, commits, and pull requests

### Commits

Use Conventional Commits:

```text
feat(session): add registration waitlist
fix(reward): prevent duplicate checkout submission
refactor(marketplace): centralize order query keys
test(profile): cover invalid display names
chore(deps): update HeroUI packages
```

Allowed common types are `feat`, `fix`, `refactor`, `perf`, `test`, `docs`, `build`, `ci`, and `chore`.

- Keep commits focused and reviewable.
- Explain why the change is needed.
- Do not combine unrelated formatting or cleanup with product behavior.
- Do not commit generated build directories, local reports, environment files, or secrets.

The repository already has `pre-commit` configuration for trailing whitespace, private-key detection, and ESLint.
Commitlint, Commitizen, and Husky are not configured, so Conventional Commits remain a team convention rather than an
automatically enforced rule.

The configured pre-commit ESLint mirror currently differs from the version in `package.json`. Keep hook and project
tool versions aligned when maintaining the hook configuration. The configured pre-push script currently performs no
checks, so it must not be treated as a quality gate.

### Pull requests

A pull request should include:

- A short problem and solution summary
- A linked work item
- Screenshots or recordings for visible UI changes
- Desktop and mobile states when both are affected
- Test evidence and manual test steps
- Accessibility considerations
- Environment, migration, feature-flag, or deployment notes
- Known limitations or follow-up work

Keep pull requests small enough to review confidently. Separate mechanical refactors from behavior changes.

## CI quality gates

This repository uses GitLab CI, not GitHub Actions. `.gitlab-ci.yml` includes an externally maintained pipeline from
`cicd/pipeline/aster/aster-web`, so the complete current job list is not visible in this repository. Changes to required
checks must be coordinated with that pipeline.

The target merge-request pipeline should run with Bun and the repository lockfile, not the npm-based GitHub Actions
example from a generic guide.

Recommended required checks:

1. Frozen dependency install
2. Prettier check
3. ESLint
4. TypeScript type check
5. Production-like static build
6. Knip as an advisory check until existing findings are resolved
7. Commitlint after the team enables enforcement

CI configuration must pin supported runtime versions, cache Bun dependencies safely, upload useful failure artifacts,
and avoid accessing production secrets from untrusted pull requests.

## Definition of done

For every changed feature:

- [ ] The code follows feature ownership and folder boundaries.
- [ ] Route files remain thin.
- [ ] TypeScript is strict and no unsafe suppression was added.
- [ ] Formatting, imports, and Tailwind classes match Prettier.
- [ ] ESLint and relevant type checks pass.
- [ ] Loading, empty, error, and success states are handled.
- [ ] Keyboard interaction, focus, labels, contrast, and image alternatives were reviewed.
- [ ] Mobile and desktop layouts were checked when applicable.
- [ ] Remote state uses TanStack Query and local/global state has the narrowest appropriate owner.
- [ ] Forms use React Hook Form and Zod where applicable.
- [ ] Tests cover new critical logic and regressions where practical.
- [ ] Production build behavior was checked when the change affects build or routing.
- [ ] No secret, personal data, debug log, generated build output, or unrelated change is included.
- [ ] The pull request explains behavior, test evidence, and rollout considerations.
