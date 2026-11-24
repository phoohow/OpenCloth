import type { Pattern } from '@/model/types';

export interface GarmentTemplate {
  key: string;
  name: string;
  summary: string;
  revision: string;
  params?: Record<string, number>;
  source: 'file' | 'user';
  assetId?: string;
  generate(fabricId: string): Pattern;
}
