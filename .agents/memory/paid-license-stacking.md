---
name: Paid license stacking policy
description: Product rule for unused time when a customer redeems another paid license key.
---

When a customer redeems a paid license key, preserve and add any existing unused license time. For example, three days remaining plus a one-day key gives four days total.

**Why:** The user explicitly chose preserving the existing balance rather than replacing it.

**How to apply:** Calculate the new expiry from the current remaining time plus the newly redeemed key's duration. Do not discard an unused balance unless the user changes this policy.
