# AI Designer Brief: SplitFriends Mobile Product Design

## 1. What product this is

We are building a mobile-first product for shared expenses inside small real-life groups:

- friends at dinner or barbecue;
- family trips;
- kids and parents;
- office or event collections;
- any case where one person pays for themselves and sometimes for someone else.

This is **not** a generic banking app and **not** a landing page.
It is an operational product where users:

- create a collection;
- add participants, guests, and children;
- add expenses and itemized receipt positions;
- calculate who owes what;
- review, dispute, confirm, and pay;
- manage manual payments and auto-pay rules.

The core value of the product is:

**make shared money flows feel clear, calm, premium, and easy to trust.**

## 2. What is wrong with the current UI

The current UI is functional, but it is not a strong product design.

Main problems:

- too close to a dev prototype;
- weak visual hierarchy;
- too much “form stacked under form” feeling;
- not enough premium mobile product character;
- organizer workflows feel dense but not intentionally designed;
- important states do not feel different enough;
- money information is not presented with enough clarity or confidence.

The next design should feel like a real consumer fintech/productivity app, not an internal demo.

## 3. Visual direction we want

Use the attached reference image as the **style direction**, not as something to copy literally.

What we want from that reference:

- dark premium mobile UI;
- deep violet / purple primary brand direction;
- high contrast on dark surfaces;
- compact but elegant spacing;
- strong cards and panels;
- obvious primary money numbers;
- clean iconography;
- polished “consumer fintech” feel.

What we **do not** want:

- a clone of a wallet/bank app;
- decorative fake charts everywhere;
- marketing-style layout;
- overly playful visuals;
- big empty hero sections;
- weak contrast;
- card overload with no information structure.

## 4. Product design principles

The design must feel:

- **trustworthy**: money flows should look accurate and calm;
- **fast**: users should understand the next action immediately;
- **dense but readable**: compact, but never cramped;
- **mobile-native**: designed for one-hand usage and narrow screens first;
- **stateful**: draft, review, dispute, unpaid, partially paid, paid, blocked should feel meaningfully different;
- **role-aware**: organizer and participant experiences must feel different.

## 5. Target audience

Primary users:

- 20–40 years old;
- active in friend groups, couples, families, trips, coworker events;
- comfortable with fintech apps;
- want less awkwardness around shared money.

They are not accountants.
They need confidence and speed, not bookkeeping complexity.

## 6. Platform and scope

Design for:

- mobile app first;
- iPhone-like viewport first;
- Android should still work, but visual target is premium mobile dark UI.

Initial scope:

- **dark theme first**
- optional light theme later, but not required in this phase.

## 7. Brand / tone

Brand feeling:

- premium;
- sharp;
- modern;
- slightly bold;
- not corporate boring;
- not neon-gaming;
- not cute.

Tone:

- direct;
- clear;
- expensive-feeling;
- useful.

## 8. Information architecture to design

Main mobile product surfaces:

1. Home
2. Collections list
3. Collection detail for participant
4. Organizer workspace for a collection
5. Payment screen
6. Dispute / review correction flow
7. Inbox / notifications
8. Profile and payment settings

## 9. Screens that must be designed

### 9.1 Home

Purpose:

- show what needs attention now;
- show active collections;
- show organizer-owned collections;
- show recent notifications.

Must include:

- greeting / user identity;
- “Need to pay” section;
- “I organize” section;
- short inbox preview;
- clear CTA to create new collection.

### 9.2 Collections list

Purpose:

- manage many collections without confusion.

Must include:

- segmented filters:
  - active
  - history
  - organizing
- meaningful collection cards;
- clear status and amount summary;
- quick scan for what needs action.

### 9.3 Participant collection screen

Purpose:

- explain how much the user owes and why.

Must include:

- main due amount;
- collection type/state;
- explanation of the calculation;
- participant list with responsibility visibility;
- progress of collection payment state;
- actions:
  - pay
  - confirm review
  - open dispute

This screen must feel very clear and low-friction.

### 9.4 Organizer workspace

This is one of the most important screens.

Purpose:

- give the organizer a powerful but clean operations dashboard.

Must include:

- collection headline and state;
- total collected / remaining;
- attention block:
  - disputes
  - manual payments awaiting review
  - review confirmations
- participant management;
- guest/child/responsible-payer controls;
- participant profile controls:
  - relationship type
  - weight
  - presets
- expenses and itemized receipt editing;
- transfer plan;
- manual payments queue;
- auto-pay preview;
- main actions:
  - calculate
  - send to review
  - run autopay

This screen should feel like a premium operations cockpit, not a raw admin form.

### 9.5 Payment screen

Purpose:

- make payment feel simple and trustworthy.

Must include:

- due amount;
- selected payment method;
- primary pay action;
- manual payment option;
- proof / comment flow;
- clear feedback after payment.

### 9.6 Review / dispute screen

Purpose:

- make disagreements feel structured, not chaotic.

Must include:

- predefined dispute reasons;
- optional comment;
- a clear submit action;
- confidence that organizer will see it.

### 9.7 Inbox / notifications

Purpose:

- central place for actions and updates.

Must include:

- meaningful notification cards;
- category/type distinction;
- timestamps;
- clear routing into the relevant screen.

### 9.8 Profile / payment settings

Purpose:

- manage personal identity and payment behavior.

Must include:

- saved payment methods;
- payment method statuses;
- auto-pay settings;
- trusted payment preferences;
- frequent people / shared relationships.

## 10. Important domain concepts the design must reflect

These concepts are central to the product and should be visible in the UI model:

- collection;
- participant;
- guest;
- child;
- responsible payer;
- participant weight;
- itemized receipt item;
- share rule;
- calculation version;
- review confirmation;
- dispute;
- manual payment proof;
- auto-pay rule;
- notification.

The design should help users understand these without exposing backend jargon.

## 11. Design requirements for participant model

Participant cards should support:

- who the participant is;
- whether they are adult / guest / child;
- whether they pay for themselves or are covered by someone else;
- relationship preset;
- weight;
- quick edit actions.

The participant area should visually reveal **coverage groups**:

- standalone payers;
- payers responsible for children or guests;
- total burden/weight carried by each responsible payer.

## 12. Design requirements for money presentation

Money should always be visually strong.

Rules:

- primary amount should be large and immediately legible;
- secondary amounts should be quieter but still easy to compare;
- negative / due / danger states must be distinct;
- collected vs remaining must be obvious;
- review / paid / disputed / blocked states must never look the same.

## 13. Design requirements for itemized receipts

The product supports item-level split logic.

The design must support:

- expense card;
- nested receipt positions;
- item-level rules such as:
  - excluded
  - weighted
  - fixed amount
  - percent
- quick organizer editing.

This area should feel powerful but still understandable.

## 14. Interaction style

Use:

- segmented controls for tabs and filters;
- chips for compact state switching;
- dense cards for collections and notifications;
- bottom navigation;
- clear fixed CTA areas;
- inline edit controls where needed;
- collapsible detail only where it really reduces clutter.

Avoid:

- giant modal-heavy flow for everything;
- too many full-screen forms;
- hidden critical information behind multiple taps.

## 15. Component direction

Core components to design:

- collection card;
- notification card;
- participant card;
- expense card;
- receipt item row;
- split rule pill / editor row;
- progress indicator;
- money summary card;
- payment method card;
- dispute card;
- auto-pay summary card;
- bottom nav;
- top compact app bar;
- segmented tabs;
- primary and secondary buttons.

## 16. Color direction

Base direction:

- dark charcoal / near-black surfaces;
- deep purple / violet primary brand;
- restrained supporting accent colors;
- warm red only for risk or due states;
- controlled green for success states.

Avoid:

- rainbow palette;
- washed gray-on-gray UI;
- candy gradients;
- overly blue corporate palette.

## 17. Typography direction

Typography should feel:

- compact;
- sharp;
- premium;
- strong on monetary values;
- readable in dense mobile layouts.

Use clear size contrast between:

- headline money;
- section titles;
- card titles;
- helper text.

## 18. Layout direction

Layout should be:

- narrow-screen first;
- card-based but not decorative;
- information-dense in a controlled way;
- consistent in spacing rhythm;
- comfortable for repeated daily use.

Organizer screen especially should feel like:

- one long, structured mobile workspace;
- strong blocks;
- clear action zones;
- no chaotic stacking of unrelated inputs.

## 19. What “good” looks like

A good result should make someone say:

- “I instantly understand what I owe.”
- “I instantly understand who needs my attention.”
- “This feels like a premium money app.”
- “This looks trustworthy enough to actually use with friends.”
- “The organizer flow looks powerful, but not scary.”

## 20. What the AI designer should deliver

Please produce:

1. A mobile design system direction for this product
2. Dark-theme key screens
3. At least these screens in polished form:
   - Home
   - Collections list
   - Participant collection
   - Organizer workspace
   - Payment
   - Dispute flow
   - Inbox
   - Profile / payment settings
4. Component logic for:
   - participant cards
   - expense cards
   - receipt item rows
   - collection cards
   - notification cards
5. A clear visual state system for:
   - draft
   - review
   - dispute
   - unpaid
   - partially paid
   - paid
   - blocked

## 21. Anti-goals

Do not produce:

- a marketing site;
- a generic wallet clone;
- a crypto-dashboard look;
- a neon gaming UI;
- a flat unopinionated SaaS admin;
- a design with poor mobile ergonomics;
- a concept that ignores organizer complexity.

## 22. Ready-to-use prompt for the AI designer

Use this as the direct prompt:

> Design a premium mobile-first dark-theme product UI for a shared-expense app called SplitFriends. The product is not a bank and not a landing page. It helps friends, families, and small groups create collections, add participants/guests/children, assign who pays for whom, add itemized receipt expenses, calculate debts, review, dispute, confirm, and pay. Use a visual direction inspired by modern dark fintech apps with deep violet accents, high contrast, elegant compact spacing, strong money hierarchy, and polished consumer-grade mobile design. Prioritize usability and trust. Design these screens: Home, Collections List, Participant Collection, Organizer Workspace, Payment, Dispute Flow, Inbox, Profile/Payment Settings. The organizer workspace must handle participants, responsible payers, children, weights, receipt items, share rules, disputes, manual payments, and autopay without looking like an admin prototype. The result should feel premium, useful, fast, and trustworthy.

## 23. Extra note for the designer

This product will be used in awkward real-life money situations.
The design should reduce friction, embarrassment, and confusion.
It should make shared payments feel socially lighter and operationally clearer.
