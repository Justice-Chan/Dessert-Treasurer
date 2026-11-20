// The desktop app signs its calls with SYNC_SECRET instead of a Google sign-in; its one call,
// syncLedger, lives in Ledger.js.

// Compares every character so the response time does not reveal how much of a guess was right.
function verifySyncSecret(secret) {
  const expected = property("SYNC_SECRET");
  const given = typeof secret === "string" ? secret : "";
  let difference = given.length ^ expected.length;
  for (let index = 0; index < expected.length; index += 1) {
    difference |= expected.charCodeAt(index) ^ (given.charCodeAt(index) || 0);
  }
  if (difference !== 0 || expected.length < 32) throw appError("unauthorized", "同步金鑰不正確。");
}
