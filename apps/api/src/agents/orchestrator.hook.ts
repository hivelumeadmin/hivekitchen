import fp from 'fastify-plugin';
import type { FastifyPluginAsync } from 'fastify';
import { OnboardingAgent } from './onboarding.agent.js';
import { RecipeAgent } from './recipe-agent.js';
import { CulturalPriorRepository } from '../modules/cultural-priors/cultural-prior.repository.js';
import { CulturalPriorService } from '../modules/cultural-priors/cultural-prior.service.js';
import { ThreadRepository } from '../modules/threads/thread.repository.js';
import { RecipeService } from '../modules/recipe/recipe.service.js';
import { RecipesRepository } from '../modules/recipe/recipes.repository.js';
import { PantryService } from '../modules/pantry/pantry.service.js';
import { ChildPreferencesRepository } from '../modules/child-preferences/child-preferences.repository.js';
import { ChildAllergensRepository } from '../modules/children/child-allergens.repository.js';
import { ChildrenRepository } from '../modules/children/children.repository.js';
import { DomainOrchestrator } from './orchestrator.js';
import type { OrchestratorServices } from './orchestrator.js';
import { OpenAIAdapter } from './providers/openai.adapter.js';
import { AnthropicAdapter } from './providers/anthropic.adapter.js';

const orchestratorHookPlugin: FastifyPluginAsync = async (fastify) => {
  if (!fastify.openai) {
    throw new Error('orchestratorHook requires openai decorator — register openaiPlugin first');
  }
  if (!fastify.memoryService) {
    throw new Error('orchestratorHook requires memoryService decorator — register memoryHook first');
  }
  if (!fastify.allergyGuardrailService) {
    throw new Error(
      'orchestratorHook requires allergyGuardrailService decorator — register allergyGuardrailHook first',
    );
  }
  if (!fastify.auditService) {
    throw new Error('orchestratorHook requires auditService decorator — register auditHook first');
  }
  if (!fastify.redis) {
    throw new Error('orchestratorHook requires redis decorator — register ioredisPlugin first');
  }
  if (!fastify.supabase) {
    throw new Error('orchestratorHook requires supabase decorator — register supabasePlugin first');
  }
  if (!fastify.plansService) {
    throw new Error('orchestratorHook requires plansService decorator — register plansHook first');
  }
  if (!fastify.tavily) {
    throw new Error('orchestratorHook requires tavily decorator — register tavilyPlugin first');
  }
  if (!fastify.vocabularyService) {
    throw new Error(
      'orchestratorHook requires vocabularyService decorator — register vocabularyPlugin first',
    );
  }

  // Story 3.4: cultural.lookup tool needs CulturalPriorService.listByHousehold().
  // No fastify decorator exists for this service today (it's instantiated per-route
  // in cultural-prior.routes.ts), so construct it inline using shared decorators.
  const culturalPriorRepository = new CulturalPriorRepository(fastify.supabase);
  const threads = new ThreadRepository(fastify.supabase);
  const onboardingAgent = new OnboardingAgent(fastify.openai);
  const culturalPriorService = new CulturalPriorService({
    repository: culturalPriorRepository,
    threads,
    agent: onboardingAgent,
    logger: fastify.log,
  });

  // Slice D.2 — RecipeService now has a real read path (search + fetch).
  // Constructed with the repository so the agent's recipe.search / recipe.fetch
  // tools return live catalog rows instead of throwing NotImplementedError.
  // PantryService still a stub — wired up in a future story.
  const recipesRepository = new RecipesRepository(fastify.supabase);
  const recipeService = new RecipeService(recipesRepository, fastify.log);
  const pantryService = new PantryService();

  // Story 4-S11 — child_signal tool deps. kek=null is fine: findByHouseholdId
  // reads names + plaintext allergen/tag rows only; the household DEK path is
  // never exercised here (mirrors the plan-generation job's ChildrenRepository).
  const childPreferencesRepository = new ChildPreferencesRepository(fastify.supabase);
  const childAllergensRepository = new ChildAllergensRepository(fastify.supabase, null);
  const childrenRepository = new ChildrenRepository(
    fastify.supabase,
    null,
    fastify.log,
    childAllergensRepository,
  );

  const services: OrchestratorServices = {
    memory: fastify.memoryService,
    allergyGuardrail: fastify.allergyGuardrailService,
    recipe: recipeService,
    pantry: pantryService,
    plan: fastify.plansService,
    culturalPrior: culturalPriorService,
    childPrefs: childPreferencesRepository,
    children: childrenRepository,
  };

  // OPENAI_TRACES_ENABLED is env-validated; staging/prod are hard-blocked from
  // setting it true (env.ts superRefine). When true in dev, the adapter drops
  // the zero-retention header so requests appear in the OpenAI dashboard.
  const openaiTracesEnabled = fastify.env?.OPENAI_TRACES_ENABLED ?? false;
  if (openaiTracesEnabled) {
    fastify.log.warn(
      { module: 'orchestrator', node_env: fastify.env?.NODE_ENV },
      'OPENAI_TRACES_ENABLED=true — OpenAI dashboard will log full request bodies (zero-retention disabled)',
    );
  }

  const openaiStoreCompletions = fastify.env?.OPENAI_STORE_COMPLETIONS ?? false;
  if (openaiStoreCompletions) {
    fastify.log.info(
      { module: 'orchestrator', node_env: fastify.env?.NODE_ENV },
      'OPENAI_STORE_COMPLETIONS=true — completions stored in OpenAI Evals dataset (zero-retention disabled)',
    );
  }

  const openaiAdapter = new OpenAIAdapter(fastify.openai, {
    tracesEnabled: openaiTracesEnabled,
    storeCompletions: openaiStoreCompletions,
  });
  const anthropicAdapter = new AnthropicAdapter();
  // Story 3-31 — RecipeAgent wires Tavily + OpenAI + vocabulary. Stateless
  // across requests; constructed once and shared.
  const recipeAgent = new RecipeAgent({
    tavily: fastify.tavily,
    openai: fastify.openai,
    vocabulary: fastify.vocabularyService,
    logger: fastify.log,
  });

  const orchestrator = new DomainOrchestrator(
    [openaiAdapter, anthropicAdapter],
    services,
    fastify.redis,
    fastify.auditService,
    fastify.log,
    recipeAgent,
  );
  fastify.decorate('orchestrator', orchestrator);
  fastify.addHook('onClose', () => { orchestrator.dispose(); });
};

export const orchestratorHook = fp(orchestratorHookPlugin, { name: 'orchestrator-hook' });
