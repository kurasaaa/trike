# PANAW (Progressive Advanced Network for Automated Wayfinding) — Defense Notes

Everything below is meant to be read once, understood, and then said in your own
words. Memorized answers sound memorized.

---

## Part 1 — The three sentences

If you only get thirty seconds:

> Tricycle fares are already set by ordinance, but they are transacted verbally,
> so the passenger has to know the rate and be willing to argue for it.
> PANAW computes the fare on a server from the ordinance, locks it before
> departure, and shows the same locked number on both the passenger's and the
> driver's screen. Afterwards it issues a signed receipt that anyone can verify
> by scanning a QR code.

The claim is narrow on purpose. You are not claiming to end overcharging. You
are claiming to move the fare from a negotiation into a record.

---

## Part 2 — Why the design is the way it is

These are the four decisions a panel will probe. Know the reasoning, not just
the behaviour.

### 2.1 Why the server computes and not the app

An app that computes its own fare is a calculator with a logo. Anyone can
install a modified version, and more importantly the driver has no reason to
believe the number on a passenger's screen. Server computation means the fare
exists once, outside both parties, and both are shown the same copy of it.

Concretely: `POST /api/trips` **recomputes** the fare and discards anything the
client sent. If you want to demonstrate it, send a request claiming ₱1 — the
stored trip still holds the correct amount.

### 2.2 Why regular hire is charged per passenger

This is the change most worth being able to defend, because an earlier version
of the prototype got it wrong.

That version computed one fare for the trip and divided it among the passengers.
Four riders on a 2 km trip paid ₱3.75 each. The driver earned ₱15 whether the
sidecar was full or empty. That contradicts how tricycle ordinances actually
work and contradicts the economics of the vehicle: no driver would adopt a
system that erases the benefit of a full load.

So the model now distinguishes:

- **Regular hire** — the shared queue ride. Each passenger pays their own fare:
  ₱15 for the first 2 km plus ₱1 per succeeding km.
- **Special trip** — the passenger hires the whole unit: ₱25 for the first 2 km
  plus ₱2 per succeeding km, split by whoever rides.

The split-fare model survives only where it is actually true.

If a panelist says the Buenavista ordinance uses different figures, agree
immediately and point at `data/rules.json`. Say plainly that the current rates
follow the structure commonly published for tricycles in the Iloilo–Guimaras
area — ₱15 for the first 2 km plus ₱1 per succeeding km — and that verifying
them against the actual Sangguniang Bayan ordinance is the next step. The rates
are data, not code: changing them touches four numbers and no logic.

### 2.3 Why the night rate is not a switch

The prototype originally had a "Night Travel" toggle on the passenger screen.
That is indefensible in a system whose whole claim is that the fare cannot be
manipulated: a 15% surcharge that either party can switch on by hand is exactly
the abuse the project exists to prevent.

The night rate is now derived from the **server's** clock against the
ordinance's window. Neither app has a control for it.

For Buenavista the surcharge is switched **off** by default, because we are not
assuming an authorization that has not been verified. The useful consequence:
at 11 p.m. the app adds ₱0 and says so on screen. A system that declines to add
an unauthorized charge is making the same argument as one that adds an
authorized one.

### 2.4 Why confirmed-safe events are logged

A safety system that only records its alarms cannot report how often it was
wrong. Every time a passenger taps "I'm safe", the trip stores a
`safe_confirmed` event. Over a study period, `safe_confirmed ÷ (safe_confirmed +
alert_sent)` is your false-positive rate — a measurable result rather than an
assumption. Say this when the deviation feature comes up; it shows you designed
for evaluation, not just for demo.

---

## Part 3 — Anticipated questions

### On the problem

**Q. What problem does this actually solve? Fares are already posted at the terminal.**
Posted matrices are static and put the whole burden on the passenger: compute
your own distance, apply your own discount, then argue with the driver. The
argument is the failure point, and it falls hardest on people least able to
have it. This system removes the argument by producing the number before the
trip, on both screens, from the same source.

**Q. Isn't this just a fare calculator?**
A calculator produces an opinion. This produces a record: locked before
departure, visible to both parties, signed afterwards. The difference shows up
in the dispute, not in the arithmetic.

**Q. Who is this for — passengers, drivers, or the LGU?**
All three, differently. Passengers get certainty. Honest drivers get protection
from being accused. The LGU gets compliance data it currently has no way to
collect.

**Q. Why tricycles and not jeepneys or ride-hailing?**
Jeepney fares are simple and enforced by the conductor. Ride-hailing already
computes and locks, and does not operate here anyway. In Buenavista the
tricycle is the mode: it is what takes you from the poblacion to MacArthur
Wharf, to the campus, to the hospital. It is also the mode where the fare is
highest-variance, the regulation is thinnest, and the passenger is most alone
with the driver.

**Q. Why Buenavista specifically?**
It is where we are, which means the TODA, the terminal and the routes are
reachable for a field trial rather than hypothetical. The wharf route in
particular carries passengers arriving from Iloilo who do not know the local
rate — the exact condition under which overcharging is easiest.

### On the fare logic

**Q. Where did these rates come from?**
The rate structure — base fare covering the first two kilometres, then a
per-kilometre rate — follows the standard form of a Philippine tricycle fare
ordinance; the nearest documented comparable figures are Iloilo City's ₱15 for
the first 2 km plus ₱1 per succeeding kilometre. The specific numbers in the
build are provisional and labelled as such in the config file. **If you can get
the actual Buenavista ordinance before the defense, do — it is one visit to the
SB secretary's office and it removes this question entirely.**

**Q. And the destinations and distances?**
The destinations are real places in Buenavista, with coordinates taken from
mapping data — the GSU Salvador campus, the New Terminal Market, the Emergency
Hospital, MacArthur Wharf, Navalas Church, Roca Encantada, Lagdon Beach in
Getulio, and four barangay halls. The distances are great-circle distances from
the New Poblacion terminal with a road-curvature factor applied, so they are
estimates rather than measurements. If you have measured any of them with an
odometer, say which ones and say so plainly; if not, call them estimated.

**Q. Why does the discount apply to the passenger's own fare rather than the trip total?**
Because the statutory entitlement is personal. RA 9994 and RA 10754 discount
what the beneficiary pays, not what the group pays. If you took 20% off the
whole trip when one of four riders is a senior, the other three would receive a
discount they aren't entitled to, and the driver would absorb it.

**Q. Why round to ₱0.25?**
Because nobody carries centavos. Unrounded shares produce a receipt total that
doesn't equal the coins handed over — a real dispute trigger. The system rounds
each share, then makes the total the exact sum of the rounded shares, so the
two always agree.

**Q. What if the passenger lies about being a senior citizen?**
The system cannot verify an ID, and it doesn't pretend to. What it does is make
the claim explicit and recorded: the driver's screen shows *2 × senior*, so a
false claim is visible at the point of payment and attached to a trip record.
Verification is a physical act — showing the ID — and this system supports that
act rather than replacing it.

**Q. Can the driver just ignore the app and demand cash?**
Yes, and that is an honest limitation. What changes is the evidence available
afterwards. "He overcharged me" becomes a report with a reference number, a
locked amount, a driver ID and a timestamp. Enforcement still belongs to the
LGU and the TODA — the contribution here is to make enforcement possible, not
to perform it.

### On the technology

**Q. What does "locked" mean technically? Show me it can't be changed.**
The fare is stored on the server when the trip is created and there is no API
endpoint that modifies it — you can read `server.js` end to end and confirm
there is no route touching `fare`. The client's own copy is display only. A
tampered request is recomputed from inputs, so the worst a modified app can do
is send a false input, which shows on the driver's screen.

**Q. Why polling instead of WebSockets?**
Because the requirement is two devices agreeing within a couple of seconds, and
polling meets it in four lines with no reconnection logic. WebSockets would be
the right answer at thousands of concurrent trips. Choosing the smaller
mechanism is an engineering judgment, not an omission.

**Q. Why a JSON file instead of a database?**
Scope. The prototype handles tens of records and the datastore is isolated
behind `src/db.js`, so swapping in PostgreSQL means rewriting one file. Using a
database here would have added setup risk without changing a single result.

**Q. Why no framework?**
Zero dependencies means the demo runs on a laptop with no internet, which is a
real constraint in this room. It also means every line in the project is a line
we wrote and can explain.

**Q. Is the QR code real?**
Yes. It encodes the receipt URL plus a truncated HMAC-SHA256 signature over the
trip ID, total, and lock time. Scan it with any phone and the server re-derives
the signature and reports whether it matches. Change one character in the link
and the page shows a failed verification. *(Have a judge scan it. This
demonstration is more convincing than any answer you can give.)*

**Q. Is that signature actually secure?**
It is a real HMAC, but the key lives in the source for the prototype and the
digest is truncated to 12 characters for a printable code. A deployment would
hold the key server-side only and never expose it. What it defends against today
is a forged or edited receipt link, which is the realistic threat.

**Q. What happens with no internet?**
The fare engine is deterministic and needs only the rate table and a distance,
so a deployed app can compute offline. Locking, receipts, and alerts need
connectivity. This prototype falls back to local computation and labels itself
on screen when it does — it will not silently pretend a fare was locked.

### On safety

**Q. How do you detect a deviation without real GPS?**
The classification is real: the server measures the perpendicular distance from
the terminal-to-destination corridor and applies thresholds — under 0.35 km is
on-route, up to about 1 km is minor, beyond that is major. What is simulated is
the coordinate stream feeding it. Swapping in a real receiver changes the source
of two numbers, not the logic.

**Q. Why an 8-second countdown? Isn't that too short to react?**
It's tuned for a demo. In deployment it would be closer to 30 seconds, and the
right value is an empirical question — long enough to reach your phone, short
enough to matter. It's on the list of parameters the study should measure rather
than assume.

**Q. What if the passenger is forced to press "I'm safe"?**
Undetectable in this design, and I'd rather say so than claim otherwise. The
countdown is built so that the *safe* default is silence — doing nothing sends
the alert. A duress path, where a second confirmation appears to cancel but
actually alerts, is identified as future work.

**Q. Isn't sharing live location a privacy risk?**
Location goes only to contacts the passenger added themselves, only during an
active trip, and only on a major unconfirmed deviation or a manual trigger. It
is never continuously shared with the driver, the TODA, or other users. The
public receipt view deliberately strips contact phone numbers and device IDs.

### On scope and equity

**Q. What about passengers without smartphones?**
The most serious gap, and it hits the population the discount logic exists to
protect. Partial mitigation is in the build already: the driver's console shows
the same locked fare, so a walk-up passenger can be shown the screen and given
the trip ID. Full coverage needs a terminal kiosk or a dispatcher, which is
outside this prototype.

**Q. Would drivers actually adopt this?**
Untested, and it is the variable that decides whether the system works at all.
The design tries to earn adoption rather than assume it — per-passenger charging
keeps a full load worth carrying, the locked fare protects an honest driver from
accusation, and the receipt gives them a record too. But adoption is a field
question, and I'd frame it as the first thing to test, not something this
prototype has shown.

**Q. What would you measure to say this worked?**
Four things: reported overcharge incidents per 100 trips before and after; the
rate at which statutory discounts are actually granted; the share of trips where
the amount paid equals the locked amount; and the false-positive rate of
deviation alerts, which the `safe_confirmed` logging makes computable.

**Q. What's next if you continue this?**
In order: real driver authentication tied to the TODA roster, an SMS gateway for
alerts, replacing the JSON store with a real database, a duress path, and a
field trial with one TODA over a defined period. Live routing and a native app
come after that, because neither changes what the study is testing.

---

## Part 4 — Answers to have ready but not volunteer

**If asked what you'd change.** The distance table is the weakest input — it
assumes every trip follows the standard route, which fails for a passenger with
an intermediate stop. Handling multi-stop trips would be the first structural
change.

**If asked whether you built it yourself.** Be straightforward about what was
written, what was adapted, and what was vendored: the QR encoder is a
third-party MIT library credited in the source, deliberately chosen over a
hand-rolled one because a receipt code has to survive being scanned by a
stranger's phone. Everything else is project code.

**If something breaks live.** Say what broke, say what it would take to fix,
move on. A panel forgives a failed demo far more readily than a student who
talks over a frozen screen. The `data/db.json` file is human-readable — you can
open it and show the locked fare directly if the UI dies.

---

## Part 5 — The one-sentence answer to the hardest question

> *"So what stops the driver from just asking for more money anyway?"*

Nothing stops him. What changes is that he now has to do it in front of a number
both of you have already seen, and afterwards you hold a signed record of what
that number was. That is the difference between a disagreement and a complaint.
