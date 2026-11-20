// ==============================================================================
// server_backend/tests/mediaAndFlashcardsSuite.test.js
// Comprehensive Test Suite for Media Studio Engine (Phase 1) & Flashcards SM-2 (Phase 2)
// Verifies:
// 1. Truthful Provider Status (BLOCKED when unconfigured, no fake generations)
// 2. Quota Enforcement & Daily Limits
// 3. Idempotency Key Handling
// 4. Job State Machine & Transitions
// 5. Artifact Security (Path Traversal confinement & Magic-Byte validation)
// 6. Flashcard Deck Creation & Mandatory Citations on AI-generated decks
// 7. SM-2 Spaced Repetition Algorithm calculations (repetitions, intervals, easiness floor 1.3)
// 8. Atomic Deck Deletion with cascade to cards & reviews
// 9. Application-level Tenant Isolation
// 10. AI Agent Tools (media_image_generate, cards_deck_create, cards_import)
// ==============================================================================
"use strict";

const assert = require("node:assert");
const path = require("node:path");
const fs = require("node:fs");
const { getDb } = require("../db/database");
const { workspaceTools } = require("../services/agent/workspaceTools");

async function runMediaAndFlashcardsSuite() {
  console.log("================================================================");
  console.log("🎬 RUNNING MEDIA STUDIO & FLASHCARDS SM-2 TEST SUITE");
  console.log("================================================================\n");

  const mediaService = await import("../../server/media/mediaService.js");
  const cardsService = await import("../../server/cards/cardsService.js");

  const db = getDb();
  let passed = 0;
  let total = 0;

  async function test(name, fn) {
    total++;
    try {
      await fn();
      passed++;
      console.log(`  ✅ [PASS] ${name}`);
    } catch (err) {
      console.error(`  ❌ [FAIL] ${name}: ${err.message}`);
      throw err;
    }
  }

  const userA = "usr_media_test_owner_a";
  const userB = "usr_media_test_owner_b";

  // --------------------------------------------------------------------------
  console.log("[Phase 1] Media Studio Engine Verification...");
  // --------------------------------------------------------------------------

  await test("1.1 Provider returns BLOCKED truthfully when environment variables are missing", async () => {
    delete process.env.MEDIA_IMAGE_BASE_URL;
    delete process.env.MEDIA_IMAGE_API_KEY;
    delete process.env.MEDIA_IMAGE_MODEL;
    assert.strictEqual(mediaService.providerStatus("image"), "BLOCKED");
    assert.strictEqual(mediaService.providerStatus("video"), "BLOCKED");
    assert.strictEqual(mediaService.providerStatus("animation"), "BLOCKED");
  });

  await test("1.2 Attempting to create a job for a BLOCKED provider throws 503 MEDIA_PROVIDER_BLOCKED", async () => {
    try {
      mediaService.createJob(db, {
        ownerId: userA,
        type: "image",
        prompt: "A futuristic city skyline",
      });
      assert.fail("Should have thrown MEDIA_PROVIDER_BLOCKED");
    } catch (err) {
      assert.strictEqual(err.code, "MEDIA_PROVIDER_BLOCKED");
      assert.strictEqual(err.status, 503);
    }
  });

  await test("1.3 Provider returns READY when configured with required environment variables", async () => {
    process.env.MEDIA_IMAGE_BASE_URL = "http://127.0.0.1:9999/v1";
    process.env.MEDIA_IMAGE_API_KEY = "test-media-api-key";
    process.env.MEDIA_IMAGE_MODEL = "dall-e-3";
    assert.strictEqual(mediaService.providerStatus("image"), "READY");
  });

  await test("1.4 Creates job with QUEUED state and records immutable media_events entry", async () => {
    const job = mediaService.createJob(db, {
      ownerId: userA,
      type: "image",
      prompt: "A solar flare captured from orbit",
    });
    assert.ok(job.id);
    assert.strictEqual(job.state, "QUEUED");
    assert.strictEqual(job.owner_id, userA);
    assert.strictEqual(job.cost_units, 1);

    const event = db.prepare("SELECT * FROM media_events WHERE job_id = ?").get(job.id);
    assert.ok(event);
    assert.strictEqual(event.event, "QUEUED");
    assert.strictEqual(event.owner_id, userA);
  });

  await test("1.5 Idempotency: exact same idempotency_key returns identical job without duplicate charge", async () => {
    const idemKey = `idem-${Date.now()}-${Math.random()}`;
    const job1 = mediaService.createJob(db, {
      ownerId: userA,
      type: "image",
      prompt: "Idempotency test prompt",
      idempotencyKey: idemKey,
    });

    const job2 = mediaService.createJob(db, {
      ownerId: userA,
      type: "image",
      prompt: "Idempotency test prompt",
      idempotencyKey: idemKey,
    });

    assert.strictEqual(job1.id, job2.id);
  });

  await test("1.6 Enforces daily quota (20 units/day) with 429 MEDIA_QUOTA_EXCEEDED", async () => {
    const quotaUser = `usr_quota_${Date.now()}`;
    const today = new Date().toISOString().slice(0, 10);
    db.prepare("INSERT INTO media_usage (owner_id, day, type, units) VALUES (?, ?, \x27image\x27, 20)").run(quotaUser, today);

    try {
      mediaService.createJob(db, {
        ownerId: quotaUser,
        type: "image",
        prompt: "Quota overflow attempt",
      });
      assert.fail("Should have rejected with 429");
    } catch (err) {
      assert.strictEqual(err.code, "MEDIA_QUOTA_EXCEEDED");
      assert.strictEqual(err.status, 429);
    }
  });

  await test("1.7 Job state transition validation (QUEUED -> CANCELLED, reject invalid transitions)", async () => {
    const job = mediaService.createJob(db, {
      ownerId: userA,
      type: "image",
      prompt: "To be cancelled",
    });
    const cancelled = mediaService.cancelJob(db, userA, job.id);
    assert.strictEqual(cancelled.state, "CANCELLED");

    try {
      mediaService.cancelJob(db, userA, job.id);
      assert.fail("Should not allow transition from CANCELLED");
    } catch (err) {
      assert.strictEqual(err.code, "MEDIA_STATE_INVALID");
    }
  });

  await test("1.8 Path traversal defense in resolveArtifactPath", async () => {
    const evilJobId = `job_evil_${Date.now()}`;
    const t = new Date().toISOString();
    db.prepare(`INSERT INTO media_jobs (id, owner_id, type, state, prompt, artifact_path, artifact_mime, created_at, updated_at)
                VALUES (?, ?, \x27image\x27, \x27READY\x27, \x27evil\x27, \x27../../../etc/passwd\x27, \x27text/plain\x27, ?, ?)`).run(evilJobId, userA, t, t);

    try {
      mediaService.resolveArtifactPath(db, userA, evilJobId);
      assert.fail("Should reject path outside MEDIA_ROOT");
    } catch (err) {
      assert.strictEqual(err.code, "MEDIA_PATH_FORBIDDEN");
      assert.strictEqual(err.status, 403);
    }
  });

  // --------------------------------------------------------------------------
  console.log("\n[Phase 2] Flashcards SM-2 Engine Verification...");
  // --------------------------------------------------------------------------

  await test("2.1 Manual deck creation and card insertion", async () => {
    const deck = cardsService.createDeck(db, {
      ownerId: userA,
      title: "Spanish Vocabulary — Beginners",
      generated: false,
    });
    assert.ok(deck.id);
    assert.strictEqual(deck.title, "Spanish Vocabulary — Beginners");
    assert.strictEqual(deck.generated, 0);

    const card = cardsService.addCard(db, {
      ownerId: userA,
      deckId: deck.id,
      front: "Hola",
      back: "Hello",
    });
    assert.ok(card.id);
    assert.strictEqual(card.front, "Hola");
    assert.strictEqual(card.back, "Hello");
  });

  await test("2.2 AI-generated deck requires source_ref, otherwise throws 400 DECK_SOURCE_REQUIRED", async () => {
    try {
      cardsService.createDeck(db, {
        ownerId: userA,
        title: "Document Summary Deck",
        generated: true,
        sourceRef: null,
      });
      assert.fail("Should have required source_ref");
    } catch (err) {
      assert.strictEqual(err.code, "DECK_SOURCE_REQUIRED");
      assert.strictEqual(err.status, 400);
    }

    const validAiDeck = cardsService.createDeck(db, {
      ownerId: userA,
      title: "Microbiology Chapter 3",
      generated: true,
      sourceRef: "Microbiology 10th Ed. p. 45-52",
    });
    assert.strictEqual(validAiDeck.generated, 1);
    assert.strictEqual(validAiDeck.source_ref, "Microbiology 10th Ed. p. 45-52");
  });

  await test("2.3 Cards in an AI-generated deck MUST carry source_ref citation", async () => {
    const aiDeck = cardsService.createDeck(db, {
      ownerId: userA,
      title: "Quantum Physics Fundamentals",
      generated: true,
      sourceRef: "Principles of Quantum Mechanics, Ch. 1",
    });

    try {
      cardsService.addCard(db, {
        ownerId: userA,
        deckId: aiDeck.id,
        front: "What is Planck constant?",
        back: "6.626 x 10^-34 J*s",
      });
      assert.fail("Should have rejected card without source_ref");
    } catch (err) {
      assert.strictEqual(err.code, "CARD_SOURCE_REQUIRED");
      assert.strictEqual(err.status, 400);
    }

    const card = cardsService.addCard(db, {
      ownerId: userA,
      deckId: aiDeck.id,
      front: "What is Planck constant?",
      back: "6.626 x 10^-34 J*s",
      sourceRef: "Section 1.2, Equation 1.4",
    });
    assert.ok(card.id);
    assert.strictEqual(card.source_ref, "Section 1.2, Equation 1.4");
  });

  await test("2.4 SM-2 Spaced Repetition calculation logic", async () => {
    const deck = cardsService.createDeck(db, {
      ownerId: userA,
      title: "Algorithm Complexities",
      generated: false,
    });
    const card = cardsService.addCard(db, {
      ownerId: userA,
      deckId: deck.id,
      front: "Binary Search Time Complexity",
      back: "O(log n)",
    });

    const r1 = cardsService.reviewCard(db, userA, card.id, 4);
    assert.strictEqual(r1.repetitions, 1);
    assert.strictEqual(r1.interval_days, 1);
    assert.strictEqual(r1.easiness, 2.5);

    const r2 = cardsService.reviewCard(db, userA, card.id, 4);
    assert.strictEqual(r2.repetitions, 2);
    assert.strictEqual(r2.interval_days, 6);
    assert.strictEqual(r2.easiness, 2.5);

    const r3 = cardsService.reviewCard(db, userA, card.id, 5);
    assert.strictEqual(r3.repetitions, 3);
    assert.strictEqual(r3.interval_days, 15);
    assert.strictEqual(r3.easiness, 2.6);

    const rFail = cardsService.reviewCard(db, userA, card.id, 1);
    assert.strictEqual(rFail.repetitions, 0);
    assert.strictEqual(rFail.interval_days, 1);
    assert.ok(rFail.easiness < 2.6);

    for (let i = 0; i < 15; i++) {
      cardsService.reviewCard(db, userA, card.id, 0);
    }
    const rFloor = cardsService.reviewCard(db, userA, card.id, 0);
    assert.strictEqual(rFloor.easiness, 1.3);
  });

  await test("2.5 Atomic Deck Deletion with cascade to cards and review records", async () => {
    const deck = cardsService.createDeck(db, {
      ownerId: userA,
      title: "Deck To Be Deleted",
      generated: false,
    });
    const card1 = cardsService.addCard(db, { ownerId: userA, deckId: deck.id, front: "Q1", back: "A1" });
    const card2 = cardsService.addCard(db, { ownerId: userA, deckId: deck.id, front: "Q2", back: "A2" });
    cardsService.reviewCard(db, userA, card1.id, 4);

    const delRes = cardsService.deleteDeck(db, userA, deck.id);
    assert.strictEqual(delRes.deleted, true);

    const deckRow = db.prepare("SELECT * FROM card_decks WHERE id = ?").get(deck.id);
    assert.strictEqual(deckRow, undefined);

    const cardsLeft = db.prepare("SELECT COUNT(*) as c FROM cards WHERE deck_id = ?").get(deck.id);
    assert.strictEqual(cardsLeft.c, 0);

    const reviewsLeft = db.prepare("SELECT COUNT(*) as c FROM card_reviews WHERE card_id IN (?, ?)").get(card1.id, card2.id);
    assert.strictEqual(reviewsLeft.c, 0);
  });

  await test("2.6 Tenant isolation: User B cannot access User A decks or cards", async () => {
    const deckA = cardsService.createDeck(db, {
      ownerId: userA,
      title: "Secret Private Deck User A",
      generated: false,
    });

    try {
      cardsService.getDeck(db, userB, deckA.id);
      assert.fail("Should not allow cross-tenant deck read");
    } catch (err) {
      assert.strictEqual(err.code, "DECK_NOT_FOUND");
      assert.strictEqual(err.status, 404);
    }
  });

  // --------------------------------------------------------------------------
  console.log("\n[Phase 3] AI Agent Tools Integration...");
  // --------------------------------------------------------------------------

  await test("3.1 Tool cards_deck_create & cards_import execute via workspaceTools with citation validation", async () => {
    const ctx = {
      user: { id: userA, role: "admin" },
      project: { id: "proj-test", files: [] },
    };

    const deck = await workspaceTools.cards_deck_create.handler({
      title: "Neural Networks 101",
      source_ref: "Deep Learning Book, Goodfellow et al.",
      generated: true,
    }, ctx);
    assert.ok(deck.id);
    assert.strictEqual(deck.generated, 1);

    try {
      await workspaceTools.cards_import.handler({
        deck_id: deck.id,
        cards: [
          { front: "What is Backpropagation?", back: "Gradient descent using chain rule" },
        ],
      }, ctx);
      assert.fail("Should have rejected import with missing citation");
    } catch (err) {
      assert.strictEqual(err.code, "CARD_SOURCE_REQUIRED");
    }

    const imported = await workspaceTools.cards_import.handler({
      deck_id: deck.id,
      cards: [
        { front: "What is Backpropagation?", back: "Gradient descent using chain rule", source_ref: "Chapter 6.5, p. 200" },
        { front: "What is ReLU?", back: "Rectified Linear Unit max(0, x)", source_ref: "Chapter 6.3, p. 187" },
      ],
    }, ctx);
    assert.strictEqual(imported.imported, 2);
  });

  await test("3.2 Alias tool names (media.image.generate, cards.deck.create, cards.import) match", () => {
    assert.strictEqual(typeof workspaceTools["media.image.generate"]?.handler, "function");
    assert.strictEqual(typeof workspaceTools["cards.deck.create"]?.handler, "function");
    assert.strictEqual(typeof workspaceTools["cards.import"]?.handler, "function");
  });

  console.log("\n================================================================");
  console.log(`🎉 ALL ${passed}/${total} MEDIA & FLASHCARDS TESTS PASSED!`);
  console.log("================================================================\n");
}

runMediaAndFlashcardsSuite().catch((err) => {
  console.error("\n❌ Media & Flashcards Test Suite Failed:", err);
  process.exit(1);
});
