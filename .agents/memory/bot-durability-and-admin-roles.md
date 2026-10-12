---
name: Bot durability and admin roles
description: Product expectations for persisted bot state, licensed uptime, and WhatsApp administrator protections.
---

The user requires durable account, WhatsApp session, group security, and warning state to live in Firebase so Railway restarts or disk loss do not erase it. Railway is the runtime; active licensed accounts should reconnect and remain available 24/7 while their licenses are active. Group security settings must synchronize between the user's bot groups. A person who is currently a WhatsApp group admin must be exempt from anti-warning enforcement and manual warnings; this protection ends when they are demoted or removed.

Only the configured owner account should list all app-user profiles and live statuses, create license keys, or change other users' license access. Keep the Firebase web configuration public if needed, but enforce admin access with verified identity and Firestore rules rather than a client-side email check alone.

**Why:** the user asked.

**How to apply:** Keep long-lived state Firebase-backed, await critical writes before reporting success, enforce owner access on admin APIs and Firestore reads/writes, and base group-admin exemptions on current participant roles. Do not claim that code alone guarantees Railway uptime or Firebase durability when platform configuration is unverified.
