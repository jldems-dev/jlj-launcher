"use strict";

const net = require("node:net");
const { domainToASCII } = require("node:url");

const MAX_DOMAIN_LENGTH = 253;
const MAX_RULES = 5000;
const ACTIONS = new Set(["allow", "block"]);

function normalizeDomain(input) {
  if (typeof input !== "string") throw new TypeError("Domain must be text");
  let value = input.trim();
  if (!value || value.length > 1024) throw new Error("Enter a valid domain name");
  if (/[\u0000-\u0020\u007f]/.test(value)) throw new Error("Domain cannot contain spaces or control characters");
  if (/[\/:?#*\\@]/.test(value)) throw new Error("Enter a domain only; URLs, ports, paths, and wildcards are not accepted");

  if (value.endsWith(".")) value = value.slice(0, -1);
  if (!value || value.endsWith(".")) throw new Error("Domain has an empty label");
  const ascii = domainToASCII(value).toLowerCase();
  if (!ascii || ascii.length > MAX_DOMAIN_LENGTH || net.isIP(ascii)) {
    throw new Error("Domain is invalid or exceeds DNS limits");
  }

  const labels = ascii.split(".");
  if (labels.length < 2 || labels.some((label) =>
    label.length < 1 || label.length > 63 ||
    !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label)
  )) {
    throw new Error("Domain contains an invalid DNS label");
  }
  return ascii;
}

function normalizeRule(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new TypeError("Rule must be an object");
  const allowed = new Set(["id", "domain", "action", "enabled", "includeSubdomains"]);
  if (Object.keys(input).some((key) => !allowed.has(key))) throw new Error("Rule contains unsupported fields");
  if (!ACTIONS.has(input.action)) throw new Error("Rule action must be allow or block");
  if (input.enabled !== undefined && typeof input.enabled !== "boolean") throw new Error("Rule enabled must be true or false");
  if (input.includeSubdomains !== undefined && typeof input.includeSubdomains !== "boolean") throw new Error("Subdomain option must be true or false");
  if (input.id !== undefined && (!Number.isSafeInteger(input.id) || input.id < 1)) throw new Error("Rule ID is invalid");
  return {
    ...(input.id === undefined ? {} : { id: input.id }),
    domain: normalizeDomain(input.domain),
    action: input.action,
    enabled: input.enabled !== false,
    includeSubdomains: input.includeSubdomains === true,
  };
}

function findDuplicateRules(rules) {
  const seen = new Map();
  const duplicates = [];
  rules.forEach((rule, index) => {
    const domain = normalizeDomain(rule.domain);
    if (seen.has(domain)) duplicates.push({ domain, firstIndex: seen.get(domain), duplicateIndex: index });
    else seen.set(domain, index);
  });
  return duplicates;
}

function matchesRule(domain, rule) {
  const host = normalizeDomain(domain);
  const candidate = normalizeRule(rule);
  if (!candidate.enabled) return false;
  if (host === candidate.domain) return true;
  return candidate.includeSubdomains && host.endsWith(`.${candidate.domain}`);
}

function evaluateDomain(domain, rules, defaultAction = "deny") {
  if (!Array.isArray(rules) || rules.length > MAX_RULES) throw new Error("Rule set is invalid or too large");
  if (!new Set(["allow", "deny"]).has(defaultAction)) throw new Error("Default action must be allow or deny");
  const host = normalizeDomain(domain);
  const matches = rules
    .map((rule) => normalizeRule(rule))
    .filter((rule) => rule.enabled && (host === rule.domain || (rule.includeSubdomains && host.endsWith(`.${rule.domain}`))))
    .sort((a, b) => b.domain.split(".").length - a.domain.split(".").length || Number(b.action === "block") - Number(a.action === "block"));
  const winner = matches[0];
  return {
    action: winner ? winner.action : defaultAction,
    matchedDomain: winner?.domain || null,
    source: winner ? "rule" : "default",
  };
}

module.exports = { ACTIONS, MAX_RULES, normalizeDomain, normalizeRule, findDuplicateRules, matchesRule, evaluateDomain };
