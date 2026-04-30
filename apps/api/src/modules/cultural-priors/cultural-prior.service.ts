import type { FastifyBaseLogger } from 'fastify';
import type {
  CulturalPrior,
  RatifyAction,
  TemplateState,
} from '@hivekitchen/types';
import { NotFoundError } from '../../common/errors.js';
import type { OnboardingAgent } from '../../agents/onboarding.agent.js';
import type { ThreadRepository } from '../threads/thread.repository.js';
import type {
  CulturalPriorRepository,
  CulturalPriorRow,
} from './cultural-prior.repository.js';

export interface CulturalPriorServiceDeps {
  repository: CulturalPriorRepository;
  threads: ThreadRepository;
  agent: OnboardingAgent;
  logger: FastifyBaseLogger;
}

export interface InferFromSummaryInput {
  householdId: string;
  threadId: string;
  transcript: Array<{ role: string; message: string }>;
}

export interface RatifyInput {
  householdId: string;
  priorId: string;
  action: RatifyAction;
}

export interface RatifyResult {
  prior: CulturalPrior;
  lumi_response?: string;
  // Set only when state actually transitioned (opt_in / forget). The route
  // uses this to populate request.auditContext for template.state_changed.
  audit?: {
    from_state: TemplateState;
    to_state: TemplateState;
    key: CulturalPriorRow['key'];
    prior_id: string;
  };
}

const ONBOARDING_THREAD_TYPE = 'onboarding';

export class CulturalPriorService {
  private readonly repository: CulturalPriorRepository;
  private readonly threads: ThreadRepository;
  private readonly agent: OnboardingAgent;
  private readonly logger: FastifyBaseLogger;

  constructor(deps: CulturalPriorServiceDeps) {
    this.repository = deps.repository;
    this.threads = deps.threads;
    this.agent = deps.agent;
    this.logger = deps.logger;
  }

  async inferFromSummary(input: InferFromSummaryInput): Promise<{ detectedCount: number }> {
    if (input.transcript.length === 0) return { detectedCount: 0 };
    const inferred = await this.agent.inferCulturalPriors(input.transcript);
    if (inferred.length === 0) {
      // Silence-mode: no rows, no ratification turn. UX-DR46 default.
      return { detectedCount: 0 };
    }

    const inserted = await this.repository.upsertDetected(input.householdId, inferred);
    if (inserted.length === 0) {
      // Every inferred prior already existed at a higher state — nothing new
      // to ratify.
      return { detectedCount: 0 };
    }

    await this.threads.appendTurnNext({
      threadId: input.threadId,
      role: 'lumi',
      body: {
        type: 'ratification_prompt',
        priors: inserted.map((p) => ({
          prior_id: p.id,
          key: p.key,
          label: p.label,
        })),
      },
      modality: 'text',
    });

    this.logger.info(
      {
        module: 'cultural-priors',
        action: 'cultural.inferred',
        household_id: input.householdId,
        thread_id: input.threadId,
        prior_count: inserted.length,
      },
      'cultural priors detected and ratification turn appended',
    );

    return { detectedCount: inserted.length };
  }

  async listByHousehold(householdId: string): Promise<CulturalPrior[]> {
    const rows = await this.repository.findByHousehold(householdId);
    return rows.map(toCulturalPrior);
  }

  async ratify(input: RatifyInput): Promise<RatifyResult> {
    const existing = await this.repository.findByIdForHousehold(
      input.householdId,
      input.priorId,
    );
    if (existing === null) {
      throw new NotFoundError('cultural prior not found');
    }

    if (input.action === 'tell_lumi_more') {
      // Only valid from detected state — the three action buttons are only
      // shown for detected priors; guard here as a server-side invariant.
      if (existing.state !== 'detected') {
        return { prior: toCulturalPrior(existing) };
      }
      // No state change — generate a single follow-up question scoped to this
      // prior and append it to the household's onboarding thread. Check both
      // modalities because voice-onboarded households have a thread with
      // modality='voice' which the text-only lookup would miss.
      const lumiResponse = await this.generateFollowUp(existing);
      const onboardingThread =
        (await this.threads.findActiveThreadByHousehold(
          input.householdId,
          ONBOARDING_THREAD_TYPE,
          'text',
        )) ??
        (await this.threads.findActiveThreadByHousehold(
          input.householdId,
          ONBOARDING_THREAD_TYPE,
          'voice',
        )) ??
        (await this.threads.findClosedThreadByHousehold(
          input.householdId,
          ONBOARDING_THREAD_TYPE,
        ));
      if (onboardingThread !== null) {
        try {
          await this.threads.appendTurnNext({
            threadId: onboardingThread.id,
            role: 'lumi',
            body: { type: 'message', content: lumiResponse },
            modality: 'text',
          });
        } catch (err) {
          // Thread persistence is best-effort here — the user will still see
          // the response even if we cannot append a follow-up turn.
          this.logger.warn(
            {
              err,
              module: 'cultural-priors',
              action: 'cultural.tell_lumi_more.append_failed',
              household_id: input.householdId,
              prior_id: input.priorId,
            },
            'tell_lumi_more follow-up turn append failed — returning response anyway',
          );
        }
      } else {
        this.logger.warn(
          {
            module: 'cultural-priors',
            action: 'cultural.tell_lumi_more.no_thread',
            household_id: input.householdId,
            prior_id: input.priorId,
          },
          'tell_lumi_more could not find onboarding thread — lumi turn not appended',
        );
      }
      return { prior: toCulturalPrior(existing), lumi_response: lumiResponse };
    }

    if (input.action === 'opt_in') {
      // Idempotent: already opted in → no-op return.
      if (existing.state === 'opt_in_confirmed') {
        return { prior: toCulturalPrior(existing) };
      }
      const updated = await this.repository.transition(
        input.priorId, input.householdId, 'opt_in_confirmed', existing.state,
        { opted_in_at: new Date(), opted_out_at: null },
      );
      if (updated === null) {
        const current = await this.repository.findByIdForHousehold(input.householdId, input.priorId);
        return { prior: toCulturalPrior(current ?? existing) };
      }
      return {
        prior: toCulturalPrior(updated),
        audit: {
          from_state: existing.state,
          to_state: 'opt_in_confirmed',
          key: existing.key,
          prior_id: existing.id,
        },
      };
    }

    // action === 'forget'
    if (existing.state === 'forgotten') {
      return { prior: toCulturalPrior(existing) };
    }
    const updated = await this.repository.transition(
      input.priorId, input.householdId, 'forgotten', existing.state,
      { opted_out_at: new Date(), opted_in_at: null },
    );
    if (updated === null) {
      const current = await this.repository.findByIdForHousehold(input.householdId, input.priorId);
      return { prior: toCulturalPrior(current ?? existing) };
    }
    return {
      prior: toCulturalPrior(updated),
      audit: {
        from_state: existing.state,
        to_state: 'forgotten',
        key: existing.key,
        prior_id: existing.id,
      },
    };
  }

  // Lightweight follow-up — bounded text, no chained tool calls. The
  // agent.respond() shape returns plain text; we frame the prompt around the
  // specific prior so Lumi asks ONE clarifying question scoped to it.
  private async generateFollowUp(prior: CulturalPriorRow): Promise<string> {
    const fallback = `Got it — tell me more about how ${prior.label} shows up at your table.`;
    try {
      const reply = await this.agent.respond(
        [
          {
            role: 'user',
            content: `The household indicated that "${prior.label}" is not quite the right cultural template for them. Ask one short, warm follow-up question that invites them to describe what is actually going on at their table — without offering alternatives or naming other templates.`,
          },
        ],
        { modality: 'text' },
      );
      const trimmed = reply.text.trim();
      return trimmed.length > 0 ? trimmed : fallback;
    } catch (err) {
      this.logger.warn(
        {
          err,
          module: 'cultural-priors',
          action: 'cultural.tell_lumi_more.agent_failed',
          prior_id: prior.id,
        },
        'tell_lumi_more agent call failed — using fallback copy',
      );
      return fallback;
    }
  }
}

function toCulturalPrior(row: CulturalPriorRow): CulturalPrior {
  return {
    id: row.id,
    household_id: row.household_id,
    key: row.key,
    label: row.label,
    tier: row.tier,
    state: row.state,
    presence: row.presence,
    confidence: row.confidence,
    opted_in_at: row.opted_in_at,
    opted_out_at: row.opted_out_at,
    last_signal_at: row.last_signal_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}
