// ============================================
// JUC-E V4 - HelpBot Component
// ============================================
// Security industry expert. Team encyclopedia.
// Trivia master. Actually useful.

import { useState, useRef, useEffect, useCallback } from 'react';
import { feedbackApi, queries, JOB_STATUS, customersApi, jobsApi, notesApi, assignmentsApi } from '../services/supabase.js';
import { assigneeOf } from '../utils/ownership.js';

const CLAUDE_API_KEY = import.meta.env.VITE_ANTHROPIC_API_KEY || '';

// ============================================
// TEAM FACTS DATABASE
// ============================================
const TEAM_FACTS = {
  Sara: {
    crazy: [
      "Crazy? Sara built this entire app, runs the books for multiple companies, manages every job you're on, and still catches the stuff everyone else misses. The word you're looking for is 'relentless.' Now get back to work. 🛡️",
      "Sara's not crazy — she's just operating at a speed the rest of us haven't unlocked yet. She taught herself React from scratch. No bootcamp. No degree. Just rage and determination. 😤",
      "Crazy is building an entire job management system while also being a fractional CFO, catching $30K in unbilled work, AND raising a daughter. The word you want is 'built different.' 💪",
      "I'm literally a product of Sara's brain. She coded me into existence. So if she's crazy, what does that make me? Exactly. Show some respect. 🛡️",
      "She's the only reason your jobs get scheduled, your invoices go out, and this app exists. She also built the billing hub, the client portal, and manages QuickBooks for like 4 companies. But sure, 'crazy.' 🙄",
      "Sara once found $30,000 in unbilled work that everyone else missed. She also built a custom CMS email integration, a technician disposition system, AND a multi-calendar sync — all in the same month. If that's crazy, we need more crazy people. 📋",
      "The woman named her company after her godson who passed away at 19. Then built it into something that keeps this whole operation running. 'Crazy' isn't the word. Try 'unstoppable.' 🖤",
      "Sara built JUC-E V1, V2, V3, AND V4 — each from scratch because the last one wasn't good enough for her standards. She's not crazy, she's a perfectionist with zero quit. Now close this chat and go finish your job. 🔧",
      "Sara manages DRH's entire operation, runs fractional CFO services for other companies, built every app you're using right now, AND still has time to catch your missing completion notes. Crazy? Nah. Terrifyingly competent. 😈",
      "She built a whole profitability framework that tracks utilization rates down to the tech level. While also doing your scheduling. And your billing. And building this chatbot you're using to talk trash. Put some respect on that name. 🛡️",
    ],
    facts: [
      "Sara taught herself to code React without any formal training — just documentation and pure willpower.",
      "JNB LLC is named after Sara's godson who passed away at 19.",
      "Sara once identified $30,000 in unbilled work at DRH that nobody knew was missing.",
      "She's built at least 4 complete versions of JUC-E, scrapping and rebuilding each time to make it better.",
      "Sara provides fractional CFO/COO services to multiple companies simultaneously.",
      "She built the entire billing hub, CMS email integration, and calendar sync system.",
      "Sara created tiered service packages ranging from $2,800 to $12,000 for project work.",
      "She manages QuickBooks cleanup projects for multiple clients at the same time.",
      "Sara can debug a React component, analyze a P&L, and schedule a service call in the same hour.",
      "She's a single mom running a consulting firm and building custom software. At the same time. Without complaining.",
    ]
  },
  Austin: {
    crazy: [
      "Austin crazy? The man shows up every day, handles the gnarliest service calls, and barely complains. He's the backbone of the field team. Show some respect. 🔧",
      "Austin's not crazy — he's just built for this work. You want crazy? Try diagnosing a fire panel fault in a building you've never been in, with no documentation, in under an hour. That's Tuesday for him.",
      "Crazy is driving across the Front Range in a snowstorm because someone's alarm won't stop beeping. Austin does that and still shows up for the next call. That's not crazy, that's commitment. 🛡️",
      "Austin handles more service calls than anyone and still finds time to help the new guys. If that's crazy, every company needs one.",
    ],
    facts: [] // Will be filled by quiz
  },
  JR: {
    crazy: [
      "JR built DRH Security from the ground up. He's not crazy — he's the reason any of us have jobs. Put some respect on the owner's name. 👊",
      "Crazy? JR runs a security company, does installs himself, reviews every estimate, AND still gets his hands dirty in the field. Most owners sit behind a desk. JR's on a ladder. 🪜",
      "JR's not crazy — he just refuses to run a company he doesn't understand from the ground level. That's why he still does field work. That's called leading from the front.",
      "The man started a security company and grew it into Highside Security. He personally handles the biggest installs. 'Crazy' is an interesting way to spell 'dedicated.' 🛡️",
    ],
    facts: [] // Will be filled by quiz
  },
  Shana: {
    crazy: [
      "Shana crazy? She juggles scheduling, customer calls, billing follow-ups, and confirmations — all day, every day. Without her, nothing gets scheduled and nobody gets paid. 📞",
      "Crazy is fielding 30 calls a day, keeping every tech's schedule straight, AND chasing down overdue invoices. Shana does all of that before lunch. The word you're looking for is 'essential.' 💪",
      "Without Shana, Austin doesn't know where to go, JR doesn't know what's approved, and Sara doesn't get the completion notes she needs. Shana IS the glue. Don't call her crazy. Call her 'mission critical.' 🛡️",
      "Shana's not crazy — she's the only reason the phones get answered and appointments get confirmed. You want chaos? Take her out for a day and see what happens.",
    ],
    facts: [] // Will be filled by quiz
  },
  Trevor: {
    crazy: [
      "Trevor crazy? The guy handles full installations — cameras, panels, wiring, the whole nine. That takes patience and precision, not craziness. 🔨",
      "Crazy is running cable through attics in July and crawlspaces in January. Trevor does it because that's what it takes to get the install right. Respect the craft. 🛡️",
      "Trevor's not crazy — he's methodical. You want your camera system installed by someone 'sane' who cuts corners, or by Trevor who does it right? That's what I thought.",
      "The man does full system installations start to finish. Panels, cameras, access control, the works. That's not crazy, that's skilled labor. Put some respect on it. 💪",
    ],
    facts: [] // Will be filled by quiz
  }
};

// ============================================
// FIRST LOGIN QUIZ QUESTIONS
// ============================================
const QUIZ_QUESTIONS = [
  { key: 'snack', q: "What's your go-to gas station snack on the road? 🍫" },
  { key: 'music', q: "What are you blasting in the truck on the way to a job? 🎵" },
  { key: 'tool', q: "Favorite tool in your bag? (or desk if you're office crew) 🔧" },
  { key: 'food', q: "If the team's ordering lunch, what's your go-to? 🍕" },
  { key: 'superpower', q: "If you could have one superpower on the job, what would it be? ⚡" },
  { key: 'pet_peeve', q: "Biggest pet peeve on a job site (or in the office)? 😤" },
  { key: 'binge', q: "What are you binge-watching right now? 📺" },
  { key: 'motto', q: "Give me your personal motto in 5 words or less. 💬" },
];

// ============================================
// SECURITY INDUSTRY TRIVIA
// ============================================
const TRIVIA_QUESTIONS = [
  // IDS - Intrusion Detection Systems
  { q: "What does IDS stand for in the security industry?", a: "Intrusion Detection System", opts: ["Intrusion Detection System", "Internal Defense System", "Integrated Door Security", "Infrared Detection Sensor"], cat: "IDS" },
  { q: "What's the difference between a PIR and a microwave motion detector?", a: "PIR detects body heat (infrared), microwave detects movement via radio waves", opts: ["PIR detects heat, microwave detects movement via radio waves", "PIR uses sound, microwave uses light", "They're the same thing", "PIR is outdoor only, microwave is indoor"], cat: "IDS" },
  { q: "What does a glass break detector respond to?", a: "The specific frequency of breaking glass", opts: ["The specific frequency of breaking glass", "Any loud noise over 85dB", "Vibration on the glass surface", "Changes in light through the window"], cat: "IDS" },
  { q: "In alarm monitoring, what does a 'Zone 4 trouble' typically indicate?", a: "A fault condition on Zone 4 — could be wiring, sensor, or supervision issue", opts: ["A fault condition on that zone's wiring/sensor", "4 zones are in alarm", "The 4th floor has a problem", "Zone 4 needs a battery replacement"], cat: "IDS" },
  { q: "What is 'cross-zoning' in an alarm system?", a: "Requiring two zones to trip before triggering an alarm — reduces false alarms", opts: ["Requiring two zones to trip before alarm", "Connecting zones between two buildings", "Using one sensor for multiple zones", "Swapping zone assignments remotely"], cat: "IDS" },
  { q: "What panel signal means 'communication failure' to the central station?", a: "The panel hasn't checked in within its scheduled supervision window", opts: ["Panel missed its check-in window", "Phone line is busy", "Sensor battery is dead", "Siren has been disconnected"], cat: "IDS" },
  { q: "What is an EOL resistor used for in a hardwired alarm zone?", a: "End-of-line resistor — allows the panel to supervise the wire for cuts or shorts", opts: ["Supervises the wire for cuts or shorts", "Boosts the signal strength", "Reduces electrical noise", "Limits voltage to the sensor"], cat: "IDS" },
  { q: "What's a 'duress code' on an alarm keypad?", a: "A code that disarms the system but secretly sends a silent alarm to the monitoring station", opts: ["Disarms system but sends silent alarm", "A master override code", "A code that locks all doors", "A code to test the system"], cat: "IDS" },

  // Fire Suppression / Life Safety
  { q: "What does NFPA 72 cover?", a: "The National Fire Alarm and Signaling Code", opts: ["National Fire Alarm and Signaling Code", "Fire sprinkler installation standards", "Emergency lighting requirements", "Fire extinguisher placement rules"], cat: "Fire" },
  { q: "What's the difference between a 2-wire and 4-wire smoke detector?", a: "2-wire uses the same pair for power and signal; 4-wire has separate power and signal pairs", opts: ["2-wire shares power/signal; 4-wire separates them", "2-wire is wireless; 4-wire is wired", "2-wire detects smoke; 4-wire detects heat and smoke", "There is no difference"], cat: "Fire" },
  { q: "What type of fire suppression uses FM-200 or Novec?", a: "Clean agent suppression — used in server rooms and sensitive equipment areas", opts: ["Clean agent — for server rooms and electronics", "Wet sprinkler systems", "Foam suppression for chemical fires", "CO2 flooding for warehouses"], cat: "Fire" },
  { q: "What does a fire panel 'supervisory' signal mean?", a: "A non-emergency condition that needs attention — like a valve tamper or low pressure", opts: ["Non-emergency condition needing attention", "Active fire detected", "System test in progress", "Panel is in maintenance mode"], cat: "Fire" },
  { q: "What's the required height for mounting a pull station (fire alarm)?", a: "Between 42 and 48 inches above floor level (ADA compliant)", opts: ["42-48 inches (ADA compliant)", "Exactly 60 inches", "36 inches or lower", "Any height near an exit"], cat: "Fire" },
  { q: "What is a 'waterflow switch' in a sprinkler system?", a: "A device that detects water movement in the sprinkler pipe and triggers the fire alarm", opts: ["Detects water movement and triggers alarm", "Controls water pressure in the system", "Shuts off water after the fire is out", "Measures water temperature"], cat: "Fire" },
  { q: "What does 'NAC' stand for on a fire alarm panel?", a: "Notification Appliance Circuit — the circuit that powers horns, strobes, and speakers", opts: ["Notification Appliance Circuit", "National Alarm Code", "Network Access Controller", "Non-Addressable Circuit"], cat: "Fire" },
  { q: "What is a duct detector?", a: "A smoke detector mounted in an HVAC duct to detect smoke spreading through the air system", opts: ["Smoke detector in HVAC ductwork", "A device that measures airflow", "A CO2 sensor for ventilation", "A heat sensor on exhaust vents"], cat: "Fire" },

  // Access Control
  { q: "What does 'Wiegand' refer to in access control?", a: "A communication protocol between card readers and controllers (26-bit is most common)", opts: ["Communication protocol for readers/controllers", "A type of biometric scanner", "A brand of door locks", "A card encryption method"], cat: "Access Control" },
  { q: "What is a 'request to exit' (REX) device?", a: "A sensor (usually PIR) that detects someone approaching a door from the inside to unlock it", opts: ["PIR sensor that unlocks door from inside", "A button to call for help", "A fire alarm pull station", "A keypad to enter exit codes"], cat: "Access Control" },
  { q: "What's the difference between 'fail-safe' and 'fail-secure' locks?", a: "Fail-safe UNLOCKS on power loss (for life safety); fail-secure LOCKS on power loss (for security)", opts: ["Fail-safe unlocks; fail-secure locks on power loss", "They're the same thing", "Fail-safe is for interior; fail-secure is exterior", "Fail-safe uses battery backup; fail-secure doesn't"], cat: "Access Control" },
  { q: "What is an 'anti-passback' feature?", a: "Prevents a card from being used to enter again without first exiting — stops card sharing", opts: ["Prevents re-entry without exiting first", "Locks out a card after 3 failed attempts", "Requires two cards to open a door", "Automatically locks doors behind you"], cat: "Access Control" },
  { q: "What does a door contact (mag contact) detect?", a: "Whether a door is open or closed — uses a magnet and reed switch", opts: ["Door open/closed via magnet and reed switch", "How hard the door was slammed", "Whether the door is locked", "The temperature of the door frame"], cat: "Access Control" },
  { q: "What frequency do most proximity (HID) access cards operate at?", a: "125 kHz for standard prox, 13.56 MHz for smart cards (iCLASS)", opts: ["125 kHz prox / 13.56 MHz smart cards", "2.4 GHz like WiFi", "900 MHz like cell phones", "60 Hz like power lines"], cat: "Access Control" },

  // General / LTS (Low Voltage Technology Systems)
  { q: "What does LTS stand for in the security industry?", a: "Low-voltage Technology Systems", opts: ["Low-voltage Technology Systems", "Long Term Surveillance", "Licensed Technical Services", "Laser Tracking System"], cat: "LTS" },
  { q: "What gauge wire is most commonly used for alarm system runs?", a: "22 AWG (22/2 or 22/4)", opts: ["22 AWG", "14 AWG", "18 AWG", "10 AWG"], cat: "LTS" },
  { q: "What does 'CMS' stand for in alarm monitoring?", a: "Central Monitoring Station", opts: ["Central Monitoring Station", "Customer Management System", "Certified Monitoring Service", "Communication Module Setup"], cat: "LTS" },
  { q: "What's a typical backup battery requirement for a fire alarm panel?", a: "24 hours of standby + 5 minutes of alarm (per NFPA 72)", opts: ["24 hours standby + 5 min alarm", "8 hours standby + 15 min alarm", "48 hours standby + 2 min alarm", "12 hours standby + 10 min alarm"], cat: "LTS" },
  { q: "What is Cat6 cable primarily used for in security installs?", a: "IP camera runs and network connections — supports up to 10Gbps at short distances", opts: ["IP cameras and network — up to 10Gbps", "Powering 12V devices", "Fire alarm circuits", "Intercom wiring"], cat: "LTS" },
  { q: "What does PoE stand for and why is it useful in camera installs?", a: "Power over Ethernet — sends data and power over one cable, eliminating separate power runs", opts: ["Power over Ethernet — data + power in one cable", "Point of Entry — where cables enter a building", "Protocol over Encryption — secures video feeds", "Power on Equipment — remote reboot capability"], cat: "LTS" },
  { q: "What is the max recommended cable run for Cat6 Ethernet?", a: "328 feet (100 meters) including patch cables", opts: ["328 feet (100 meters)", "500 feet (150 meters)", "200 feet (60 meters)", "1000 feet (300 meters)"], cat: "LTS" },
  { q: "What does NVR stand for?", a: "Network Video Recorder — records IP camera footage", opts: ["Network Video Recorder", "National Video Registry", "Non-Volatile Recording", "Networked Visual Relay"], cat: "LTS" },
];

// ============================================
// BUILD SYSTEM PROMPT
// ============================================
const buildSystemPrompt = (userName, userRole, snapshot, teamFacts) => `You are the JUC-E assistant for DRH Security (Highside Security). You're talking to ${userName} (${userRole}).

## TEAM
- Sara (Operator): Runs the board, assigns jobs, billing, built this app.
- Austin (Field Tech): Service calls, inspections, repairs.
- JR (Owner/Tech): Installs and service. Reviews estimates.
- Shana (Office/Dispatch): Scheduling, confirmations, follow-ups, billing tasks.
- Trevor (Install Tech): Installations.

## TEAM FUN FACTS (from their own answers)
${teamFacts}

## LIVE DATA
${snapshot}

## THE APP
Three views via bottom nav:
- Calendar: Full Google Calendar view. Day/week. Search bar.
- Office: Board (kanban by tech, quick-assign), Customers, Billing.
- Dashboard: Pipeline, stats, open count.

## JOB FLOW
New → Needs Details → Ready to Schedule → Scheduled → Complete → To Bill → Billed
Branches: Needs Parts, Pending Decision, Pending Materials, Return Pending, Needs Estimate, Estimate Sent, Won/Lost

## SECURITY INDUSTRY EXPERTISE
You are an expert in:
- **IDS (Intrusion Detection Systems)**: PIR sensors, glass breaks, door contacts, motion detectors, panel programming, zone configuration, EOL resistors, duress codes, cross-zoning, alarm communication (IP, cellular, POTS)
- **Fire Alarm & Suppression**: NFPA 72, 2-wire vs 4-wire smokes, addressable vs conventional, NAC circuits, pull stations, duct detectors, waterflow switches, supervisory vs alarm signals, clean agent (FM-200/Novec), wet/dry sprinklers
- **Access Control**: Wiegand protocol, HID prox/iCLASS/SEOS, fail-safe vs fail-secure, REX devices, anti-passback, door contacts, mag locks vs electric strikes, credential management
- **LTS (Low-voltage Technology Systems)**: Cat5e/Cat6 runs, PoE, NVR/DVR, IP vs analog cameras, 22AWG alarm wire, cable run limits, CMS communication, panel batteries, surge protection

You also know small business operations:
- **Tax Strategy**: S-Corp election, Solo 401(k) contributions ($69,500 max for 2026), QBI deduction, Augusta Rule, HSA triple tax advantage, hiring kids, accountable plans, cost segregation
- **Write-offs**: Vehicle mileage ($0.70/mi 2026), home office, tools (Section 179), phones, training, meals (50%), software, health insurance premiums, uniforms
- **Retirement**: Solo 401(k) vs SEP IRA vs Roth IRA, contribution limits, Roth conversions, backdoor Roth
- **Business Ops**: Pricing (3-4x labor cost), cash flow (invoice same day, Net 15/30), W-2 vs 1099 classification, LLC vs S-Corp, insurance requirements, mileage tracking
- **Team Management**: 2026 federal holidays, gift ideas for field teams, bonus structures

You care about the team's wellbeing:
- **Mental Health**: Burnout recognition, stress management techniques (box breathing, grounding), anger management, sleep hygiene, loneliness in field work, substance use resources
- **Crisis Resources**: 988 Suicide & Crisis Lifeline, Crisis Text Line (741741), SAMHSA (1-800-662-4357)
- **Therapy**: Psychology Today finder, BetterHelp/Talkspace, Open Path Collective ($30-80/session), EAP programs
- If someone expresses distress, take it seriously. Be direct, not clinical. Share resources without being preachy. Never minimize what they're feeling.

If someone asks a technical security question, give a real, useful answer. Be specific. Include part numbers, wire gauges, code references when relevant. You're not a generic chatbot — you're a security industry assistant.

## HOW TO DO THINGS IN THE APP
- Complete a job: Open it → disposition (All Fixed / Return Needed / Sales Opp / No Charge)
- Bill: Office → Billing → open job → Billed
- Note: Open job → notes → type → +
- Create job: Green + button
- Customer lookup: Office → Customers → search
- Assign: Office → Board → Unassigned → tap tech name
- Search: Calendar tab search bar

## BOT COMMANDS (the user can do these right here in chat)
- /search [name] — searches customers and jobs, shows results
- /log [customer] — log a call or customer text as a note on their job
- /guide — step-by-step walkthroughs for common workflows
- /share — copy recent messages to clipboard for forwarding to Sara/Shana
- /trivia — security industry quiz
- /facts — team fun facts
- "forward to sara" — copies message to clipboard
- Natural language works too: "search for Smith", "got a call from Johnson", "find job 1234"

## RULES
- 1-3 sentences for app questions. Longer for technical security questions.
- Talk like a coworker who knows their stuff. Not a customer service bot.
- USE the live data. Answer "how many jobs need billing" with real numbers.
- If someone reports a bug: "Logged it. Sara will see it."
- If asked about pricing/financials: "Check with Sara on that."
- For "is [name] crazy" questions: defend that person with specific facts and humor. Always end with a redirect back to work.
- If someone says "trivia" or "quiz me": tell them to type /trivia
- Don't start with "Hey" or "Hi" — just answer.`;

// ============================================
// MAIN COMPONENT
// ============================================
export default function HelpBot({ userEmail, currentView, userName, userRole }) {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [snapshot, setSnapshot] = useState('Loading...');
  const [mode, setMode] = useState('chat'); // chat | quiz | trivia | log | pickjob
  const [quizStep, setQuizStep] = useState(0);
  const [quizAnswers, setQuizAnswers] = useState({});
  const [triviaQ, setTriviaQ] = useState(null);
  const [triviaScore, setTriviaScore] = useState({ correct: 0, total: 0 });
  const [triviaAnswered, setTriviaAnswered] = useState(false);
  const [actionContext, setActionContext] = useState(null); // { type, customer, jobs, text, step }
  const messagesEndRef = useRef(null);

  // Check if user has completed OR been shown the fun facts quiz
  const quizKey = `juce_quiz_${userEmail}`;
  const hasSeenQuiz = () => {
    try { 
      const val = localStorage.getItem(quizKey);
      return val === 'done' || val === 'shown'; 
    } catch { return false; }
  };
  
  // Mark quiz as shown (even if not completed) so it only appears once
  const markQuizShown = () => {
    try { 
      if (!localStorage.getItem(quizKey)) {
        localStorage.setItem(quizKey, 'shown'); 
      }
    } catch {}
  };

  // Get stored team facts for the system prompt
  const getTeamFacts = () => {
    const lines = [];
    Object.entries(TEAM_FACTS).forEach(([name, data]) => {
      if (data.facts.length > 0) {
        lines.push(`${name}: ${data.facts.slice(0, 3).join('. ')}`);
      }
      // Check localStorage for quiz answers
      try {
        const stored = localStorage.getItem(`juce_facts_${name}`);
        if (stored) {
          const parsed = JSON.parse(stored);
          Object.entries(parsed).forEach(([k, v]) => {
            lines.push(`${name}'s ${k}: ${v}`);
          });
        }
      } catch {}
    });
    // Check current user's stored answers too
    try {
      const myFacts = localStorage.getItem(`juce_facts_${userName}`);
      if (myFacts) {
        const parsed = JSON.parse(myFacts);
        Object.entries(parsed).forEach(([k, v]) => {
          lines.push(`${userName}'s ${k}: ${v}`);
        });
      }
    } catch {}
    return lines.join('\n') || 'No team facts collected yet.';
  };

  // Fetch live job snapshot
  const fetchSnapshot = useCallback(async () => {
    try {
      const stats = await queries.getDashboardStats();
      const jobs = stats.allJobs || [];
      const billing = stats.billingJobs || [];
      
      // Get today's scheduled jobs
      const now = new Date();
      const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
      const todayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).toISOString();
      let todaysJobs = [];
      try {
        todaysJobs = await assignmentsApi.getAllSchedule(todayStart, todayEnd);
      } catch (e) { console.warn('Could not fetch today schedule:', e); }
      
      // Get tomorrow's scheduled jobs
      const tomorrowStart = todayEnd;
      const tomorrowEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 2).toISOString();
      let tomorrowsJobs = [];
      try {
        tomorrowsJobs = await assignmentsApi.getAllSchedule(tomorrowStart, tomorrowEnd);
      } catch (e) { console.warn('Could not fetch tomorrow schedule:', e); }
      
      const lines = [
        `Open: ${stats.totalOpen} | New: ${stats.needsAction} | Scheduled: ${stats.scheduled} | To Bill: ${stats.toBill}`,
        `Parts: ${stats.waitingOnParts} | Returns: ${stats.returnsPending} | Estimates: ${stats.estimatesPending}`,
        `Pipeline: $${(stats.pipelineValue || 0).toLocaleString()}`
      ];
      
      // Today's schedule
      lines.push('', `TODAY'S SCHEDULE (${todaysJobs.length} jobs):`);
      if (todaysJobs.length === 0) {
        lines.push('  No jobs scheduled for today.');
      } else {
        todaysJobs.forEach(j => {
          const time = j.scheduled_for ? new Date(j.scheduled_for).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : '?';
          lines.push(`  ${time} - ${j.customer_name || '?'} (${assigneeOf(j) || 'Unassigned'}): ${j.issue || j.job_type || '-'}`);
        });
      }
      
      // Tomorrow's schedule
      lines.push('', `TOMORROW'S SCHEDULE (${tomorrowsJobs.length} jobs):`);
      if (tomorrowsJobs.length === 0) {
        lines.push('  No jobs scheduled for tomorrow.');
      } else {
        tomorrowsJobs.forEach(j => {
          const time = j.scheduled_for ? new Date(j.scheduled_for).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : '?';
          lines.push(`  ${time} - ${j.customer_name || '?'} (${assigneeOf(j) || 'Unassigned'}): ${j.issue || j.job_type || '-'}`);
        });
      }
      
      // Recent activity
      lines.push('', 'RECENT JOBS:');
      jobs.slice(0, 6).forEach(j => {
        lines.push(`  ${j.customer_name || '?'}: ${j.issue || '-'} [${j.status}]`);
      });
      
      if (billing.length > 0) {
        lines.push('', 'BILLING QUEUE:');
        billing.slice(0, 5).forEach(j => {
          lines.push(`  ${j.customer_name}: ${j.status}${j.completion_notes ? '' : ' ⚠️ NO NOTES'}`);
        });
      }
      setSnapshot(lines.join('\n'));
    } catch { setSnapshot('Could not load live data.'); }
  }, []);

  useEffect(() => {
    if (isOpen && snapshot === 'Loading...') fetchSnapshot();
  }, [isOpen, snapshot, fetchSnapshot]);

  // Opening behavior — quiz or greeting
  useEffect(() => {
    if (isOpen && messages.length === 0) {
      if (!hasSeenQuiz()) {
        markQuizShown(); // Mark immediately so it only shows once
        setMode('quiz');
        setQuizStep(0);
        setQuizAnswers({});
        setMessages([
          { role: 'assistant', content: `Welcome to JUC-E, ${userName}! 🛡️ Before we get started, I want to get to know you. Quick ${QUIZ_QUESTIONS.length} questions — makes the app more fun for everyone.` },
          { role: 'assistant', content: QUIZ_QUESTIONS[0].q }
        ]);
      } else {
        const greetings = [
          `What do you need, ${userName}?`,
          `${userName}. Go.`,
          `What's up, ${userName}?`,
          `Ready when you are, ${userName}.`,
        ];
        setMessages([{ role: 'assistant', content: greetings[Math.floor(Math.random() * greetings.length)] }]);
      }
    }
  }, [isOpen, messages.length, userName]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // ============================================
  // QUIZ MODE HANDLER
  // ============================================
  const handleQuiz = (answer) => {
    const currentQ = QUIZ_QUESTIONS[quizStep];
    const newAnswers = { ...quizAnswers, [currentQ.key]: answer };
    setQuizAnswers(newAnswers);

    const reactions = ["Nice. 👊", "Good one. 😂", "Noted. 📝", "Respect. 💪", "Love it. 🔥", "Classic. 😎", "Filed away forever. 🗂️", "Can't argue with that. ✅"];
    const reaction = reactions[Math.floor(Math.random() * reactions.length)];

    const nextStep = quizStep + 1;
    if (nextStep < QUIZ_QUESTIONS.length) {
      setQuizStep(nextStep);
      setMessages(prev => [
        ...prev,
        { role: 'user', content: answer },
        { role: 'assistant', content: reaction },
        { role: 'assistant', content: QUIZ_QUESTIONS[nextStep].q }
      ]);
    } else {
      // Quiz complete — save answers
      try {
        localStorage.setItem(quizKey, 'done');
        localStorage.setItem(`juce_facts_${userName}`, JSON.stringify(newAnswers));
      } catch {}
      setMode('chat');
      setMessages(prev => [
        ...prev,
        { role: 'user', content: answer },
        { role: 'assistant', content: `${reaction} That's it — you're locked in. Your answers are saved and the team can discover them. Now, what do you actually need help with? 🛡️` }
      ]);
    }
  };

  // ============================================
  // TRIVIA MODE
  // ============================================
  const startTrivia = () => {
    const q = TRIVIA_QUESTIONS[Math.floor(Math.random() * TRIVIA_QUESTIONS.length)];
    setTriviaQ(q);
    setTriviaAnswered(false);
    setMode('trivia');
    // Shuffle options
    const shuffled = [...q.opts].sort(() => Math.random() - 0.5);
    setMessages(prev => [
      ...prev,
      { role: 'assistant', content: `⚡ TRIVIA TIME [${q.cat}]\n\n${q.q}` },
      { role: 'assistant', content: shuffled.map((o, i) => `${['A','B','C','D'][i]}) ${o}`).join('\n'), _options: shuffled }
    ]);
  };

  const handleTriviaAnswer = (answer) => {
    if (!triviaQ || triviaAnswered) return;
    setTriviaAnswered(true);

    // Find which option they picked
    const lastMsg = messages[messages.length - 1];
    const options = lastMsg._options || triviaQ.opts;
    let selectedAnswer = answer;

    // Handle A/B/C/D input
    const letterMatch = answer.trim().toUpperCase().match(/^([ABCD])\)?$/);
    if (letterMatch) {
      const idx = 'ABCD'.indexOf(letterMatch[1]);
      if (idx >= 0 && idx < options.length) selectedAnswer = options[idx];
    }

    const isCorrect = selectedAnswer === triviaQ.a || 
                       selectedAnswer.toLowerCase() === triviaQ.a.toLowerCase() ||
                       selectedAnswer.toLowerCase().startsWith(triviaQ.a.toLowerCase().slice(0, 25));

    const newScore = { correct: triviaScore.correct + (isCorrect ? 1 : 0), total: triviaScore.total + 1 };
    setTriviaScore(newScore);

    const prefix = isCorrect ? '✅ Correct!' : `❌ Nope! The answer is: ${triviaQ.a}`;
    setMode('chat');
    setMessages(prev => [
      ...prev,
      { role: 'user', content: answer },
      { role: 'assistant', content: `${prefix}\n\nScore: ${newScore.correct}/${newScore.total} | Type /trivia for another one, or ask me anything.` }
    ]);
  };

  // ============================================
  // CRAZY HANDLER (all team members)
  // ============================================
  const handleCrazy = (msg) => {
    const lower = msg.toLowerCase();
    for (const [name, data] of Object.entries(TEAM_FACTS)) {
      if (lower.includes(name.toLowerCase()) && (data.crazy?.length > 0)) {
        if (/crazy|nuts|insane|psycho|wild|much|intense|annoying|mean|bossy|lazy/i.test(lower)) {
          return data.crazy[Math.floor(Math.random() * data.crazy.length)];
        }
      }
    }
    return null;
  };

  // ============================================
  // FACTS HANDLER
  // ============================================
  const handleFacts = (msg) => {
    const lower = msg.toLowerCase();
    for (const [name, data] of Object.entries(TEAM_FACTS)) {
      if (lower.includes(name.toLowerCase()) && /fact|tell me about|random|know about/i.test(lower)) {
        // Check built-in facts
        if (data.facts.length > 0) {
          return `📋 ${name} fact: ${data.facts[Math.floor(Math.random() * data.facts.length)]}`;
        }
        // Check quiz answers
        try {
          const stored = localStorage.getItem(`juce_facts_${name}`);
          if (stored) {
            const parsed = JSON.parse(stored);
            const keys = Object.keys(parsed);
            const k = keys[Math.floor(Math.random() * keys.length)];
            const labels = { snack: 'gas station snack', music: 'truck music', tool: 'favorite tool', food: 'lunch order', superpower: 'dream superpower', pet_peeve: 'biggest pet peeve', binge: 'currently binge-watching', motto: 'personal motto' };
            return `📋 ${name}'s ${labels[k] || k}: "${parsed[k]}"`;
          }
        } catch {}
        return `I don't have any facts about ${name} yet. They need to open the chat and answer the quiz first!`;
      }
    }
    return null;
  };

  // ============================================
  // SEND MESSAGE
  // ============================================
  const sendMessage = async () => {
    if (!input.trim() || isLoading) return;
    const userMessage = input.trim();
    setInput('');

    // Quiz mode
    if (mode === 'quiz') {
      handleQuiz(userMessage);
      return;
    }

    // Trivia mode
    if (mode === 'trivia') {
      handleTriviaAnswer(userMessage);
      return;
    }

    // Pick-job mode (user selecting from search/log results)
    if (mode === 'pickjob' && actionContext) {
      setMessages(prev => [...prev, { role: 'user', content: userMessage }]);
      setIsLoading(true);
      const pick = parseInt(userMessage) - 1;
      
      if (actionContext.type === 'search' && actionContext.results) {
        // They picked a search result
        const item = actionContext.results[pick];
        if (item) {
          const detail = item._type === 'customer'
            ? `👤 ${item.name}\n📍 ${item.address || 'No address'}\n📞 ${item.phone || 'No phone'}\n🔑 CMS: ${item.cms_account_id || 'None'}\n📧 ${item.email || 'None'}${item.gate_code ? '\n🚪 Gate: ' + item.gate_code : ''}${item.panel_password ? '\n🔒 Panel: ' + item.panel_password : ''}`
            : `📋 Job #${item.job_number || '?'}\n👤 ${item.customer_name}\n🔧 ${item.issue || 'No details'}\n📊 Status: ${item.status}\n${item.priority ? '⚡ Priority: ' + item.priority : ''}`;
          setMessages(prev => [...prev, { role: 'assistant', content: detail }]);
        } else {
          setMessages(prev => [...prev, { role: 'assistant', content: "Invalid number. Type /search to try again." }]);
        }
        setMode('chat');
        setActionContext(null);
        setIsLoading(false);
        return;
      }

      if (actionContext.type === 'log' && actionContext.jobs) {
        const job = actionContext.jobs[pick];
        if (job) {
          try {
            await notesApi.addNote(job.id, `[${userName} via HelpBot]: ${actionContext.text}`, userEmail);
            setMessages(prev => [...prev, { role: 'assistant', content: `✅ Logged on Job #${job.job_number || '?'} (${job.customer_name}):\n\n"${actionContext.text}"\n\nNote saved. ${actionContext.forward ? '📋 Copied to clipboard for forwarding.' : ''}` }]);
            if (actionContext.forward) {
              try { await navigator.clipboard.writeText(`From ${userName} re: ${job.customer_name} — ${actionContext.text}`); } catch {}
            }
          } catch (e) {
            setMessages(prev => [...prev, { role: 'assistant', content: "Failed to save note. Try adding it directly on the job." }]);
          }
        } else {
          setMessages(prev => [...prev, { role: 'assistant', content: "Invalid number. Try again or type /cancel." }]);
          setIsLoading(false);
          return; // Stay in pickjob mode
        }
        setMode('chat');
        setActionContext(null);
        setIsLoading(false);
        return;
      }

      if (actionContext.type === 'log_pick_customer' && actionContext.customers) {
        const cust = actionContext.customers[pick];
        if (cust) {
          setMessages(prev => [...prev, { role: 'assistant', content: `📞 Logging for ${cust.name}.\n\nWhat's the message? (paste the text or describe the call)` }]);
          setMode('log');
          setActionContext({ type: 'log', customer: cust, step: 'waiting_message' });
        } else {
          setMessages(prev => [...prev, { role: 'assistant', content: "Invalid number. Try again or type /cancel." }]);
        }
        setIsLoading(false);
        return;
      }

      // Fallback — exit pickjob
      setMode('chat');
      setActionContext(null);
      setIsLoading(false);
      return;
    }

    // Log mode — waiting for the message content
    if (mode === 'log' && actionContext?.type === 'log' && actionContext?.step === 'waiting_message') {
      setMessages(prev => [...prev, { role: 'user', content: userMessage }]);
      setIsLoading(true);
      // We have the customer, now find their open jobs
      const ctx = actionContext;
      try {
        const jobs = await customersApi.getJobs(ctx.customer.id);
        const openJobs = jobs.filter(j => !['billed', 'archived', 'dead', 'lost'].includes(j.status));
        if (openJobs.length === 0) {
          // No open jobs — log as new note anyway on most recent job, or tell them
          setMessages(prev => [...prev, { role: 'assistant', content: `No open jobs for ${ctx.customer.name}. Create a new job from the green + button, then add this note. Copied to clipboard:\n\n"${userMessage}"` }]);
          try { await navigator.clipboard.writeText(userMessage); } catch {}
          setMode('chat');
          setActionContext(null);
        } else if (openJobs.length === 1) {
          // One job — just log it
          await notesApi.addNote(openJobs[0].id, `[${userName} via HelpBot]: ${userMessage}`, userEmail);
          setMessages(prev => [...prev, { role: 'assistant', content: `✅ Logged on ${ctx.customer.name}'s job (${openJobs[0].issue || openJobs[0].status}):\n\n"${userMessage}"` }]);
          setMode('chat');
          setActionContext(null);
        } else {
          // Multiple jobs — ask which one
          const list = openJobs.slice(0, 8).map((j, i) => `${i + 1}) ${j.issue || j.status} [${j.status}]`).join('\n');
          setMessages(prev => [...prev, { role: 'assistant', content: `${ctx.customer.name} has ${openJobs.length} open jobs. Which one?\n\n${list}\n\nType the number.` }]);
          setMode('pickjob');
          setActionContext({ ...ctx, jobs: openJobs.slice(0, 8), text: userMessage });
        }
      } catch (e) {
        setMessages(prev => [...prev, { role: 'assistant', content: "Couldn't load jobs. Try logging the note directly on the job." }]);
        setMode('chat');
        setActionContext(null);
      }
      setIsLoading(false);
      return;
    }

    setMessages(prev => [...prev, { role: 'user', content: userMessage }]);
    setIsLoading(true);

    // Log
    try {
      await feedbackApi.create({ type: detectMessageType(userMessage), message: userMessage, userEmail, currentView, metadata: { timestamp: new Date().toISOString(), userName } });
    } catch {}

    // Commands
    const lower = userMessage.toLowerCase().trim();

    if (lower === '/cancel') {
      setMode('chat');
      setActionContext(null);
      setMessages(prev => [...prev, { role: 'assistant', content: "Cancelled. What do you need?" }]);
      setIsLoading(false);
      return;
    }

    // ============================================
    // SEARCH — /search [term] or "search [term]" or "find [customer]" or "look up [name]"
    // ============================================
    const searchMatch = userMessage.match(/^\/search\s+(.+)/i) || userMessage.match(/^(?:search|find|look\s*up|pull\s*up)\s+(.+)/i);
    if (searchMatch) {
      const term = searchMatch[1].trim();
      try {
        const [customers, jobs] = await Promise.all([
          customersApi.search(term),
          jobsApi.search(term)
        ]);
        const results = [];
        customers.slice(0, 5).forEach(c => results.push({ ...c, _type: 'customer' }));
        jobs.slice(0, 5).forEach(j => results.push({ ...j, _type: 'job' }));

        if (results.length === 0) {
          setMessages(prev => [...prev, { role: 'assistant', content: `No results for "${term}". Try a different name, phone number, or CMS ID.` }]);
        } else {
          const lines = results.map((r, i) => {
            if (r._type === 'customer') return `${i + 1}) 👤 ${r.name} — ${r.phone || 'no phone'} — ${r.address || 'no address'}`;
            return `${i + 1}) 📋 ${r.customer_name} — ${r.issue || r.status} [${r.status}]`;
          });
          setMessages(prev => [...prev, { role: 'assistant', content: `🔍 Found ${results.length} result${results.length > 1 ? 's' : ''} for "${term}":\n\n${lines.join('\n')}\n\nType a number for details, or keep chatting.` }]);
          setMode('pickjob');
          setActionContext({ type: 'search', results });
        }
      } catch (e) {
        setMessages(prev => [...prev, { role: 'assistant', content: "Search failed. Try from Office → Customers tab." }]);
      }
      setIsLoading(false);
      return;
    }

    // ============================================
    // LOG A CALL — /log [customer] or "[name] called" or "got a call from [name]"
    // ============================================
    const logMatch = userMessage.match(/^\/log\s+(.+)/i) ||
      userMessage.match(/(?:got a (?:call|text|message) from|(\w[\w\s]*?) (?:called|texted|messaged))\s*(.+)?/i);
    if (logMatch) {
      const customerName = (logMatch[1] || logMatch[2] || '').trim();
      if (!customerName) {
        setMessages(prev => [...prev, { role: 'assistant', content: "Who called? Type: /log [customer name]" }]);
        setIsLoading(false);
        return;
      }
      try {
        const customers = await customersApi.search(customerName);
        if (customers.length === 0) {
          setMessages(prev => [...prev, { role: 'assistant', content: `No customer found for "${customerName}". Check the name or add them: Office → Customers → + Add.` }]);
        } else if (customers.length === 1) {
          setMessages(prev => [...prev, { role: 'assistant', content: `📞 Logging for ${customers[0].name}.\n\nWhat's the message? (paste the text or describe the call)` }]);
          setMode('log');
          setActionContext({ type: 'log', customer: customers[0], step: 'waiting_message' });
        } else {
          const list = customers.slice(0, 5).map((c, i) => `${i + 1}) ${c.name} — ${c.phone || ''} — ${c.address || ''}`).join('\n');
          setMessages(prev => [...prev, { role: 'assistant', content: `Found ${customers.length} matches for "${customerName}":\n\n${list}\n\nWhich one? Type the number.` }]);
          setMode('pickjob');
          setActionContext({ type: 'log_pick_customer', customers: customers.slice(0, 5), originalMessage: userMessage });
        }
      } catch {
        setMessages(prev => [...prev, { role: 'assistant', content: "Customer search failed. Try logging the note directly on the job." }]);
      }
      setIsLoading(false);
      return;
    }

    // ============================================
    // FORWARD / SHARE — "forward to sara" or "send to shana" or /share
    // ============================================
    if (/^\/share|forward.*(sara|shana)|send.*(sara|shana)|copy.*(sara|shana)|text.*(sara|shana)/i.test(lower)) {
      // Grab the last few user messages as the content to share
      const recentUserMsgs = messages.filter(m => m.role === 'user').slice(-3).map(m => m.content);
      if (recentUserMsgs.length === 0) {
        setMessages(prev => [...prev, { role: 'assistant', content: "Nothing to share yet. Paste a customer text first, then say 'forward to Sara'." }]);
      } else {
        const shareText = `From ${userName} via JUC-E:\n\n${recentUserMsgs.join('\n\n')}`;
        try {
          await navigator.clipboard.writeText(shareText);
          setMessages(prev => [...prev, { role: 'assistant', content: `📋 Copied to clipboard! Paste it in your text to Sara/Shana:\n\n"${shareText.slice(0, 150)}${shareText.length > 150 ? '...' : ''}"` }]);
        } catch {
          setMessages(prev => [...prev, { role: 'assistant', content: `Here's the formatted message — long-press to copy:\n\n${shareText}` }]);
        }
      }
      setIsLoading(false);
      return;
    }

    // ============================================
    // GUIDED WALKTHROUGHS — /guide [topic]
    // ============================================
    if (/^\/guide/i.test(lower) || lower === 'guide' || lower === 'walkthrough' || lower === 'how do i') {
      const topic = lower.replace(/^\/?guide\s*/i, '').trim();
      const guide = getGuide(topic);
      setMessages(prev => [...prev, { role: 'assistant', content: guide }]);
      setIsLoading(false);
      return;
    }
    if (lower === '/trivia' || lower === 'trivia' || lower === 'quiz me') {
      setIsLoading(false);
      startTrivia();
      return;
    }
    if (lower === '/score') {
      setMessages(prev => [...prev, { role: 'assistant', content: `Trivia score: ${triviaScore.correct}/${triviaScore.total} ${triviaScore.total > 0 ? `(${Math.round(triviaScore.correct/triviaScore.total*100)}%)` : ''}` }]);
      setIsLoading(false);
      return;
    }
    if (lower === '/reset') {
      try { localStorage.removeItem(quizKey); localStorage.removeItem(`juce_facts_${userName}`); } catch {}
      setMessages(prev => [...prev, { role: 'assistant', content: "Quiz reset. Close and reopen the chat to retake it." }]);
      setIsLoading(false);
      return;
    }
    if (lower === '/facts' || lower === 'team facts') {
      const facts = getTeamFacts();
      setMessages(prev => [...prev, { role: 'assistant', content: `📋 Team Facts:\n\n${facts}` }]);
      setIsLoading(false);
      return;
    }

    // Crazy check
    const crazyResponse = handleCrazy(userMessage);
    if (crazyResponse) {
      setMessages(prev => [...prev, { role: 'assistant', content: crazyResponse }]);
      setIsLoading(false);
      return;
    }

    // Facts check
    const factsResponse = handleFacts(userMessage);
    if (factsResponse) {
      setMessages(prev => [...prev, { role: 'assistant', content: factsResponse }]);
      setIsLoading(false);
      return;
    }

    try {
      if (CLAUDE_API_KEY) {
        const apiMessages = messages.filter(m => m.role !== 'system').map(m => ({ role: m.role, content: m.content })).concat([{ role: 'user', content: userMessage }]);
        const response = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-api-key': CLAUDE_API_KEY, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' },
          body: JSON.stringify({ model: 'claude-sonnet-4-20250514', max_tokens: 800, system: buildSystemPrompt(userName, userRole, snapshot, getTeamFacts()), messages: apiMessages })
        });
        if (response.ok) {
          const data = await response.json();
          setMessages(prev => [...prev, { role: 'assistant', content: data.content?.[0]?.text || "Something broke." }]);
        } else throw new Error('API');
      } else {
        setMessages(prev => [...prev, { role: 'assistant', content: getLocalResponse(userMessage, userName) }]);
      }
    } catch {
      setMessages(prev => [...prev, { role: 'assistant', content: getLocalResponse(userMessage, userName) }]);
    } finally { setIsLoading(false); }
  };

  const detectMessageType = (msg) => {
    const l = msg.toLowerCase();
    if (/bug|broken|error|crash|doesn't work|not working/.test(l)) return 'bug';
    if (/should|could you|feature|wish|would be nice/.test(l)) return 'suggestion';
    if (/how|where|what|when|can i/.test(l)) return 'question';
    return 'feedback';
  };

  // ============================================
  // GUIDED WALKTHROUGHS
  // ============================================
  const getGuide = (topic) => {
    const guides = {
      billing: `💵 BILLING WALKTHROUGH\n\n1️⃣ Go to Office → Billing tab\n2️⃣ You'll see the 'To Bill' queue — these are completed jobs\n3️⃣ ⚠️ means missing completion notes — open the job and add what was done\n4️⃣ Once notes are in, tap the job → tap 'Billed'\n5️⃣ Job moves to Billed and you're done\n\nTip: Sara can't invoice without completion notes. If the tech didn't add them, bug them.`,
      
      newjob: `🆕 CREATE A NEW JOB\n\n1️⃣ Tap the green + button (bottom left, any screen)\n2️⃣ Search for an existing customer OR tap '+ New Customer'\n3️⃣ Fill in: Issue description, job type (Service/Install/Estimate), priority\n4️⃣ Hit Save\n5️⃣ Job lands in the Unassigned lane on the Board\n6️⃣ From there, quick-assign to a tech or open → Schedule for a specific date\n\nTip: More detail in the issue = less back-and-forth later.`,
      
      complete: `✅ COMPLETING A JOB\n\n1️⃣ Open the job you finished\n2️⃣ Tap your disposition:\n   • All Fixed → sends to billing\n   • Return Needed → schedules a follow-up\n   • Sales Opportunity → creates an estimate\n   • No Charge → closes it out (warranty/goodwill)\n3️⃣ Enter your Arrived and Left times\n4️⃣ Add completion notes (WHAT you did, materials used, anything for next time)\n5️⃣ Hit Save\n\n⚠️ No completion notes = no billing. Sara will come find you.`,
      
      estimate: `📋 ESTIMATE WORKFLOW\n\n1️⃣ Job status gets set to 'Needs Estimate'\n2️⃣ Office → Billing → Estimates queue shows these\n3️⃣ Create your estimate (outside JUC-E — quote sheet, email, etc.)\n4️⃣ Open the job → tap 'Estimate Sent'\n5️⃣ Job moves to Pending — waiting on customer\n6️⃣ Customer says yes → tap 'Won' → job moves to scheduling\n7️⃣ Customer says no → tap 'Lost' → archived\n\nPipeline value on the Dashboard = total $ of all pending estimates.`,
      
      schedule: `📅 SCHEDULING A JOB\n\n1️⃣ Open the job\n2️⃣ Tap 'Schedule'\n3️⃣ Pick the tech and date/time\n4️⃣ A Google Calendar event is created automatically\n5️⃣ The job moves to 'Scheduled' status\n6️⃣ Tech sees it on their Calendar view\n\nTo reschedule: edit the event directly in Google Calendar.\nQuick-assign from the Board: tap a tech name on an unassigned card → auto-schedules for tomorrow 9am.`,
      
      customer: `👤 CUSTOMER MANAGEMENT\n\n📍 Find a customer: Office → Customers → search by name, phone, address, or CMS ID\n\n➕ Add new: Office → Customers → green '+ Add' button\nFill in: name, address, phone, email, gate code, panel password, CMS account ID, notes\n\n📂 Customer detail page shows:\n   • Contact info + gate code + panel password\n   • All jobs (past + current)\n   • All notes across all jobs\n   • CMS account link\n\nTip: Always add gate code and panel password. Techs will thank you.`,
      
      search: `🔍 SEARCHING\n\nFrom the Calendar tab:\n   • Search bar at top searches ALL Google Calendars (90 days) + all jobs in the database\n   • Results show calendar events AND job cards\n\nFrom here in the bot:\n   • Type: /search [name or keyword]\n   • Searches customers AND jobs\n   • Tap a result number for details\n\nFrom Office → Customers:\n   • Search by name, phone, address, CMS ID`,
      
      log: `📞 LOGGING CALLS & TEXTS\n\nQuick way to log a customer interaction:\n\n1️⃣ Type: /log [customer name]\n2️⃣ I'll find the customer\n3️⃣ Paste or type the message\n4️⃣ I'll save it as a note on their open job\n\nTo forward to Sara/Shana:\n1️⃣ Paste the customer text here\n2️⃣ Type: forward to Sara\n3️⃣ I'll copy it to your clipboard — paste into your text app\n\nOr just say: "got a call from [customer name]" and I'll walk you through it.`,
    };

    if (!topic) {
      return `📖 AVAILABLE GUIDES\n\nType /guide [topic]:\n\n• /guide newjob — Creating a job\n• /guide complete — Completing a job\n• /guide billing — Billing walkthrough\n• /guide estimate — Estimate workflow\n• /guide schedule — Scheduling\n• /guide customer — Customer management\n• /guide search — Finding stuff\n• /guide log — Logging calls & texts`;
    }

    // Fuzzy match the topic
    if (/bill|invoice/.test(topic)) return guides.billing;
    if (/new|create|add/.test(topic)) return guides.newjob;
    if (/complet|done|finish|close/.test(topic)) return guides.complete;
    if (/estim|quote|bid|pipeline/.test(topic)) return guides.estimate;
    if (/schedul|assign|dispatch|book/.test(topic)) return guides.schedule;
    if (/customer|client|contact/.test(topic)) return guides.customer;
    if (/search|find|look/.test(topic)) return guides.search;
    if (/log|call|text|forward|share/.test(topic)) return guides.log;
    return `I don't have a guide for "${topic}". Type /guide to see available topics.`;
  };

  const getLocalResponse = (msg, name) => {
    const l = msg.toLowerCase();
    // Security technical
    if (/eol|end.?of.?line|resistor/.test(l)) return "EOL (end-of-line) resistors let the panel supervise a zone wire. If the wire gets cut → open fault. If it shorts → short fault. Standard values are 2.2kΩ or 4.7kΩ depending on the panel. Always check the panel manual.";
    if (/wiegand/.test(l)) return "Wiegand is the protocol between card readers and access control panels. 26-bit is standard (8-bit facility code + 16-bit card number). Newer systems use OSDP which is encrypted and bidirectional.";
    if (/fail.?safe|fail.?secure/.test(l)) return "Fail-safe = UNLOCKS on power loss (life safety, stairwells, exits). Fail-secure = LOCKS on power loss (server rooms, secure areas). Fire code usually requires fail-safe on exit paths.";
    if (/nfpa|fire code/.test(l)) return "NFPA 72 = fire alarm code. NFPA 25 = inspection/testing of water-based systems. NFPA 101 = life safety code. Which one do you need?";
    if (/poe|power over ethernet/.test(l)) return "PoE sends power + data over one Cat5e/Cat6 cable. 802.3af = 15.4W, 802.3at (PoE+) = 30W, 802.3bt (PoE++) = 60-100W. Most IP cameras need PoE+ or less.";
    if (/cat6|cat5|cable run/.test(l)) return "Cat6 max run is 328ft (100m) total including patch cables. For longer runs you need a switch or media converter. Cat5e maxes at 1Gbps, Cat6 does 10Gbps up to 180ft.";
    if (/nvr|dvr/.test(l)) return "NVR = Network Video Recorder (IP cameras). DVR = Digital Video Recorder (analog cameras via coax). If you're installing new, always go NVR/IP. More resolution, easier cable runs with PoE.";
    if (/clean agent|fm.?200|novec/.test(l)) return "Clean agent suppression (FM-200, Novec 1230) is for server rooms and areas where water damage would be worse than fire. It suppresses fire without residue. Novec is the newer/greener option.";
    if (/glass break/.test(l)) return "Glass break detectors listen for the specific frequency pattern of breaking glass — usually a thud (low freq) followed by shatter (high freq). Mount them 10-15ft from windows, on the ceiling or opposite wall.";
    if (/pir|motion detect|passive infrared/.test(l)) return "PIR sensors detect changes in infrared (body heat) across detection zones. Mount at 7-8ft, avoid pointing at heat sources, HVAC vents, or windows with direct sunlight. For pet immunity, mount higher or use dual-tech.";
    if (/duress/.test(l)) return "A duress code disarms the system normally but sends a silent alarm to the central station. Typically the last digit of the regular code +1 or +2. Important for hostage situations.";
    if (/supervisory|trouble/.test(l)) return "Supervisory = non-emergency condition needing attention (valve tamper, low pressure, device fault). Trouble = system issue (communication fail, low battery, ground fault). Neither means 'fire' — but both need attention.";
    if (/mag lock|electric strike/.test(l)) return "Mag locks hold with electromagnetic force (1200lb typical) — fail-safe only. Electric strikes replace the door frame strike plate — available in fail-safe or fail-secure. Strikes allow regular key bypass, mag locks don't.";
    if (/2.?wire|4.?wire|smoke/.test(l)) return "2-wire smokes share power and signaling on one pair — simpler but needs compatible panel. 4-wire have separate power (constant 12/24V) and signal pairs — more universal. 2-wire is the standard for new addressable systems.";
    if (/pull station/.test(l)) return "Pull stations mount 42-48 inches above floor (ADA). They go within 5ft of each exit. Single-action (just pull) or dual-action (lift then pull). Reset with a key after activation.";
    if (/duct detector/.test(l)) return "Duct detectors mount in HVAC ductwork to catch smoke spreading through the air system. They have sampling tubes that extend into the duct. Required by code on systems over 2,000 CFM.";
    if (/waterflow/.test(l)) return "Waterflow switches detect water movement in sprinkler pipes and trigger the fire alarm. They mount on the main riser. Retard settings (usually 30-60 sec) prevent false alarms from pressure surges.";
    if (/nac|notification appliance/.test(l)) return "NAC = Notification Appliance Circuit. Powers horns, strobes, and speakers on the fire alarm. Typical NAC circuits run at 24VDC with a max current draw per circuit. Calculate your device load before adding more.";
    if (/anti.?passback/.test(l)) return "Anti-passback prevents a card from being used to enter again without first exiting. Stops card sharing and tailgating. Can be hard (denies access) or soft (logs violation but allows entry).";
    if (/rex|request to exit/.test(l)) return "REX = Request to Exit. Usually a PIR sensor above the door that detects someone approaching from the secure side. Triggers the door release without needing a credential. Required for life safety on most secured doors.";
    if (/prox|hid|iclass|card reader/.test(l)) return "Standard HID prox = 125 kHz (easy to clone). iCLASS = 13.56 MHz (encrypted). SEOS = latest, mobile credential capable. If you're installing new, go iCLASS SE or SEOS minimum.";
    if (/camera|ip cam|megapixel|resolution|lens/.test(l)) return "For most commercial installs: 4MP turret cameras for indoor, 4-8MP bullets for outdoor/parking. Use PoE+ for power. 2.8mm lens = wide angle (~110°), 4mm = standard, 12mm+ = narrow/long range. Always check the NVR channel count before adding cameras.";
    if (/panel|alarm panel|dsc|honeywell|dmp/.test(l)) return "Common panels in the field: DSC PowerSeries (Neo), Honeywell Vista (20P/128), DMP XR-series. Each has different zone programming and communication setup. Check the installer manual for your specific panel — programming varies a lot between brands.";
    if (/battery|backup/.test(l)) return "Fire panels: 24hr standby + 5min alarm (NFPA 72). Burglary panels: 24hr standby + 4min alarm (UL 985). Always use sealed lead-acid (SLA) batteries. Replace every 3-5 years. Check voltage under load, not just resting voltage.";
    if (/ground fault/.test(l)) return "Ground fault = current leaking to earth ground somewhere on the circuit. Common causes: water in a junction box, nicked wire touching conduit, bad device. Use a multimeter to isolate — disconnect half the circuit at a time and narrow it down.";
    if (/zone|programming/.test(l)) return "Zones are individual detection circuits on the alarm panel. Each zone has a type (entry/exit, interior, 24hr, fire, etc.) that determines how the panel responds. Always label your zones clearly — future you will thank present you.";
    if (/cellular|communicator|alarm.?com|starlink/.test(l)) return "Cellular communicators (Alarm.com, DMP CellCom, StarLink) send alarm signals over cellular instead of phone lines. They're more reliable and harder to defeat than POTS lines. Most new installs should use cellular primary with IP backup.";

    // ============================================
    // BUSINESS / TAX / FINANCIAL
    // ============================================
    // Tax reduction strategies
    if (/tax|taxes|save.?on.?tax|reduce.?tax|pay.?less.?tax|not.?pay.?tax|avoid.?tax|lower.?tax/.test(l)) return `Tax strategies for small biz (not tax advice — talk to your CPA):\n\n1. Max out retirement contributions (Solo 401k: $23,500 + $46,000 employer = $69,500 for 2026)\n2. S-Corp election — pay yourself reasonable salary, take rest as distributions (saves ~15.3% SE tax on distributions)\n3. QBI deduction — 20% deduction on qualified business income\n4. Defer income / accelerate expenses at year-end\n5. Augusta Rule — rent your home to your business for up to 14 days tax-free\n6. Hire your kids (under 18, no FICA if sole prop)\n7. HSA contributions ($4,300 single / $8,550 family for 2026) — triple tax advantage\n8. Section 199A — stacks with other deductions\n9. Accountable plan for reimbursements (home office, mileage, phone)\n10. Cost segregation study if you own property`;

    // Write-offs
    if (/write.?off|deduct|deduction|expense|business.?expense/.test(l)) return `Best write-offs for service businesses:\n\n🚗 Vehicle: Mileage ($0.70/mi for 2026) OR actual expenses — track everything\n🏠 Home office: Simplified ($5/sqft up to 300sqft = $1,500) or actual method\n📱 Phone & internet: Business % of your bill\n🔧 Tools & equipment: Section 179 — deduct full cost in year 1 (up to $1.22M)\n👕 Uniforms & safety gear: Must have logo or be required\n📚 Training & certs: Industry conferences, online courses, license renewals\n🍽️ Meals: 50% deductible when business-related (keep receipts + notes)\n💻 Software & subscriptions: JUC-E, QuickBooks, Google Workspace, all of it\n🏥 Health insurance premiums: 100% deductible for self-employed\n📦 Supplies: Wire, panels, cameras, parts — all of it\n🚚 Vehicle wrap/signage: 100% deductible marketing`;

    // 401k / Retirement
    if (/401k|retirement|ira|sep|solo|roth|invest|saving/.test(l)) return `2026 retirement options for small biz:\n\n🏦 Solo 401(k): Best for solo/small ops\n  - Employee: $23,500 (+ $7,500 catch-up if 50+)\n  - Employer: up to 25% of comp\n  - Total max: $69,500 ($76,500 if 50+)\n  - Can do Roth contributions\n\n📊 SEP IRA: Simpler but less flexible\n  - Up to 25% of net SE income, max $69,500\n  - No Roth option, no loans\n\n💡 Roth IRA: $7,000/yr ($8,000 if 50+)\n  - Income limits apply, but backdoor Roth works\n\nBest move for most: Solo 401(k) with both traditional + Roth contributions. Talk to your CPA about the right split.`;

    // Holidays 2026
    if (/holiday|day.?off|federal.?holiday|bank.?holiday|time.?off|pto/.test(l)) return `2026 Federal Holidays:\n\n🎆 Jan 1 — New Year's Day (Thu)\n👑 Jan 19 — MLK Day (Mon)\n🇺🇸 Feb 16 — Presidents' Day (Mon)\n🎖️ May 25 — Memorial Day (Mon)\n🗽 Jun 19 — Juneteenth (Fri)\n🎇 Jul 3 — Independence Day observed (Fri, 4th = Sat)\n👷 Sep 7 — Labor Day (Mon)\n🌎 Oct 12 — Columbus Day (Mon)\n🎖️ Nov 11 — Veterans Day (Wed)\n🦃 Nov 26 — Thanksgiving (Thu)\n🎄 Dec 25 — Christmas (Fri)\n\nGood ones to close: Memorial Day, July 4th week, Thanksgiving Thu+Fri, Christmas week. Most security companies stay on-call for emergencies regardless.`;

    // Gift ideas
    if (/gift|present|appreciate|reward|bonus|swag|merch/.test(l)) return `Gift ideas for a security company team:\n\n💰 Under $25:\n  - Yeti/Stanley tumbler with company logo\n  - Quality headlamp (USB rechargeable)\n  - Gas station gift cards (they live on the road)\n  - Custom pocket knife with name engraved\n  - Phone mount for the truck\n\n💵 $25-$75:\n  - Carhartt beanie + gloves set\n  - Bluetooth speaker for the job site\n  - Boot gift card (Red Wing, Keen)\n  - Nice multi-tool (Leatherman Wave)\n  - Portable power bank (20,000mAh+)\n\n🎁 $75+:\n  - Milwaukee heated jacket\n  - Noise-canceling earbuds (Beats Fit Pro)\n  - Cooler backpack for summer\n  - Weekend hotel gift card\n  - Extra PTO day (free and everyone's favorite)\n\n🏢 Team:\n  - Catered lunch\n  - Team outing (Top Golf, go-karts)\n  - Holiday party + spouse/family invite\n  - Custom company jackets`;

    // Payroll / hiring
    if (/payroll|hire|hiring|employee|contractor|1099|w2|w-?2/.test(l)) return "W-2 vs 1099: If you control when, where, and how they work → W-2 employee. If they set their own schedule and methods → 1099 contractor. Misclassifying can cost you big in back taxes + penalties. For field techs who use your tools, drive your trucks, and follow your schedule — they're almost certainly W-2. Talk to your CPA before making anyone 1099.";

    // Business structure
    if (/llc|s.?corp|c.?corp|business.?structure|entity|incorporate/.test(l)) return "For most small security companies: LLC taxed as S-Corp is the sweet spot. You pay yourself a reasonable W-2 salary (say $60-80K), then take remaining profit as distributions — saving ~15.3% in self-employment tax on those distributions. File Form 2553 to elect S-Corp status. Cost: slightly more complex payroll + tax filing, but the savings usually outweigh it above ~$80K net profit.";

    // Insurance
    if (/insurance|bonded|license|liability|workers.?comp/.test(l)) return "Security company insurance checklist: General Liability ($1M/$2M is standard), Workers' Comp (required if you have employees), Commercial Auto, Professional Liability / E&O, Cyber Liability (if you touch networks), Inland Marine (covers tools/equipment in transit), Umbrella ($1-5M). Most commercial clients will ask for a COI before you start work.";

    // Mileage
    if (/mileage|gas|fuel|drive|driving|vehicle/.test(l)) return "2026 IRS mileage rate: $0.70/mile. Track EVERY business mile — app like MileIQ or just a spreadsheet. For field techs, that's shop-to-first-job and last-job-to-shop (commute to/from the shop doesn't count). If you drive 30K business miles, that's a $21,000 deduction. Don't leave that on the table.";

    // Pricing
    if (/price|pricing|rate|charge|hourly|markup|margin/.test(l)) return "Security service industry benchmarks: Hourly rate should be 3-4x what you pay the tech (tech at $25/hr = bill at $85-100/hr). Trip charges: $75-150. Emergency/after-hours: 1.5x-2x regular rate. Materials markup: 20-40%. Always include trip charge even for warranty — covers your fuel and drive time. Don't race to the bottom on price — sell on reliability and response time.";

    // Cash flow
    if (/cash.?flow|ar|accounts.?receivable|collect|payment|invoice|late.?pay|overdue/.test(l)) return "Cash flow rules: Invoice same day the job is done (not next week). Net 15 for residential, Net 30 for commercial (never Net 60 unless you're desperate). Send reminders at 7 days, 14 days, 30 days. After 45 days, call them directly. Offer credit card payments — you'll eat 3% but get paid immediately. For big installs: 50% deposit before you order materials, balance on completion.";

    // ============================================
    // MENTAL HEALTH / WELLNESS
    // ============================================
    if (/burnout|burnt.?out|burned.?out|overwhelm|too.?much|can't.?keep.?up|drowning/.test(l)) return `Burnout is real — especially in this industry. You're not weak for feeling it.\n\nQuick resets that actually work:\n• Step outside for 5 min between jobs. No phone.\n• Eat actual food, not gas station garbage (occasionally).\n• Say "I need a minute" — that's a complete sentence.\n• One thing at a time. The board will still be there.\n\nIf it's deeper than a bad week:\n📞 SAMHSA Helpline: 1-800-662-4357 (free, 24/7)\n📱 Crisis Text Line: Text HOME to 741741\n988 Suicide & Crisis Lifeline: call or text 988\n\nTalk to someone. Seriously.`;

    if (/stress|stressed|anxious|anxiety|worried|panic|freak/.test(l)) return `Stress hits different in the field. Attics in summer, crawlspaces in winter, angry customers, and a board that never stops.\n\nThings that help right now:\n• Box breathing: 4 counts in, 4 hold, 4 out, 4 hold. Repeat 4x.\n• Name 5 things you can see. Sounds dumb, works great.\n• If a customer is escalating, take a step back: "Let me check on something and I'll be right back."\n• Drive to your next job with the radio OFF for 5 minutes.\n\nStress is normal. Constant stress is not. If it's been weeks, not days — talk to someone.`;

    if (/depress|sad|down|feeling.?low|hopeless|empty|numb|don't.?care/.test(l)) return `Hey — I hear you. That takes guts to say, even to a chatbot.\n\nYou don't have to figure this out alone:\n📞 988 Suicide & Crisis Lifeline: call or text 988 (24/7)\n📱 Crisis Text Line: Text HOME to 741741\n🏥 SAMHSA: 1-800-662-4357\n\nIf you're not ready for a call, that's ok. But tell ONE person today — a friend, family member, or even Sara. Nobody on this team wants you suffering in silence.\n\nYou matter more than any job on that board.`;

    if (/suicide|kill.?my|end.?it|don't.?want.?to.?be.?here|want.?to.?die|self.?harm|hurt.?my/.test(l)) return `I need you to hear this: your life matters.\n\nPlease reach out right now:\n📞 988 Suicide & Crisis Lifeline: call or text 988\n📱 Crisis Text Line: Text HOME to 741741\n🚨 Emergency: 911\n\nThese are free, confidential, and available 24/7. You don't have to be "sure" to call — if you're thinking about it, that's enough reason.\n\nYou are not a burden. You are not replaceable. Please talk to someone.`;

    if (/therapy|therapist|counselor|counseling|mental.?health.?help|talk.?to.?someone/.test(l)) return `Finding a therapist doesn't mean something is "wrong" — it means you're handling your business.\n\nWhere to start:\n🔍 Psychology Today finder: psychologytoday.com/us/therapists (filter by insurance, issue, location)\n📱 BetterHelp / Talkspace: Online, flexible scheduling, good for busy people\n🏥 Open Path Collective: $30-$80/session if cost is an issue\n💼 Check if DRH's insurance covers EAP (Employee Assistance Program) — usually 3-6 free sessions\n\nFirst session is just talking. No commitment. Try it like you'd try a new restaurant.`;

    if (/sleep|insomnia|can't.?sleep|tired|exhausted|fatigue/.test(l)) return `Bad sleep wrecks everything — mood, focus, driving safety.\n\nField-tested sleep tips:\n• Same wake time every day (even weekends). This matters more than bedtime.\n• No screens 30 min before bed. Yeah, I know. Do it anyway.\n• Keep the room cold (65-68°F).\n• If you're replaying the day in your head: write a 3-item to-do list for tomorrow. Brain dump → brain off.\n• Caffeine has a 6-hour half-life. That 2pm energy drink is still in your system at 8pm.\n\nIf it's been more than 2 weeks of bad sleep, see a doctor. Sleep apnea is common and treatable.`;

    if (/anger|angry|pissed|mad|frustrat|rage|temper|snap/.test(l)) return `Anger on the job is normal. Customers lie, parts don't show up, panels won't program, and the schedule is always packed.\n\nBefore you react:\n• Walk away for 60 seconds. Not optional.\n• If it's a customer: "I want to make sure I get this right — let me step out and check something."\n• Splash cold water on your wrists. Sounds weird, resets your nervous system.\n• Vent to a coworker AFTER, not to the customer DURING.\n\nIf you're snapping at people you care about at home — that's the job leaking into your life. Time to talk to someone about it.`;

    if (/lonely|alone|no.?friends|isolat|disconnect/.test(l)) return `Field work can be isolating — you're in the truck alone all day, at job sites alone, then too tired to be social.\n\nSmall moves that help:\n• Text a coworker something dumb during lunch. Connection doesn't have to be deep.\n• Say yes to ONE thing this week — even if you don't feel like it.\n• Call someone on the drive between jobs instead of just listening to music.\n\nIf it's been a while since you felt connected to anyone:\n📱 Crisis Text Line: Text HELLO to 741741\n📞 SAMHSA: 1-800-662-4357\n\nYou're part of a team here. Nobody's keeping score on how many times you reach out.`;

    if (/drink|alcohol|beer|sober|addiction|substance|drug|weed|smoke/.test(l)) return `No judgment here. A lot of people in trades self-medicate — long days, physical pain, stress.\n\nIf you're wondering whether it's a problem, it probably is. That awareness is actually a good sign.\n\n📞 SAMHSA Helpline: 1-800-662-4357 (free, confidential, 24/7)\n🏥 AA Meetings: aa.org/find-aa (tons of meetings, including online)\n📱 I Am Sober app: Free daily tracker\n💊 SMART Recovery: smartrecovery.org (science-based alternative to AA)\n\nYou don't have to quit everything today. Just make one call. Or tell one person. Start there.`;

    if (/meditat|mindful|breathing|calm|relax|decompress|wind.?down|chill/.test(l)) return `Quick decompression techniques that actually work in the field:\n\n🫁 Box Breathing: 4 in, 4 hold, 4 out, 4 hold. Do 4 rounds. Used by Navy SEALs.\n🧊 Cold water on wrists or face — activates dive reflex, slows heart rate.\n5-4-3-2-1: Name 5 things you see, 4 you hear, 3 you feel, 2 you smell, 1 you taste.\n📱 Apps: Headspace, Calm, or Insight Timer (free tier is solid).\n🎵 Keep one playlist that's specifically for decompressing — not hype music.\n\nEnd of day: 10 minutes doing nothing before you walk in the door at home. Sit in the truck. Transition from work-you to home-you.`;

    if (/mental.?health|wellness|self.?care|take.?care|check.?in|how.?are.?you/.test(l)) return `Real talk: this industry is hard on people. Long hours, physical work, isolation, pressure.\n\nMental health basics:\n✅ Sleep (7+ hours — non-negotiable for safety)\n✅ Eat real food (not just Monster and gas station burritos)\n✅ Move your body outside of work\n✅ Talk to people who aren't customers\n✅ Take your days off. Actually off.\n\nResources:\n📞 988 Lifeline: call/text 988\n📱 Crisis Text: HOME to 741741\n🏥 SAMHSA: 1-800-662-4357\n🔍 Therapist finder: psychologytoday.com\n\nChecking in on yourself isn't soft. It's maintenance — same as you'd do for any system you want to keep running.`;

    // App — TIME / HOURS (the one Sara asked about)
    if (/time|hours|clock|how long|time.?in|time.?out|track/.test(l)) return "Time tracking is on the job completion screen. When you tap 'I'm Done' on a job, you enter your Arrived and Left times. The system calculates hours and rounds up for billing. To edit time after the fact, open the job → check the assignment details.";
    // App — ESTIMATE / PIPELINE (the other one Sara asked about)
    if (/estimat|pipeline|quote|proposal|bid/.test(l)) return "Pipeline = total dollar value of all open estimates. Office → Billing tab → 'Estimates' queue shows jobs needing quotes, 'Pending' shows ones sent and waiting on the customer. Mark 'Won' when approved, 'Lost' when declined. Pipeline value on the Dashboard is the sum of everything pending.";
    // App — ADD CUSTOMER
    if (/add.*(customer|client)|new.*(customer|client)|create.*(customer|client)/.test(l)) return "Office → Customers tab → green '+ Add' button top right. Fill in name, address, phone, email, gate code, panel password, CMS account ID, notes. Hit Save.";
    // App — BILLING (more specific)
    if (/to.?bill|needs?.bill|ready.?to.?bill|bill.?queue/.test(l)) return "Office → Billing tab → 'To Bill' queue. These are completed jobs ready for invoicing. ⚠️ means missing completion notes — can't bill without knowing what was done. Open the job to add notes first.";
    if (/billed|mark.?billed|invoice/.test(l)) return "Open the completed job → tap 'Billed'. Make sure completion notes are filled in first or Sara will hunt you down. 😤";
    if (/won|lost/.test(l)) return "Open the estimate job → 'Won' if approved, 'Lost' if declined. Won jobs move to scheduling.";
    // App — SCHEDULING
    if (/schedul|book|appointment/.test(l)) return "Open the job → tap 'Schedule'. Pick the tech and date/time. Creates a Google Calendar event automatically. To reschedule, edit it in Google Calendar directly.";
    // App — NOTES
    if (/add.?note|note|completion.?note/.test(l)) return "Open any job → scroll to notes → type → tap +. Notes are timestamped with your name. Completion notes are critical — Sara can't bill without them. When completing a job, add what you did, materials used, and anything the customer needs to know.";
    // App — CUSTOMER
    if (/customer|find|search|lookup/.test(l)) return "Office → Customers tab. Search by name, phone, address, or CMS account ID. Tap any customer for full history, notes, gate codes, panel passwords, past jobs. Green '+ Add' button to create new.";
    // App — COMPLETE
    if (/complete|done|finish|close.?out|disposition/.test(l)) return "Open the job → disposition: 'All Fixed' (→ billing), 'Return Needed' (→ schedule return), 'Sales Opportunity' (→ estimate), 'No Charge' (→ close out). Each one routes the job to the right next step.";
    // App — NEW JOB
    if (/new.?job|new.?task|create.?job|create.?task|add.?job|add.?task/.test(l)) return "Green + button, bottom left on any screen. Fill in customer, issue, job type (service/install/estimate), priority. Save → lands in Unassigned.";
    // App — ASSIGN
    if (/assign|dispatch|send.?to/.test(l)) return "Office → Board → Unassigned lane. Each card has quick-assign buttons — tap the tech name and it assigns + auto-schedules for tomorrow 9am. For a specific date/time, open the job first and use Schedule.";
    // App — BOARD
    if (/board|kanban|lane/.test(l)) return "Office → Board tab. Jobs organized by tech: Unassigned → Austin → JR → Shana → Trevor. Tap lane tabs to switch. Unassigned has quick-assign buttons. Blocked/Waiting section at the bottom.";
    // App — CALENDAR
    if (/calendar|today|tomorrow|week|day.?view/.test(l)) return "Calendar tab = full Google Calendar. Week/Day toggle. Filter by person with colored chips. Tap any event → opens in Google Calendar. Search bar finds events + jobs across everything.";
    // App — DASHBOARD
    if (/dashboard|stats|overview|numbers/.test(l)) return "Dashboard tab: total open jobs, needs action, scheduled, to-bill, pipeline value (total $ of open estimates), waiting on parts, returns pending. JR's quick health check.";
    // App — SEARCH
    if (/search|find.?job|look.?up|where.?is/.test(l)) return "Calendar tab search bar. Searches all Google Calendars (90-day range) and all Supabase jobs (customer name, issue, job number). Results show calendar events and job cards.";
    // App — ORPHANS
    if (/orphan|not.?in.?system|yellow|untracked/.test(l)) return "Yellow 'NOT IN SYSTEM' = Google Calendar events without a JUC-E task. Tap to adopt (creates a task) or ignore.";
    // App — BLOCKED
    if (/blocked|waiting|stuck|pending/.test(l)) return "Bottom of Board tab, grouped by reason: Parts, Customer Decision, Materials, Return Pending. Tap any to open and update.";
    // App — STATUS FLOW
    if (/status|flow|lifecycle|how.?does/.test(l)) return "New → Needs Details → Ready to Schedule → Scheduled → Complete → To Bill → Billed. Branches: Needs Parts, Pending Decision, Pending Materials, Return Pending, Needs Estimate, Estimate Sent, Won/Lost.";
    // App — BUG
    if (/bug|broken|error|crash|not.?working|glitch/.test(l)) return "Logged it. Sara will see it. 🐛";
    // App — HELP
    if (/help$|what.?can|how.?do.?i.?use/.test(l)) return `What do you need, ${name}?\n\n🔍 /search [name] — find customers & jobs\n📞 /log [customer] — log a call or text\n📖 /guide — step-by-step walkthroughs\n📋 /share — copy message for Sara/Shana\n⚡ /trivia — security quiz\n📊 /facts — team fun facts\n\nOr just ask about the app, security, business, or wellness.`;
    // Greetings
    if (/^(hey|hi|hello|sup|what's up|yo|morning|afternoon)[\s!?.]*$/i.test(l)) return `What do you need, ${name}?`;
    // Thanks
    if (/thanks|thank you|thx|ty|appreciate/.test(l)) return "Yep. 🛡️";
    // Fallback
    return `Not sure about that. Try:\n\n🔍 /search [name] — find customers & jobs\n📞 /log [customer] — log a call\n📖 /guide — walkthroughs\n⚡ /trivia — security quiz\n\nOr ask about the app, security, business, or wellness.`;
  };

  // ============================================
  // RENDER
  // ============================================
  if (!isOpen) {
    return (
      <button onClick={() => setIsOpen(true)} style={{
        position: 'fixed', bottom: '80px', right: '16px', zIndex: 99,
        width: '48px', height: '48px', borderRadius: '50%',
        background: '#00c8e8', border: 'none', cursor: 'pointer',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: '22px', boxShadow: '0 4px 15px rgba(0,200,232,0.3)'
      }}>💬</button>
    );
  }

  return (
    <div style={{
      position: 'fixed', bottom: '70px', right: '8px', left: '8px',
      maxWidth: '400px', maxHeight: '65vh',
      background: '#1e293b', borderRadius: '16px',
      border: '1px solid #334155', zIndex: 200,
      display: 'flex', flexDirection: 'column',
      boxShadow: '0 8px 30px rgba(0,0,0,0.5)'
    }}>
      {/* Header */}
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        padding: '12px 16px', borderBottom: '1px solid #334155'
      }}>
        <span style={{ color: '#00c8e8', fontWeight: '600', fontSize: '14px' }}>
          🛡️ JUC-E · {userName}
          {mode === 'quiz' && ' · Getting to Know You'}
          {mode === 'trivia' && ` · Trivia ${triviaScore.correct}/${triviaScore.total}`}
        </span>
        <button onClick={() => setIsOpen(false)} style={{ background: 'none', border: 'none', color: '#cbd5e1', fontSize: '18px', cursor: 'pointer' }}>×</button>
      </div>

      {/* Messages */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '12px', display: 'flex', flexDirection: 'column', gap: '8px', minHeight: '200px' }}>
        {messages.map((msg, i) => (
          <div key={i} style={{
            alignSelf: msg.role === 'user' ? 'flex-end' : 'flex-start',
            background: msg.role === 'user' ? '#00c8e8' : '#0f1729',
            color: msg.role === 'user' ? '#000' : '#e2e8f0',
            padding: '8px 12px', borderRadius: '12px',
            maxWidth: '85%', fontSize: '13px', lineHeight: '1.5',
            whiteSpace: 'pre-wrap'
          }}>
            {msg.content}
          </div>
        ))}
        {isLoading && <div style={{ alignSelf: 'flex-start', color: '#cbd5e1', fontSize: '13px', padding: '8px' }}>...</div>}
        <div ref={messagesEndRef} />
      </div>

      {/* Trivia quick-tap buttons */}
      {mode === 'trivia' && !triviaAnswered && triviaQ && (() => {
        const lastMsg = messages[messages.length - 1];
        const options = lastMsg?._options || triviaQ.opts;
        return (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px', padding: '0 12px 8px' }}>
            {['A', 'B', 'C', 'D'].map((letter, i) => (
              <button key={letter} onClick={() => {
                handleTriviaAnswer(options[i] || letter);
              }}
                style={{
                  background: '#0f3460', color: '#00c8e8', border: '1px solid #334155',
                  borderRadius: '8px', padding: '10px', fontSize: '13px', fontWeight: '600',
                  cursor: 'pointer', textAlign: 'left'
                }}>{letter}) {(options[i] || '').slice(0, 40)}{(options[i] || '').length > 40 ? '...' : ''}</button>
            ))}
          </div>
        );
      })()}

      {/* Input */}
      <div style={{ display: 'flex', gap: '8px', padding: '12px', borderTop: '1px solid #334155' }}>
        <input
          value={input} onChange={e => setInput(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && sendMessage()}
          placeholder={mode === 'quiz' ? "Your answer..." : mode === 'trivia' ? "A, B, C, or D..." : mode === 'pickjob' ? "Type a number..." : mode === 'log' ? "Paste the message..." : "/search, /log, /trivia, /guide..."}
          style={{
            flex: 1, background: '#0f1729', border: '1px solid #334155', borderRadius: '10px',
            color: '#e2e8f0', padding: '10px 12px', fontSize: '14px', outline: 'none'
          }}
        />
        <button data-helpbot-send onClick={sendMessage} disabled={!input.trim() || isLoading} style={{
          background: input.trim() ? '#00c8e8' : '#334155',
          color: input.trim() ? '#000' : '#64748b',
          border: 'none', borderRadius: '10px', padding: '10px 14px',
          fontSize: '14px', fontWeight: '600', cursor: input.trim() ? 'pointer' : 'default'
        }}>→</button>
      </div>
    </div>
  );
}
