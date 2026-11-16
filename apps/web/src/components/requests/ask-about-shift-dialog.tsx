import type { Employee, MyShift } from '@shiftora/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { ApiError } from '@/lib/api-client';
import { employeesApi, shiftRequestsApi } from '@/lib/api';

export type RequestKind = 'swap' | 'drop';

/**
 * "Can someone take this?" (W5 D5).
 *
 * A swap names a colleague; a drop names nobody and goes straight to a manager. Either way the
 * ask is a request, not a change: nothing moves until the colleague (for a swap) and a manager
 * (always) have said yes.
 */
export function AskAboutShiftDialog({
  orgId,
  shift,
  kind,
  onClose,
}: {
  orgId: string;
  shift: MyShift | null;
  kind: RequestKind | null;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [colleagueId, setColleagueId] = useState<string>('');
  const [note, setNote] = useState('');

  const staff = useQuery({
    queryKey: ['employees', orgId, 'for-swap'],
    queryFn: () => employeesApi.list(orgId, { limit: 100 }),
    enabled: kind === 'swap',
  });

  const ask = useMutation({
    mutationFn: () => {
      if (!shift || !kind) throw new Error('Nothing to ask about');
      return shiftRequestsApi.create(orgId, {
        type: kind,
        shiftId: shift.id,
        ...(kind === 'swap' ? { targetEmployeeId: colleagueId } : {}),
        ...(note.trim() ? { note: note.trim() } : {}),
      });
    },
    onSuccess: () => {
      toast.success(kind === 'swap' ? 'Asked. Your colleague decides next.' : 'Sent to a manager.');
      void queryClient.invalidateQueries({ queryKey: ['me-requests', orgId] });
      close();
    },
    onError: (error: unknown) => {
      toast.error(error instanceof ApiError ? error.message : 'That did not work. Try again.');
    },
  });

  function close() {
    setColleagueId('');
    setNote('');
    onClose();
  }

  const open = shift !== null && kind !== null;

  return (
    <Dialog open={open} onOpenChange={(next) => !next && close()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {kind === 'swap' ? 'Ask a colleague to take it' : 'Give this shift up'}
          </DialogTitle>
          <DialogDescription>
            {shift
              ? `${shift.date} · ${shift.startTime}–${shift.endTime} · ${shift.locationName}`
              : ''}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {kind === 'swap' && (
            <div className="space-y-1.5">
              <Label htmlFor="colleague">Who should take it?</Label>
              <Select value={colleagueId} onValueChange={setColleagueId}>
                <SelectTrigger id="colleague">
                  <SelectValue
                    placeholder={staff.isPending ? 'Loading the team…' : 'Choose a colleague'}
                  />
                </SelectTrigger>
                <SelectContent>
                  {(staff.data?.items ?? [])
                    .filter((person: Employee) => person.status === 'active')
                    .map((person: Employee) => (
                      <SelectItem key={person.id} value={person.id}>
                        {person.name}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="note">Anything they should know? (optional)</Label>
            <Textarea
              id="note"
              rows={3}
              maxLength={500}
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder={kind === 'drop' ? 'Why you cannot work it' : 'Why you need the change'}
            />
          </div>

          {kind === 'drop' && (
            <p className="text-xs text-muted-foreground">
              A manager decides, then the shift goes to whoever is free and qualified — you will
              hear either way.
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={close} disabled={ask.isPending}>
            Cancel
          </Button>
          <Button
            onClick={() => ask.mutate()}
            disabled={ask.isPending || (kind === 'swap' && !colleagueId)}
          >
            {ask.isPending ? 'Sending…' : kind === 'swap' ? 'Send the ask' : 'Ask to give it up'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
