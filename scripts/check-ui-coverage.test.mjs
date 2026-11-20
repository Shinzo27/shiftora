// Unit tests for the UI coverage check. Run with `node --test scripts/` (pnpm test:scripts).
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { allowlistIn, callsIn, check, normalise, routesIn } from './check-ui-coverage.mjs';

test('normalise: params and template expressions compare equal, query strings drop', () => {
  assert.equal(normalise('employees/:id/time-off'), '/employees/:/time-off');
  assert.equal(normalise('/employees/${id}/time-off?from=x'), '/employees/:/time-off');
});

test('routesIn: joins the controller prefix and each handler path', () => {
  const source = `
    @Controller('job-roles')
    export class JobRolesController {
      @Get() list() {}
      @Patch(':id') rename() {}
    }`;
  assert.deepEqual(routesIn(source), [
    { method: 'GET', path: '/job-roles' },
    { method: 'PATCH', path: '/job-roles/:' },
  ]);
  assert.deepEqual(routesIn("@Controller()\nclass X { @Get('me/shifts') m() {} }"), [
    { method: 'GET', path: '/me/shifts' },
  ]);
});

test('callsIn: reads quoted and template paths from the client', () => {
  const calls = callsIn("api.get('/members'); api.put(`/employees/${id}/availability`, {})");
  assert.ok(calls.has('/members'));
  assert.ok(calls.has('/employees/:/availability'));
});

const doc = `
## Pages
| Route | Screen |
|---|---|
| \`/o/:orgId/team\` | Team |

## API-only routes and why

| Route | Why there is no screen |
|---|---|
| \`POST /auth/refresh\` | Called by the client. |
| \`/webhooks/*\` | Providers call them. |
| \`GET /schedules/:id\` | Integrations. |
`;

test('allowlistIn: only the API-only table, with methods and wildcards', () => {
  const entries = allowlistIn(doc);
  assert.deepEqual(
    entries.map((entry) => [entry.methods, entry.path]),
    [
      [['POST'], '/auth/refresh'],
      [null, '/webhooks/*'],
      [['GET'], '/schedules/:'],
    ],
  );
});

test('check: a route with no caller and no reason is missing; a dead reason is stale', () => {
  const entries = allowlistIn(doc);
  const routes = [
    { method: 'POST', path: '/auth/refresh' },
    { method: 'POST', path: '/webhooks/whatsapp' },
    { method: 'GET', path: '/members' },
    { method: 'DELETE', path: '/members/:' },
    { method: 'PATCH', path: '/schedules/:' }, // a different method than the reason allows
  ];
  const { missing, stale } = check({ routes, calls: new Set(['/members']), entries });
  assert.deepEqual(missing, [
    { method: 'DELETE', path: '/members/:' },
    { method: 'PATCH', path: '/schedules/:' },
  ]);
  assert.deepEqual(
    stale.map((entry) => entry.raw),
    ['GET /schedules/:id'],
  );
});
