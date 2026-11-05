export const CM_PER_M = 100;
export const MM_PER_CM = 10;

export const cmToM = (cm: number): number => cm / CM_PER_M;
export const mToCm = (m: number): number => m * CM_PER_M;
export const cmToMm = (cm: number): number => cm * MM_PER_CM;
export const mmToCm = (mm: number): number => mm / MM_PER_CM;
