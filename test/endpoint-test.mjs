/**
 * Tap-to-Attend Backend Integration Test Suite
 * Requires Node.js 18+ (native fetch support)
 * 
 * Usage:
 *   $env:SCRIPT_URL="https://script.google.com/macros/s/.../exec"; $env:PIN="1234"; node test/endpoint-test.mjs
 */

const SCRIPT_URL = process.env.SCRIPT_URL;
const PIN = process.env.PIN;

if (!SCRIPT_URL || !PIN) {
  console.error("ERROR: SCRIPT_URL and PIN environment variables must be set.");
  console.error('Example: SCRIPT_URL="https://script.google.com/macros/s/.../exec" PIN="1234" node test/endpoint-test.mjs');
  process.exit(1);
}

let passed = 0;
let failed = 0;

async function postApi(body) {
  const res = await fetch(SCRIPT_URL, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify(body)
  });
  return await res.json();
}

function assert(condition, testName, details = "") {
  if (condition) {
    console.log(`\x1b[32m[PASS]\x1b[0m ${testName}`);
    passed++;
  } else {
    console.error(`\x1b[31m[FAIL]\x1b[0m ${testName} ${details ? `-> ${details}` : ""}`);
    failed++;
  }
}

async function runTests() {
  console.log("==================================================");
  console.log("  Tap-to-Attend Backend Integration Test Suite   ");
  console.log("==================================================");
  console.log(`Endpoint: ${SCRIPT_URL}`);
  console.log(`Testing with PIN: ${PIN.replace(/./g, "*")}\n`);

  try {
    // 1. Bad PIN test
    const badPinRes = await postApi({ pin: "WRONG_PIN_9999", action: "ping" });
    assert(badPinRes.ok === false && badPinRes.error === "bad_pin", "Reject request with bad PIN");

    // 2. Ping test
    const pingRes = await postApi({ pin: PIN, action: "ping" });
    assert(pingRes.ok === true && typeof pingRes.serverTime === "string", "Validate correct PIN via ping", JSON.stringify(pingRes));

    // 3. Get Bootstrap test
    const bootstrapRes = await postApi({ pin: PIN, action: "get_bootstrap" });
    assert(
      bootstrapRes.ok === true && Array.isArray(bootstrapRes.courses) && Array.isArray(bootstrapRes.registry),
      "Retrieve bootstrap data (courses and registry)",
      JSON.stringify(bootstrapRes)
    );

    // Verify sample dummy students exist for test
    const registry = bootstrapRes.registry || [];
    const test1 = registry.find(s => s.studentId === "TEST001");
    const test2 = registry.find(s => s.studentId === "TEST002");

    if (!test1 || !test2) {
      console.warn("\x1b[33m[WARN]\x1b[0m Dummy students TEST001 and TEST002 were not found in the Registry tab.");
      console.warn("Please add rows to Registry: [TEST001, Test Student One, '', ''] and [TEST002, Test Student Two, '', '']");
    }

    // 4. Registration Refusals & Success
    const unknownReg = await postApi({ pin: PIN, action: "register", studentId: "NON_EXISTENT_999", uid: "04:a1:b2:c3" });
    assert(unknownReg.ok === false && unknownReg.error === "unknown_student", "Refuse registration for unknown student ID");

    if (test1) {
      const regSuccess = await postApi({ pin: PIN, action: "register", studentId: "TEST001", uid: "04:a1:b2:c3" });
      assert(regSuccess.ok === true, "Register TEST001 with UID 04:a1:b2:c3", JSON.stringify(regSuccess));

      const takenReg = await postApi({ pin: PIN, action: "register", studentId: "TEST002", uid: "04:a1:b2:c3" });
      assert(takenReg.ok === false && takenReg.error === "uid_taken", "Refuse registration with already taken UID", JSON.stringify(takenReg));

      const alreadyReg = await postApi({ pin: PIN, action: "register", studentId: "TEST001", uid: "04:99:88:77", replace: false });
      assert(alreadyReg.ok === false && alreadyReg.error === "student_already_registered", "Refuse re-registration without replace:true", JSON.stringify(alreadyReg));
    }

    // 5. Session Sync & Attendance Logic
    const sessionKey = "TEST COURSE|2026-10-09";
    const tapId1 = "tap-test-uuid-" + Date.now() + "-1";
    const tapId2 = "tap-test-uuid-" + Date.now() + "-2";
    const tapId3 = "tap-test-uuid-" + Date.now() + "-3";
    const tapId4 = "tap-test-uuid-" + Date.now() + "-4";
    const tapId5 = "tap-test-uuid-" + Date.now() + "-5";

    const syncPayload = {
      pin: PIN,
      action: "sync",
      sessions: [
        {
          sessionKey: sessionKey,
          course: "TEST COURSE",
          date: "2026-10-09",
          startedAt: new Date().toISOString()
        }
      ],
      events: [
        // Event 1: Valid registered tap
        {
          tapId: tapId1,
          type: "tap",
          sessionKey: sessionKey,
          uid: "04:a1:b2:c3",
          tapTime: new Date().toISOString()
        },
        // Event 2: Unknown card tap
        {
          tapId: tapId3,
          type: "tap",
          sessionKey: sessionKey,
          uid: "04:ff:ee:dd",
          tapTime: new Date(Date.now() + 1000).toISOString()
        },
        // Event 3: Invalid manual event (missing reason)
        {
          tapId: tapId4,
          type: "manual",
          sessionKey: sessionKey,
          studentId: "TEST002",
          reason: "",
          tapTime: new Date(Date.now() + 2000).toISOString()
        },
        // Event 4: Valid manual override
        {
          tapId: tapId5,
          type: "manual",
          sessionKey: sessionKey,
          studentId: "TEST002",
          reason: "Forgot card at dorm",
          tapTime: new Date(Date.now() + 3000).toISOString()
        }
      ]
    };

    const syncRes = await postApi(syncPayload);
    assert(syncRes.ok === true && Array.isArray(syncRes.results), "Sync session and batch events", JSON.stringify(syncRes));

    if (syncRes.results) {
      const res1 = syncRes.results.find(r => r.tapId === tapId1);
      assert(res1 && res1.status === "present", "Registered card marked 'present'", JSON.stringify(res1));

      const res3 = syncRes.results.find(r => r.tapId === tapId3);
      assert(res3 && res3.status === "unknown_uid", "Unregistered card marked 'unknown_uid'", JSON.stringify(res3));

      const res4 = syncRes.results.find(r => r.tapId === tapId4);
      assert(res4 && res4.status === "invalid_student", "Manual override without reason rejected as 'invalid_student'", JSON.stringify(res4));

      const res5 = syncRes.results.find(r => r.tapId === tapId5);
      assert(res5 && res5.status === "present", "Valid manual override marked 'present'", JSON.stringify(res5));
    }

    // 6. Idempotency test (re-sending tapId1)
    const idempotentSync = await postApi({
      pin: PIN,
      action: "sync",
      sessions: [{ sessionKey, course: "TEST COURSE", date: "2026-10-09", startedAt: new Date().toISOString() }],
      events: [
        {
          tapId: tapId1,
          type: "tap",
          sessionKey: sessionKey,
          uid: "04:a1:b2:c3",
          tapTime: new Date().toISOString()
        }
      ]
    });
    const idempResult = (idempotentSync.results || []).find(r => r.tapId === tapId1);
    assert(idempResult && idempResult.status === "already_synced", "Idempotent sync: identical tapId returns 'already_synced'", JSON.stringify(idempResult));

    // 7. Duplicate tap test (new tapId, same student in same session)
    const duplicateSync = await postApi({
      pin: PIN,
      action: "sync",
      sessions: [{ sessionKey, course: "TEST COURSE", date: "2026-10-09", startedAt: new Date().toISOString() }],
      events: [
        {
          tapId: tapId2,
          type: "tap",
          sessionKey: sessionKey,
          uid: "04:a1:b2:c3",
          tapTime: new Date().toISOString()
        }
      ]
    });
    const dupResult = (duplicateSync.results || []).find(r => r.tapId === tapId2);
    assert(dupResult && dupResult.status === "duplicate", "Duplicate tap in same session marked 'duplicate'", JSON.stringify(dupResult));

    // 8. Late-resolution test: register TEST002 with previously unknown UID 04:ff:ee:dd
    const lateResolveReg = await postApi({
      pin: PIN,
      action: "register",
      studentId: "TEST002",
      uid: "04:ff:ee:dd",
      replace: true
    });
    assert(
      lateResolveReg.ok === true && lateResolveReg.lateResolvedCount >= 1,
      "Late-resolve: registering UID converts past unknown_uid log to 'present'",
      JSON.stringify(lateResolveReg)
    );

  } catch (err) {
    console.error("Test execution encountered an error:", err);
    failed++;
  }

  console.log("\n==================================================");
  console.log(`Results: ${passed} passed, ${failed} failed`);
  console.log("==================================================");

  process.exit(failed > 0 ? 1 : 0);
}

runTests();
