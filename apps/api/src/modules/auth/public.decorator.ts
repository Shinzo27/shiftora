import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC = 'auth:isPublic';

/**
 * Opts a route (or a whole controller) out of the global JwtAuthGuard.
 * Every route is protected by default; use this only for genuinely public endpoints.
 */
export const Public = () => SetMetadata(IS_PUBLIC, true);
