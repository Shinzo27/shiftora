import { describe, expect, it } from 'vitest';

import { applyProviderReport, type DeliveryState } from './provider-status.js';

const t1 = new Date('2026-11-16T03:30:00Z');
const t2 = new Date('2026-11-16T03:31:00Z');

const sent: DeliveryState = { status: 'sent', deliveredAt: null, readAt: null };

describe('applyProviderReport', () => {
  it('a delivery report moves a sent message to delivered', () => {
    expect(applyProviderReport(sent, { status: 'delivered', at: t1 })).toEqual({
      kind: 'progress',
      status: 'delivered',
      deliveredAt: t1,
      readAt: null,
    });
  });

  it('a read report implies delivery, at the latest when it was read', () => {
    expect(applyProviderReport(sent, { status: 'read', at: t2 })).toEqual({
      kind: 'progress',
      status: 'delivered',
      deliveredAt: t2,
      readAt: t2,
    });
  });

  it('a late "delivered" after "read" keeps both times (reports arrive out of order)', () => {
    const read: DeliveryState = { status: 'delivered', deliveredAt: t1, readAt: t2 };
    expect(applyProviderReport(read, { status: 'delivered', at: t2 })).toBeNull();
  });

  it('the same report twice changes nothing the second time', () => {
    const delivered: DeliveryState = { status: 'delivered', deliveredAt: t1, readAt: null };
    expect(applyProviderReport(delivered, { status: 'delivered', at: t1 })).toBeNull();
    expect(applyProviderReport(delivered, { status: 'read', at: t2 })).toMatchObject({
      readAt: t2,
      deliveredAt: t1,
    });
  });

  it('"sent" is ignored: the worker marks that itself', () => {
    expect(applyProviderReport(sent, { status: 'sent', at: t1 })).toBeNull();
  });

  it('a failure after acceptance is a failure, with the reason', () => {
    expect(
      applyProviderReport(sent, { status: 'failed', at: t1, error: 'Message undeliverable' }),
    ).toEqual({ kind: 'failed', reason: 'Message undeliverable' });
  });

  it('a delivered message cannot un-arrive, and a failed one is not failed twice', () => {
    const delivered: DeliveryState = { status: 'delivered', deliveredAt: t1, readAt: null };
    expect(applyProviderReport(delivered, { status: 'failed', at: t2 })).toBeNull();
    const failed: DeliveryState = { status: 'failed', deliveredAt: null, readAt: null };
    expect(applyProviderReport(failed, { status: 'failed', at: t2 })).toBeNull();
    expect(applyProviderReport(failed, { status: 'delivered', at: t2 })).toBeNull();
  });

  it('nothing can be reported about a skipped delivery', () => {
    const skipped: DeliveryState = { status: 'skipped', deliveredAt: null, readAt: null };
    expect(applyProviderReport(skipped, { status: 'delivered', at: t1 })).toBeNull();
  });

  it('a report that beats the worker\'s own "sent" write still counts', () => {
    const queued: DeliveryState = { status: 'queued', deliveredAt: null, readAt: null };
    expect(applyProviderReport(queued, { status: 'delivered', at: t1 })).toMatchObject({
      status: 'delivered',
    });
  });
});
