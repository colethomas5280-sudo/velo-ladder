# Homepage shortcuts and group tests — design

**Date:** 2026-10-16
**Status:** implemented
**Builds on:** the velocity group screen (`components/GroupSession.tsx`), the movement
screen and Pitching Inhibitors modals (`ScreenModal.tsx`, `DeliveryModal.tsx`), the
draft helper (`lib/draft.ts`, and its stale-date fix in commit `5a10c1c`)

## What this is

Starting a session or a test today means: go to the Athletes page, tick athletes, click
"Log a session for N" (sessions), or open one athlete's page and use "Record a screen"
(tests). Cole wants to start from the homepage, and wants to run two athletes through the
same test at the same time on one device, the way a velocity session already handles
several athletes. The app he is taking the tests from (OnBaseU) can only do one athlete
at a time, which means two devices.

## Decisions

| Decision | Choice | Why |
|---|---|---|
| Homepage | Two buttons, **Track a new session** and **Track a new test**, pinned at the top of the Dashboard | Cole's request. They are not a dashboard widget, so Customize cannot hide them. |
| Which tests | Movement screen and Pitching Inhibitors | Cole's answer. Strength lift days stay where they are. |
| Several athletes | One group test screen with a tab per athlete, like the velocity group screen | Cole's answer: two athletes through the same test at once. |
| Unsaved answers | Survive a reload, per athlete and per test type | Cole's answer. A movement screen has dozens of answers; losing them mid-gym is the worst case. |
| One test type per group | Yes, chosen before the athletes | "The same test at the same time." Mixing types in one screen has no use case. |
| Delete | Not in the group screen | Deleting a record stays on the athlete's own page. The group screen is for recording. |
| Existing athlete flows | Unchanged | The athlete page and Tests page work exactly as now. |

## What the coach sees

**Homepage (coach only).** Two large buttons at the top of the Dashboard. An athlete never
reaches this page: they are redirected to their own profile, and every route the picker
and the forms call is already coach-gated.

**Track a new session.** An athlete picker opens (below). **Start** opens the existing
group velocity screen with those athletes. Mound or pulldown is chosen inside it, as
today. Nothing about that screen changes.

**Track a new test.** First a choice: *Movement screen* or *Pitching Inhibitors*. Then the
same athlete picker. **Start** opens the group test screen.

**The athlete picker.** Every active athlete, a search box, a checkbox each, "select all"
and "clear", and a live count ("3 selected"). **Start** is disabled until at least one is
ticked. It is one component used by both flows. It is separate from the roster's own
checkboxes on the Athletes page, which are left alone.

**The group test screen.** A header naming the test, a tab per picked athlete (the same
look as the velocity group screen), and the athlete's own form beneath, exactly as the
single-athlete form looks today. Tab marks: a dot when that athlete has unsaved answers (read from the
live form, or from the saved draft for an athlete whose tab has not been opened since a
reload), a tick once saved in this sitting. Per athlete: **Save** (saves that athlete, ticks the tab,
stays on the screen) and the form's own "mark the rest normal". At the bottom: **Save all**
(saves everyone who has answers). An athlete who already has a record for today opens on
it, as the athlete page does now; the date, the "already exists for this date" warning and
the "threw on this date" note all behave as they do today.

## How it is built

**Split each test modal into a form and a frame.** `ScreenModal` and `DeliveryModal` each
become a thin modal around a new form component (`ScreenForm`, `DeliveryForm`) that holds
everything else: the state, the cards, the save call. The modals keep their exact props
and behaviour, so the athlete page does not change and their existing tests are the
regression proof. The forms gain three optional props for group use: a way to report
"dirty" (has answers) upward, a draft to start from, and a flag that hides Cancel and
Delete. The group screen mounts a form per athlete the first time its tab is opened and
**keeps it mounted** (hidden when inactive), so flipping between athletes never loses
anything. A team of twenty is fine because forms mount only when visited.

**One group shell.** `GroupTest` owns the tabs, the per-athlete panels, Save all and the
tab marks. It is parameterised by test type, with one small table mapping type to form,
endpoint and label, so adding a third test later is one row. Each athlete's panel loads
that athlete's existing records (the same `/api/athletes/[id]/screens` or `/delivery`
call the athlete page makes) and works out today's record, the taken dates and any draft
before mounting the form. It does not reuse `GroupEntryModal`, whose header is built
around the mound/pulldown switch; it reuses the same look through the same CSS classes.

**Drafts.** A new `lib/testDraft.ts`, one localStorage entry per athlete and per test
type, written as answers change and removed when that athlete's save succeeds. It follows
the rule set for velocity drafts this week: **an entry with no answers always starts on
today's date; one with answers keeps the date it was started under**, so nothing is saved
under the wrong day by accident. A draft restores over today's saved record when it has
answers. Closing the group screen with unsaved answers is therefore safe.

**What counts as "has answers".** A movement screen with any reading answered, or a
Pitching Inhibitors assessment with any flaw marked. Save all covers exactly those athletes,
and its button shows the count ("Save all (2)"). A Pitching Inhibitors assessment with
nothing marked is a real record too ("I looked and found nothing"), so it is saved with
that athlete's own **Save**, never swept up by Save all, which would otherwise record a
clean assessment for anyone whose tab was merely opened. A draft is kept only while it has
answers; typing notes alone does not create one.

**Saving.** No API or schema change. Each save is the same POST the single forms make.
Save all saves sequentially and reports per athlete; one failure leaves that athlete's
tab open with its error and its draft intact, and does not stop the others.

**Refreshing.** After a save, every list that shows these records has to refresh: the
athlete's own list, the Tests page cards, the dashboard's "screening due" and activity.
The plan lists the exact keys, found by reading the code.

**Files.** New: `components/QuickStart.tsx` (the two buttons and the test chooser),
`components/AthletePicker.tsx`, `components/GroupTest.tsx`, `components/ScreenForm.tsx`,
`components/DeliveryForm.tsx`, `lib/testDraft.ts`. Changed: `Dashboard.tsx` (renders
`QuickStart`), `ScreenModal.tsx` and `DeliveryModal.tsx` (become frames).

## Testing

Test-first, then each assertion proven by breaking the code on purpose.

- **Frames unchanged:** the existing `ScreenModal` and `DeliveryModal` tests pass without
  edits, and a test for each proves the modal still saves, cancels and (screen) deletes.
- **Picker:** search narrows, select all and clear, the count, Start disabled with none,
  archived athletes never listed.
- **Quick start:** both buttons present; the test chooser offers exactly the two types;
  the right flow opens for each choice.
- **Group test, the core:** two athletes, answer in A, switch to B, answer in B, switch
  back: A's answers are intact. Save one saves only that athlete's POST body and ticks
  the tab. Save all posts only athletes with answers. One failing save keeps its draft and
  error and does not stop the others. An athlete with today's record opens on it.
- **Drafts:** answers survive a simulated reload; an empty leftover from an earlier day
  starts on today; one with answers keeps its date; a successful save removes the draft;
  keys are per athlete and per test type.
- **Dirty marks:** the dot appears with answers and disappears after saving, and shows after a reload for an athlete with a saved draft whose tab was never reopened.
- Full gate (`npm run verify`) green from a clean build.

## Deploy

Push. No schema change, no `/api/setup` run, no new setting. To check on the live site:
from the homepage start a test for two athletes, answer both, flip between them, reload
the page mid-way and confirm the answers are still there, then save both and confirm they
appear on the Tests page.

## Out of scope, deliberately

- **Strength lift days** as a third test type (Cole chose the two).
- **Delete** inside the group screen.
- **Running both test types for the same athletes in one pass.**
- **Changes to the velocity group screen** beyond reaching it from the homepage.
- **Any API or database change.**

## Open questions

None.
