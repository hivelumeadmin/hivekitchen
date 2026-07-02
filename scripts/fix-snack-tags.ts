/**
 * Dev data fix: two global seed snack SKUs carry a genuine FALCPA-9 allergen but
 * were stocked with empty allergen_tags. With the curated-shelf doctrine
 * (allergen_tags is authoritative; empty = no allergens), these MUST be tagged
 * so they route through the verifiable branch and block for allergic children.
 *   - Edamame  → soy
 *   - Hummus Cup → sesame (tahini)
 * The remaining seeds are already correct: String Cheese/Yogurt Cup = dairy,
 * Granola Bar/ABC = wheat, and the whole-food snacks (Apple, Banana, Baby
 * Carrots, Celery Sticks, Rice Cakes) are genuinely allergen-free → empty tags.
 */
import { createClient } from '@supabase/supabase-js';

const db = createClient(process.env['SUPABASE_URL']!, process.env['SUPABASE_SERVICE_ROLE_KEY']!, { auth: { autoRefreshToken: false, persistSession: false } });

const FIXES: Array<[string, string[]]> = [
  ['Edamame', ['soy']],
  ['Hummus Cup', ['sesame']],
];

async function main() {
  for (const [name, tags] of FIXES) {
    const { data, error } = await db
      .from('snack_skus')
      .update({ allergen_tags: tags })
      .eq('name', name)
      .select('id, name, allergen_tags');
    if (error) { console.error(name, error.message); continue; }
    console.log('tagged', name, '→', JSON.stringify((data ?? []).map((r) => r.allergen_tags)));
  }
}
main().catch((e: unknown) => { console.error(e); process.exit(1); });
