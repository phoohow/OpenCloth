import { createStarterProject, templatePattern } from '@/app';
import { describe, expect, it } from 'vitest';
import { planWraps, resolveWrap, zoneSweep } from '@/garment/wrapPlan';

describe('wrap plan', () => {
  it('gives a single torso piece the whole front half', () => {
    const project = createStarterProject();
    const front = Object.values(project.pattern.panels).find(panel => panel.name === '前片')!;
    const slot = planWraps(project.pattern).get(front.id)!;
    expect(slot.startRad).toBeCloseTo(-Math.PI / 2, 9);
    expect(slot.sweepRad).toBeCloseTo(Math.PI, 9);
  });

  it('splits the gores of a skirt across the half they name', () => {
    const pattern = templatePattern('skirt');
    const slots = planWraps(pattern);
    const front = Object.values(pattern.panels).filter(panel => panel.name.startsWith('前裙片'));
    const frontSlots = front.map(panel => slots.get(panel.id)!).sort((a, b) => a.startRad - b.startRad);
    expect(frontSlots).toHaveLength(3);
    expect(frontSlots[0]!.startRad).toBeCloseTo(-Math.PI / 2, 9);
    for (let i = 1; i < frontSlots.length; i++) {
      expect(frontSlots[i]!.startRad).toBeCloseTo(frontSlots[i - 1]!.startRad + frontSlots[i - 1]!.sweepRad, 9);
    }

    const last = frontSlots[frontSlots.length - 1]!;
    expect(last.startRad + last.sweepRad).toBeCloseTo(Math.PI / 2, 9);
  });

  it('runs the back half the other way and keeps the sleeve on its own arm', () => {
    const project = createStarterProject();
    const slots = planWraps(project.pattern);
    const back = Object.values(project.pattern.panels).find(panel => panel.name === '后片')!;
    const backSlot = slots.get(back.id)!;
    expect(backSlot.startRad).toBeCloseTo(3 * Math.PI / 2, 9);
    expect(backSlot.sweepRad).toBeCloseTo(-Math.PI, 9);

    const sleeve = Object.values(project.pattern.panels).find(panel => panel.name === '左袖')!;
    expect(resolveWrap(sleeve).side).toBe('left');
  });

  it('turns a limb piece the way the sheet holds its partner', () => {
    const sleeves = createStarterProject().pattern;
    const leftSleeve = Object.values(sleeves.panels).find(panel => panel.name === '左袖')!;
    const sleeveSlot = planWraps(sleeves).get(leftSleeve.id)!;
    expect(sleeveSlot.startRad + sleeveSlot.sweepRad / 2).toBeCloseTo(0, 9);
    expect(sleeveSlot.sweepRad).toBeCloseTo(-zoneSweep('arm', 'full').sweepRad, 9);

    const trousers = templatePattern('pants-long');
    const slots = planWraps(trousers);
    for (const [leftName, rightName, zone] of [
      ['前裤片（左）', '前裤片（右）', 'front'],
      ['后裤片（左）', '后裤片（右）', 'back'],
    ] as const) {
      const left = Object.values(trousers.panels).find(panel => panel.name === leftName)!;
      const right = Object.values(trousers.panels).find(panel => panel.name === rightName)!;
      expect(slots.get(left.id)).toEqual(slots.get(right.id));
      expect(Math.sign(slots.get(left.id)!.sweepRad)).toBe(Math.sign(zoneSweep('leg', zone).sweepRad));
    }
  });

  it('gives limbs the sectors the torso uses', () => {
    for (const zone of ['front', 'back', 'full'] as const) {
      expect(zoneSweep('leg', zone)).toEqual(zoneSweep('torso', zone));
      expect(zoneSweep('arm', zone)).toEqual(zoneSweep('torso', zone));
    }
  });

  it('plans nothing for a panel placed by hand', () => {
    const project = createStarterProject();
    const front = Object.values(project.pattern.panels).find(panel => panel.name === '前片')!;
    front.placement = { position: { x: 0, y: 0, z: 0 }, rotationEuler: { x: 0, y: 0, z: 0 } };
    expect(planWraps(project.pattern).has(front.id)).toBe(false);
  });
});
