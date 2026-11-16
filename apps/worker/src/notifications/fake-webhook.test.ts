import { createHmac } from 'node:crypto';
import { createServer, type IncomingHttpHeaders } from 'node:http';
import type { AddressInfo } from 'node:net';

import { describe, expect, it } from 'vitest';

import { FakeMessageSender } from './fake-sender.js';
import { createFakeWebhookReporter, signMetaPayload } from './fake-webhook.js';

describe('the fake provider’s delivery reports', () => {
  it('signs exactly the bytes it sends, as Meta does', () => {
    const body = '{"object":"whatsapp_business_account"}';
    const expected = createHmac('sha256', 'app-secret-123456').update(body).digest('hex');
    expect(signMetaPayload(body, 'app-secret-123456')).toBe(`sha256=${expected}`);
  });

  it('reports delivered then read for an accepted WhatsApp, as signed Meta webhooks', async () => {
    const received: { headers: IncomingHttpHeaders; body: string }[] = [];
    const server = createServer((req, res) => {
      let body = '';
      req.on('data', (chunk: Buffer) => (body += chunk.toString()));
      req.on('end', () => {
        received.push({ headers: req.headers, body });
        res.writeHead(200).end();
      });
    });
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const { port } = server.address() as AddressInfo;

    const reporter = createFakeWebhookReporter({
      url: `http://127.0.0.1:${port}/webhooks/whatsapp`,
      secret: 'app-secret-123456',
      delayMs: 10,
    });
    const sender = new FakeMessageSender('whatsapp', 'none', () => undefined, reporter);
    const { messageId } = await sender.send({ to: '+919820000001', subject: 'Hi', body: 'Hi' });

    await expect.poll(() => received.length, { timeout: 2_000 }).toBe(2);
    server.close();

    const statuses = received.map((r) => {
      expect(r.headers['x-hub-signature-256']).toBe(signMetaPayload(r.body, 'app-secret-123456'));
      const parsed = JSON.parse(r.body) as {
        entry: { changes: { value: { statuses: { id: string; status: string }[] } }[] }[];
      };
      return parsed.entry[0]!.changes[0]!.value.statuses[0]!;
    });
    expect(statuses.map((s) => s.status)).toEqual(['delivered', 'read']);
    expect(statuses.every((s) => s.id === messageId)).toBe(true);
    // Never a phone number in the report.
    expect(received.some((r) => r.body.includes('9820000001'))).toBe(false);
  });

  it('an undeliverable number is accepted, then reported failed', async () => {
    const reports: string[] = [];
    const sender = new FakeMessageSender(
      'whatsapp',
      'undeliverable',
      () => undefined,
      (r) => reports.push(r.status),
    );
    await expect(sender.send({ to: '+919820000001', subject: 'Hi', body: 'Hi' })).resolves.toEqual({
      messageId: expect.stringMatching(/^fake-whatsapp-/) as string,
    });
    expect(reports).toEqual(['failed']);
  });
});
