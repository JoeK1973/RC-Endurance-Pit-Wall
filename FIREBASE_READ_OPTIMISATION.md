# Firebase read optimisation

This migration has been adjusted so the Pit Wall does not reload every session collection after every realtime event.

## Realtime behaviour

- The initial session load reads race state, drivers, queue, live-results configuration and stored laps once.
- Firestore realtime listeners skip their initial snapshots because that data has already been loaded.
- Subsequent realtime events use `docChanges()` and update only the affected local records.
- A new driver no longer triggers a complete session reload, so it cannot disappear because of a stale refresh racing the insert.
- New/deleted/modified laps update the local lap list incrementally instead of rereading the complete lap collection.
- RC-Results polling remains HTTP/API polling; it does not write the live timing table to Firestore every five seconds.

## Write-path optimisation

- Inserts using `.select()` return the newly generated document data without an additional Firestore read.
- ID-only updates no longer perform a read before the write.
- ID-only deletes no longer perform a read before the delete.
- ID-based updates/deletes with additional filters retain the read needed to preserve Supabase-style semantics.

## Expected effect

A four-hour race with multiple devices should use substantially fewer reads than the first migration build, particularly when laps are being recorded frequently. The exact usage still depends on the number of connected devices and the number of changed documents.
