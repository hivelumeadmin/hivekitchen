import fp from 'fastify-plugin';
import twilio from 'twilio';
import type { Twilio } from 'twilio';

export const twilioPlugin = fp(async (fastify) => {
  const client: Twilio = twilio(fastify.env.TWILIO_ACCOUNT_SID, fastify.env.TWILIO_AUTH_TOKEN);
  fastify.decorate('twilio', client);
});
