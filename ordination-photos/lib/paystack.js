const BASE = 'https://api.paystack.co';

function secret() {
  return process.env.PAYSTACK_SECRET_KEY || '';
}
// No secret key configured -> demo mode (simulated payments)
function isDemo() {
  return !secret();
}

async function ps(pathname, opts = {}) {
  const res = await fetch(BASE + pathname, {
    ...opts,
    headers: {
      Authorization: `Bearer ${secret()}`,
      'Content-Type': 'application/json',
      ...(opts.headers || {}),
    },
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.status === false) {
    throw new Error(json.message || `Paystack error (HTTP ${res.status})`);
  }
  return json.data;
}

// Creates a Paystack checkout and returns { authorization_url, ... }
function initTransaction({ email, amountKobo, reference, callbackUrl }) {
  return ps('/transaction/initialize', {
    method: 'POST',
    body: JSON.stringify({ email, amount: amountKobo, reference, callback_url: callbackUrl }),
  });
}

function verifyTransaction(reference) {
  return ps('/transaction/verify/' + encodeURIComponent(reference));
}

module.exports = { isDemo, initTransaction, verifyTransaction, secret };
