import type { RobotResult, RobotTask, RobotYear, Scenario } from './types';

export const ROBOT_TASKS: RobotTask[] = ['cabinTurnover', 'greenhouse', 'dcHands', 'solarOps', 'livestock', 'maintenance'];

/** Share of a task's human hours a humanoid can take on in a given year (logistic adoption curve). */
export function readiness(s: Scenario, task: RobotTask, year: number): number {
  const t = s.robots.tasks[task];
  return 1 / (1 + Math.exp(-t.steepness * (year - (t.midYear + s.robots.readinessShiftYears))));
}

/** Price of one work-capable humanoid in a given year (US$). */
export function robotPriceUsd(s: Scenario, year: number): number {
  return s.robots.priceUsd * Math.pow(1 - s.robots.priceDeclinePctYr / 100, year - s.robots.priceRefYear);
}

export function robotLeaseUsdPerMonth(s: Scenario, year: number): number {
  return s.robots.leaseUsdPerMonth * Math.pow(1 - s.robots.priceDeclinePctYr / 100, year - s.robots.priceRefYear);
}

/** Human labour the site needs each year, by task, derived from the plan. */
export function taskHours(s: Scenario, x: { guestNights: number; greenhouseM2: number; kwdc: number; dse: number; dwellings: number }): Record<RobotTask, number> {
  const stays = x.guestNights / 2.2;
  return {
    cabinTurnover: stays * 2.5 + x.guestNights * 0.3,
    greenhouse: x.greenhouseM2 * 0.9,
    dcHands: s.compute.servers > 0 ? (0.4 * s.compute.staffPerYr) / s.robots.tasks.dcHands.wage : 0,
    solarOps: (x.kwdc / 1000) * 50,
    livestock: x.dse * 1.5,
    maintenance: 300 + 20 * x.dwellings,
  };
}

const zero = (): Record<RobotTask, number> => ({ cabinTurnover: 0, greenhouse: 0, dcHands: 0, solarOps: 0, livestock: 0, maintenance: 0 });

/**
 * Allocates the fleet's human-equivalent hours to the tasks robots can do that year: labour that is already a cash
 * cost first (highest wage first), then owner time. Savings are labour cost avoided.
 */
export function robotYears(s: Scenario, hours: Record<RobotTask, number>, startYear: number, years: number, inflationPct: number): RobotResult {
  const r = s.robots;
  const out: RobotYear[] = [];
  const order = [...ROBOT_TASKS].sort((a, b) => (Number(r.tasks[b].costed) - Number(r.tasks[a].costed)) || r.tasks[b].wage - r.tasks[a].wage);
  const capacityPerRobot = r.hoursPerDay * 365 * (r.uptimePct / 100);
  for (let i = 0; i < years; i++) {
    const year = startYear + i;
    const ready = zero(), auto = zero();
    let savings = 0, owner = 0, worked = 0;
    const active = r.fleet > 0 && year >= r.deployYear;
    for (const t of ROBOT_TASKS) ready[t] = readiness(s, t, year);
    if (active) {
      let capacity = r.fleet * capacityPerRobot * r.productivity;
      const wageF = Math.pow(1 + inflationPct / 100, i);
      for (const t of order) {
        const take = Math.min(capacity, hours[t] * ready[t]);
        if (take <= 0) continue;
        auto[t] = take;
        capacity -= take;
        if (r.tasks[t].costed) savings += take * r.tasks[t].wage * wageF;
        else owner += take;
      }
      worked = (Object.values(auto).reduce((a, b) => a + b, 0)) / Math.max(0.05, r.productivity);
    }
    out.push({ calYear: year, readiness: ready, automatedHours: auto, humanHours: { ...hours }, cashSavings: savings, ownerHoursFreed: owner, robotHoursWorked: worked, priceUsd: robotPriceUsd(s, year) });
  }
  const mature = out.find((y) => ROBOT_TASKS.every((t) => y.readiness[t] > 0.8 || hours[t] === 0)) ?? out[out.length - 1];
  return { taskHours: hours, years: out, capexFirst: 0, steadySavings: mature?.cashSavings ?? 0 };
}
