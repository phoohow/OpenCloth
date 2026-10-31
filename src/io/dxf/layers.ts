/** Layer naming convention a garment DXF file follows. */
export type DxfConvention = 'AAMA' | 'ASTM';

/** Semantic role a garment-CAD layer plays in the pattern model. */
export type LayerRole =
  | 'outline'
  | 'seamAllowance'
  | 'internalLine'
  | 'dart'
  | 'grainline'
  | 'notch'
  | 'drill'
  | 'annotation'
  | 'ignore';

/** Exact AAMA AVX layer names to roles. */
export const AAMA_LAYERS: Record<string, LayerRole> = {
  '001-OUTLINE': 'outline',
  '001-CUTLINE': 'outline',
  '002-SEAMLINE': 'seamAllowance',
  '002-SEAMLNE': 'seamAllowance',
  '002-SEAM': 'seamAllowance',
  '002-HOLE': 'outline',
  '018-DART': 'dart',
  '028-INTERNAL': 'internalLine',
  '028-INNERLN': 'internalLine',
  '029-FOLD': 'internalLine',
  '031-GRAINLINE': 'grainline',
  '040-NOTCH': 'notch',
  '041-NOTCH2': 'notch',
  '042-DRILL': 'drill',
  '043-DRILL2': 'drill',
  '070-TEXT': 'annotation',
  '071-ANNOTATION': 'annotation',
};

/** ASTM layer names to the same roles. */
export const ASTM_LAYERS: Record<string, LayerRole> = {
  OUTLINE: 'outline',
  CUTLINE: 'outline',
  HOLE: 'outline',
  'SEAM-LINE': 'seamAllowance',
  SEAMLNE: 'seamAllowance',
  DART: 'dart',
  INTERNAL: 'internalLine',
  FOLD: 'internalLine',
  'GRAIN-LINE': 'grainline',
  NOTCH: 'notch',
  DRILL: 'drill',
  ANNOTATION: 'annotation',
  TEXT: 'annotation',
};

const CONVENTION_TABLES: Record<DxfConvention, Record<string, LayerRole>> = {
  AAMA: AAMA_LAYERS,
  ASTM: ASTM_LAYERS,
};

/** Exact per-role layer names the writer emits, by convention. */
export const LAYER_NAMES: Record<DxfConvention, Partial<Record<LayerRole, string>>> = {
  AAMA: {
    outline: '001-OUTLINE',
    seamAllowance: '002-SEAMLNE',
    dart: '018-DART',
    internalLine: '028-INTERNAL',
    grainline: '031-GRAINLINE',
    notch: '040-NOTCH',
    drill: '042-DRILL',
    annotation: '070-TEXT',
  },
  ASTM: {
    outline: 'OUTLINE',
    seamAllowance: 'SEAM-LINE',
    dart: 'DART',
    internalLine: 'INTERNAL',
    grainline: 'GRAIN-LINE',
    notch: 'NOTCH',
    drill: 'DRILL',
    annotation: 'TEXT',
  },
};

/** Keyword inference used when a layer name is not in the convention table. */
function inferRole(normalized: string): LayerRole {
  if (normalized.includes('DRILL')) return 'drill';
  if (normalized.includes('NOTCH')) return 'notch';
  if (normalized.startsWith('04')) return normalized.includes('DRILL') ? 'drill' : 'notch';
  if (normalized.includes('GRAIN')) return 'grainline';
  if (normalized.startsWith('031')) return 'grainline';
  if (normalized.includes('OUTLINE') || normalized.includes('CUT') || normalized.includes('HOLE')) return 'outline';
  if (normalized.startsWith('001')) return 'outline';
  if (normalized.includes('SEAM')) return 'seamAllowance';
  if (normalized.startsWith('002')) return 'seamAllowance';
  if (normalized.includes('DART')) return 'dart';
  if (normalized.startsWith('018')) return 'dart';
  if (normalized.includes('FOLD') || normalized.includes('INTERNAL') || normalized.includes('INNERLN')) return 'internalLine';
  if (normalized.startsWith('028') || normalized.startsWith('029')) return 'internalLine';
  if (normalized.includes('TEXT') || normalized.includes('ANNOT') || normalized.includes('MARK')) return 'annotation';
  if (normalized.startsWith('07')) return 'annotation';
  return 'ignore';
}

/** Classifies a DXF layer name into a pattern role under the given convention. */
export function layerRole(name: string, convention: DxfConvention = 'AAMA'): LayerRole {
  const normalized = name.trim().toUpperCase();
  if (normalized === '' || normalized === '0') return 'ignore';
  const exact = CONVENTION_TABLES[convention][normalized];
  if (exact) return exact;
  const other = CONVENTION_TABLES[convention === 'AAMA' ? 'ASTM' : 'AAMA'][normalized];
  if (other) return other;
  return inferRole(normalized);
}

/** The layer name to write entities of this role to; unknown roles fall back to layer '0'. */
export function layerName(role: LayerRole, convention: DxfConvention): string {
  return LAYER_NAMES[convention][role] ?? '0';
}
