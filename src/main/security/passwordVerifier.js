"use strict";

const crypto = require("node:crypto");
const { promisify } = require("node:util");

const scrypt = promisify(crypto.scrypt);
const KEY_LENGTH = 64;
const SCRYPT_OPTIONS = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const FORMAT = "scrypt";

function safeEqual(left, right) {
  const a = Buffer.isBuffer(left) ? left : Buffer.from(String(left));
  const b = Buffer.isBuffer(right) ? right : Buffer.from(String(right));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

async function hashPassword(password) {
  if (typeof password !== "string" || password.length < 1 || Buffer.byteLength(password, "utf8") > 1024) {
    throw new Error("Password must contain between 1 and 1024 UTF-8 bytes");
  }
  const salt = crypto.randomBytes(16);
  const digest = await scrypt(password, salt, KEY_LENGTH, SCRYPT_OPTIONS);
  return [FORMAT, SCRYPT_OPTIONS.N, SCRYPT_OPTIONS.r, SCRYPT_OPTIONS.p, salt.toString("hex"), digest.toString("hex")].join("$");
}

function isPasswordHash(value) {
  return typeof value === "string" && value.startsWith(`${FORMAT}$`);
}

async function verifyPassword(stored, candidate) {
  if (typeof stored !== "string" || typeof candidate !== "string" || Buffer.byteLength(candidate, "utf8") > 1024) return false;
  if (!isPasswordHash(stored)) return safeEqual(stored, candidate);
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== FORMAT) return false;
  const [, n, r, p, saltHex, digestHex] = parts;
  if (![n, r, p].every((part) => /^\d+$/.test(part)) || !/^[a-f0-9]{32}$/i.test(saltHex) || !/^[a-f0-9]{128}$/i.test(digestHex)) return false;
  const cost = { N: Number(n), r: Number(r), p: Number(p), maxmem: 64 * 1024 * 1024 };
  if (cost.N !== SCRYPT_OPTIONS.N || cost.r !== SCRYPT_OPTIONS.r || cost.p !== SCRYPT_OPTIONS.p) return false;
  const actual = await scrypt(candidate, Buffer.from(saltHex, "hex"), KEY_LENGTH, cost);
  return safeEqual(actual, Buffer.from(digestHex, "hex"));
}

module.exports = { hashPassword, verifyPassword, isPasswordHash };
