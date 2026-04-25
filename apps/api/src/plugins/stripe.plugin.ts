import fp from 'fastify-plugin';
import Stripe from 'stripe';

export const stripePlugin = fp(async (fastify) => {
  const client = new Stripe(fastify.env.STRIPE_SECRET_KEY, {
    apiVersion: '2026-04-22.dahlia',
    typescript: true,
  });
  fastify.decorate('stripe', client);
});
