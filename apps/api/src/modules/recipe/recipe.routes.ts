import fp from 'fastify-plugin';
import type { FastifyPluginAsync } from 'fastify';
import { GetRecipeResponseSchema, RecipeIdParamSchema } from '@hivekitchen/contracts';
import { authorize } from '../../middleware/authorize.hook.js';
import { NotFoundError } from '../../common/errors.js';
import { RecipesRepository } from './recipes.repository.js';

// Story 14-s4 — the web's first recipe READ surface. The day-detail Wall Card
// needs recipe content (ingredients + method) that GET /v1/plans never carried;
// plans expose recipe_ids only. Pure read: no audit row, no mutation.
const recipeRoutesPlugin: FastifyPluginAsync = async (fastify) => {
  const recipesRepository = new RecipesRepository(fastify.supabase);
  const requireMember = authorize(['primary_parent', 'secondary_caregiver']);

  fastify.get(
    '/v1/recipes/:recipeId',
    {
      preHandler: requireMember,
      schema: {
        params: RecipeIdParamSchema,
        response: { 200: GetRecipeResponseSchema },
      },
    },
    async (request) => {
      const { recipeId } = request.params as { recipeId: string };
      const row = await recipesRepository.findForDayView(recipeId);

      // A recipe the caller may not read is reported as absent, never as
      // forbidden — a 403 would confirm the id exists to an unrelated
      // household. Curated / catalog-seeded rows carry a NULL owner and are
      // readable by everyone; without that clause a household could not read
      // the very recipes its own first plan is built from.
      const isReadable =
        row !== null &&
        (row.visibility === 'shared' ||
          row.created_by_household_id === null ||
          row.created_by_household_id === request.user.household_id);
      if (!isReadable) {
        throw new NotFoundError('recipe not found');
      }

      const steps = await recipesRepository.findStepsByRecipeId(recipeId);

      return {
        recipe: {
          id: row.id,
          canonical_name: row.canonical_name,
          ingredients: row.ingredients,
          prep_time_minutes: row.prep_time_minutes,
          finish_time_minutes: row.finish_time_minutes,
          source: row.source,
        },
        steps: steps.map((s) => ({ sequence: s.sequence, mode: s.mode, text: s.text })),
      };
    },
  );
};

export const recipeRoutes = fp(recipeRoutesPlugin, { name: 'recipe-routes' });
