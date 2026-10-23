import { readFileSync, readdirSync } from "node:fs";
import { sayAfterStartupLine } from "./startAnnounce";

type Probe = () => string | null;

let checked = false;
let cgroupProbeForTests: Probe | null = null;
let procfsProbeForTests: Probe | null = null;

/** Why the cgroup-backed readers cannot read, or null when a controller is visible. */
export function cgroupMissingCause(): string | null {
  if (cgroupProbeForTests) {
    try { return cgroupProbeForTests(); } catch { return "the cgroup probe failed"; }
  }
  const groups = [
    ["memory", [
      ["/sys/fs/cgroup/memory.current", "/sys/fs/cgroup/memory.max"],
      ["/sys/fs/cgroup/memory/memory.usage_in_bytes", "/sys/fs/cgroup/memory/memory.limit_in_bytes"],
    ]],
    ["CPU", [
      ["/sys/fs/cgroup/cpu.max", "/sys/fs/cgroup/cpu.stat"],
      ["/sys/fs/cgroup/cpu/cpu.cfs_quota_us", "/sys/fs/cgroup/cpu/cpu.stat"],
    ]],
  ] as const;
  const missing: string[] = [];
  for (const [name, pairs] of groups) {
    let readable = false;
    for (const pair of pairs) {
      try {
        readFileSync(pair[0], "utf8");
        readFileSync(pair[1], "utf8");
        readable = true;
        break;
      } catch {
        // Try the other cgroup version.
      }
    }
    if (!readable) missing.push(name);
  }
  if (!missing.length) return null;
  return `no readable cgroup ${missing.join(" or ")} controller is visible`;
}

/** Why descriptor headroom cannot be read, or null when both procfs files work. */
export function procfsMissingCause(): string | null {
  if (procfsProbeForTests) {
    try { return procfsProbeForTests(); } catch { return "the procfs probe failed"; }
  }
  try {
    readdirSync("/proc/self/fd");
    readFileSync("/proc/self/limits", "utf8");
    return null;
  } catch {
    return "/proc/self/fd or /proc/self/limits is unreadable";
  }
}

/** Pure sentence builder: probing deliberately stays in announceUnreadableSources. */
export function unreadableSourcesLine(
  cgroupCause: string | null,
  procfsCause: string | null,
): string | null {
  const parts: string[] = [];
  if (cgroupCause) {
    parts.push(
      `container memory pressure and CPU throttling (${cgroupCause}): container limits and throttling come from Linux cgroup controllers`,
    );
  }
  if (procfsCause) {
    parts.push(
      `descriptor headroom (${procfsCause}): open descriptors and their limit come from Linux procfs`,
    );
  }
  if (!parts.length) return null;
  const tail = `. ${parts.length === 1 ? "That one meter stays" : "Those meters stay"} absent for the life of this process; nothing else about Boosthis is affected.`;
  return parts.length === 1
    ? `[boosthis] This Node runtime cannot report ${parts[0]}${tail}`
    : `[boosthis] This Node runtime cannot report ${parts.length} of Boosthis's readings — ${parts.join("; ")}${tail}`;
}

/** Judge once per process, including the fully capable case. Never throws. */
export function announceUnreadableSources(): void {
  if (checked) return;
  checked = true;
  try {
    const line = unreadableSourcesLine(cgroupMissingCause(), procfsMissingCause());
    if (line) {
      try { sayAfterStartupLine(line); } catch { /* guest safety outranks notice */ }
    }
  } catch {
    // A diagnostic must never disturb its host.
  }
}

export function _setSourceNoticeProbesForTests(
  cgroup: Probe | null,
  procfs: Probe | null,
): void {
  cgroupProbeForTests = cgroup;
  procfsProbeForTests = procfs;
}

export function _resetSourceNoticeForTests(): void {
  checked = false;
  cgroupProbeForTests = null;
  procfsProbeForTests = null;
}