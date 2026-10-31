import { createHash, timingSafeEqual } from 'node:crypto';
import { createMiddleware } from 'hono/factory';
import { env } from '@server/env';

// Hash both sides so the buffers have equal length and the compare is constant-time.
const digest = (v: string) => createHash('sha256').update(v).digest();
const expected = digest(env.APP_TOKEN);

/** Gate for the `/:token` sub-app. A wrong token gets a bare 404 so nothing reveals the app. */
export const tokenGate = createMiddleware(async (c, next) => {
  const given = c.req.param('token') ?? '';
  if (!timingSafeEqual(digest(given), expected)) {
    return c.body(null, 404);
  }
  await next();
});
