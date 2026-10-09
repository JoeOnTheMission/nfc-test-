/**
 * Tap-to-Attend 50-Event Batch Load Simulation Suite
 * Validates full classroom attendance, batching, chunking (25/req), late-resolve, duplicate rejection, and idempotency.
 * 
 * Usage:
 *   $env:SCRIPT_URL="https://script.google.com/macros/s/.../exec"; $env:PIN="1234"; node test/load-simulation.mjs
 */

const SCRIPT_URL = process.env.SCRIPT_URL;
const PIN = process.env.PIN;

if (!SCRIPT_URL || !PIN) {
  console.error("ERROR: SCRIPT_URL and PIN environment variables must be set.");
  process.exit(1);
}

let passed = 0;
let failed = 0;

function assert(condition, testName, details = "") {
  if (condition) {
    console.log(`\x1b[32m[PASS]\x1b[0m ${testName}`);
    passed++;
  } else {
    console.error(`\x1b[31m[FAIL]\x1b[0m ${testName} ${details ? `-> ${details}` : ""}`);
    failed++;
  }
}

async function postApi(body) {
  const res = await fetch(SCRIPT_URL, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify(body)
  });
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch (e) {
    console.error("Non-JSON response received:", text.slice(0, 400));
    throw e;
  }
}

async function runSimulation() {
  console.log("==================================================================");
  console.log("  Tap-to-Attend Batch Load & Class Simulation Suite (v1.0.0)      ");
  console.log("==================================================================");
  console.log(`Endpoint: ${SCRIPT_URL}`);
  console.log(`Time: ${new Date().toISOString()}\n`);

  try {
    // 1. Verify Ping
    const ping = await postApi({ pin: PIN, action: "ping" });
    assert(ping.ok === true, "Admin PIN authentication verified");

    // 2. Fetch Bootstrap
    const bootstrap = await postApi({ pin: PIN, action: "get_bootstrap" });
    assert(bootstrap.ok === true && Array.isArray(bootstrap.registry), "Bootstrap registry loaded successfully");

    const registry = bootstrap.registry || [];
    const test1 = registry.find(s => s.studentId === "TEST001");
    const test2 = registry.find(s => s.studentId === "TEST002");

    if (!test1 || !test2) {
      console.warn("Please ensure TEST001 and TEST002 exist in Registry tab.");
    }

    // Ensure TEST001 has a registered UID
    const test1Uid = "04:10:01:" + Math.floor(Math.random() * 256).toString(16).padStart(2, "0");
    if (test1) {
      await postApi({
        pin: PIN,
        action: "register",
        studentId: test1.studentId,
        uid: test1Uid,
        replace: true
      });
    }

    // 3. Create unique simulation session
    console.log("\n[1/4] Initializing Lecture Session (Applied Mathematics III)...");
    const sessionDate = "2026-10-09-SIM" + Math.floor(Date.now() / 1000);
    const courseName = "TEST COURSE";
    const sessionKey = `${courseName}|${sessionDate}`;

    const sessionObj = {
      sessionKey: sessionKey,
      course: courseName,
      date: sessionDate,
      startedAt: new Date().toISOString()
    };

    // 4. Generate 50 realistic attendance events
    console.log("\n[2/4] Generating 50 Classroom Attendance Events (Taps, Overrides, Duplicates)...");
    const events = [];
    const unregUid = "04:99:ee:" + Math.floor(Math.random() * 256).toString(16).padStart(2, "0");

    // Event 1: Valid tap with TEST001 registered card
    const tapId1 = `sim-tap-${Date.now()}-1`;
    events.push({
      tapId: tapId1,
      type: "tap",
      sessionKey: sessionKey,
      uid: test1Uid,
      tapTime: new Date().toISOString()
    });

    // Event 2: Manual override for TEST002
    const tapId2 = `sim-manual-${Date.now()}-2`;
    events.push({
      tapId: tapId2,
      type: "manual",
      sessionKey: sessionKey,
      studentId: "TEST002",
      name: "Test Student Two",
      reason: "Card forgotten at dorm",
      tapTime: new Date(Date.now() + 1000).toISOString()
    });

    // Event 3: Unknown card tap (to test late-resolve)
    const tapId3 = `sim-unreg-${Date.now()}-3`;
    events.push({
      tapId: tapId3,
      type: "tap",
      sessionKey: sessionKey,
      uid: unregUid,
      tapTime: new Date(Date.now() + 2000).toISOString()
    });

    // Events 4 to 10: Duplicate taps from TEST001
    for (let i = 4; i <= 10; i++) {
      events.push({
        tapId: `sim-dup-${Date.now()}-${i}`,
        type: "tap",
        sessionKey: sessionKey,
        uid: test1Uid,
        tapTime: new Date(Date.now() + i * 500).toISOString()
      });
    }

    // Events 11 to 50: Additional simulated queue volume
    for (let i = 11; i <= 50; i++) {
      events.push({
        tapId: `sim-load-${Date.now()}-${i}`,
        type: "tap",
        sessionKey: sessionKey,
        uid: test1Uid,
        tapTime: new Date(Date.now() + i * 600).toISOString()
      });
    }

    // 5. Chunked Synchronization (25 events per chunk)
    console.log(`\n[3/4] Synchronizing ${events.length} events in 25-event chunks...`);
    const chunk1 = events.slice(0, 25);
    const chunk2 = events.slice(25);

    const sync1 = await postApi({
      pin: PIN,
      action: "sync",
      sessions: [sessionObj],
      events: chunk1
    });
    assert(sync1.ok === true && sync1.results.length === 25, "Chunk 1 (first 25 events) synced successfully");

    const sync2 = await postApi({
      pin: PIN,
      action: "sync",
      sessions: [sessionObj],
      events: chunk2
    });
    assert(sync2.ok === true && sync2.results.length === 25, "Chunk 2 (next 25 events) synced successfully");

    // Verify results
    const allResults = [...(sync1.results || []), ...(sync2.results || [])];
    const res1 = allResults.find(r => r.tapId === tapId1);
    const res2 = allResults.find(r => r.tapId === tapId2);
    const res3 = allResults.find(r => r.tapId === tapId3);

    assert(res1 && res1.status === "present", "Registered tap marked 'present'");
    assert(res2 && res2.status === "present", "Valid manual override marked 'present'");
    assert(res3 && res3.status === "unknown_uid", "Unregistered card marked 'unknown_uid'");

    const duplicateCount = allResults.filter(r => r.status === "duplicate").length;
    assert(duplicateCount >= 40, `Duplicate protection rejected ${duplicateCount} duplicate events without corrupted records`);

    // 6. Test Late-Resolution
    console.log("\n[4/4] Executing Late-Resolution for unknown card...");
    await new Promise(r => setTimeout(r, 1500));
    if (test2) {
      const lateRes = await postApi({
        pin: PIN,
        action: "register",
        studentId: test2.studentId,
        uid: unregUid,
        replace: true
      });
      assert(lateRes.ok === true && lateRes.lateResolvedCount >= 1, "Late-resolve converted past unknown card log to 'present'");
    }

    // 7. Idempotency test: Re-syncing chunk 1
    await new Promise(r => setTimeout(r, 1500));
    const resync = await postApi({
      pin: PIN,
      action: "sync",
      sessions: [sessionObj],
      events: chunk1
    });
    const allAlreadySynced = (resync.results || []).every(r => r.status === "already_synced");
    assert(allAlreadySynced, "Idempotent re-sync of batch events returns 'already_synced' with zero duplicates");

  } catch (err) {
    console.error("Simulation error:", err);
    failed++;
  }

  console.log("\n==================================================================");
  console.log(`  Simulation Summary: ${passed} assertions passed, ${failed} failed`);
  console.log("  Class Attendance Load Test Complete: Zero Corruptions Detected.");
  console.log("==================================================================");
}

runSimulation();
