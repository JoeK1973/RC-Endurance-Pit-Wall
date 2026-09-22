# Driver time tracking fix

Changes in this build:
- Stint history and rotation history no longer depend on Firestore composite ordering indexes; results are sorted locally.
- Driver stint and race-event collections are now subscribed to through Firebase realtime updates.
- Active driver load updates continuously while the race runs.
- Driver load uses recorded stint boundaries and tracks race pause time for new stints.
- New stints record pause time at start; closed stints record pause time at end.
- Existing queue, driver persistence, and driver/full-change permission fixes are preserved.
