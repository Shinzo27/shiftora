import { Injectable, Logger } from '@nestjs/common';
import type { Server } from 'socket.io';

import {
  AUTOFILL_UPDATED,
  SCHEDULE_CHANGED,
  orgRoom,
  type AutofillProgressEvent,
  type ScheduleChangedEvent,
} from './realtime.events.js';

/**
 * Publishes board changes to whoever is looking at them.
 *
 * Services call this after a write has landed. The event carries the schedule it belongs to,
 * so a client ignores other weeks and branches — one room per organisation is enough at this
 * size, and the payload is what keeps it cheap if it ever needs narrowing.
 *
 * Emitting happens just after the write and just before the request's transaction commits.
 * That is deliberate: if the commit were to fail, the worst case is a client refetching a week
 * that did not change — never a client missing a change that did.
 */
@Injectable()
export class RealtimeService {
  private readonly logger = new Logger(RealtimeService.name);
  private server: Server | null = null;

  /** Called by the gateway once Socket.IO is up. */
  attach(server: Server): void {
    this.server = server;
  }

  /** Progress from the worker's long jobs; the page refetches the run when it hears this. */
  autofillProgress(event: AutofillProgressEvent): void {
    if (!this.server) return;
    try {
      this.server.to(orgRoom(event.orgId)).emit(AUTOFILL_UPDATED, event);
    } catch (error) {
      this.logger.warn(`Could not emit ${AUTOFILL_UPDATED}: ${(error as Error).message}`);
    }
  }

  scheduleChanged(event: ScheduleChangedEvent): void {
    if (!this.server) return; // no realtime in this process (tests, CLI)
    try {
      this.server.to(orgRoom(event.orgId)).emit(SCHEDULE_CHANGED, event);
    } catch (error) {
      // Realtime is an optimisation: a failed emit must never fail the write.
      this.logger.warn(`Could not emit ${SCHEDULE_CHANGED}: ${(error as Error).message}`);
    }
  }
}
