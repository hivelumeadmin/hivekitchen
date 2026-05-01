-- Story 2.13 review patch: prevent duplicate memory nodes for the same
-- household/type/facet combination. Partial index scoped to active nodes
-- (hard_forgotten = false) so a forgotten node can be re-seeded after a
-- user clears it via the Visible Memory panel (Epic 7).
CREATE UNIQUE INDEX memory_nodes_household_type_facet_unique_idx
  ON memory_nodes (household_id, node_type, facet)
  WHERE hard_forgotten = false;
