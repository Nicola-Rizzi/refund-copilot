# @refund-copilot/ui

A React component library built on Tailwind CSS + shadcn patterns with a custom brand token set.

> **Note:** This README is generated automatically from the live MCP tool output.
> Run `node scripts/generate-docs.js` from the monorepo root to regenerate.

## Installation

```bash
npm install @refund-copilot/ui
```

Add to `vite.config.ts`:
```ts
resolve: { alias: { "@refund-copilot/ui": resolve(__dirname, "../../packages/ui/src/components/ui") } }
```

Add to `tsconfig.json`:
```json
"paths": { "@refund-copilot/ui/*": ["../../packages/ui/src/components/ui/*"] }
```

## Design Tokens

### Color

| Token                         | Value   | Description                                                            |
| ----------------------------- | ------- | ---------------------------------------------------------------------- |
| color.brand.primary           | #6D28D9 | Primary brand color — deep violet                                      |
| color.brand.primaryHover      | #5B21B6 | Hover state for primary brand color                                    |
| color.brand.primaryForeground | #FFFFFF | Text on primary brand surfaces                                         |
| color.brand.accent            | #A14507 | Warm amber accent (6.2:1 with white text; 5:1 as text on its 15% tint) |
| color.brand.accentForeground  | #FFFFFF | Text on accent brand surfaces                                          |
| color.text.default            | #1C1917 | Default body text — warm near-black                                    |
| color.text.muted              | #716A65 | Muted / secondary text (≥ 4.5:1 on every surface)                      |
| color.surface.default         | #FAFAF9 | Page background — warm off-white                                       |
| color.surface.card            | #FFFFFF | Card surface                                                           |
| color.surface.subtle          | #F5F5F4 | Subtle background for ghost elements                                   |
| color.border.default          | #D6D3D1 | Default border                                                         |
| color.border.focus            | #6D28D9 | Focus ring — matches brand primary                                     |
| color.border.input            | #8A847F | Form control boundaries: inputs, selects (3.7:1, WCAG 1.4.11)          |
| color.feedback.error          | #B91C1C | Error states                                                           |
| color.feedback.success        | #166534 | Success states                                                         |

### Spacing

| Token   | Value | Description           |
| ------- | ----- | --------------------- |
| space.1 | 4px   | 4px base unit         |
| space.2 | 8px   | Tight spacing         |
| space.3 | 12px  | Compact spacing       |
| space.4 | 16px  | Default block spacing |
| space.6 | 24px  | Section spacing       |
| space.8 | 32px  | Large section spacing |

### Typography

| Token                | Value | Description              |
| -------------------- | ----- | ------------------------ |
| font.size.sm         | 14px  | Small text / captions    |
| font.size.base       | 16px  | Body text                |
| font.size.lg         | 18px  | Large body / subheadings |
| font.size.xl         | 20px  | Headings                 |
| font.weight.medium   | 500   | Medium weight            |
| font.weight.semibold | 600   | Semibold for UI labels   |
| font.weight.bold     | 700   | Bold headings            |

### Radius

| Token       | Value  | Description               |
| ----------- | ------ | ------------------------- |
| radius.sm   | 6px    | Small — tags, chips       |
| radius.md   | 10px   | Default — inputs, buttons |
| radius.lg   | 14px   | Cards and dialogs         |
| radius.full | 9999px | Pills                     |

### Shadow

| Token     | Value                                                  | Description      |
| --------- | ------------------------------------------------------ | ---------------- |
| shadow.sm | 0 1px 3px rgba(0,0,0,0.08), 0 1px 2px rgba(0,0,0,0.06) | Subtle elevation |
| shadow.md | 0 4px 8px rgba(0,0,0,0.10), 0 2px 4px rgba(0,0,0,0.06) | Card elevation   |
| shadow.lg | 0 10px 24px rgba(0,0,0,0.12)                           | Modal elevation  |

## Components

### Badge

```tsx
import { Badge } from "@refund-copilot/ui/badge";
```

| Prop    | Type                                                             | Notes                       |
| ------- | ---------------------------------------------------------------- | --------------------------- |
| variant | 'default' | 'outline' | 'success' | 'error' | 'accent' | 'muted' | optional, default 'default' |

**Example:**
```tsx
<Badge variant="default" />
```

---

### Button

```tsx
import { Button } from "@refund-copilot/ui/button";
```

| Prop    | Type                                                       | Notes                       |
| ------- | ---------------------------------------------------------- | --------------------------- |
| variant | 'default' | 'outline' | 'ghost' | 'destructive' | 'accent' | optional, default 'default' |
| size    | 'sm' | 'md' | 'lg' | 'icon'                                | optional, default 'md'      |

**Example:**
```tsx
<Button variant="default" size="md" />
```

---

### Card

```tsx
import { Card } from "@refund-copilot/ui/card";
```

| Prop    | Type                                          | Notes                       |
| ------- | --------------------------------------------- | --------------------------- |
| variant | 'default' | 'elevated' | 'ghost' | 'outlined' | optional, default 'default' |
| padding | 'none' | 'sm' | 'md' | 'lg'                   | optional, default 'md'      |

**Example:**
```tsx
<Card variant="default" padding="md" />
```

---

### Dialog

```tsx
import { Dialog } from "@refund-copilot/ui/dialog";
```

| Prop    | Type               | Notes                  |
| ------- | ------------------ | ---------------------- |
| size    | 'sm' | 'md' | 'lg' | optional, default 'md' |
| open    | boolean            | required               |
| onClose | () => void         | required               |
| title   | string             | required               |

**Example:**
```tsx
<Dialog size="md" />
```

---

### Input

```tsx
import { Input } from "@refund-copilot/ui/input";
```

| Prop    | Type                          | Notes                       |
| ------- | ----------------------------- | --------------------------- |
| variant | 'default' | 'error' | 'ghost' | optional, default 'default' |
| size    | 'sm' | 'md' | 'lg'            | optional, default 'md'      |

**Example:**
```tsx
<Input variant="default" size="md" />
```
