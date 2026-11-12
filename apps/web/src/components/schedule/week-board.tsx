import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  closestCenter,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import { weekDates, type LocalDate } from '@shiftora/domain';
import type { Employee, JobRole, Shift, ShiftWarning } from '@shiftora/shared';
import { Plus, TriangleAlert, UserRound } from 'lucide-react';
import { motion, useReducedMotion } from 'motion/react';
import { useState, type ReactNode } from 'react';

import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import type { ShiftMoveRequest } from '@/lib/schedule';
import { cn } from '@/lib/utils';
import {
  compactDuration,
  dayOfMonth,
  isWeekend,
  monthShort,
  readableDate,
  weekdayShort,
} from '@/lib/week';

/** A small distance lets a click still open the sheet; a hold starts a touch drag. */
const POINTER_OPTIONS = { activationConstraint: { distance: 5 } } as const;
const TOUCH_OPTIONS = { activationConstraint: { delay: 250, tolerance: 8 } } as const;

/** Chart tokens cycle per job role, so a role keeps its colour everywhere on the board. */
const ROLE_COLOURS = [
  'var(--chart-1)',
  'var(--chart-2)',
  'var(--chart-3)',
  'var(--chart-4)',
  'var(--chart-5)',
];

interface Row {
  key: string;
  /** null for the open-shifts row. */
  employeeId: string | null;
  name: string;
  detail?: string;
  /** Shifts whose employee is not on this location's team (archived, or moved). */
  loose?: boolean;
}

interface Cell {
  date: LocalDate;
  employeeId: string | null;
}

interface WeekBoardProps {
  weekStart: LocalDate;
  today: LocalDate;
  employees: Employee[];
  shifts: Shift[];
  jobRoles: JobRole[];
  /** Conflict warnings per shift, from the schedule's conflicts endpoint. */
  conflicts: Map<string, ShiftWarning[]>;
  onAdd: (cell: Cell) => void;
  onEdit: (shift: Shift) => void;
  /** A chip was dropped on another day and/or row. */
  onMove: (move: ShiftMoveRequest) => void;
}

/**
 * The week: employees down, days across. A shift sits in the column of the local date it
 * starts on (so an overnight shift stays on its evening), and rows come from the team plus
 * anyone who actually has a shift, so nothing on the week can be invisible.
 *
 * Chips are draggable between cells (dnd-kit): a drop changes the date and/or who is on it,
 * never the times — those live in the sheet. Everything is still reachable by keyboard:
 * Enter opens the sheet, Space picks the chip up and the arrows move it between cells.
 */
export function WeekBoard({
  weekStart,
  today,
  employees,
  shifts,
  jobRoles,
  conflicts,
  onAdd,
  onEdit,
  onMove,
}: WeekBoardProps) {
  const dates = weekDates(weekStart);
  const rows = buildRows(employees, shifts, jobRoles);
  const [dragging, setDragging] = useState<Shift | null>(null);
  const reduceMotion = useReducedMotion();

  const byCell = new Map<string, Shift[]>();
  for (const shift of shifts) {
    const key = cellKey(shift.employeeId, shift.date);
    const cell = byCell.get(key) ?? [];
    cell.push(shift);
    byCell.set(key, cell);
  }
  for (const cell of byCell.values()) cell.sort((a, b) => a.startTime.localeCompare(b.startTime));

  const totals = dates.map((date) =>
    shifts
      .filter((shift) => shift.date === date)
      .reduce((sum, shift) => sum + shift.paidMinutes, 0),
  );

  const sensors = useSensors(
    // Module-level options: a fresh object each render would give dnd-kit a new sensor
    // instance mid-drag and silently cancel it.
    useSensor(PointerSensor, POINTER_OPTIONS),
    useSensor(TouchSensor, TOUCH_OPTIONS),
    useSensor(KeyboardSensor),
  );

  function handleDragStart(event: DragStartEvent) {
    const shift = event.active.data.current?.shift as Shift | undefined;
    setDragging(shift ?? null);
  }

  function handleDragEnd(event: DragEndEvent) {
    setDragging(null);
    const shift = event.active.data.current?.shift as Shift | undefined;
    const target = event.over?.data.current as Cell | undefined;
    if (!shift || !target) return;
    if (target.date === shift.date && target.employeeId === shift.employeeId) return;
    onMove({
      id: shift.id,
      date: target.date,
      employeeId: target.employeeId,
      version: shift.version,
    });
  }

  return (
    <div className="space-y-3">
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        onDragCancel={() => setDragging(null)}
      >
        <div className="overflow-x-auto rounded-xl border bg-card shadow-xs">
          <table className="w-full min-w-[58rem] border-separate border-spacing-0 text-sm">
            <caption className="sr-only">
              Week of {readableDate(dates[0]!)}: shifts per employee and day
            </caption>
            <thead>
              <tr>
                <th
                  scope="col"
                  className="sticky top-14 left-0 z-30 w-48 border-r border-b bg-card px-3 py-2 text-left align-bottom"
                >
                  <span className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                    Team
                  </span>
                </th>
                {dates.map((date) => {
                  const isToday = date === today;
                  return (
                    <th
                      key={date}
                      scope="col"
                      className={cn(
                        'sticky top-14 z-20 min-w-[7.5rem] border-r border-b bg-card px-2 py-2 text-left font-normal last:border-r-0',
                        isToday && 'bg-primary/5',
                      )}
                      aria-current={isToday ? 'date' : undefined}
                    >
                      <span
                        className={cn(
                          'flex items-baseline gap-1.5 text-muted-foreground',
                          isToday && 'text-primary',
                        )}
                      >
                        <span className="text-xs font-medium uppercase">{weekdayShort(date)}</span>
                        <span className="text-base font-semibold tabular-nums">
                          {dayOfMonth(date)}
                        </span>
                        <span className="text-[11px]">{monthShort(date)}</span>
                        {isToday ? (
                          <Badge className="ml-auto h-4 px-1 text-[10px]">Today</Badge>
                        ) : null}
                      </span>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.key}>
                  <th
                    scope="row"
                    className="sticky left-0 z-10 border-r border-b bg-card px-3 py-2 text-left align-top font-normal"
                  >
                    <span className="flex items-center gap-2">
                      <span
                        className={cn(
                          'flex size-7 shrink-0 items-center justify-center rounded-full border bg-muted text-[11px] font-medium',
                          row.employeeId ? 'text-foreground' : 'text-muted-foreground',
                        )}
                        aria-hidden="true"
                      >
                        {row.employeeId ? initialsOf(row.name) : <UserRound className="size-3.5" />}
                      </span>
                      <span className="min-w-0">
                        <span
                          className={cn(
                            'block truncate text-sm font-medium',
                            row.loose && 'text-muted-foreground',
                          )}
                        >
                          {row.name}
                        </span>
                        {row.detail ? (
                          <span className="block truncate text-[11px] text-muted-foreground">
                            {row.detail}
                          </span>
                        ) : null}
                      </span>
                    </span>
                  </th>
                  {dates.map((date) => (
                    <DayCell
                      key={date}
                      id={cellKey(row.employeeId, date)}
                      cell={{ date, employeeId: row.employeeId }}
                      isToday={date === today}
                      weekend={isWeekend(date)}
                    >
                      {(byCell.get(cellKey(row.employeeId, date)) ?? []).map((shift) => (
                        <DraggableShift
                          key={shift.id}
                          shift={shift}
                          role={jobRoles.find((role) => role.id === shift.jobRoleId)?.name}
                          colour={colourFor(jobRoles, shift.jobRoleId)}
                          warnings={conflicts.get(shift.id) ?? []}
                          onEdit={onEdit}
                        />
                      ))}
                      <button
                        type="button"
                        onClick={() => onAdd({ date, employeeId: row.employeeId })}
                        aria-label={`Add a shift for ${row.name} on ${readableDate(date)}`}
                        className="flex min-h-6 flex-1 items-center justify-center rounded-md border border-dashed border-transparent text-muted-foreground/60 transition-colors hover:border-border hover:bg-accent/50 hover:text-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:outline-none"
                      >
                        <Plus className="size-3.5" aria-hidden="true" />
                      </button>
                    </DayCell>
                  ))}
                </tr>
              ))}
              {rows.length === 0 ? (
                <tr>
                  <td
                    colSpan={8}
                    className="border-b px-3 py-10 text-center text-sm text-muted-foreground"
                  >
                    Add employees to start building this week.
                  </td>
                </tr>
              ) : null}
            </tbody>
            <tfoot>
              <tr>
                <th
                  scope="row"
                  className="sticky left-0 z-10 border-r bg-card px-3 py-2 text-left text-xs font-medium text-muted-foreground"
                >
                  Scheduled
                </th>
                {dates.map((date, index) => (
                  <td
                    key={date}
                    className="border-r px-2 py-2 text-xs tabular-nums text-muted-foreground last:border-r-0"
                  >
                    {totals[index] ? compactDuration(totals[index]) : '—'}
                  </td>
                ))}
              </tr>
            </tfoot>
          </table>
        </div>

        <DragOverlay dropAnimation={{ duration: 160, easing: 'cubic-bezier(0.2, 0, 0, 1)' }}>
          {dragging ? (
            <motion.div
              initial={{ scale: 0.97, rotate: 0 }}
              animate={{ scale: reduceMotion ? 1 : 1.03, rotate: reduceMotion ? 0 : -1 }}
              transition={{ duration: 0.12 }}
              className="w-44 cursor-grabbing"
            >
              <div
                className="rounded-md border border-l-[3px] bg-card px-2 py-1.5 shadow-lg ring-1 ring-ring/30"
                style={{
                  borderLeftColor: colourFor(jobRoles, dragging.jobRoleId) ?? 'var(--border)',
                }}
              >
                <ChipBody
                  shift={dragging}
                  role={jobRoles.find((role) => role.id === dragging.jobRoleId)?.name}
                />
              </div>
            </motion.div>
          ) : null}
        </DragOverlay>
      </DndContext>
      <RoleLegend jobRoles={jobRoles} />
    </div>
  );
}

function cellKey(employeeId: string | null, date: LocalDate): string {
  return `${employeeId ?? 'open'}:${date}`;
}

/** A day cell is a drop target: dropping a chip here re-dates and/or reassigns it. */
function DayCell({
  id,
  cell,
  isToday,
  weekend,
  children,
}: {
  id: string;
  cell: Cell;
  isToday: boolean;
  weekend: boolean;
  children: ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({ id, data: cell });
  return (
    <td
      ref={setNodeRef}
      className={cn(
        'border-r border-b p-1.5 align-top transition-colors last:border-r-0',
        isToday && 'bg-primary/5',
        weekend && !isToday && 'bg-muted/30',
        isOver && 'bg-primary/10 outline-2 -outline-offset-2 outline-primary/40',
      )}
    >
      <div className="flex min-h-14 flex-col gap-1.5">{children}</div>
    </td>
  );
}

function DraggableShift({
  shift,
  role,
  colour,
  warnings,
  onEdit,
}: {
  shift: Shift;
  role: string | undefined;
  colour: string | undefined;
  warnings: ShiftWarning[];
  onEdit: (shift: Shift) => void;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: shift.id,
    data: { shift },
  });
  const overnight = shift.endTime <= shift.startTime;
  const open = shift.status === 'open';

  const chip = (
    <button
      ref={setNodeRef}
      type="button"
      {...attributes}
      {...listeners}
      onClick={() => onEdit(shift)}
      style={{ borderLeftColor: colour ?? 'var(--border)' }}
      className={cn(
        'relative w-full cursor-grab rounded-md border border-l-[3px] bg-background px-2 py-1.5 text-left shadow-xs transition-colors hover:border-ring hover:bg-accent/40 focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none active:cursor-grabbing',
        open && 'border-dashed',
        isDragging && 'opacity-40',
      )}
      aria-label={`Edit shift ${readableDate(shift.date)}, ${shift.startTime} to ${shift.endTime}${
        overnight ? ' next day' : ''
      }${open ? ', open shift' : ''}${
        warnings.length
          ? `, ${warnings.length} warning${warnings.length === 1 ? '' : 's'}: ${warnings
              .map((warning) => warning.message)
              .join('; ')}`
          : ''
      }`}
    >
      <ChipBody shift={shift} role={role} />
      {warnings.length ? (
        <span className="absolute top-1 right-1 text-warning">
          <TriangleAlert className="size-3" aria-hidden="true" />
        </span>
      ) : null}
    </button>
  );

  if (warnings.length === 0) return chip;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{chip}</TooltipTrigger>
      <TooltipContent side="right" align="start" className="max-w-64">
        <ul className="space-y-1 text-left">
          {warnings.map((warning, index) => (
            <li key={`${warning.code}-${index}`}>{warning.message}</li>
          ))}
        </ul>
      </TooltipContent>
    </Tooltip>
  );
}

function ChipBody({ shift, role }: { shift: Shift; role: string | undefined }) {
  const overnight = shift.endTime <= shift.startTime;
  const open = shift.status === 'open';
  return (
    <>
      <span className="block pr-4 text-xs font-medium tabular-nums">
        {shift.startTime}–{shift.endTime}
        {overnight ? <span className="ml-1 text-[10px] text-muted-foreground">+1</span> : null}
      </span>
      <span className="mt-0.5 flex items-center gap-1 text-[11px] text-muted-foreground">
        <span className="truncate">{open ? 'Open shift' : (role ?? 'Any role')}</span>
        <span className="ml-auto shrink-0 tabular-nums">{compactDuration(shift.paidMinutes)}</span>
      </span>
    </>
  );
}

function RoleLegend({ jobRoles }: { jobRoles: JobRole[] }) {
  if (jobRoles.length === 0) return null;
  return (
    <ul className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
      {jobRoles.slice(0, 5).map((role) => (
        <li key={role.id} className="flex items-center gap-1.5">
          <span
            className="size-2 rounded-full"
            style={{ backgroundColor: colourFor(jobRoles, role.id) }}
            aria-hidden="true"
          />
          {role.name}
        </li>
      ))}
    </ul>
  );
}

function colourFor(jobRoles: JobRole[], jobRoleId: string | null): string | undefined {
  if (!jobRoleId) return undefined;
  const index = jobRoles.findIndex((role) => role.id === jobRoleId);
  return index < 0 ? undefined : ROLE_COLOURS[index % ROLE_COLOURS.length];
}

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/);
  const first = parts[0]?.[0] ?? '?';
  const last = parts.length > 1 ? (parts.at(-1)?.[0] ?? '') : '';
  return `${first}${last}`.toUpperCase();
}

/**
 * One row per employee at this location, then the open shifts, then a row for shifts whose
 * employee is no longer on the team (archived, or moved to another branch) so that no shift
 * on the week can be invisible.
 */
function buildRows(employees: Employee[], shifts: Shift[], jobRoles: JobRole[]): Row[] {
  const assigned = new Set(shifts.map((shift) => shift.employeeId).filter(Boolean));
  const rows: Row[] = employees.map((employee) => ({
    key: employee.id,
    employeeId: employee.id,
    name: employee.name,
    detail:
      employee.jobRoleIds
        .map((id) => jobRoles.find((role) => role.id === id)?.name)
        .filter(Boolean)
        .join(', ') || 'No job role yet',
  }));

  const known = new Set(rows.map((row) => row.employeeId));
  const loose = [...assigned].filter((id): id is string => !!id && !known.has(id));
  for (const id of loose) {
    rows.push({
      key: id,
      employeeId: id,
      name: 'Former or other staff',
      detail: 'Not on this location’s team',
      loose: true,
    });
  }

  if (shifts.some((shift) => shift.employeeId === null)) {
    rows.push({
      key: 'open',
      employeeId: null,
      name: 'Open shifts',
      detail: 'Nobody assigned yet',
    });
  }
  return rows;
}
