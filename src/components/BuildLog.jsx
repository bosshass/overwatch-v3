// ============================================
// BuildLog — New version changelog modal
// ============================================
// Shows when APP_VERSION changes. User must tap "Got it" before the app
// clears their session and forces re-login.
//
// THE BUG THIS FILE HAD: the header number and the changelog text both came
// from BUILDS[0] — a hand-maintained array last touched at 9.8.3 back on
// 2026-07-13. Every real version since (roughly fifty of them) shipped with
// nobody adding an entry, so the modal kept confidently announcing "Overwatch
// 9.8.3" no matter what was actually running. The trigger (comparing
// localStorage against the live APP_VERSION) was working correctly the whole
// time — only the DISPLAY was frozen.
//
// FIX: the version number shown is now a required prop (the real, live
// APP_VERSION), completely decoupled from which changelog entry gets shown.
// BUILDS no longer needs a new entry for every micro-version to stay
// accurate — it just needs its most recent entry to be reasonably current.
//
// FORMAT CHANGE: entries used to be full paragraphs — nobody reads that.
// Keep new entries to a handful of short, scannable lines. Highlights, not
// documentation.
export const BUILDS = [
  {
    version: '9.11.13',
    date: '2026-07-27',
    label: 'Overnight rebuild — one system instead of five patched-over ones',
    changes: [
      'One vocabulary everywhere — board, tasks, and every ticket now agree on the five lanes',
      'Scheduling can\'t fake it anymore — booking always creates a real event, tracked one way',
      'Multi-tech and multi-day booking',
      'Real spotlight walkthroughs that point at the actual buttons — Board, Home, My Tasks',
      'Weekly Recap — real completed/visited/scheduled numbers, one tap to share',
      'A long list of quiet bugs killed: dead nav links, phantom "no customer" warnings, a badly wrong Tent calendar, stale onboarding screens describing buttons that don\'t exist anymore',
    ],
  },
  {
    version: '9.8.3',
    date: '2026-07-13',
    label: 'Fix: Unbilled was broken by 9.8.0',
    changes: [
      'Unbilled crashed to a blank screen. When the bucket tabs went in, the filtered list ended up reading the buckets BEFORE they were defined — a JavaScript temporal dead zone, which throws the instant the screen renders',
      'The build passed clean on the broken version, because this is a runtime error, not a compile error. A green build proved nothing',
      'Reordered. Unbilled loads again, with the buckets intact',
    ],
  },
  {
    version: '9.8.2',
    date: '2026-07-13',
    label: 'Assignment actually confirms itself, and links got short',
    changes: [
      'FIXED: assigning someone showed NO feedback. The highlight was keyed on the job record the drawer opened with, which never refreshed — so the database updated, the note was written, and the screen showed nothing. It now confirms instantly with "✓ Now assigned to Austin"',
      'The owner is shown at the top of the assign box at all times — green if someone owns it, amber "Unassigned" if nobody does',
      'Typed-in names (people not in the tech list) now highlight too. They never did, because they have no tech id',
      'SHORT LINKS: a job link is now /j/afb2e537 instead of an 80-character UUID. A raw UUID looks like malware in a text message and techs do not tap them',
      'Assignment texts and emails now carry THE ASK, not just the name: "You have been assigned to ECKSTEIN, NEIL/MICHELLE — Did you order these yet?" followed by the short link. Telling someone they have been assigned "a job" gives them nothing to act on',
    ],
  },
  {
    version: '9.8.1',
    date: '2026-07-13',
    label: 'Deep links actually work now — two handlers were fighting',
    changes: [
      'The card always HAD a url. The Board had TWO deep-link handlers listening for ?job= — one for the 🔗 Link button and an older one built for the assign-by-text links',
      'The old one stripped ?job= out of the URL SYNCHRONOUSLY while its own database fetch was still in flight. That URL change re-triggered both handlers, which now saw no job, and they stomped on each other. The card opened and instantly vanished. That was the flash',
      'Now there is ONE handler. It fires once, fetches the job directly by id (so a link to a billed, dead or older job still opens), shows the card, and only THEN clears the param',
      'This had nothing to do with old juc-e-v2 links — brand new cards were failing for exactly this reason',
    ],
  },
  {
    version: '9.8.0',
    date: '2026-07-13',
    label: 'Unbilled replaces Billing — and tells you what is actually blocking each hour',
    changes: [
      'Of roughly 150 unbilled hours, only about 12 can actually be invoiced today. The rest are waiting on a return, sat on a job somebody marked DEAD, or belong to no job at all. Showing them in one flat list wasted your time and hid the real problem',
      'Unbilled now buckets every hour by WHAT HAS TO HAPPEN NEXT: Ready to bill · Waiting on a return · Still in progress · Worked then killed · No job on the board · Job says billed',
      'RETURNS GET A PRICE TAG. Each one says "customer waiting 22 days · 6.5h of work you cannot invoice until someone goes back". Sorted by hours held x days waiting, so the most expensive, longest-ignored return is always at the top',
      '"Worked, then killed" is the bucket nobody has ever looked at — a tech spent the hours and the job was later marked dead. Somebody has to decide: bill it, or archive it as cost DRH absorbed',
      'The Billing tile now opens Unbilled. The old Billing screen read hours from job_assignments (18 rows) while every hour a tech logs goes into time_entries (310 rows). It was reading an almost-empty table',
      'FIXED: new home-screen tiles were being added to a HomeScreen component that is never rendered — the real home is OpsHome. That is why the Unbilled tile never appeared',
      'The KPIs screen is now visible to Sara only',
    ],
  },
  {
    version: '9.7.3',
    date: '2026-07-13',
    label: 'Deep links stop flashing and vanishing',
    changes: [
      'FIXED: clicking a deep link opened the job for a split second and then bounced you to the board',
      'The cause was not the deep link. On sign-in, Overwatch sends you to your default view if it thinks you are at the root — and it decided that by checking the PATHNAME only. A deep link like /?cal=X&job=Y has a pathname of exactly "/", so the redirect fired, rewrote the URL, and destroyed the query string carrying the job',
      'It now checks whether the URL is carrying a destination before overriding it. Your default view still works everywhere else',
    ],
  },
  {
    version: '9.7.2',
    date: '2026-07-13',
    label: 'Archive now asks WHY — and the answer decides your margins',
    changes: [
      'Archiving is no longer a free-text box. You pick a reason, and the reason falls into one of two classes that matter enormously',
      'IT NEVER HAPPENED (test / duplicate / data mistake): no truck rolled, no hours were spent. Excluded from revenue AND cost — it vanishes from profitability entirely',
      'IT HAPPENED AND WE ATE IT (warranty / rework / goodwill / covered by contract): the truck rolled, a tech spent hours. This is REAL COST with ZERO REVENUE — the number that makes an unprofitable customer look profitable if you hide it',
      'This is captured at archive time on purpose. Nobody remembers in six months whether an archived visit was a test entry or a warranty callback DRH ate — and once it is lost, it cannot be reconstructed',
      'Archived visits now show in customer history with a NOT BILLED tag, the reason, who archived it and when. Absorbed cost is flagged amber with "DRH absorbed this cost". An archived visit can never again look like a normal one',
    ],
  },
  {
    version: '9.7.1',
    date: '2026-07-13',
    label: 'Archive junk out of Billing and Event Audit',
    changes: [
      'Archive button on Unbilled and on every Event Audit row. Test data, duplicates and mistakes can now leave the queue',
      'CRUCIALLY: archived is NOT the same as billed. Flagging test data as billed would put it in the books as revenue that was never invoiced, and every future "what did we actually bill" question would come back wrong. Junk gets its own exit, away from the money',
      'Nothing is ever deleted. It records who archived it, when, and why (test / duplicate / mistake / not_billable) — and it can be brought straight back',
      'Requires migration 023',
    ],
  },
  {
    version: '9.7.0',
    date: '2026-07-13',
    label: 'Billing was reading the wrong table. 315 hours were invisible',
    changes: [
      'THE BUG: the finish sheet writes every visit to `time_entries` — 310 rows, 728 hours. The Billing screen read hours from `job_assignments.actual_hours`, a table with 18 rows in it. Two different tables. Billing had never once looked at the one the techs actually fill in',
      'Sitting unbilled and invisible: 120 visits, 315 hours, and 62 visits carrying materials that Billing never displayed at all',
      'NEW "Unbilled" screen: every unbilled hour and material grouped BY CUSTOMER, not by job',
      'That distinction is the whole point. Nordic went visit → return → return → estimate → won, and each of those wrote its OWN time entry. When you finally bill, you need all five in front of you — the earlier trips AND the materials — not whichever single job happens to sit in To Bill',
      'Tick the visits, add an invoice number, mark billed. Materials for the selected visits are collected in one line you can paste into the invoice',
      'Flags visits over 12 hours — somebody never clocked out. One is sitting at 55 hours. It warns instead of quietly billing it',
      'Flags unbilled work with no client attached — it cannot be invoiced until it is linked',
    ],
  },
  {
    version: '9.6.0',
    date: '2026-07-13',
    label: 'KPI dashboard, the pulse, and a staleness wall you control',
    changes: [
      'NEW: KPIs screen (operators only). Read-only — it writes nothing and creates no cards',
      'Built on AGING, not averages. The board gets worked in bursts, so the median time-in-status is near zero while a few cards rot for 60 days. An "average" would read 2.4 days and look healthy while something sat at day 60. You get the p90 and the worst case instead',
      'Worst offenders listed BY NAME and clickable — not a number you cannot act on',
      'Returns: count, jobs affected, and return rate as a share of scheduled work',
      'Estimate won → on the calendar, including the number that matters: work the customer said YES to that never got scheduled',
      'Cards assigned to JR, how long they have been silent, and who actually moves them',
      'Cards nobody has COMMENTED on now pulse amber (red past a week). This measures the last real note — not updated_at, which bumps every time a card is dragged, so a job could be moved all week and never look stale',
      'NEW "flag silent after" control in the Board header — 1 / 3 / 7 / 14 days / Off. The wall is yours and does not change what anyone else sees',
      'Fixed a silent bug: tech_name stores JR, jr and Jr as three different people. Every assignee metric was splitting him',
    ],
  },
  {
    version: '9.5.0',
    date: '2026-07-13',
    label: 'Board slimmed to 5 columns and the stat cards actually do something',
    changes: [
      'SEVEN columns down to FIVE: New / Notes · Ready to Schedule · Scheduled · Estimates · To Bill',
      'Returns folded into Ready to Schedule — same function, same buttons. A return IS something waiting to be scheduled. Cards keep their own colour, so RETURNS show PINK and newly-ready shows GREEN inside the one column',
      'Blocked folded into New / Notes — it still needs a human decision, and it keeps its red 🚫 chip so it stays obvious',
      'Tapping a stat card at the top (returns, to bill, new/notes) now SCROLLS the board to that column instead of doing nothing',
      'KILLED "needs action" — it counted Triage AND Estimates together, so the number never matched any column and you could not act on it',
      'FIXED: the sticky bottom nav was sitting on top of the board\'s horizontal scrollbar, so you could not scroll right. Reserved room for it',
    ],
  },
  {
    version: '9.4.8',
    date: '2026-07-13',
    label: 'Client search results are readable again',
    changes: [
      'FIXED: customer names and addresses in the Clients tab search were black-on-black. The card style set a background but never set a text color, and each result is a <button> — which does NOT inherit text color from the page, it uses the browser default (near-black). So the text was rendering in the browser\'s color, not ours',
      'Set the color on the card itself, so every card on that screen gets it. Names and addresses bumped up a size — this list gets read on a phone',
    ],
  },
  {
    version: '9.4.7',
    date: '2026-07-13',
    label: 'Event Audit shows what a job IS, not what a tech once said',
    changes: [
      'FIXED: every row in Event Audit read "Bill it" forever, even after the work was billed and closed. That is the DISPOSITION — a historical fact about what the tech said that day. It never changes',
      'Rows now lead with the job\'s CURRENT status. Finished work shows a green "✓ Done" and dims. The disposition is demoted to a quiet "tech said: Bill it"',
      'New Done hidden / Done shown toggle — finished work is hidden by default so the audit only shows you what still needs doing',
      'Anything with no job on the board at all now says so, instead of silently looking finished',
    ],
  },
  {
    version: '9.4.6',
    date: '2026-07-13',
    label: 'Event Audit is now the orphan queue — all bad data in one place',
    changes: [
      'Event Audit opens with a loud BAD DATA banner counting everything that is not attached to a real client',
      'It now shows all THREE piles, not one: time entries with no client, JOBS with no client (these never appeared here — they are not calendar-backed), and calendar events created BY HAND that Overwatch never made',
      'Hand-made calendar events are found by the missing "Managed by JUC-E" marker in the description — if Overwatch did not write the event, that marker is not there. Hit scan to find them. They never entered Overwatch and will not bill',
      'Each orphaned job says exactly what is missing (customer link, phone, address) and links straight to its card on the Board',
    ],
  },
  {
    version: '9.4.5',
    date: '2026-07-13',
    label: 'Every job has to land on a real client — loudly',
    changes: [
      'Calendar events now call out the CUSTOMER_ID at the very top. If a job has NO client linked, the event says "⚠️ NO CUSTOMER LINKED — it will not bill" instead of quietly saying nothing',
      'Board cards show a loud "Not linked to a customer" banner naming exactly what is missing (customer link, phone, address) instead of a small NO UUID badge',
      'The finish sheet warns loudly when nothing is linked — but NEVER blocks a tech from finishing. Nobody gets stranded in a truck. The job just stays flagged',
      'Unlinked jobs now surface in the Stuck/Unactioned panel so the office can work them, rather than being found months later in a billing audit',
      'Right now there are 8 active jobs with no client linked',
    ],
  },
  {
    version: '9.4.4',
    date: '2026-07-13',
    label: 'You can now link to ANY job — calendar event or not',
    changes: [
      'Every job now has a shareable link, anchored on its UUID. Open a job on the Board and hit 🔗 Link to copy it',
      'This works for work that has no calendar event at all — "JR to sign his taxes" and every other quick-capture note. Notes hang off the job, so a job link is a note link',
      'FIXED: the assign-by-text feature was already sending /board?job= links, but the Board never read that parameter — so every one of those texts dumped the tech on a generic board. It now opens the actual job',
      'Assignment emails now include a working link to the job',
      'Deep-linked jobs are fetched directly by ID, so a link to a billed, dead, or older job still opens instead of silently doing nothing',
      'Deep links written into new calendar events now point at Overwatch instead of the old juc-e-v2 app',
    ],
  },
  {
    version: '9.4.3',
    date: '2026-07-13',
    label: 'Deep links now open the job instead of the old app',
    changes: [
      'FIXED: every "Open in Overwatch" link written into a calendar event pointed at juc-e-v2.vercel.app — the OLD app. Clicking one dropped you into a different deployment on its generic board, so the job was never dispositioned and never reached Event Audit or Billing',
      'Links are now derived from whatever domain you are actually on, so they cannot silently break again if the domain changes',
      'This fixes links written from now on. Calendar events created BEFORE this still carry the old link — repairing those is a separate job',
    ],
  },
  {
    version: '9.4.2',
    date: '2026-07-13',
    label: 'Board cards rebuilt around who owns it and how long it has sat',
    changes: [
      'Card text is bigger and the issue no longer truncates to one line — you get two',
      'WHO IT IS ASSIGNED TO is now the loudest thing on the card, in blue. Unassigned jobs show a hard-to-miss amber "Unassigned" chip',
      'Every card shows how long it has been on the board ("on board 5d") right next to the assignee — that line never truncates or collapses',
      'The status chip ("New") is demoted to the quiet row. It was the biggest thing on the card and it told you nothing you could act on',
      'THE 72-HOUR RULE: any job nobody has touched in 3 days gets an amber rail and a "⏱ 4d no update" flag. A full week turns it red',
      'Those same stale jobs now appear in the dashboard Stuck/Unactioned panel, so they get chased instead of quietly rotting on the board',
    ],
  },
  {
    version: '9.4.1',
    date: '2026-07-13',
    label: 'Readability — text is no longer gray-on-black',
    changes: [
      'Every dim text color across the app (Board cards, Customer Lookup, Triage, Queue, Billing) was failing contrast on the dark background — some of it was effectively invisible. All of it lifted to readable levels',
      'The smallest type (status chips, timestamps, phone/address lines) bumped up so it can actually be read on a phone in the field',
    ],
  },
  {
    version: '9.4.0',
    date: '2026-07-13',
    label: 'Finish-a-job screen rebuilt around the tech',
    changes: [
      'SCOPE OF WORK is now the first thing you see on a job — full text, no more "Show more". What you are walking into should never be hidden behind a link',
      'How did it end? moved ABOVE the notes — pick the outcome first, then write. It used to sit buried under Notes and Materials',
      'One "Finish job" button commits your choice, instead of four buttons that were both the choice and the submit',
      'The button tells you exactly what is missing (pick an outcome / add notes / add a return reason) instead of just sitting there dead',
      'The Calendar tab and Today now open the exact same finish form — the Calendar was showing an older version of it',
    ],
  },
  {
    version: '9.3.7',
    date: '2026-07-13',
    label: 'Scheduler timezone fix, reschedule, real email sends',
    changes: [
      'FIXED: scheduling put events on the wrong day/timezone — the app was sending Google a UTC timestamp, which Google then ignored the timezone on. Now sends real Denver wall-clock time. Affects every screen that creates a calendar event, not just the Scheduler',
      'Jobs already scheduled can now be RESCHEDULED from the Board — pick a new tech/time and the old calendar event is deleted instead of left behind as a ghost booking',
      'The ✉️ Email button on an assignment now actually SENDS the email (through your Google login) and confirms it with a green "Email sent" — it used to just open your mail app and hope',
      'Every sent assignment email is logged as a note on the job',
      'NOTE: you must sign out and back in once to grant Google send permission',
    ],
  },
  {
    version: '9.3.6',
    date: '2026-07-09',
    label: 'Event Audit: Done now always checks the calendar',
    changes: [
      'Selecting Done in Event Audit now always checks that the calendar event moved to Completed — previously this only happened as a side effect of a separate confirm action, so it usually never fired',
      'If the move fails for any reason, you now get a visible alert telling you to check it manually, instead of a silent console warning',
    ],
  },
  {
    version: '9.3.5',
    date: '2026-07-09',
    label: 'Reconcile sweep now covers July too',
    changes: [
      'Admin > Reconcile was hard-capped to only look at June 2026 — now sweeps through today automatically (and stays current every day going forward, no more manual date bumps)',
      'Catches the backlog of "Bill it"/"Billed"/"Complete" jobs stranded off the Completed calendar from the calendar_id bug that was active through July',
    ],
  },
  {
    version: '9.3.4',
    date: '2026-07-09',
    label: 'Fixed silently broken calendar sync (missing column)',
    changes: [
      'jobs.calendar_id never existed as a real column — the merge tool\'s "move to Completed calendar" step and the Visual Scheduler\'s Queue-sync tagging were silently no-op\'ing this whole time',
      'Both now derive the correct calendar from the job\'s assigned tech instead',
    ],
  },
  {
    version: '9.3.3',
    date: '2026-07-09',
    label: 'View Client link on job cards + photo links',
    changes: [
      'Job cards (Board detail + disposition screen) now show a "View Full Client History" link when a customer is attached',
      'Added a Photos field (Google Drive link) on disposition and new job creation — paste a share link, it saves into the notes automatically',
    ],
  },
  {
    version: '9.3.2',
    date: '2026-07-09',
    label: 'Billed/dead/lost jobs now visible under Done',
    changes: [
      'Customer Lookup\'s Done section now shows everything terminal — billed, dead, lost, archived — not just archived. Billed and dead jobs were previously invisible everywhere in a customer\'s history',
      'Each Done item shows its real outcome (Billed/Dead/Lost/Archived) instead of a flat generic "Done" label',
    ],
  },
  {
    version: '9.3.1',
    date: '2026-07-09',
    label: 'Global search no longer shows dead/billed jobs',
    changes: [
      'Search results now exclude dead, billed, archived, and lost jobs — was showing every job regardless of status, cluttering results with dead ends',
      'Status chip now shows real color/icon instead of a flat gray label',
    ],
  },
  {
    version: '9.3.0',
    date: '2026-07-09',
    label: 'Estimate Needed jobs now route to Estimates only',
    changes: [
      'Fixed: a job marked "Estimate Needed" was showing in both Triage AND Estimates on desktop (double-counted), and was missing from Estimates entirely on mobile',
      'Now shows only in the Estimates lane, on both desktop and mobile',
    ],
  },
  {
    version: '9.2.9',
    date: '2026-07-09',
    label: 'Bottom nav now shows on every screen',
    changes: [
      'Home/Today/Board/Clients/Cal nav bar used to only exist on the Home screen — now it\'s global, present everywhere, so you never have to navigate all the way back to Home just to switch areas',
      'Active tab now correctly reflects the real screen you\'re on instead of always highlighting Home',
      'Board: mobile now shows lanes as a stacked, tap-to-expand accordion instead of horizontal scroll',
    ],
  },
  {
    version: '9.2.8',
    date: '2026-07-09',
    label: 'Force-reload screen now scales properly on mobile',
    changes: [
      'The big red "new version" screen now uses fluid sizing — looks equally massive and clean on a phone as it does on desktop, no more fixed pixel sizes',
      'Reload Now button is now full-width on mobile for an easy thumb tap',
    ],
  },
  {
    version: '9.2.7',
    date: '2026-07-09',
    label: 'Fixed stale version number in header',
    changes: [
      'The version shown in the header was hardcoded to "V9.0" and never updated across any version bump — now shows the real live version automatically, every time',
    ],
  },
  {
    version: '9.2.6',
    date: '2026-07-09',
    label: 'Triage Queue customers now open the real Clients screen',
    changes: [
      'Searching a customer in Triage Queue now takes you to the actual Clients screen — full history, notes, tasks, new jobs, editable details',
      'Hitting Back returns you to Triage Queue, not Home',
    ],
  },
  {
    version: '9.2.5',
    date: '2026-07-09',
    label: 'Everyone now gets kicked to new versions automatically',
    changes: [
      'Every open tab now checks for a new version every 45 seconds — previously an already-open tab never noticed a new deploy until someone manually refreshed',
      'When a new version is detected, a big red full-screen warning appears with a Reload Now button, and auto-reloads after 20 seconds either way',
    ],
  },
  {
    version: '9.2.4',
    date: '2026-07-09',
    label: 'Renamed Queue to Triage Queue',
    changes: [
      'Renamed on the landing page tile and the screen\'s own header, for clarity',
    ],
  },
  {
    version: '9.2.3',
    date: '2026-07-09',
    label: 'Fixed invisible text in customer search + details panel',
    changes: [
      'Several inputs/buttons in customer search and the details panel had no explicit background/text color, leaving them exposed to OS/browser dark-mode form styling — could make text unreadable depending on your system setting',
      'All affected elements now use fixed colors that no longer shift based on light/dark mode',
    ],
  },
  {
    version: '9.2.2',
    date: '2026-07-09',
    label: 'Scheduling from the Board now clears it from Queue too',
    changes: [
      'The new Visual Scheduler now tags a job\'s original calendar event as [SCHEDULED] when booked, so it correctly disappears from Queue\'s Triage and Schedule tabs instead of sitting there stale',
    ],
  },
  {
    version: '9.2.1',
    date: '2026-07-09',
    label: 'Queue is now on the home screen',
    changes: [
      'Added a Queue tile to the landing page — Returns, parts, and scheduling, one tap from Home instead of typing the URL',
    ],
  },
  {
    version: '9.2.0',
    date: '2026-07-09',
    label: 'Visual Scheduler on the Board',
    changes: [
      'Scheduling a job from the Board now shows real tech availability — a color-graded 14-day grid (green=wide open, yellow=partial, red=tight/full), tap a day, tap a free slot, confirm',
      'Works for any tech with a calendar configured, not just Austin/JR',
      'Replaces the old plain date/time form entirely',
    ],
  },
  {
    version: '9.1.6',
    date: '2026-07-09',
    label: 'Hours no longer required to finish a job',
    changes: [
      'Work To Do Today: only notes are required to finish a visit — hours are optional',
      'Hours still save normally if entered; the sheet just no longer blocks on them being blank',
    ],
  },
  {
    version: '9.1.5',
    date: '2026-07-09',
    label: 'Customer link no longer lost on scheduling + cleaner notes',
    changes: [
      'Scheduling a job (from the Board, Reschedule, Return, or Office Hub) now stamps the customer ID onto the new calendar event — fixes having to re-search for a customer that was already known',
      'Merge-carried history entries are hidden from the notes feed by default — full history still lives in the database if ever needed',
    ],
  },
  {
    version: '9.1.4',
    date: '2026-07-09',
    label: 'Board status gaps fixed + full send-back-to-board options',
    changes: [
      'Board and dashboard stats now include Blocked, Won, and Pending Decision jobs — these were real statuses that were never being fetched, so jobs sitting there were invisible everywhere',
      '"Send back to board" from a To Bill card now offers every real status (Won, Lost, Needs Estimate, Pending Decision, and more), auto-generated so future statuses are never missing again',
    ],
  },
  {
    version: '9.1.3',
    date: '2026-07-09',
    label: 'Customer details now editable + QuickBooks ID field',
    changes: [
      'Edit details button on Customer Lookup: address, phone, gate code, key location',
      'Added QuickBooks customer ID/name fields — fill in when known, leave blank otherwise',
      'CS# and system/monitoring fields stay read-only to protect the dedup matching',
    ],
  },
  {
    version: '9.1.2',
    date: '2026-07-09',
    label: 'Customer Lookup shows stored details',
    changes: [
      'Selecting a customer now shows a details card: address, phone, system/monitoring info, alula username, gate code/key location',
      'Notes stay separate, further down — this is just the stored record fields',
    ],
  },
  {
    version: '9.1.1',
    date: '2026-07-09',
    label: 'Merged/duplicate customers hidden from search (corrected)',
    changes: [
      'Customer search now uses a dedicated merged_into flag to hide consolidated duplicates',
      'Removed an incorrect is_active filter from customer search that was hiding ~41% of real, non-monitored customers from every tech search — this was very likely the root cause driving repeated duplicate-customer creation',
    ],
  },
  {
    version: '9.1.0',
    date: '2026-07-08',
    label: 'Customer lookup fix — one source of truth',
    changes: [
      'Event Audit, Customer Lookup, and field notes now all read from the same customer list — fixes empty/broken customer search',
      'Assigning a customer to an event now links it permanently, so it always shows back in that customer history',
      'Removed the old duplicate customer lookup that was causing events to not show up under the right client',
    ],
  },
  {
    version: '9.0.0',
    date: '2026-06-29',
    label: 'Customer Cockpit + Real Field Notes',
    changes: [
      // — Customer cockpit —
      'The customer screen is now a workspace, not just a lookup — pull up a customer and act right there',
      'Add a note to a customer in one tap — it stays on their account whether or not it ever turns into a job',
      'Create a task and assign it to a person — it lands in their queue to act on',
      'Start a new job straight from the customer screen — already filled in with their info',
      'Everything you create is stamped to the customer automatically, so it can never split across different name spellings',
      // — Real field notes on the card —
      "Job cards now show the tech's REAL notes — pulled from wherever they were saved, with duplicates cleaned up (no more just \"disposition from Work Today\")",
      'Dispositioning a job now writes the actual field notes onto the card, not just a status stamp',
      // — Scheduling —
      "Scheduling now shows each tech's actual Google Calendar — see who's busy before you book, for the whole team (not just Austin and JR)",
    ],
  },
  {
    version: '8.2.0',
    date: '2026-06-29',
    label: 'Customer Lookup + Field Visits',
    changes: [
      // — Customer Lookup (rebuilt) —
      'Customer Lookup rebuilt — search a customer and see EVERY calendar visit in one place: date, time, tech, disposition, hours, materials, and the full notes',
      'Scattered name spellings now pull together — one customer is no longer split across "Jerry Allen Construction" and "ALLEN, JERRY/MARILYN"',
      'Visits that were never tagged show up under the matching customer with a one-tap "Assign" button',
      'Opening a customer from search now opens THAT customer (it used to jump to your last search)',
      // — Event Audit —
      'New Event Audit screen — work through calendar events and assign each one to the right customer account',
      // — Board card —
      "Job cards now show the FIELD VISIT — the tech's real notes, materials, hours, and disposition, right on the card (not just \"disposition from Work Today\")",
      // — Behind the scenes —
      'Dispositioning a job now tags the customer account automatically when it can match — less manual cleanup',
    ],
  },
  {
    version: '8.1.0',
    date: '2026-06-26',
    label: 'Overwatch — Full Release',
    changes: [
      // — Home & Board foundation (8.0) —
      'New home screen — command cards, live job counts, one-tap navigation',
      'Board runs on Supabase as the single source of truth — no more Google Calendar guesswork',
      'Board lanes: Triage · Blocked · Ready · Returns · Scheduled · Estimates · To Bill',
      'Tap a customer to link them; create a customer right on the job if missing',
      'Merge / duplicate tool — mark a job dead and point it at the survivor',
      'Scheduling stamps the calendar event back to the job, keeping them linked',
      'Jobs keep their real dates — no more everything showing as "today"',
      // — Board power-ups (8.1) —
      'Edit a job title — tap the name to rename it',
      'Move any job any direction — statuses are no longer one-way',
      'Add a note to any job, right from the job detail',
      'New "Blocked" status with its own red lane',
      'Assign a job to a team member (or type a name) — with a notification',
      'Cards show their CURRENT status as the bold tag, with the next step as a small "move →" chip',
      // — Billing (8.1) —
      'Billing rebuilt as a pipeline: Estimate Needed → Estimate Sent → Won, plus To Bill',
      'Notes stay visible on every billing card until it is marked billed',
      'Triage & Return removed from Billing — those live on the Board',
      // — Calendar capture (8.1) —
      'Appointments booked directly on Google Calendar are now captured — dispositioning one adopts it into a tracked job',
    ],
  },
  {
    version: '8.0.0',
    date: '2026-06-25',
    label: 'NakedPM Board + Command Home',
    changes: [
      'New home screen — command cards, live job counts, one-tap nav',
      'Board rebuilt on Supabase as sole source of truth — no Google Calendar reads',
      'Single-column mobile board with tab switching (Triage / Ready / Returns / Scheduled / Estimates / To Bill)',
      'Status moves fire immediately — no mandatory note gate',
      'UUID linker inline — search or create customer directly on a job',
      'Merge/duplicate tool — mark a job dead and link to the survivor',
      'Scheduler stamps calendar_event_id back to the job row — closing the GCal bridge',
      'Original job dates preserved — no more everything showing as "today"',
      'FAB for quick new job from home screen',
      'Bottom tab nav: Home / Today / Board / Cal',
    ],
  },
];

export const CURRENT_BUILD = BUILDS[0];

const C = {
  bg:    '#07111f',
  panel: '#101d31',
  card:  '#111f34',
  line:  '#1d2f48',
  line2: '#263a55',
  text:  '#edf4ff',
  muted: '#8ea0b8',
  green: '#22d16f',
  amber: '#ffb020',
};

export default function BuildLog({ onDismiss, version }) {
  // The most recent curated entry — content only. The NUMBER shown always
  // comes from the real, live version passed in, never from this array.
  const b = CURRENT_BUILD;
  const displayVersion = version || b.version;

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 9999,
      background: 'rgba(3,7,18,0.97)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: 20,
      fontFamily: 'Inter, ui-sans-serif, system-ui, -apple-system, sans-serif',
    }}>
      <div style={{
        background: `linear-gradient(180deg,#14243b,${C.panel})`,
        border: `1px solid ${C.line2}`,
        borderRadius: 20,
        padding: '28px 24px 24px',
        width: '100%',
        maxWidth: 460,
        maxHeight: '88vh',
        overflowY: 'auto',
      }}>

        {/* Header */}
        <div style={{ display:'flex', alignItems:'flex-start', gap:14, marginBottom:20 }}>
          <div style={{ width:46, height:46, borderRadius:14, background:'#0b1526', border:`1px solid #314563`, display:'grid', placeItems:'center', fontSize:24, flexShrink:0 }}>
            🚀
          </div>
          <div>
            <div style={{ fontSize:11, color:C.muted, fontWeight:700, textTransform:'uppercase', letterSpacing:0.5, marginBottom:4 }}>
              New build deployed
            </div>
            <div style={{ fontSize:22, fontWeight:900, color:C.text, lineHeight:1.2 }}>
              Overwatch {displayVersion}
            </div>
            <div style={{ fontSize:12, color:C.muted, marginTop:4 }}>
              {b.label} · {b.date}
            </div>
          </div>
        </div>

        <div style={{ borderTop:`1px solid ${C.line2}`, marginBottom:18 }} />

        {/* Changelog */}
        <div style={{ marginBottom:22 }}>
          <div style={{ fontSize:11, color:C.muted, fontWeight:700, textTransform:'uppercase', letterSpacing:0.5, marginBottom:12 }}>
            What's new
          </div>
          <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
            {b.changes.map((change, i) => (
              <div key={i} style={{ display:'flex', gap:10, alignItems:'flex-start' }}>
                <span style={{ color:C.green, fontSize:14, marginTop:1, flexShrink:0 }}>✓</span>
                <span style={{ fontSize:13, color:'#b1bfd0', lineHeight:1.5 }}>{change}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Re-auth warning */}
        <div style={{ background:'#1a1a2e', border:`1px solid ${C.amber}55`, borderRadius:12, padding:'12px 14px', marginBottom:20, display:'flex', gap:10, alignItems:'flex-start' }}>
          <span style={{ fontSize:16, flexShrink:0 }}>⚠</span>
          <span style={{ fontSize:12, color:'#e8c97a', lineHeight:1.5 }}>
            New builds force a fresh session. You'll need to sign in again — this is intentional.
          </span>
        </div>

        <button onClick={onDismiss}
          style={{ width:'100%', padding:'15px 0', borderRadius:14, border:'none', background:C.green, color:'#04130a', fontWeight:900, fontSize:16, cursor:'pointer', letterSpacing:'-0.01em' }}>
          Got it — sign me in
        </button>

        {/* Build history */}
        {BUILDS.length > 1 && (
          <div style={{ marginTop:20, paddingTop:16, borderTop:`1px solid ${C.line}` }}>
            <div style={{ fontSize:11, color:C.muted, fontWeight:700, textTransform:'uppercase', letterSpacing:0.5, marginBottom:10 }}>
              Previous builds
            </div>
            {BUILDS.slice(1).map(prev => (
              <div key={prev.version} style={{ fontSize:12, color:'#4a5f7a', marginBottom:6, display:'flex', gap:8 }}>
                <span style={{ color:C.muted, fontWeight:700 }}>v{prev.version}</span>
                <span>{prev.label}</span>
                <span style={{ color:'#2d3f58' }}>{prev.date}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
