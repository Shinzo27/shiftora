/** Who is calling, attached to the request by JwtAuthGuard. Org and role arrive on day 4. */
export interface AuthenticatedUser {
  id: string;
}

declare module 'fastify' {
  interface FastifyRequest {
    user?: AuthenticatedUser;
  }
}
