import type { Redis } from 'ioredis';
import type { FastifyBaseLogger } from 'fastify';
import { KitchenMapSchema } from '@hivekitchen/contracts';
import type { KitchenMap } from '@hivekitchen/types';
import { NotFoundError } from '../../common/errors.js';
import { composeKitchenMap } from './kitchen-map.composer.js';
import type { KitchenMapRepository } from './kitchen-map.repository.js';

const KITCHEN_MAP_CACHE_TTL_SECONDS = 60 * 60; // 1 hour
const SCHEMA_VERSION = '1.1.0' as const;

export interface KitchenMapServiceDeps {
  repository: KitchenMapRepository;
  redis: Redis;
  logger: FastifyBaseLogger;
}

/**
 * Slice A0.5 — read-through cache for the KitchenMap projection.
 *
 * Cache key: `kitchen-map:{householdId}:schema-{SCHEMA_VERSION}:v{mapVersion}`
 *
 * Invalidation is implicit: triggers in migration 20260514000000 bump
 * households.kitchen_map_version on every write to a source table, so the
 * next read computes a fresh cache key and the old entry naturally expires.
 *
 * Failures are non-fatal where possible:
 *   - Redis read failure → compose fresh, log warn.
 *   - Redis write failure → return fresh map, log warn.
 *   - Cached payload fails Zod parse (schema drift) → compose fresh.
 * A missing household raises NotFoundError — caller decides whether that's
 * a 404 or an internal contract violation.
 */
export class KitchenMapService {
  constructor(private readonly deps: KitchenMapServiceDeps) {}

  async get(householdId: string): Promise<KitchenMap> {
    const raw = await this.deps.repository.loadRaw(householdId);
    if (raw === null) {
      throw new NotFoundError(`household ${householdId}`);
    }

    const version = raw.household.kitchen_map_version;
    const cacheKey = this.cacheKey(householdId, version);

    const cached = await this.tryReadCache(cacheKey, householdId);
    if (cached !== null) return cached;

    const map = composeKitchenMap(raw);

    const validated = KitchenMapSchema.safeParse(map);
    if (!validated.success) {
      this.deps.logger.error(
        {
          module: 'kitchen-map',
          action: 'kitchen_map.compose_validation_failed',
          household_id: householdId,
          issues: validated.error.issues,
        },
        'kitchen map composer produced an invalid projection — returning anyway',
      );
      // Returning the composed (unvalidated) map is safer than throwing —
      // the agent layer can degrade gracefully on a partial map, whereas a
      // throw blocks every downstream service. Issues are logged for fix.
      return map;
    }

    await this.tryWriteCache(cacheKey, validated.data, householdId);

    this.deps.logger.debug(
      {
        module: 'kitchen-map',
        action: 'kitchen_map.cache_miss_composed',
        household_id: householdId,
        version,
        children: validated.data.children.length,
        favourites: validated.data.recipes.favourites.length,
      },
      'kitchen map composed and cached',
    );
    return validated.data;
  }

  /**
   * Application-layer cache bump for the rare household-column writers
   * (Stripe tier change, timezone update) that triggers don't cover.
   */
  async bumpVersion(householdId: string): Promise<void> {
    await this.deps.repository.bumpVersion(householdId);
  }

  // ---- Helpers ------------------------------------------------------------

  private cacheKey(householdId: string, version: number): string {
    return `kitchen-map:${householdId}:schema-${SCHEMA_VERSION}:v${String(version)}`;
  }

  private async tryReadCache(key: string, householdId: string): Promise<KitchenMap | null> {
    let raw: string | null;
    try {
      raw = await this.deps.redis.get(key);
    } catch (err) {
      this.deps.logger.warn(
        { err, module: 'kitchen-map', action: 'kitchen_map.cache_read_failed', household_id: householdId },
        'redis read failed — falling back to compose',
      );
      return null;
    }
    if (raw === null) return null;

    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(raw);
    } catch (err) {
      this.deps.logger.warn(
        { err, module: 'kitchen-map', action: 'kitchen_map.cache_corrupt', household_id: householdId },
        'cached kitchen map JSON was corrupt — recomposing',
      );
      return null;
    }

    const parsed = KitchenMapSchema.safeParse(parsedJson);
    if (!parsed.success) {
      this.deps.logger.warn(
        {
          module: 'kitchen-map',
          action: 'kitchen_map.cache_schema_drift',
          household_id: householdId,
          issues: parsed.error.issues,
        },
        'cached kitchen map failed schema parse — recomposing',
      );
      return null;
    }

    this.deps.logger.debug(
      {
        module: 'kitchen-map',
        action: 'kitchen_map.cache_hit',
        household_id: householdId,
        version: parsed.data.meta.map_version,
      },
      'kitchen map cache hit',
    );
    return parsed.data;
  }

  private async tryWriteCache(key: string, map: KitchenMap, householdId: string): Promise<void> {
    try {
      await this.deps.redis.setex(key, KITCHEN_MAP_CACHE_TTL_SECONDS, JSON.stringify(map));
    } catch (err) {
      this.deps.logger.warn(
        { err, module: 'kitchen-map', action: 'kitchen_map.cache_write_failed', household_id: householdId },
        'kitchen map cache write failed — returning fresh map',
      );
    }
  }
}
