-- Expand allergen_tags with common allergens not covered by FALCPA top-9.
-- Parents regularly mention these during onboarding; the agent could not tag
-- them, causing child.upsert tool failures and Lumi apologies to the user.
-- All new entries are sensitivity or extended rule_class — warn default.

INSERT INTO allergen_tags (key, display_name, rule_class, severity_default, alias_keys, sort_order) VALUES
  ('avocado',     'Avocado',      'sensitivity', 'warn', ARRAY['avo']::text[],                          250),
  ('kiwi',        'Kiwi',         'sensitivity', 'warn', ARRAY['kiwifruit']::text[],                    260),
  ('mango',       'Mango',        'sensitivity', 'warn', ARRAY[]::text[],                               270),
  ('strawberry',  'Strawberry',   'sensitivity', 'warn', ARRAY[]::text[],                               280),
  ('banana',      'Banana',       'sensitivity', 'warn', ARRAY[]::text[],                               290),
  ('coconut',     'Coconut',      'sensitivity', 'warn', ARRAY[]::text[],                               300),
  ('stone_fruit', 'Stone Fruit',  'sensitivity', 'warn', ARRAY['peach','plum','cherry','apricot','nectarine']::text[], 310),
  ('oat',         'Oat',          'sensitivity', 'warn', ARRAY['oats']::text[],                         320),
  ('sulfite',     'Sulfite',      'sensitivity', 'warn', ARRAY['sulphite','sulphur_dioxide','so2']::text[], 330),
  ('latex',       'Latex',        'sensitivity', 'warn', ARRAY['natural_rubber_latex']::text[],         340),
  ('pork',        'Pork',         'sensitivity', 'warn', ARRAY[]::text[],                               350),
  ('beef',        'Beef',         'sensitivity', 'warn', ARRAY['red_meat']::text[],                     360),
  ('chicken',     'Chicken',      'sensitivity', 'warn', ARRAY['poultry']::text[],                      370),
  ('legume',      'Legume',       'sensitivity', 'warn', ARRAY['lentil','chickpea','bean','pea','legumes']::text[], 380)
ON CONFLICT (key) DO NOTHING;
