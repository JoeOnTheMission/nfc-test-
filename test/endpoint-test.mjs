/**
 * Tap-to-Attend Backend Integration Test Runner
 * Requires Node.js 18+ (native fetch support)
 * Usage: SCRIPT_URL="https://script.google.com/..." PIN="your-pin" node test/endpoint-test.mjs
 */

const SCRIPT_URL = process.env.SCRIPT_URL;
const PIN = process.env.PIN;

async function run() {
  console.log("=== Tap-to-Attend Endpoint Test Runner ===");
  if (!SCRIPT_URL) {
    console.warn("[WARN] SCRIPT_URL environment variable is not set. Skipping live HTTP tests in Step 0.");
    console.log("[INFO] Ready for Step 2 full endpoint test suite.");
    return;
  }

  try {
    const res = await fetch(SCRIPT_URL);
    const data = await res.json();
    console.log("GET response:", data);
  } catch (err) {
    console.error("Connection failed:", err.message);
  }
}

run();
