# 🐝 HiveKitchen Design System
This is a living document. Update it as the project grows.

**Version:** 1.0

**Last Updated:** January 29, 2026
**Status:** Live Document

This document defines the visual, semantic, and interaction standards for the HiveKitchen product ecosystem.

It ensures consistency across web, mobile, and partner experiences while preserving HiveKitchen’s warm, intelligent identity.

---

## 1. Brand Foundations

### Brand Essence

HiveKitchen represents the intersection of **intelligent systems** and **human-centered cooking**.

**Personality**

- Intelligent, not flashy
- Warm, not playful
- Professional, not cold
- Modern, not trendy

**Design Principle**

> Balance warmth (food) with structure (technology)

---

## 2. Logo System

### Primary Logo

- Full-color logo (Honey + Tech Blue). This will be provided the developer
- Use on light or dark neutral backgrounds

### Secondary Logo

- Monochrome (white or charcoal)
- For watermarks, embossing, and constrained spaces

### Clear Space

Maintain minimum clear space equal to **one honey hexagon width** around the logo.

### Do Not

- Recolor outside brand palette
- Add gradients or shadows
- Distort proportions
- Rotate or skew

---

## 3. Color System

HiveKitchen uses a **semantic color system**, not a purely visual one.

Colors are named by **intent**, not appearance.

---

### 🍯 `honey-*` — Primary Actions / Core Food Flows

**Meaning:** Warmth, food, execution, confidence

| Token | Hex | Usage |
| --- | --- | --- |
| honey-700 | #C4551A | Pressed / focus states |
| honey-600 | #F36A20 | Hover / active |
| honey-500 | #F6BB39 | Primary CTAs |
| honey-300 | #FFD27A | Highlights, badges |
| honey-100 | #FFF3D6 | Soft backgrounds |

---

### 🌿 `sage-*` — Secondary Actions / Support

**Meaning:** Calm, balance, freshness

| Token | Hex | Usage |
| --- | --- | --- |
| sage-700 | #2F6E72 | Emphasis text |
| sage-600 | #3A8F94 | Hover / active |
| sage-500 | #67C6CC | Secondary buttons |
| sage-300 | #9EDFE3 | Cards, panels |
| sage-100 | #E8F6F7 | Background sections |

---

### 🧡 `coral-*` — Community & Engagement

**Meaning:** Human warmth, connection

| Token | Hex | Usage |
| --- | --- | --- |
| coral-700 | #B64036 | Strong emphasis |
| coral-600 | #D45548 | Active |
| coral-500 | #E86A5C | Likes, reactions |
| coral-300 | #F3A29A | Soft highlights |
| coral-100 | #FCE7E5 | Notification background |

---

### 🚫 `destructive-*` — Safety & Dietary Risks

**Meaning:** Alert, urgency, protection

| Token | Hex | Usage |
| --- | --- | --- |
| destructive-700 | #7F1D1D | Critical alerts |
| destructive-600 | #A92C24 | Active |
| destructive-500 | #C8372D | Errors |
| destructive-300 | #E8A09A | Alert background |
| destructive-100 | #FBE6E4 | Inline warnings |

---

### 🧱 Neutral / Structural Colors

| Token | Hex | Usage |
| --- | --- | --- |
| surface-0 | #FFFFFF | App background |
| surface-50 | #F5F7F6 | Cards |
| surface-600 | #556566 | Secondary text |
| surface-900 | #2A3A3B | Primary text |

---

## 4. Typography System

### Primary Typeface — Inter

**Use:** UI text, forms, buttons, labels

**Why:** Screen-optimized, neutral, highly readable

**Weights**

- 400 Regular — Body text
- 500 Medium — Labels
- 600 SemiBold — Buttons
- 700 Bold — Emphasis

---

### Brand Typeface — Sora

**Use:** Headlines, brand name, section headers

**Why:** Geometric, modern, warm, distinctive

---

### Type Scale

| Element | Font | Size |
| --- | --- | --- |
| App Title | Sora Bold | 28–32 |
| Section Header | Sora SemiBold | 20–24 |
| Body Text | Inter Regular | 14–16 |
| Button Text | Inter SemiBold | 14 |
| Caption | Inter Regular | 12 |

---

## 5. Iconography

- Outline icons only
- Rounded corners
- Consistent stroke width
- No filled or sharp-angled icons

Icons should feel **technical but friendly**.

---

## 6. UI Components

### Buttons

- Primary → `honey-500`
- Secondary → `sage-500`
- Destructive → `destructive-500`

### Cards

- Background → `surface-50`
- Border → `divider`
- Accent → `honey-300` or `sage-300`

---

## 7. Interaction States

```
Hover:   +10% saturation or darker shade
Active:  next darker token (e.g. honey-600 → honey-700)
Focus:   sage-300 outline
Disabled:#C9D3D4

```

### Dark Mode

Support dark mode from the start, but don't let it slow you down:

Add dark: variants when practical

### Core Principles

1. **Consistency first**: Reuse existing patterns before creating new ones
2. **Tailwind only**: Use utility classes, no arbitrary values without good reason
3. **Mobile-first**: Always include responsive variants
4. **Accessible**: Include focus states, semantic HTML, ARIA when needed
5. **Practical**: Suggest simple solutions, not over-engineered ones

### Decision Making

- If a pattern exists, use it
- If creating something new, keep it simple
- If in doubt, compose from shadcn/ui components
- Suggest documenting new patterns when they emerge

### 

### Flexibility

- Don't rigidly enforce every guideline
- Adapt to the user's specific needs
- Suggest improvements, don't mandate them
- Help the design system evolve naturally

### When Generating Components

- Import from `@/shared/components/common/` for reusable components
- Import from `@/shared/components/ui/` for shadcn components
- Only create new components in feature folders when absolutely necessary
- Always compose existing components rather than creating from scratch
- Suggest refactoring if you see duplicated patterns

## Accessibility

### Non-Negotiables

1. **Keyboard Navigation**: All interactive elements must be keyboard accessible
2. **Focus States**: Always visible, never removed
3. **Semantic HTML**: Use proper elements (`button`, `a`, `input`, etc.)
4. **ARIA Labels**: Add when visual context isn't enough