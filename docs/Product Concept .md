# HiveKitchen - Product Concept

---

### 1. Project Name & One-Liner

**HiveKitchen**

HiveKitchen is an AI school lunch planning app for families who want to pack safe, meaningful, and genuinely enjoyable lunches — without adding to their daily mental load.
It learns who your family is and uses that knowledge to build a personalized weekly lunch +plan before start of the week, automatically. 

It is a focused, intelligent planning companion that learns a family's specific needs, values, and food identity over time and gets meaningfully better the longer it is used.

---

### 2. Problem Statement

---

School lunch planning is a high-frequency, high-stakes decision that families must repeat throughout the school year, balancing child preferences with nutrition, time constraints, safety requirements (like allergies), and school-specific food policies—often while also trying to honor cultural and religious food identity. Because these constraints vary widely by household and can change over time, most existing meal planning or recipe tools don’t reliably translate into lunches that are actually safe, compliant, packable, and accepted by the child. The result is ongoing mental load for parents, inconsistent outcomes, and a planning process that too often defaults to stress, repetition, or guesswork instead of a dependable system that adapts to each family’s real-world needs.

Working parents have limited time for meaningful daily connection with their children. School lunch planning can become a shared ritual that could create emotional connection and give children a sense of involvement and care.

### 3. Target Users

The primary user is a parent or caregiver, aged roughly 28–55, with one or more school-age children (4–17), managing at least one non-trivial constraint in their lunch planning — a food allergy, a school nut-free policy, a Halal or Kosher household, a child who refuses most things, or usually some combination. They are time-poor and decision-fatigued. They are not looking for recipe inspiration — they are looking for a system that does the thinking for them without erasing their family's identity. Families from culturally specific food communities — Halal, Kosher, South Asian, East African, Caribbean and others — are a deeply valued and underserved segment of this audience. The secondary user is the child, who participates in the experience at lunchtime and whose feedback shapes the system's learning over time.

---

### 4. Core Concept & How It Works

HiveKitchen is built around a weekly planning cycle. Every start of the week, the app's AI companion -Lumi  generates a five-day lunch plan tailored to the family. The plan is drawn from a curated recipe library and shaped by everything Lumi knows about the family: who the children are, what they like and dislike, what they can and cannot eat safely, what their schools allow, and what the family's food culture looks like. The parent can accept the plan as-is, swap out individual days, or talk to Lumi directly to request changes. Once the plan is confirmed, it becomes the week's source of truth.

This does not mean plans cant change. Parents are able to swap any remaining days lunch plan as their availability, leftovers, ingredient availability etc.. might change.

Every day during the school week, the child receives a short link on their phone or email — no app needed — that shows them a note from their parent and asks one simple question: how was lunch? Three emoji options, one tap, done. That feedback goes directly back to Lumi, who uses it to make next week's plan a little more accurate. 

All data is stored in database and is aways the source of truth. Over time, through the datapoints gathered from  user interactions and data stored in database, Lumi learns the family well enough that the weekly plan needs almost no adjustment. 

The parent's job shrinks. The child's voice grows. The lunches get better.

---

### 5. Key Features (High-Level)

**Family and School Profiles.** The parent builds a profile for each child — name, age, what they love, what they won't eat, any allergies — and for each school — nut-free, no-heating, specific policies. These profiles are the foundation Lumi works from and are never overridden by suggestions.

**Family Calendar.** Parents set up a school calendar inside HiveKitchen so that Lumi only plans lunches for days they are actually needed. Term dates, school holidays, early release days, and one-off exceptions — like a school trip where packed lunch is not required — can all be marked in advance. Lumi reads the calendar before generating any weekly plan and quietly drops or adjusts days that do not need a lunch. For families who already manage their schedule in Google Calendar or a similar tool, HiveKitchen can connect to it directly, so there is no need to enter dates twice.

**Weekly Lunch Planning.**  Lumi generates a personalized weekly plan based on the family's full profile — preferences, allergies, school policies, and cultural food identity. The parent can accept it in one tap, swap individual days, or ask Lumi to adjust it through a simple chat interface.

**The Lunch Link.** Every lunchtime, each child receives a time-limited link via email or a permitted messenger. It opens in any browser — no app, no login — and shows a personal note from their parent alongside the day's lunch. The child rates their lunch with a single emoji tap. That rating feeds directly into Lumi's planning.

**Lumi — the AI Planning Companion.** Lumi works mostly in the background — generating plans, processing feedback, learning preferences. She is also available through a chat interface for direct questions and requests, and explains her suggestions in plain language so parents always understand why something was chosen.

**Leftover-Aware Planning.** Parents can tell Lumi what is left over from dinner — preferrably the night before  — and Lumi will assess whether it works as a school lunch that day or later in the week. If it does, Lumi will offer to fold it into the plan, with a brief note on why it fits. If it does not — because of a school policy, an allergen conflict, or simply because it would not travel well — Lumi explains that too and moves on. This keeps food waste low, saves money, and removes one more small decision from the parent's morning.

**Grocery Bridge.** Once the weekly plan is confirmed, HiveKitchen generates a simple shopping list grouped by category. It can be shared to any notes or messaging app with one tap.

---

### 6. What It Is NOT / Out of Scope

- **Not a recipe platform or cooking inspiration app.** HiveKitchen does not exist to help parents discover food. It exists to remove a recurring decision from their week.
- **Not a nutrition tracker.** Calorie counts, macros, and dietary logging are not part of this product.Colories or Nutrition may be suggested but is not the main reason why this app exists.
- **Not a grocery delivery service.** The shopping list is a convenience export. There is no in-app ordering or retailer integration at launch.
- **Not a general family meal planner.** HiveKitchen plans school lunches only — not dinners, breakfasts, or weekend meals.
- **Not a social or sharing platform.** There are no public profiles, shared recipe feeds, or community features at launch.
- **Not a family scheduling or household management tool.** The Family Calendar exists solely to inform Lumi's lunch planning. It does not track appointments, after-school activities, or non-lunch-related events, and it is not a replacement for a general family calendar.
- **Not a two-way calendar integration.** The Google Calendar connection is read-only. HiveKitchen will never create, edit, or delete events in any external calendar.
- **Not a meal diary or food journal.** Leftover data is used only to inform the next available lunch slot. HiveKitchen does not log, store, or analyse household dinner habits over time.
- **Not a food waste tracking tool.** Lumi surfaces leftover opportunities as a convenience. The product does not report on waste reduction, carbon footprint, or household food behaviour. Those are separate categories of product.

---

### 7. Success Looks Like

For a parent, success is opening the app on weekend, seeing a plan that feels right for their family, tapping accept, and not thinking about school lunches again until next week. For a child, success is opening a link at lunchtime and feeling like their mum or dad packed that lunch specifically for them — and knowing that what they thought about it actually mattered. For the product, success at 90 days is a majority of active households using the weekly plan consistently, children engaging with the Lunch Link at rates above 50%, and a meaningful share of free users converting to a paid plan — not because they were pushed, but because the product has become genuinely hard to give up.

---

### 8. Key Terms / Domain Glossary

**Lumi** — HiveKitchen's AI planning companion. Not a chatbot. A background intelligence that plans, learns, and is available for direct conversation when needed.

**Lunch Link** — A time-limited, one-time-use web link sent to a child at lunchtime. Requires no app or login. Delivers a Heart Note from the parent and collects a single emoji feedback rating from the child.

**Heart Note** — A short personal message written by the parent each morning, delivered to the child through the Lunch Link. The emotional centrepiece of the child experience.

**Seed Library** — HiveKitchen's curated recipe collection, covering multiple cultural and regional food communities. The source Lumi draws from before a family has contributed their own recipes. Minimum 200 recipes at launch.

**Family Safety and Identity Engine** — The rule layer that governs all of Lumi's suggestions. Safety constraints (allergens) sit at the top, followed by identity constraints (cultural and religious requirements), followed by preference and personalisation logic. Not a UI setting — enforced at the data layer.

**School Profile** — A per-child record of the food policies applicable at that child's school. Treated as a hard constraint by Lumi, equivalent in priority to allergen safety.

**Leftover Log** — A lightweight daily or weekly input where a parent records what dinner leftovers are available for potential school lunch use. Not a meal diary or a nutrition record. Lumi uses this data only for lunch planning purposes and does not retain it as a long-term record of household eating habits.

**School Term Calendar** — The per-child calendar record inside HiveKitchen, covering term dates, holidays, and exceptions. Treated by Lumi as a hard planning constraint, equivalent in priority to school food policy.

**Lunch Day** — Any school day on the calendar that is marked as requiring a packed lunch. The only days Lumi plans for.

**No-Lunch Day** — Any day marked as not requiring a packed lunch — a school holiday, a day the child has school meals, a trip, or a half day where lunch is provided. Lumi skips these days entirely in plan generation.

**Early Release Day** — A school day that ends earlier than usual, sometimes before a full lunch period. Flagged separately from No-Lunch Days so Lumi can make an appropriate suggestion rather than skipping the day entirely.

**Calendar** — The per-child calendar record inside HiveKitchen, covering school term dates, holidays, and exceptions. Treated by Lumi as a hard planning constraint, equivalent in priority to school food policy.

**Child Experience** — The Lunch Link and Heart Note, delivered via a web link to the child's email or a permitted messenger. No app required. This is the only child-facing feature at launch.