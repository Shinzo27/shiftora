import { Injectable } from '@nestjs/common';
import { projectCost, weekBounds, type WorkedPeriod } from '@shiftora/domain';
import { errorCodes, type ScheduleCost } from '@shiftora/shared';

import { AppException } from '../../common/app-exception.js';
import { EmployeesService } from '../employees/employees.service.js';
import { LocationAccess } from '../locations/location-access.service.js';
import { LocationsRepository } from '../locations/locations.repository.js';
import { PayRulesService } from '../pay-rules/pay-rules.service.js';
import { SchedulesRepository } from './schedules.repository.js';
import { ShiftsRepository, type ShiftRecord } from './shifts.repository.js';

const notFound = () => new AppException(404, errorCodes.scheduleNotFound, 'No such schedule.');
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The projected labour cost of a week's schedule (W6 D6): every assigned shift priced with the
 * pay engine (`projectCost` → `computePay`), each shift's planned break as its unpaid break, and
 * overtime worked out with the person's other shifts that week at any location, each shift charged
 * in time order (`projectCost`): overtime lands where it happens, and branches' figures add up.
 */
@Injectable()
export class ScheduleCostService {
  constructor(
    private readonly schedules: SchedulesRepository,
    private readonly shifts: ShiftsRepository,
    private readonly employees: EmployeesService,
    private readonly locations: LocationsRepository,
    private readonly access: LocationAccess,
    private readonly payRules: PayRulesService,
  ) {}

  async cost(scheduleId: string): Promise<ScheduleCost> {
    const schedule = await this.schedules.findById(scheduleId);
    if (!schedule) throw notFound();
    let timezone: string;
    try {
      timezone = (await this.access.assertAccess(schedule.locationId)).timezone;
    } catch (error) {
      if (error instanceof AppException && error.code === errorCodes.locationNotFound) {
        throw notFound();
      }
      throw error;
    }

    const rows = (await this.shifts.listBySchedule(schedule.id)).filter(
      (row) => row.status !== 'cancelled',
    );
    const assigned = rows.filter(
      (row): row is ShiftRecord & { employeeId: string } => row.employeeId !== null,
    );
    const employeeIds = [...new Set(assigned.map((row) => row.employeeId))];

    // Their other shifts around this week (a day either side catches an overnight at the edge).
    const week = weekBounds(schedule.weekStart, timezone);
    const [people, versions, around] = await Promise.all([
      this.employees.findMany(employeeIds),
      this.payRules.versions(),
      this.shifts.forEmployees(
        employeeIds,
        new Date(week.start.getTime() - DAY_MS),
        new Date(week.end.getTime() + DAY_MS),
      ),
    ]);
    const zones = new Map(
      (await this.locations.findByIds([...new Set(around.map((row) => row.locationId))])).map(
        (location) => [location.id, location.timezone],
      ),
    );
    const planned = (row: ShiftRecord): WorkedPeriod => ({
      id: row.id,
      startsAt: row.startsAt,
      endsAt: row.endsAt,
      timezone: zones.get(row.locationId) ?? timezone,
      breakMinutes: row.breakMinutes,
    });

    const projection = projectCost(
      employeeIds.map((employeeId) => ({
        employeeId,
        hourlyRateMinor: people.get(employeeId)?.hourlyRateMinor ?? 0,
        shifts: assigned.filter((row) => row.employeeId === employeeId).map(planned),
        otherShifts: around
          .filter((row) => row.employeeId === employeeId && row.scheduleId !== schedule.id)
          .map(planned),
      })),
      versions,
    );

    const firstPerson = people.values().next().value;
    return {
      scheduleId: schedule.id,
      currency: firstPerson?.currency ?? 'INR',
      costMinor: projection.costMinor,
      paidMinutes: projection.paidMinutes,
      overtimeMinutes: projection.overtimeMinutes,
      openShifts: rows.filter((row) => row.employeeId === null).length,
      people: projection.people
        .map((person) => ({ ...person, name: people.get(person.employeeId)?.name ?? '' }))
        .sort((a, b) => b.costMinor - a.costMinor),
    };
  }
}
