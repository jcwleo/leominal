import crypto from 'node:crypto';

console.log(`LEOMINAL_SESSION_SECRET=${crypto.randomBytes(48).toString('base64url')}`);
