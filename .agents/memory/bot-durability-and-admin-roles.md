---
name: Bot durability and admin roles
description: Product expectations for persisted bot state, licensed uptime, and WhatsApp administrator protections.
---

The user requires durable account, WhatsApp session, group security, and warning state to live in Firebase so Railway restarts or disk loss do not erase it. Railway is the runtime; active licensed accounts should reconnect and remain available 24/7 while their licenses are active. Group security settings must synchronize between the user's bot groups. A person who is currently a WhatsApp group admin must be exempt from anti-warning enforcement and manual warnings; this protection ends when they are demoted or removed.

**Why:** the user asked.

**How to apply:** Keep long-lived state Firebase-backed, await critical writes before reporting success, and base admin exemptions on current group participant roles. Do not claim that code alone guarantees Railway uptime or Firebase durability when platform configuration is unverified.
