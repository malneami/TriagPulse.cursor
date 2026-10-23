/* Host-resource readings. Additive/display-only; never part of Speed. */
import {
  closeSync,
  existsSync,
  fstatSync,
  openSync,
  readFileSync,
  readdirSync,
  statfsSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { availableParallelism, cpus, loadavg, uptime } from "node:os";
import { join } from "node:path";
import { linearScore, ratingFor } from "./healthAxes";
import { REASON_BLOCKED_BY_ENVIRONMENT } from "./axisReasons";
import type { ExtraAxis } from "./extraMeters";
import { windowMinOf, windowPhrase } from "./rateHonesty";
import { hostPlatform, systemUnavailableReading } from "./systemLimits";
import {
  SETTLE_FAMILIES,
  isSettling,
  markSettled,
  settledFromMs,
  settlingReading,
  spanJudgeable,
} from "./settleRule";

export const DISK_USED_PCT_GOOD = 75;
export const DISK_USED_PCT_POOR = 95;
export const IO_GOOD_MB_PER_SEC = 2;
export const IO_POOR_MB_PER_SEC = 100;
export const FAULT_GOOD_PER_MIN = 1;
export const FAULT_POOR_PER_MIN = 100;
export const FDMIX_SOCK_PCT_GOOD = 70;
export const FDMIX_SOCK_PCT_POOR = 95;
export const FDMIX_MIN_FDS = 20;
export const FDMIX_SCAN_CAP = 4096;
export const SYSTEM_LOAD_GOOD = 0.7;
export const SYSTEM_LOAD_POOR = 2.0;
/** The start-up rule (peakRate): a counter rate is taken over samples after
 *  the process settles, across at least five minutes of them, and never over
 *  more than the newest half hour. Start-up loads modules and config from
 *  disk, which is neither page-fault trouble nor I/O pressure. */
export const HOST_RATE_MIN_SPAN_MS = SETTLE_FAMILIES.peakRate.minSpanSec * 1000;
export const HOST_RATE_WINDOW_MS = 30 * 60_000;
/** The shared decision (ioPressure): the meter is named for I/O STALL
 *  pressure, so the grade is the kernel's pressure-stall share (the "some"
 *  line's one-minute average); throughput rides as context. */
export const IO_STALL_PCT_GOOD = 2;
export const IO_STALL_PCT_POOR = 25;

// kit-probe-file observation point constants (contract table §6/§8).
export const STORAGE_LATENCY_GOOD_MS = 8;
export const STORAGE_LATENCY_POOR_MS = 120;
export const STORAGE_FAILURE_GOOD_PCT = 1;
export const STORAGE_FAILURE_POOR_PCT = 10;
export const STORAGE_MIN_OPERATIONS = 5;
export const STORAGE_RING_CAP = 200;
/** The start-up rule (latencyTail): the probe latency tail is taken from probes
 *  after settling, never the very first probe (it pays the directory lookup
 *  and a cold page cache), and from 20 of them or more. */
export const STORAGE_LATENCY_MIN_SETTLED = SETTLE_FAMILIES.latencyTail.minSamples;

const MB = 1024 * 1024;
/** One tick of the two /proc counters. Each half is independently nullable:
 *  a host that publishes /proc/self/stat but not /proc/self/io (a sandbox, a
 *  hardened container) can still be asked about page faults, and reading the
 *  two as one sample made the missing source silence the reading that did not
 *  need it. */
type CounterSample = {
  at: number;
  read: number | null;
  written: number | null;
  major: number | null;
};
let samples: CounterSample[] = [];
let storageDurations: number[] = [];
let storageAttempts = 0;
let storageFailures = 0;
let storageSuccesses = 0;
let containerCache: boolean | undefined;

/** Test seams: a disk, a load average and a pressure-stall file to read
 *  instead of the host's own. Null reads the host. */
type StatfsReading = { totalBytes: number; freeBytes: number };
let statfsOverride: (() => StatfsReading | null) | null = null;
let loadOverride: { load: number; cpus: number; uptimeSec: number } | null = null;
let psiOverride: string | null = null;

function r1(n: number): number { return Math.round(n * 10) / 10; }
function r2(n: number): number { return Math.round(n * 100) / 100; }

export function hostVolumeScopeCode(): 2 | 3 {
  if (containerCache !== undefined) return containerCache ? 2 : 3;
  let boxed = false;
  try { boxed = existsSync("/.dockerenv"); } catch { boxed = false; }
  if (!boxed) {
    try {
      const cgroup = readFileSync("/proc/self/cgroup", "utf8");
      boxed = /docker|kubepods|containerd|lxc/.test(cgroup);
    } catch { boxed = false; }
  }
  containerCache = boxed;
  return boxed ? 2 : 3;
}

function scored(value: number, good: number, poor: number): Pick<ExtraAxis, "score" | "rating"> {
  const score = linearScore(value, good, poor);
  return { score, rating: ratingFor(score) };
}

function readCounters(now: number): void {
  if (hostPlatform() !== "linux") return;
  let read: number | null = null;
  let written: number | null = null;
  let major: number | null = null;
  try {
    let r = -1, w = -1;
    for (const line of readFileSync("/proc/self/io", "utf8").split("\n")) {
      if (line.startsWith("read_bytes:")) r = Number(line.slice(11).trim());
      if (line.startsWith("write_bytes:")) w = Number(line.slice(12).trim());
    }
    if (r >= 0 && w >= 0) { read = r; written = w; }
  } catch { /* source absent/refused: this half is omitted, not the sample */ }
  try {
    const raw = readFileSync("/proc/self/stat", "utf8");
    const fields = raw.slice(raw.lastIndexOf(") ") + 2).trim().split(/\s+/);
    const m = Number(fields[9]); // field 12; suffix begins at field 3.
    if (Number.isFinite(m)) major = m;
  } catch { /* same */ }
  if (read === null && major === null) return;
  pushCounterSample({ at: now, read, written, major });
}

function pushCounterSample(sample: CounterSample): void {
  samples.push(sample);
  if (samples.length > 240) samples = samples.slice(-240);
}

/** First and last SETTLED sample (inside the newest half hour) whose own half
 *  of the counter pair is readable, and the span between them — or null while
 *  the settled window is too short to divide by. Each reading asks for the
 *  half it publishes, so one absent source never withdraws the other's
 *  number. The first settled sample is the baseline, so nothing counted
 *  before settling enters the difference. */
function counterWindow(
  has: (s: CounterSample) => boolean,
): { a: CounterSample; b: CounterSample; span: number } | null {
  const newest = samples[samples.length - 1];
  if (!newest) return null;
  const from = Math.max(settledFromMs("peakRate"), newest.at - HOST_RATE_WINDOW_MS);
  const usable = samples.filter((s) => s.at >= from && has(s));
  if (usable.length < 2) return null;
  const a = usable[0]!, b = usable[usable.length - 1]!;
  const span = b.at - a.at;
  return spanJudgeable(span, "peakRate") ? { a, b, span } : null;
}

/** What a counter reading says before its settled window exists: "still
 *  settling" while the process settles and the counter has been read; after
 *  that, nothing until five settled minutes are in hand. */
function counterSettling(has: (s: CounterSample) => boolean): ExtraAxis | null {
  const newest = samples[samples.length - 1];
  if (!newest || !samples.some(has) || !isSettling("peakRate", newest.at)) return null;
  return settlingReading({ score: null, scopeCode: 1 });
}

function readStatfs(): StatfsReading | null {
  if (statfsOverride) return statfsOverride();
  const dir = process.env.BOOSTHIS_STATE_DIR || process.cwd();
  const s = statfsSync(dir, { bigint: true });
  return { totalBytes: Number(s.blocks * s.bsize), freeBytes: Number(s.bavail * s.bsize) };
}

/** The start-up rule (peakRate): unpacking and caches written while a process
 *  boots are not the volume's level, so the reading says "still settling"
 *  until the process settles and reads the volume as it is from then on. */
function diskPressure(now = Date.now()): ExtraAxis | null {
  try {
    const fs = readStatfs();
    if (!fs) return null;
    const total = fs.totalBytes;
    const free = fs.freeBytes;
    if (!(total > 0) || free < 0) return null;
    const usedPct = r1(100 * (total - free) / total);
    const scopeCode = hostVolumeScopeCode();
    if (isSettling("peakRate", now)) return settlingReading({ score: null, scopeCode });
    return markSettled({
      ...scored(usedPct, DISK_USED_PCT_GOOD, DISK_USED_PCT_POOR),
      usedPct, freeMb: Math.round(free / MB), totalMb: Math.round(total / MB),
      scopeCode,
      caption: `${usedPct}% used`,
    });
  } catch { return null; }
}

/** The share of the last minute in which some task waited on I/O, from the
 *  kernel's pressure-stall information: the container's own cgroup first,
 *  then the whole machine. Null where the kernel exposes neither. The Python
 *  kit reads the same two files in the same order. */
function readIoPsi(): { pct: number; source: "cgroup2" | "system" } | null {
  const sources: Array<[string, "cgroup2" | "system"]> = [];
  if (psiOverride !== null) {
    if (psiOverride === "unavailable") return null;
    sources.push([psiOverride, "system"]);
  } else {
    if (hostPlatform() !== "linux") return null;
    for (const [path, code] of [
      ["/sys/fs/cgroup/io.pressure", "cgroup2"],
      ["/proc/pressure/io", "system"],
    ] as const) {
      try {
        sources.push([readFileSync(path, "utf8"), code]);
        break;
      } catch { /* this source absent: try the next */ }
    }
  }
  for (const [text, code] of sources) {
    for (const line of text.split("\n")) {
      const parts = line.trim().split(/\s+/);
      if (parts[0] !== "some") continue;
      for (const field of parts.slice(1)) {
        if (!field.startsWith("avg60=")) continue;
        const v = Number(field.slice(6));
        return Number.isFinite(v) ? { pct: Math.max(0, v), source: code } : null;
      }
    }
  }
  return null;
}

function ioPressure(): ExtraAxis | null {
  // A system with no /proc process files has no byte counters to take this
  // from: say so, rather than send nothing and leave the tile waiting.
  const lacking = systemUnavailableReading("ioPressure", { scopeCode: 1 });
  if (lacking) return lacking;
  const has = (s: CounterSample): boolean => s.read !== null && s.written !== null;
  const win = counterWindow(has);
  if (!win) return counterSettling(has);
  const { a, b, span } = win;
  const windowMin = windowMinOf(span);
  const readBytes = Math.max(0, b.read! - a.read!);
  const writtenBytes = Math.max(0, b.written! - a.written!);
  const rate = ((readBytes + writtenBytes) / MB) / (span / 1000);
  // Throughput is how busy the disk is, not how long work waited on it: it
  // rides as context, and the grade is the stall share. Without the kernel's
  // stall file the reading says it cannot be taken here.
  const psi = readIoPsi();
  const stallPct = psi === null ? null : r2(psi.pct);
  const stall: ExtraAxis =
    psi === null
      ? {
          score: null, rating: "pending", measurable: 0,
          reasonCode: REASON_BLOCKED_BY_ENVIRONMENT, stallPct: null,
        }
      : {
          ...scored(psi.pct, IO_STALL_PCT_GOOD, IO_STALL_PCT_POOR),
          measurable: 1, stallPct, stallSourceCode: psi.source,
        };
  return markSettled({
    ...stall,
    mbPerSec: r2(rate), readMb: Math.round(readBytes / MB),
    writtenMb: Math.round(writtenBytes / MB), windowMin,
    scopeCode: 1,
    caption:
      `${r2(rate)} MB/s storage I/O` +
      (stallPct === null ? "" : ` · ${stallPct}% stalled`) +
      ` · ${windowPhrase(windowMin)}`,
  });
}

function pageFaults(): ExtraAxis | null {
  // Windows counts page faults too, but its count includes soft faults — a
  // different quantity. It is never fed in here under the major-fault name.
  const lacking = systemUnavailableReading("pageFaults", { scopeCode: 1 });
  if (lacking) return lacking;
  const has = (s: CounterSample): boolean => s.major !== null;
  const win = counterWindow(has);
  if (!win) return counterSettling(has);
  const { a, b, span } = win;
  const windowMin = windowMinOf(span);
  const majorFaults = Math.max(0, b.major! - a.major!);
  const rate = majorFaults / (span / 60_000);
  return markSettled({
    ...scored(rate, FAULT_GOOD_PER_MIN, FAULT_POOR_PER_MIN),
    majorFaults, majorPerMin: r1(rate), windowMin,
    scopeCode: 1, caption: `${r1(rate)} major faults/min · ${windowPhrase(windowMin)}`,
  });
}

function descriptorMix(): ExtraAxis | null {
  const lacking = systemUnavailableReading("descriptorMix", { scopeCode: 1 });
  if (lacking) return lacking;
  if (hostPlatform() !== "linux") return null;
  try {
    let sockets = 0, pipes = 0, files = 0, otherFds = 0;
    for (const name of readdirSync("/proc/self/fd").slice(0, FDMIX_SCAN_CAP)) {
      try {
        const s = fstatSync(Number(name));
        if (s.isSocket()) sockets++;
        else if (s.isFIFO()) pipes++;
        else if (s.isFile()) files++;
        else otherFds++;
      } catch { /* descriptor closed during walk */ }
    }
    const total = sockets + pipes + files + otherFds;
    if (total < FDMIX_MIN_FDS) return null;
    const socketsPct = Math.round(100 * sockets / total);
    // The shared decision (descriptorMix): what the table is made of says
    // nothing about running out of it (a busy proxy is mostly sockets by
    // design), so the mix is reported and never graded. Running out is
    // fdSaturation's reading. The Python kit sends the same shape.
    return {
      score: null, rating: "not-scored",
      sockets, pipes, files, otherFds, socketsPct, scopeCode: 1,
      caption: `${sockets} sockets · ${files} files · ${pipes} pipes · ${otherFds} other`,
    };
  } catch { return null; }
}

/** The start-up rule (peakRate): the load this process puts on the machine
 *  while it boots is its own start-up, not the machine's level, so the
 *  reading says "still settling" until the process settles. */
function systemLoad(now = Date.now()): ExtraAxis | null {
  // Windows keeps no load average: Node answers [0, 0, 0] there whatever the
  // machine is doing, which would read as an idle machine. Not available,
  // never zero — decided by the system, before any number is looked at.
  const lacking = systemUnavailableReading("systemLoad", { scopeCode: 3 });
  if (lacking) return lacking;
  try {
    const host = loadOverride ?? {
      load: loadavg()[0],
      cpus: typeof availableParallelism === "function" ? availableParallelism() : cpus().length,
      uptimeSec: uptime(),
    };
    if (host.uptimeSec < 60) return null;
    const load = host.load;
    const count = host.cpus;
    if (!Number.isFinite(load) || count <= 0) return null;
    if (isSettling("peakRate", now)) return settlingReading({ score: null, scopeCode: 3 });
    const loadPerCpu = r2(load / count);
    return markSettled({
      ...scored(loadPerCpu, SYSTEM_LOAD_GOOD, SYSTEM_LOAD_POOR),
      loadPerCpu, load: r2(load), cpus: count, scopeCode: 3,
      caption: `${loadPerCpu} load per CPU`,
    });
  } catch { return null; }
}

function takeStorageProbe(): void {
  const dir = process.env.BOOSTHIS_STATE_DIR;
  if (!dir) return;
  storageAttempts++;
  const path = join(dir, `.boosthis-storage-probe-${process.pid}`);
  const started = performance.now();
  let fd: number | undefined;
  try {
    fd = openSync(path, "w");
    writeFileSync(fd, "1");
    closeSync(fd); fd = undefined;
    readFileSync(path);
    unlinkSync(path);
    fileStorageDuration(Date.now(), Math.max(0, performance.now() - started));
  } catch {
    storageFailures++;
    if (fd !== undefined) try { closeSync(fd); } catch { /* best effort */ }
    try { unlinkSync(path); } catch { /* best effort */ }
  }
}

/** One completed probe's duration, banked for the latency tail only when the
 *  start-up rule lets it judge (see STORAGE_LATENCY_MIN_SETTLED). Every
 *  attempt still counts towards the failure share, which is a fault count. */
function fileStorageDuration(at: number, ms: number): void {
  storageSuccesses++;
  if (storageSuccesses === 1) return;
  if (at < settledFromMs("latencyTail")) return;
  storageDurations.push(ms);
  if (storageDurations.length > STORAGE_RING_CAP) storageDurations.shift();
}

function storagePair(): Record<string, ExtraAxis> {
  if (!process.env.BOOSTHIS_STATE_DIR || storageAttempts < STORAGE_MIN_OPERATIONS) return {};
  const scopeCode = hostVolumeScopeCode();
  const failPct = r1(100 * storageFailures / storageAttempts);
  const out: Record<string, ExtraAxis> = {
    storageFailures: {
      ...scored(failPct, STORAGE_FAILURE_GOOD_PCT, STORAGE_FAILURE_POOR_PCT),
      failPct, failCount: storageFailures, opCount: storageAttempts, scopeCode,
      caption: `${failPct}% failed`,
    },
  };
  if (storageDurations.length >= STORAGE_LATENCY_MIN_SETTLED) {
    const sorted = [...storageDurations].sort((a, b) => a - b);
    const p75Ms = r1(sorted[Math.ceil(sorted.length * .75) - 1]);
    const worstMs = r1(sorted[sorted.length - 1]);
    out.storageLatency = markSettled({
      ...scored(p75Ms, STORAGE_LATENCY_GOOD_MS, STORAGE_LATENCY_POOR_MS),
      p75Ms, worstMs, opCount: storageAttempts, scopeCode,
      caption: `${p75Ms} ms p75`,
    });
  } else if (storageSuccesses === 0) {
    out.storageLatency = {
      score: null, rating: "pending", present: 1, measurable: 0,
      reasonCode: 8, scopeCode,
    };
  } else if (isSettling("latencyTail")) {
    out.storageLatency = settlingReading({ score: null, opCount: storageAttempts, scopeCode });
  }
  return out;
}

export function readHostResourceMeters(now = Date.now()): Record<string, ExtraAxis> {
  readCounters(now);
  takeStorageProbe();
  const out: Record<string, ExtraAxis> = { ...storagePair() };
  const put = (key: string, value: ExtraAxis | null): void => { if (value) out[key] = value; };
  put("diskPressure", diskPressure(now));
  put("ioPressure", ioPressure());
  put("pageFaults", pageFaults());
  put("descriptorMix", descriptorMix());
  put("systemLoad", systemLoad(now));
  return out;
}

export function clearHostResourceMeters(): void {
  samples = []; storageDurations = []; storageAttempts = 0; storageFailures = 0;
  storageSuccesses = 0;
  containerCache = undefined;
  statfsOverride = null; loadOverride = null; psiOverride = null;
}

/** @internal hermetic test hooks. */
export const _hostResourceInternals = {
  diskPressure,
  ioPressure,
  pageFaults,
  descriptorMix,
  systemLoad,
  storagePair,
  takeStorageProbe,
  setSamples(value: CounterSample[]): void { samples = value; },
  pushCounterSample,
  setStorage(attempts: number, failures: number, durations: number[]): void {
    storageAttempts = attempts;
    storageFailures = failures;
    storageSuccesses = attempts - failures;
    storageDurations = durations.slice(-STORAGE_RING_CAP);
  },
  /** File one probe as the real probe does: an attempt, then its duration. */
  fileStorageProbe(at: number, ms: number): void {
    storageAttempts++;
    fileStorageDuration(at, ms);
  },
  setStatfsForTests(fn: (() => StatfsReading | null) | null): void { statfsOverride = fn; },
  setLoadForTests(value: { load: number; cpus: number; uptimeSec: number } | null): void {
    loadOverride = value;
  },
  /** Pressure-stall text to read instead of the host's ("unavailable" = none). */
  setPsiForTests(text: string | null): void { psiOverride = text; },
};
