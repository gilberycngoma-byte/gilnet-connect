BEGIN;

ALTER TABLE public.work_shifts
  ADD COLUMN shift_pattern text NOT NULL DEFAULT 'Morning and Afternoon',
  ADD CONSTRAINT work_shifts_shift_pattern_check
    CHECK (shift_pattern IN ('Morning and Night', 'Morning and Afternoon'));

NOTIFY pgrst, 'reload schema';
COMMIT;
