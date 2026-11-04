export const RULE_TYPES = Object.freeze({
  ATTR_MATCH:  'ATTR_MATCH',
  ATTR_SUBSET: 'ATTR_SUBSET',
  ATTR_LTE:    'ATTR_LTE',
});

export const PSU_HEADROOM_WATTS = 100;
export const PSU_FACTOR         = 1.2;
export const MAX_ITEMS          = 25;

// BuildPcGroup slugs used in code rules
export const SLOT = Object.freeze({
  CPU:          'cpu',
  MAINBOARD:    'mainboard',
  RAM:          'ram',
  SSD:          'ssd',
  HDD:          'hdd',
  VGA:          'vga',
  VGA_LIKE_NEW: 'vga-like-new',
  PSU:          'psu',
  CASE:         'case',
});

// Attribute slugs used in code rules
export const ATTR = Object.freeze({
  SO_KHE_RAM:  'so-khe-ram',
  SO_KHE_M2:   'so-khe-m-2',
  RAM_MODULES: 'ram-modules',
  TDP:         'tdp',
  PSU_WATTAGE: 'psu-wattage',
});

// Category slug for M.2 SSDs (used in M2_SLOTS rule)
export const CAT_SSD_M2 = 'ssd-m2';
