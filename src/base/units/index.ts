export const CM_PER_M = 100;

export const MM_PER_CM = 10;

export const CM2_PER_M2 = CM_PER_M * CM_PER_M;

export const CM_PER_INCH = 2.54;

export const CM_PER_UNIT: Record<LengthUnit, number> = { mm: 1 / MM_PER_CM, cm: 1, inch: CM_PER_INCH };

export type LengthUnit = 'mm' | 'cm' | 'inch';

export const cmToM = (cm: number): number => cm / CM_PER_M;

export const cm2ToM2 = (cm2: number): number => cm2 / CM2_PER_M2;

export const mToCm = (m: number): number => m * CM_PER_M;

export const cmToMm = (cm: number): number => cm * MM_PER_CM;

export const mmToCm = (mm: number): number => mm / MM_PER_CM;
