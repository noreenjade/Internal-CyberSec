// Same id shape as uid() in cyberops-task-tracker.html: "h-<epoch>-<counter>-<random>".
// Doesn't need to be cryptographically unique — just unique enough within
// this process, same guarantee the frontend's version provides.
let counter = 0;
function uid() {
  counter += 1;
  return "h-" + Date.now() + "-" + counter + "-" + Math.random().toString(36).slice(2, 6);
}

// Matches "@Full Name" mentions in comment text against a roster of
// {id, name} users, case-insensitively. Longest names are checked first so
// e.g. "Jade Lozano" can't shadow a match on "Noreen Jade Lozano". A mention
// must end at a word boundary (not immediately followed by another word
// character) so "@Noreen Jade Lozanoski" doesn't falsely match "Noreen Jade
// Lozano".
function extractMentions(text, users) {
  if (!text || !users || !users.length) return [];
  const sorted = users.slice().sort((a, b) => b.name.length - a.name.length);
  const seen = new Set();
  const mentioned = [];
  sorted.forEach((u) => {
    if (!u.name || seen.has(u.id)) return;
    const escapedName = u.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const pattern = new RegExp("(^|[^\\w@])@" + escapedName + "(?!\\w)", "i");
    if (pattern.test(text)) {
      seen.add(u.id);
      mentioned.push(u.id);
    }
  });
  return mentioned;
}

// Express 4 (unlike 5) doesn't catch a rejected Promise thrown by an async
// route handler — an unawaited rejection there just hangs the request
// instead of reaching server.js's error-handling middleware. Wrapping every
// async handler in this (since db.js's move to pg made every db.* call
// async) forwards any thrown/rejected error to next(err) the same way a
// synchronous throw always has.
function asyncRoute(fn) {
  return function (req, res, next) {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

module.exports = { uid, extractMentions, asyncRoute };
