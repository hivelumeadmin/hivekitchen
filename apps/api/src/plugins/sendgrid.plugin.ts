import fp from 'fastify-plugin';
import sgMail from '@sendgrid/mail';
import type { MailService } from '@sendgrid/mail';

export const sendgridPlugin = fp(async (fastify) => {
  sgMail.setApiKey(fastify.env.SENDGRID_API_KEY);
  fastify.decorate('sendgrid', sgMail as unknown as MailService);
});
