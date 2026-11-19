---
name: aether
description: Browse the web in the person's own Aether browser. Use for any task that needs a real browser — search, compare listings or products, fill forms, check prices or stock, book, or act on sites where the person is already signed in.
---

# Aether

Aether is the person's desktop browser. You drive it with the `aether` command; the person watches each Space work live and approves anything that spends money or cannot be undone.

When to use: the task needs a website — search results, listings, product pages, forms, bookings, or anything behind a login the person already has in Aether.

How to work:

1. Run `aether skill` once and follow what it prints: the working method and the `space` TypeScript SDK.
2. Send one script per step: `aether exec --space "<task name>" --thought "<one line for the person>"` with the script on stdin or `--file <script.ts>`.
3. A held run exits 2 and prints a token; collect the result with `aether wait <token>`.
4. End with `aether done --space "<task name>" --success yes|no --result "<summary>"`.

Never try to approve a purchase or irreversible step for the person — it happens in Aether.
