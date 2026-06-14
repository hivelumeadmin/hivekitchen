import fp from 'fastify-plugin';
import type { FastifyPluginAsync } from 'fastify';
import {
  PasswordResetRequestSchema,
  UpdateProfileRequestSchema,
  UpdateNotificationPrefsRequestSchema,
  UpdateCulturalPreferenceRequestSchema,
  UpdateAccessibilityRequestSchema,
  UpdateVoiceRetentionRequestSchema,
  VoiceTranscriptsResponseSchema,
  UserProfileSchema,
} from '@hivekitchen/contracts';
import type {
  UpdateProfileRequest,
  UpdateNotificationPrefsRequest,
  UpdateCulturalPreferenceRequest,
  UpdateAccessibilityRequest,
  UpdateVoiceRetentionRequest,
  PasswordResetRequest,
} from '@hivekitchen/types';
import { UserRepository } from './user.repository.js';
import { UserService } from './user.service.js';
import { VoiceTranscriptRepository } from '../voice/voice-transcript.repository.js';

const userRoutesPlugin: FastifyPluginAsync = async (fastify) => {
  const repository = new UserRepository(fastify.supabase);
  const service = new UserService(repository, fastify.supabase);
  const voiceTranscriptRepo = new VoiceTranscriptRepository(fastify.supabase);

  fastify.get(
    '/v1/users/me',
    {
      schema: { response: { 200: UserProfileSchema } },
    },
    async (request) => {
      return service.getMyProfile(request.user.id, request.user.household_id);
    },
  );

  fastify.patch(
    '/v1/users/me',
    {
      schema: {
        body: UpdateProfileRequestSchema,
        response: { 200: UserProfileSchema },
      },
    },
    async (request) => {
      const body = request.body as UpdateProfileRequest;
      const { profile, fieldsChanged } = await service.updateMyProfile(
        request.user.id,
        request.user.household_id,
        body,
      );
      request.auditContext = {
        event_type: 'account.updated',
        user_id: request.user.id,
        household_id: request.user.household_id,
        request_id: request.id,
        metadata: { fields_changed: fieldsChanged },
      };
      return profile;
    },
  );

  fastify.patch(
    '/v1/users/me/notifications',
    {
      schema: {
        body: UpdateNotificationPrefsRequestSchema,
        response: { 200: UserProfileSchema },
      },
    },
    async (request) => {
      const body = request.body as UpdateNotificationPrefsRequest;
      const profile = await service.updateMyNotifications(
        request.user.id,
        request.user.household_id,
        body,
      );
      request.auditContext = {
        event_type: 'account.updated',
        user_id: request.user.id,
        household_id: request.user.household_id,
        request_id: request.id,
        metadata: { fields_changed: ['notification_prefs'] },
      };
      return profile;
    },
  );

  fastify.patch(
    '/v1/users/me/preferences',
    {
      schema: {
        body: UpdateCulturalPreferenceRequestSchema,
        response: { 200: UserProfileSchema },
      },
    },
    async (request) => {
      const body = request.body as UpdateCulturalPreferenceRequest;
      const { profile, fieldsChanged } = await service.updateMyPreferences(
        request.user.id,
        request.user.household_id,
        body,
      );
      request.auditContext = {
        event_type: 'account.updated',
        user_id: request.user.id,
        household_id: request.user.household_id,
        request_id: request.id,
        metadata: { fields_changed: fieldsChanged },
      };
      return profile;
    },
  );

  fastify.patch(
    '/v1/users/me/accessibility',
    {
      schema: {
        body: UpdateAccessibilityRequestSchema,
        response: { 200: UserProfileSchema },
      },
    },
    async (request) => {
      const body = request.body as UpdateAccessibilityRequest;
      const profile = await service.updateMyAccessibility(
        request.user.id,
        request.user.household_id,
        body,
      );
      request.auditContext = {
        event_type: 'account.updated',
        user_id: request.user.id,
        household_id: request.user.household_id,
        request_id: request.id,
        metadata: { fields_changed: ['caption_only_mode'] },
      };
      return profile;
    },
  );

  fastify.get(
    '/v1/users/me/voice-transcripts',
    {
      schema: {
        response: { 200: VoiceTranscriptsResponseSchema },
      },
    },
    async (request) => {
      const userId = request.user.id;
      const [transcripts, userRow] = await Promise.all([
        voiceTranscriptRepo.findByUserId(userId),
        repository.findUserById(userId),
      ]);
      const voice_retention_mode = userRow?.voice_retention_mode ?? 'standard';
      return { transcripts, voice_retention_mode };
    },
  );

  fastify.patch(
    '/v1/users/me/voice-retention',
    {
      schema: {
        body: UpdateVoiceRetentionRequestSchema,
        response: { 200: UserProfileSchema },
      },
    },
    async (request) => {
      const body = request.body as UpdateVoiceRetentionRequest;
      const userId = request.user.id;

      // Delete existing transcripts synchronously before updating mode (AC5).
      // Only delete when switching to immediate_delete — standard mode keeps them.
      if (body.voice_retention_mode === 'immediate_delete') {
        await voiceTranscriptRepo.deleteByUserId(userId);
      }

      const profile = await service.updateVoiceRetention(
        userId,
        request.user.household_id,
        body,
      );
      request.auditContext = {
        event_type: 'account.updated',
        user_id: userId,
        household_id: request.user.household_id,
        request_id: request.id,
        metadata: { fields_changed: ['voice_retention_mode'] },
      };
      return profile;
    },
  );

  fastify.post(
    '/v1/auth/password-reset',
    {
      schema: { body: PasswordResetRequestSchema },
    },
    async (request, reply) => {
      const body = request.body as PasswordResetRequest;
      await service.initiatePasswordReset(body.email, fastify.env.WEB_BASE_URL);
      request.auditContext = {
        event_type: 'auth.password_reset_initiated',
        request_id: request.id,
        metadata: {},
      };
      return reply.code(204).send();
    },
  );
};

export const userRoutes = fp(userRoutesPlugin, { name: 'user-routes' });
