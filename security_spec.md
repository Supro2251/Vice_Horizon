# Vice Horizon Security Specification (Phase 0 TDD)

## 1. Data Invariants
1. All player saves live under `/users/{userId}` and subcollections (`characters`, `inventory`, `settings`, `missions`). Only the authenticated, email-verified owner (`request.auth.uid == userId`) can read, create, update, or delete their own save documents.
2. `uid` / `ownerId` inside any document must strictly match `request.auth.uid` and remain immutable after creation.
3. Subcollections (`characters`, `inventory`, `settings`, `missions`) enforce the Master Gate: parent `/users/{userId}` must exist (or be created atomically in the same batch via `existsAfter`) and belong to `request.auth.uid`.
4. All strings have explicit `.size()` bounds; all numeric stats (`cash`, `health`, `armor`, etc.) are bounded within sane gameplay limits; all arrays (`weapons`, `consumables`, `contraband`, `customOutfits`) are strictly bounded in size (`<= 24` items) and type-checked.
5. `createdAt` and `updatedAt` timestamps must match `request.time`.

## 2. Dirty Dozen Adversarial Payloads (Must Return PERMISSION_DENIED)
1. Unauthenticated read/write to `/users/userA`.
2. Authenticated userB attempting `get` or `update` on `/users/userA`.
3. Identity spoofing: userA creating `/users/userA/inventory/loadout` with `ownerId: "userB"`.
4. Shadow field injection: userA creating `/users/userA` with an extra `isAdmin: true` or `role: "superuser"` field.
5. Unverified email account attempting write (`email_verified == false`).
6. Path ID poisoning: creating `/users/userA/missions/invalid$id!` or a 200-char ID.
7. Oversized string DoS: `displayName` exceeding 80 characters.
8. Unbounded array DoS: `customOutfits` array with 100 entries.
9. Client timestamp forgery: `updatedAt` set to a past/future hardcoded timestamp instead of `request.time`.
10. Immutable field mutation: attempting to change `uid` or `createdAt` during an `update` on `/users/userA`.
11. Invalid enum injection: setting `activeCharacterId` to `"hacker"` instead of `["lucia", "mateo", "kairo"]`.
12. Negative/NaN or absurd cash poisoning: setting `cash` to `-500` or `999999999999`.
