/**
 * WHICH READINGS THIS OPERATING SYSTEM CANNOT GIVE, AND WHY.
 *
 * The Node kit — and the Bun kit, which ships these same files — runs on
 * Linux, macOS and Windows. Several readings are taken from places only Linux
 * has: the per-process files under /proc, and the control-group files that
 * state a container's quota. One more, the load average, exists on Linux and
 * macOS but not on Windows, where Node reports it as three zeros.
 *
 * Off Linux those readings went wrong in two ways. Most were simply never
 * sent, so nothing ever said why they were missing. The load average was sent
 * as a measured zero: an idle machine, whatever the real load was.
 *
 * This is the kit's capability table for operating systems: per system, the
 * sources it lacks, each with its own clause; per reading, the one source the
 * kit takes it from, each with its own clause. A reading whose source the
 * system lacks is sent as "not available here" with the platform reason
 * (code 3) — never as a zero, and never fed a different number under its
 * name. Windows does count page faults, for example, but its count includes
 * soft faults, which is not the major-fault count that reading names.
 *
 * THE BOUNDARY RULE. Each reading names the meter-contract boundary its source
 * sits under (scripts/src/meter-coverage/contract.ts). An entry may only blame
 * a boundary that is on that reading's own list in the contract, and a guard
 * holds every entry here to that. A reading whose missing source is NOT on its
 * list keeps its ordinary "nothing yet" state instead. The thread count is one
 * such reading: its only boundary is the threads themselves, which Windows and
 * macOS have — it is the kit's way of counting them that is Linux-only — so it
 * is deliberately absent from this table.
 *
 * WHY THE SERVER HAS NO SECOND COPY. The server is never told which operating
 * system an install runs on, so it could not choose between these clauses. It
 * renders the kit's code with its own words for code 3 ("the platform does
 * not share this number with apps"), in every language it serves. The clauses
 * here ride the kit's own caption and its in-app panel.
 *
 * Linux lacks none of these sources, so on Linux nothing here changes a single
 * reading. Neither does any other system this table does not name.
 */

import { REASON_PLATFORM_DOES_NOT_EXPOSE } from "./axisReasons";
import { hostPlatform } from "./storage";

/** Where a reading is taken from, among the sources some systems lack. */
export type SystemSource = "proc-files" | "cgroup-files" | "load-average";

/** The systems this table speaks for. Every other system is left alone. */
export type LimitedSystem = "win32" | "darwin";

/** Per system, each source it lacks, with the clause saying so. This clause
 *  opens the reason; the reading's own clause below is joined onto it. */
export const SYSTEM_LACKS: Readonly<
  Record<LimitedSystem, Readonly<Partial<Record<SystemSource, string>>>>
> = {
  win32: {
    "proc-files": "Windows has no /proc process files",
    "cgroup-files": "Windows has no Linux control groups",
    // Node documents loadavg() as returning [0, 0, 0] here: a constant, not a
    // measurement of an idle machine.
    "load-average": "Windows keeps no load average",
  },
  darwin: {
    "proc-files": "macOS has no /proc process files",
    "cgroup-files": "macOS has no Linux control groups",
  },
};

/** The meter-contract boundaries an entry here may blame. */
export type SystemLimitBoundary = "own-process" | "proc-filesystem" | "container-limits";

/** One reading the table can withhold. */
export interface SystemLimitedReading {
  /** The one place the kit takes this reading from. */
  readonly source: SystemSource;
  /** The meter-contract boundary that source sits under. Must be on this
   *  reading's own boundary list in the contract; a guard checks it. */
  readonly boundary: SystemLimitBoundary;
  /** The reading's own clause: what the missing source means for THIS
   *  reading. Joined onto the system's clause, so one system fact is written
   *  once and every reading built on it says the same true thing about it. */
  readonly clause: string;
}

/** Every reading a system can lack the source of, keyed by its axis name. */
export const SYSTEM_LIMITED_READINGS = {
  // The load average is what the operating system tells every process about
  // the machine it runs on, which is why the contract lists the reading under
  // the process boundary. Taken from os.loadavg().
  systemLoad: {
    source: "load-average",
    boundary: "own-process",
    clause: "so there is no machine load to report",
  },
  // Taken from /proc/self/io.
  ioPressure: {
    source: "proc-files",
    boundary: "proc-filesystem",
    clause: "so there are no disk byte counters for this process",
  },
  // Taken from /proc/self/stat. Windows has a page-fault count of its own,
  // and it includes soft faults (a page that was already in memory). Feeding
  // it here would publish a different quantity under the major-fault name.
  pageFaults: {
    source: "proc-files",
    boundary: "proc-filesystem",
    clause: "so there is no major page-fault count for this process",
  },
  // Taken from /proc/self/fd.
  descriptorMix: {
    source: "proc-files",
    boundary: "proc-filesystem",
    clause: "so there is no list of this process's open descriptors",
  },
  // Taken from /proc/self/fd and /proc/self/limits.
  fdSaturation: {
    source: "proc-files",
    boundary: "proc-filesystem",
    clause: "so open descriptors cannot be set against their limit",
  },
  // Taken from /proc/self/status.
  contextSwitching: {
    source: "proc-files",
    boundary: "proc-filesystem",
    clause: "so there are no context-switch counts for this process",
  },
  // Taken from /sys/fs/cgroup (cpu.max, or the version-1 quota files).
  cpuEntitlement: {
    source: "cgroup-files",
    boundary: "proc-filesystem",
    clause: "so there is no CPU quota to read",
  },
  // Taken from /sys/fs/cgroup (memory.max and memory.current).
  containerPressure: {
    source: "cgroup-files",
    boundary: "container-limits",
    clause: "so there is no container memory limit to read",
  },
  // Taken from /sys/fs/cgroup (cpu.max and cpu.stat).
  cpuThrottling: {
    source: "cgroup-files",
    boundary: "container-limits",
    clause: "so there are no CPU throttling counters to read",
  },
} as const satisfies Record<string, SystemLimitedReading>;

export type SystemLimitedAxis = keyof typeof SYSTEM_LIMITED_READINGS;

/* ─── Which system is this? ───────────────────────────────────────── */

// One switch for the whole kit, kept in the storage module (which must load
// with no imports of its own): the store and the readings answer to it alike,
// so a suite standing in for Windows changes both at once.
export { hostPlatform, _setHostPlatformForTests } from "./storage";

function limitedSystem(): LimitedSystem | null {
  const p = hostPlatform();
  return p === "win32" || p === "darwin" ? p : null;
}

/** Why this system cannot give the reading — its clause and the reading's,
 *  joined — or null where the system has the source. */
export function systemLacksSourceOf(axis: SystemLimitedAxis): string | null {
  const system = limitedSystem();
  if (system === null) return null;
  const reading = SYSTEM_LIMITED_READINGS[axis];
  const lacks = SYSTEM_LACKS[system][reading.source];
  return lacks === undefined ? null : `${lacks}, ${reading.clause}`;
}

/** The shape a withheld reading takes on the wire. */
export interface SystemUnavailableReading {
  score: null;
  rating: "not-available";
  measurable: 0;
  reasonCode: typeof REASON_PLATFORM_DOES_NOT_EXPOSE;
  caption: string;
  [k: string]: number | string | null;
}

/**
 * The "not available here" reading for an axis whose source this system
 * lacks, or null where the system has it (always null on Linux).
 *
 * `extra` carries the reading's own context fields — its scope code, for one —
 * so a withheld reading still says WHERE it would have been taken.
 */
export function systemUnavailableReading(
  axis: SystemLimitedAxis,
  extra: Record<string, number | string> = {},
): SystemUnavailableReading | null {
  const why = systemLacksSourceOf(axis);
  if (why === null) return null;
  return {
    ...extra,
    score: null,
    rating: "not-available",
    measurable: 0,
    reasonCode: REASON_PLATFORM_DOES_NOT_EXPOSE,
    caption: `not available here \u2014 ${why}`,
  };
}
