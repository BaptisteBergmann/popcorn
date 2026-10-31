import { Hono } from 'hono';
import { env } from '@server/env';

export const api = new Hono().get('/config', (c) => {
  const token = c.req.param('token');
  return c.json({
    members: env.MEMBERS,
    stremioManifestUrl: `${env.SITE_URL}/${token}/stremio/manifest.json`,
  });
});
