-- Story 3.18: cultural_calendar_observances — static reference of recurring
-- cultural/religious observances. Not household-specific; shared across all
-- households. cultural_template values mirror cultural_priors.key slugs
-- (hindu_vegetarian, halal, kosher, south_asian, east_african, caribbean).
-- Lookups join household-ratified template keys to filter relevant rows.
CREATE TABLE IF NOT EXISTS cultural_calendar_observances (
  id                UUID         NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  observance_name   TEXT         NOT NULL,
  cultural_template TEXT         NOT NULL
                    CHECK (cultural_template IN (
                      'halal','kosher','hindu_vegetarian',
                      'south_asian','east_african','caribbean'
                    )),
  observance_year   INT          NOT NULL,
  start_date        DATE         NOT NULL,
  end_date          DATE         NOT NULL,
  dietary_notes     TEXT,
  created_at        TIMESTAMPTZ  NOT NULL DEFAULT now(),
  UNIQUE (observance_name, cultural_template, observance_year)
);

CREATE INDEX IF NOT EXISTS cultural_calendar_observances_template_dates_idx
  ON cultural_calendar_observances (cultural_template, start_date, end_date);

-- Seed 2026–2027 observances. Dates are approximate and should be reconciled
-- against authoritative calendar sources at deploy time. Shabbat is encoded
-- as a year-spanning row; CulturalCalendarService maps it to the Friday of
-- the target plan week before passing it to the planner agent.
INSERT INTO cultural_calendar_observances (observance_name, cultural_template, observance_year, start_date, end_date, dietary_notes)
VALUES
  ('Diwali',       'hindu_vegetarian', 2026, '2026-11-08', '2026-11-08', 'Celebratory sweets (mithai), fried foods (puri, samosa). Avoid meat.'),
  ('Navaratri',    'hindu_vegetarian', 2026, '2026-10-13', '2026-10-21', 'Fasting foods: sabudana, kuttu atta, fruits. No onion, garlic, non-veg.'),
  ('Ramadan',      'halal',            2026, '2026-02-18', '2026-03-19', 'Suhoor before dawn, Iftar at sunset. Hearty, protein-rich, hydrating foods.'),
  ('Eid al-Fitr',  'halal',            2026, '2026-03-20', '2026-03-20', 'Festive, celebratory. Sheer khurma, biryani. Rich and joyful.'),
  ('Passover',     'kosher',           2026, '2026-04-02', '2026-04-10', 'No chametz (leavened bread). Matzo-based dishes. Seder night celebratory.'),
  ('Shabbat',      'kosher',           2026, '2026-01-01', '2026-12-31', 'Friday dinner: challah, fish, chicken. Festive and warm.'),
  ('Diwali',       'hindu_vegetarian', 2027, '2027-10-29', '2027-10-29', 'Celebratory sweets (mithai), fried foods (puri, samosa). Avoid meat.'),
  ('Navaratri',    'hindu_vegetarian', 2027, '2027-10-02', '2027-10-10', 'Fasting foods: sabudana, kuttu atta, fruits. No onion, garlic, non-veg.'),
  ('Ramadan',      'halal',            2027, '2027-02-08', '2027-03-09', 'Suhoor before dawn, Iftar at sunset. Hearty, protein-rich, hydrating foods.'),
  ('Eid al-Fitr',  'halal',            2027, '2027-03-10', '2027-03-10', 'Festive, celebratory. Sheer khurma, biryani. Rich and joyful.'),
  ('Passover',     'kosher',           2027, '2027-04-13', '2027-04-20', 'No chametz (leavened bread). Matzo-based dishes. Seder night celebratory.'),
  ('Shabbat',      'kosher',           2027, '2027-01-01', '2027-12-31', 'Friday dinner: challah, fish, chicken. Festive and warm.')
ON CONFLICT (observance_name, cultural_template, observance_year) DO NOTHING;

-- cultural_calendar_observances is global reference data; readable to all
-- authenticated users. No per-household scoping needed.
ALTER TABLE cultural_calendar_observances ENABLE ROW LEVEL SECURITY;
CREATE POLICY cultural_calendar_observances_authenticated_select_policy
  ON cultural_calendar_observances
  FOR SELECT
  TO authenticated
  USING (true);
